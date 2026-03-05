import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";
import { fetchWithProxy } from "../../lib/fetchWithProxy.ts";

// Supabase credentials:
// - apiKey: service_role or anon key
// - extra.project_url: "https://xyzproject.supabase.co"
// - extra.management_token: Supabase Management API token (for project-level ops)

const MANAGEMENT_BASE = "https://api.supabase.com/v1";

function projectHeaders(creds: IntegrationCredentials): Record<string, string> {
  return {
    apikey: (creds.apiKey ?? creds.accessToken) ?? "",
    Authorization: `Bearer ${creds.apiKey ?? creds.accessToken ?? ""}`,
    "Content-Type": "application/json",
  };
}

function managementHeaders(creds: IntegrationCredentials): Record<string, string> {
  const token = (creds.extra?.management_token as string) ?? creds.apiKey ?? creds.accessToken;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function projectUrl(creds: IntegrationCredentials): string {
  return (creds.extra?.project_url as string) ?? "";
}

export class SupabaseConnector extends BaseConnector {
  constructor() { super(); }
  readonly definition: ConnectorDefinition = {
      provider: "supabase",
      name: "Supabase",
      description: "Connect to Supabase for database queries, edge functions, storage, and project management.",
      authType: "api_key",
      actions: [
        {
          name: "run_sql",
          description: "Execute a SQL query against a Supabase project database",
          params: {
            query: { type: "string", description: "SQL query to execute", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetchWithProxy(`${projectUrl(creds)}/rest/v1/rpc/query`, {
              method: "POST",
              headers: projectHeaders(creds),
              body: JSON.stringify({ query: params.query }),
            });
            if (!res.ok) {
              // Fallback: use PostgREST SQL endpoint
              const res2 = await fetchWithProxy(`${projectUrl(creds)}/rest/v1/`, {
                method: "POST",
                headers: { ...projectHeaders(creds), "Content-Profile": "public" },
                body: JSON.stringify({ query: params.query }),
              });
              if (!res2.ok) throw new Error(`Supabase SQL error: ${res2.status} ${await res2.text()}`);
              return res2.json();
            }
            return res.json();
          },
        },
        {
          name: "select_rows",
          description: "Select rows from a Supabase table using PostgREST",
          params: {
            table: { type: "string", description: "Table name", required: true },
            columns: { type: "string", description: "Columns to select (default: *)" },
            filter: { type: "string", description: "PostgREST filter query string (e.g. 'id=eq.1&status=eq.active')" },
            limit: { type: "number", description: "Max rows to return (default: 100)" },
            order: { type: "string", description: "Order by (e.g. 'created_at.desc')" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const q = new URLSearchParams();
            q.set("select", (params.columns as string) ?? "*");
            if (params.limit) q.set("limit", String(params.limit));
            if (params.order) q.set("order", params.order as string);
            if (params.filter) {
              const filterParams = new URLSearchParams(params.filter as string);
              filterParams.forEach((v, k) => q.set(k, v));
            }
            const res = await fetchWithProxy(`${projectUrl(creds)}/rest/v1/${params.table}?${q}`, {
              headers: { ...projectHeaders(creds), Prefer: "return=representation" },
            });
            if (!res.ok) throw new Error(`Supabase API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "insert_row",
          description: "Insert a row into a Supabase table",
          params: {
            table: { type: "string", description: "Table name", required: true },
            data: { type: "object", description: "Row data to insert as key-value pairs", required: true },
            upsert: { type: "boolean", description: "Upsert on conflict (default: false)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const prefer = params.upsert ? "return=representation,resolution=merge-duplicates" : "return=representation";
            const res = await fetchWithProxy(`${projectUrl(creds)}/rest/v1/${params.table}`, {
              method: "POST",
              headers: { ...projectHeaders(creds), Prefer: prefer },
              body: JSON.stringify(params.data),
            });
            if (!res.ok) throw new Error(`Supabase API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "invoke_edge_function",
          description: "Invoke a Supabase Edge Function",
          params: {
            function_name: { type: "string", description: "Edge Function name", required: true },
            payload: { type: "object", description: "JSON payload to send to the function" },
            method: { type: "string", description: "HTTP method: GET | POST (default: POST)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const method = (params.method as string) ?? "POST";
            const res = await fetchWithProxy(`${projectUrl(creds)}/functions/v1/${params.function_name}`, {
              method,
              headers: projectHeaders(creds),
              body: params.payload ? JSON.stringify(params.payload) : undefined,
            });
            if (!res.ok) throw new Error(`Supabase Edge Function error: ${res.status} ${await res.text()}`);
            const text = await res.text();
            try { return JSON.parse(text); } catch { return { result: text }; }
          },
        },
        {
          name: "list_projects",
          description: "List all Supabase projects in the organization (requires Management API token)",
          params: {},
          async execute(creds: IntegrationCredentials, _params: Record<string, unknown>) {
            const res = await fetchWithProxy(`${MANAGEMENT_BASE}/projects`, { headers: managementHeaders(creds) });
            if (!res.ok) throw new Error(`Supabase Management API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_project",
          description: "Get details of a Supabase project (requires Management API token)",
          params: {
            project_ref: { type: "string", description: "Project reference ID", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetchWithProxy(`${MANAGEMENT_BASE}/projects/${params.project_ref}`, {
              headers: managementHeaders(creds),
            });
            if (!res.ok) throw new Error(`Supabase Management API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "storage_upload",
          description: "Upload a file to Supabase Storage",
          params: {
            bucket: { type: "string", description: "Storage bucket name", required: true },
            path: { type: "string", description: "File path within the bucket (e.g. 'uploads/image.png')", required: true },
            content: { type: "string", description: "File content (text or base64 for binary)", required: true },
            content_type: { type: "string", description: "MIME type (e.g. 'image/png', 'text/plain')" },
            upsert: { type: "boolean", description: "Overwrite if file exists (default: false)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const headers: Record<string, string> = {
              ...projectHeaders(creds),
              "Content-Type": (params.content_type as string) ?? "text/plain",
            };
            if (params.upsert) headers["x-upsert"] = "true";
            const res = await fetchWithProxy(`${projectUrl(creds)}/storage/v1/object/${params.bucket}/${params.path}`, {
              method: "POST",
              headers,
              body: params.content as string,
            });
            if (!res.ok) throw new Error(`Supabase Storage error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
      ],
  };
}

export const supabaseConnector = new SupabaseConnector();
