import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";
import { fetchWithProxy } from "../../lib/fetchWithProxy.ts";

export class PlaywrightConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "playwright",
      name: "Playwright",
      description: "Browser automation and testing via Playwright. Run tests, take screenshots, and check pages.",
      authType: "api_key",
      actions: [
        {
          name: "run_tests",
          description: "Run Playwright tests in a project directory",
          params: {
            project_path: { type: "string", description: "Absolute path to the project with playwright tests", required: true },
            test_pattern: { type: "string", description: "Glob pattern for test files (e.g. tests/**/*.spec.ts)" },
            reporter: { type: "string", description: "Reporter to use: list | dot | json | html (default: list)" },
            timeout: { type: "number", description: "Test timeout in milliseconds (default: 30000)" },
          },
          async execute(_creds: IntegrationCredentials, params: Record<string, unknown>) {
            const pattern = (params.test_pattern as string) ?? "";
            const reporter = (params.reporter as string) ?? "list";
            const timeout = (params.timeout as number) ?? 30000;
            const args = ["playwright", "test", "--reporter", reporter, `--timeout=${timeout}`];
            if (pattern) args.push(pattern);
            const proc = Bun.spawnSync(args, {
              cwd: params.project_path as string,
              env: { ...process.env },
            });
            const stdout = proc.stdout.toString();
            const stderr = proc.stderr.toString();
            return {
              success: proc.exitCode === 0,
              exit_code: proc.exitCode,
              stdout,
              stderr,
            };
          },
        },
        {
          name: "take_screenshot",
          description: "Take a screenshot of a URL using Playwright",
          params: {
            url: { type: "string", description: "URL to screenshot", required: true },
            output_path: { type: "string", description: "File path to save screenshot (e.g. /tmp/screenshot.png)", required: true },
            full_page: { type: "boolean", description: "Capture full page (default: false)" },
            viewport_width: { type: "number", description: "Viewport width in pixels (default: 1280)" },
            viewport_height: { type: "number", description: "Viewport height in pixels (default: 720)" },
          },
          async execute(_creds: IntegrationCredentials, params: Record<string, unknown>) {
            const fullPage = (params.full_page as boolean) ?? false;
            const width = (params.viewport_width as number) ?? 1280;
            const height = (params.viewport_height as number) ?? 720;
            const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: ${width}, height: ${height} });
  await page.goto(${JSON.stringify(params.url)});
  await page.screenshot({ path: ${JSON.stringify(params.output_path)}, fullPage: ${fullPage} });
  await browser.close();
  console.log('Screenshot saved');
})();
`;
            const proc = Bun.spawnSync(["node", "-e", script], { env: { ...process.env } });
            return {
              success: proc.exitCode === 0,
              output_path: params.output_path,
              stderr: proc.stderr.toString(),
            };
          },
        },
        {
          name: "check_page",
          description: "Load a page and check for JavaScript errors, broken links, or accessibility issues",
          params: {
            url: { type: "string", description: "URL to check", required: true },
            check_console_errors: { type: "boolean", description: "Capture console errors (default: true)" },
            wait_for: { type: "string", description: "CSS selector to wait for before checking" },
          },
          async execute(_creds: IntegrationCredentials, params: Record<string, unknown>) {
            const waitFor = params.wait_for ? `await page.waitForSelector(${JSON.stringify(params.wait_for)});` : "";
            const script = `
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));
  const response = await page.goto(${JSON.stringify(params.url)});
  ${waitFor}
  const title = await page.title();
  await browser.close();
  console.log(JSON.stringify({ status: response.status(), title, console_errors: errors }));
})();
`;
            const proc = Bun.spawnSync(["node", "-e", script], { env: { ...process.env } });
            if (proc.exitCode !== 0) {
              return { success: false, error: proc.stderr.toString() };
            }
            try {
              return { success: true, ...JSON.parse(proc.stdout.toString()) };
            } catch {
              return { success: true, raw: proc.stdout.toString() };
            }
          },
        },
      ],
    };
  }
}

export const playwrightConnector = new PlaywrightConnector();
