import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";

// Cloudflare credentials:
// - apiKey: Cloudflare API Token
// - extra.account_id: Cloudflare Account ID
// - extra.zone_id: Default Zone ID (optional)

const BASE_URL = "https://api.cloudflare.com/client/v4";

function cfHeaders(creds: IntegrationCredentials): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.apiKey ?? creds.accessToken ?? ""}`,
    "Content-Type": "application/json",
  };
}

function accountId(creds: IntegrationCredentials): string {
  return (creds.extra?.account_id as string) ?? "";
}

export class CloudflareConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "cloudflare",
      name: "Cloudflare Developer Platform",
      description: "Connect to Cloudflare for Workers, Pages, D1, R2, KV, cache purging, and zone management.",
      authType: "api_key",
      actions: [
        {
          name: "list_workers",
          description: "List all Workers in a Cloudflare account",
          params: {},
          async execute(creds: IntegrationCredentials, _params: Record<string, unknown>) {
            const res = await fetch(`${BASE_URL}/accounts/${accountId(creds)}/workers/scripts`, {
              headers: cfHeaders(creds),
            });
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_worker",
          description: "Get the script content of a Worker",
          params: {
            script_name: { type: "string", description: "Worker script name", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetch(
              `${BASE_URL}/accounts/${accountId(creds)}/workers/scripts/${params.script_name}`,
              { headers: cfHeaders(creds) }
            );
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            const text = await res.text();
            return { script: text };
          },
        },
        {
          name: "deploy_worker",
          description: "Deploy or update a Cloudflare Worker script",
          params: {
            script_name: { type: "string", description: "Worker script name (slug)", required: true },
            script_content: { type: "string", description: "JavaScript Worker script content", required: true },
            compatibility_date: { type: "string", description: "Compatibility date (e.g. 2024-01-01, default: today)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const compatDate = (params.compatibility_date as string) ?? new Date().toISOString().split("T")[0];
            const formData = new FormData();
            formData.append(
              "metadata",
              new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: compatDate })], {
                type: "application/json",
              }),
              "metadata.json"
            );
            formData.append(
              "worker.js",
              new Blob([params.script_content as string], { type: "application/javascript+module" }),
              "worker.js"
            );
            const headers = { Authorization: `Bearer ${creds.apiKey ?? creds.accessToken ?? ""}` };
            const res = await fetch(
              `${BASE_URL}/accounts/${accountId(creds)}/workers/scripts/${params.script_name}`,
              { method: "PUT", headers, body: formData }
            );
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "delete_worker",
          description: "Delete a Cloudflare Worker script",
          params: {
            script_name: { type: "string", description: "Worker script name to delete", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetch(
              `${BASE_URL}/accounts/${accountId(creds)}/workers/scripts/${params.script_name}`,
              { method: "DELETE", headers: cfHeaders(creds) }
            );
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return { success: true, deleted: params.script_name };
          },
        },
        {
          name: "purge_cache",
          description: "Purge Cloudflare cache for a zone",
          params: {
            zone_id: { type: "string", description: "Cloudflare Zone ID (uses extra.zone_id if not provided)" },
            purge_everything: { type: "boolean", description: "Purge all cached files (default: false)" },
            files: { type: "array", description: "Array of URLs to purge (used if purge_everything is false)" },
            tags: { type: "array", description: "Cache tags to purge" },
            prefixes: { type: "array", description: "URL prefixes to purge" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const zoneId = (params.zone_id as string) ?? (creds.extra?.zone_id as string);
            if (!zoneId) throw new Error("zone_id is required for cache purge");
            const body: Record<string, unknown> = {};
            if (params.purge_everything) {
              body.purge_everything = true;
            } else {
              if (params.files) body.files = params.files;
              if (params.tags) body.tags = params.tags;
              if (params.prefixes) body.prefixes = params.prefixes;
            }
            const res = await fetch(`${BASE_URL}/zones/${zoneId}/purge_cache`, {
              method: "POST",
              headers: cfHeaders(creds),
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "list_kv_namespaces",
          description: "List KV namespaces in a Cloudflare account",
          params: {
            page: { type: "number", description: "Page number (default: 1)" },
            per_page: { type: "number", description: "Results per page (default: 20)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const q = new URLSearchParams({ page: String(params.page ?? 1), per_page: String(params.per_page ?? 20) });
            const res = await fetch(`${BASE_URL}/accounts/${accountId(creds)}/storage/kv/namespaces?${q}`, {
              headers: cfHeaders(creds),
            });
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "kv_put",
          description: "Write a key-value pair to a KV namespace",
          params: {
            namespace_id: { type: "string", description: "KV Namespace ID", required: true },
            key: { type: "string", description: "Key name", required: true },
            value: { type: "string", description: "Value to store", required: true },
            expiration_ttl: { type: "number", description: "TTL in seconds before the key expires" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const q = params.expiration_ttl ? `?expiration_ttl=${params.expiration_ttl}` : "";
            const headers = { Authorization: `Bearer ${creds.apiKey ?? creds.accessToken ?? ""}` };
            const res = await fetch(
              `${BASE_URL}/accounts/${accountId(creds)}/storage/kv/namespaces/${params.namespace_id}/values/${encodeURIComponent(params.key as string)}${q}`,
              { method: "PUT", headers, body: params.value as string }
            );
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "list_d1_databases",
          description: "List D1 databases in a Cloudflare account",
          params: {},
          async execute(creds: IntegrationCredentials, _params: Record<string, unknown>) {
            const res = await fetch(`${BASE_URL}/accounts/${accountId(creds)}/d1/database`, {
              headers: cfHeaders(creds),
            });
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "query_d1",
          description: "Execute a SQL query against a Cloudflare D1 database",
          params: {
            database_id: { type: "string", description: "D1 Database ID", required: true },
            sql: { type: "string", description: "SQL query to execute", required: true },
            params: { type: "array", description: "Query parameters for prepared statements" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const body: Record<string, unknown> = { sql: params.sql };
            if (params.params) body.params = params.params;
            const res = await fetch(
              `${BASE_URL}/accounts/${accountId(creds)}/d1/database/${params.database_id}/query`,
              { method: "POST", headers: cfHeaders(creds), body: JSON.stringify(body) }
            );
            if (!res.ok) throw new Error(`Cloudflare D1 API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "list_pages_projects",
          description: "List Cloudflare Pages projects",
          params: {},
          async execute(creds: IntegrationCredentials, _params: Record<string, unknown>) {
            const res = await fetch(`${BASE_URL}/accounts/${accountId(creds)}/pages/projects`, {
              headers: cfHeaders(creds),
            });
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_zone",
          description: "Get details of a Cloudflare zone",
          params: {
            zone_id: { type: "string", description: "Zone ID (uses extra.zone_id if not provided)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const zoneId = (params.zone_id as string) ?? (creds.extra?.zone_id as string);
            if (!zoneId) throw new Error("zone_id is required");
            const res = await fetch(`${BASE_URL}/zones/${zoneId}`, { headers: cfHeaders(creds) });
            if (!res.ok) throw new Error(`Cloudflare API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
      ],
    };
  }
}

export const cloudflareConnector = new CloudflareConnector();
