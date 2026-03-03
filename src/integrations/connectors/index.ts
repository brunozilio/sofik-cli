import { githubConnector } from "./GitHubConnector.ts";
import { stripeConnector } from "./StripeConnector.ts";
import { sentryConnector } from "./SentryConnector.ts";
import { linearConnector } from "./LinearConnector.ts";
import { slackConnector } from "./SlackConnector.ts";
import { playwrightConnector } from "./PlaywrightConnector.ts";
import { context7Connector } from "./Context7Connector.ts";
import { notionConnector } from "./NotionConnector.ts";
import { figmaConnector } from "./FigmaConnector.ts";
import { atlassianConnector } from "./AtlassianConnector.ts";
import { vercelConnector } from "./VercelConnector.ts";
import { supabaseConnector } from "./SupabaseConnector.ts";
import { cloudflareConnector } from "./CloudflareConnector.ts";
import type { BaseConnector } from "../BaseConnector.ts";
import type { IntegrationProvider } from "../../types/integration.ts";

const connectorMap: Map<IntegrationProvider, BaseConnector> = new Map([
  ["github", githubConnector],
  ["stripe", stripeConnector],
  ["sentry", sentryConnector],
  ["linear", linearConnector],
  ["slack", slackConnector],
  ["playwright", playwrightConnector],
  ["context7", context7Connector],
  ["notion", notionConnector],
  ["figma", figmaConnector],
  ["atlassian", atlassianConnector],
  ["vercel", vercelConnector],
  ["supabase", supabaseConnector],
  ["cloudflare", cloudflareConnector],
]);

export function getConnector(provider: IntegrationProvider | string): BaseConnector | null {
  return connectorMap.get(provider as IntegrationProvider) ?? null;
}

export function getAllConnectors(): BaseConnector[] {
  return Array.from(connectorMap.values());
}

export function getAllProviders(): IntegrationProvider[] {
  return Array.from(connectorMap.keys());
}
