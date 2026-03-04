import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use a temp dir with { proxy: {} } so project-level settings override any user
// proxy settings without mocking the settings module.
const TEST_DIR = mkdtempSync(join(tmpdir(), "sofik-fwp-"));
const ORIG_CWD = process.cwd();

import { invalidateSettingsCache } from "./settings.ts";
import { fetchWithProxy } from "./fetchWithProxy.ts";

beforeAll(() => {
  mkdirSync(join(TEST_DIR, ".sofik"), { recursive: true });
  writeFileSync(join(TEST_DIR, ".sofik", "settings.json"), JSON.stringify({ proxy: {} }), "utf-8");
  process.chdir(TEST_DIR);
  invalidateSettingsCache();
});

afterAll(() => {
  process.chdir(ORIG_CWD);
  invalidateSettingsCache();
  rmSync(TEST_DIR, { recursive: true });
});

// ── Env-var save/restore helpers ───────────────────────────────────────────
const PROXY_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];
let savedEnv: Record<string, string | undefined> = {};

// Track fetch calls with a mock
type FetchCall = { url: unknown; init: unknown };
const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Save and clear proxy env vars
  for (const k of PROXY_VARS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  // Reset fetch call log and install mock fetch
  fetchCalls.length = 0;
  // @ts-ignore
  globalThis.fetch = async (url: unknown, init: unknown): Promise<Response> => {
    fetchCalls.push({ url, init });
    return new Response("ok", { status: 200 });
  };
});

afterEach(() => {
  // Restore env vars
  for (const k of PROXY_VARS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
  // Restore real fetch
  globalThis.fetch = originalFetch;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("fetchWithProxy — no proxy configured", () => {
  test("calls fetch directly when no proxy env vars set", async () => {
    await fetchWithProxy("https://example.com");
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]!.url).toBe("https://example.com");
  });

  test("fetch init is passed through when no proxy", async () => {
    const init = { method: "POST", body: "data" };
    await fetchWithProxy("https://example.com", init);
    expect(fetchCalls[0]!.init).toEqual(init);
  });

  test("returns the Response from fetch when no proxy", async () => {
    const response = await fetchWithProxy("https://example.com");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("undefined init is passed when no proxy and no init given", async () => {
    await fetchWithProxy("https://example.com");
    expect(fetchCalls[0]!.init).toBeUndefined();
  });
});

describe("fetchWithProxy — with proxy via HTTPS_PROXY", () => {
  test("fetch is called with proxy option in init for https URL", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    await fetchWithProxy("https://example.com");
    expect(fetchCalls.length).toBe(1);
    const init = fetchCalls[0]!.init as Record<string, unknown>;
    expect(init["proxy"]).toBe("http://proxy.corp:3128");
  });

  test("fetch is called with the original URL when proxy set", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    await fetchWithProxy("https://example.com");
    expect(fetchCalls[0]!.url).toBe("https://example.com");
  });

  test("existing init options are merged with proxy", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    const init = { method: "GET", headers: { "X-Custom": "value" } };
    await fetchWithProxy("https://example.com", init);
    const mergedInit = fetchCalls[0]!.init as Record<string, unknown>;
    expect(mergedInit["method"]).toBe("GET");
    expect((mergedInit["headers"] as Record<string, string>)["X-Custom"]).toBe("value");
    expect(mergedInit["proxy"]).toBe("http://proxy.corp:3128");
  });

  test("proxy option is added even when init was undefined", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    await fetchWithProxy("https://example.com");
    const init = fetchCalls[0]!.init as Record<string, unknown>;
    expect(init["proxy"]).toBe("http://proxy.corp:3128");
  });

  test("returns Response from fetch when proxy set", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    const response = await fetchWithProxy("https://example.com");
    expect(response.status).toBe(200);
  });
});

describe("fetchWithProxy — with proxy via HTTP_PROXY", () => {
  test("HTTP_PROXY used for http URL", async () => {
    process.env["HTTP_PROXY"] = "http://proxy.corp:3128";
    await fetchWithProxy("http://example.com");
    const init = fetchCalls[0]!.init as Record<string, unknown>;
    expect(init["proxy"]).toBe("http://proxy.corp:3128");
  });

  test("HTTP_PROXY not used for https URL (no proxy for https)", async () => {
    process.env["HTTP_PROXY"] = "http://proxy.corp:3128";
    await fetchWithProxy("https://example.com");
    // No HTTPS_PROXY set → no proxy for https URL
    expect(fetchCalls[0]!.init).toBeUndefined();
  });
});

describe("fetchWithProxy — URL types", () => {
  test("string URL is passed directly to fetch", async () => {
    await fetchWithProxy("https://example.com/path");
    expect(fetchCalls[0]!.url).toBe("https://example.com/path");
  });

  test("URL object is passed to fetch", async () => {
    const urlObj = new URL("https://example.com/resource");
    await fetchWithProxy(urlObj);
    expect(fetchCalls[0]!.url).toBe(urlObj);
  });

  test("Request object is passed to fetch", async () => {
    const req = new Request("https://example.com/api");
    await fetchWithProxy(req);
    expect(fetchCalls[0]!.url).toBe(req);
  });

  test("Request object with proxy: proxy added to init", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    const req = new Request("https://example.com/api");
    await fetchWithProxy(req);
    const init = fetchCalls[0]!.init as Record<string, unknown>;
    expect(init["proxy"]).toBe("http://proxy.corp:3128");
  });

  test("Request object without proxy: init is undefined", async () => {
    const req = new Request("https://example.com/api");
    await fetchWithProxy(req);
    expect(fetchCalls[0]!.init).toBeUndefined();
  });
});

describe("fetchWithProxy — NO_PROXY exclusions", () => {
  test("URL in NO_PROXY list: no proxy used even with HTTPS_PROXY set", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    process.env["NO_PROXY"] = "example.com";
    await fetchWithProxy("https://example.com");
    // Should NOT have proxy since example.com is in NO_PROXY
    expect(fetchCalls[0]!.init).toBeUndefined();
  });

  test("URL not in NO_PROXY list: proxy is used", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    process.env["NO_PROXY"] = "other.com";
    await fetchWithProxy("https://example.com");
    const init = fetchCalls[0]!.init as Record<string, unknown>;
    expect(init["proxy"]).toBe("http://proxy.corp:3128");
  });
});

describe("fetchWithProxy — init merging edge cases", () => {
  test("proxy does not override other init fields", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy:8080";
    const init = { method: "DELETE", credentials: "include" as RequestCredentials };
    await fetchWithProxy("https://example.com", init);
    const merged = fetchCalls[0]!.init as Record<string, unknown>;
    expect(merged["method"]).toBe("DELETE");
    expect(merged["credentials"]).toBe("include");
    expect(merged["proxy"]).toBe("http://proxy:8080");
  });

  test("empty init object is merged with proxy", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy:8080";
    await fetchWithProxy("https://example.com", {});
    const merged = fetchCalls[0]!.init as Record<string, unknown>;
    expect(merged["proxy"]).toBe("http://proxy:8080");
  });

  test("only one fetch call is made per invocation", async () => {
    process.env["HTTPS_PROXY"] = "http://proxy:8080";
    await fetchWithProxy("https://example.com");
    expect(fetchCalls.length).toBe(1);
  });

  test("ALL_PROXY used for https when no HTTPS_PROXY", async () => {
    process.env["ALL_PROXY"] = "http://all-proxy:3128";
    await fetchWithProxy("https://example.com");
    const init = fetchCalls[0]!.init as Record<string, unknown>;
    expect(init["proxy"]).toBe("http://all-proxy:3128");
  });
});
