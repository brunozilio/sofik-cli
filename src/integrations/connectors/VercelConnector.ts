import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";

const BASE_URL = "https://api.vercel.com";

function vercelHeaders(token: string | undefined): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export class VercelConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "vercel",
      name: "Vercel",
      description: "Connect to Vercel for deployment management, project configuration, and domain handling.",
      authType: "api_key",
      actions: [
        {
          name: "list_projects",
          description: "List all Vercel projects",
          params: {
            team_id: { type: "string", description: "Team ID or slug (optional, for team projects)" },
            limit: { type: "number", description: "Max projects to return (default: 20)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const q = new URLSearchParams({ limit: String(params.limit ?? 20) });
            if (params.team_id) q.set("teamId", params.team_id as string);
            const res = await fetch(`${BASE_URL}/v9/projects?${q}`, { headers: vercelHeaders(token) });
            if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_project",
          description: "Get details of a specific Vercel project",
          params: {
            project_id_or_name: { type: "string", description: "Project ID or name", required: true },
            team_id: { type: "string", description: "Team ID or slug (optional)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const q = params.team_id ? `?teamId=${params.team_id}` : "";
            const res = await fetch(`${BASE_URL}/v9/projects/${params.project_id_or_name}${q}`, {
              headers: vercelHeaders(token),
            });
            if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "list_deployments",
          description: "List deployments for a project",
          params: {
            project_id: { type: "string", description: "Project ID or name", required: true },
            team_id: { type: "string", description: "Team ID or slug (optional)" },
            limit: { type: "number", description: "Max deployments to return (default: 10)" },
            state: { type: "string", description: "Filter by state: BUILDING | ERROR | INITIALIZING | QUEUED | READY | CANCELED" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const q = new URLSearchParams({ projectId: params.project_id as string, limit: String(params.limit ?? 10) });
            if (params.team_id) q.set("teamId", params.team_id as string);
            if (params.state) q.set("state", params.state as string);
            const res = await fetch(`${BASE_URL}/v6/deployments?${q}`, { headers: vercelHeaders(token) });
            if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_deployment",
          description: "Get details of a specific deployment",
          params: {
            deployment_id_or_url: { type: "string", description: "Deployment ID or URL", required: true },
            team_id: { type: "string", description: "Team ID or slug (optional)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const q = params.team_id ? `?teamId=${params.team_id}` : "";
            const res = await fetch(`${BASE_URL}/v13/deployments/${params.deployment_id_or_url}${q}`, {
              headers: vercelHeaders(token),
            });
            if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "cancel_deployment",
          description: "Cancel an ongoing deployment",
          params: {
            deployment_id: { type: "string", description: "Deployment ID to cancel", required: true },
            team_id: { type: "string", description: "Team ID or slug (optional)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const q = params.team_id ? `?teamId=${params.team_id}` : "";
            const res = await fetch(`${BASE_URL}/v12/deployments/${params.deployment_id}/cancel${q}`, {
              method: "PATCH",
              headers: vercelHeaders(token),
            });
            if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "list_env_vars",
          description: "List environment variables for a project",
          params: {
            project_id: { type: "string", description: "Project ID or name", required: true },
            team_id: { type: "string", description: "Team ID or slug (optional)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const q = params.team_id ? `?teamId=${params.team_id}` : "";
            const res = await fetch(`${BASE_URL}/v9/projects/${params.project_id}/env${q}`, {
              headers: vercelHeaders(token),
            });
            if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "create_env_var",
          description: "Create or update an environment variable for a Vercel project",
          params: {
            project_id: { type: "string", description: "Project ID or name", required: true },
            key: { type: "string", description: "Environment variable name", required: true },
            value: { type: "string", description: "Environment variable value", required: true },
            target: { type: "array", description: "Deployment targets: production | preview | development (default: all)" },
            team_id: { type: "string", description: "Team ID or slug (optional)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const q = params.team_id ? `?teamId=${params.team_id}` : "";
            const body = {
              key: params.key,
              value: params.value,
              target: (params.target as string[]) ?? ["production", "preview", "development"],
              type: "plain",
            };
            const res = await fetch(`${BASE_URL}/v10/projects/${params.project_id}/env${q}`, {
              method: "POST",
              headers: vercelHeaders(token),
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Vercel API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
      ],
    };
  }
}

export const vercelConnector = new VercelConnector();
