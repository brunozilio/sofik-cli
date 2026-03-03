// ── Integration Types ──────────────────────────────────────────────────────────

export type IntegrationProvider =
  | "github"
  | "stripe"
  | "resend"
  | "jira"
  | "linear"
  | "sentry"
  | "datadog"
  | "sonarcloud"
  | "cloudflare"
  | "aws"
  | "vercel"
  | "slack"
  | "pagerduty"
  | "playwright"
  | "context7"
  | "notion"
  | "figma"
  | "atlassian"
  | "supabase";

export type AuthType = "oauth2" | "api_key" | "webhook_only";

export interface ConnectorAction {
  name: string;
  description: string;
  params: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (credentials: IntegrationCredentials, params: Record<string, unknown>) => Promise<unknown>;
}

export interface IntegrationCredentials {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  expiresAt?: number;
  extra?: Record<string, unknown>;
}

export interface ConnectorDefinition {
  provider: IntegrationProvider;
  name: string;
  description: string;
  authType: AuthType;
  oauthConfig?: {
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
    clientId?: string;
    clientSecret?: string;
  };
  actions: ConnectorAction[];
  verifyWebhook?: (payload: string, signature: string, secret: string) => boolean;
}
