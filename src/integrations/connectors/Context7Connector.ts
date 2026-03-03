import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";

const BASE_URL = "https://api.context7.com/v1";

export class Context7Connector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "context7",
      name: "Context7",
      description: "Up-to-date library documentation and API references via Context7. Resolve library IDs and fetch live docs for AI-assisted coding.",
      authType: "api_key",
      actions: [
        {
          name: "resolve_library_id",
          description: "Resolve a library name to its Context7 library ID",
          params: {
            library_name: { type: "string", description: "Name of the library to resolve (e.g. 'react', 'next.js', 'lodash')", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${BASE_URL}/libraries/resolve?name=${encodeURIComponent(params.library_name as string)}`, { headers });
            if (!res.ok) throw new Error(`Context7 API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_library_docs",
          description: "Fetch up-to-date documentation for a library by its Context7 ID",
          params: {
            library_id: { type: "string", description: "Context7 library ID (e.g. '/vercel/next.js')", required: true },
            topic: { type: "string", description: "Specific topic or section to retrieve (e.g. 'routing', 'authentication')" },
            tokens: { type: "number", description: "Max tokens of documentation to return (default: 5000)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const q = new URLSearchParams({ library_id: params.library_id as string });
            if (params.topic) q.set("topic", params.topic as string);
            if (params.tokens) q.set("tokens", String(params.tokens));
            const res = await fetch(`${BASE_URL}/libraries/docs?${q}`, { headers });
            if (!res.ok) throw new Error(`Context7 API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "search_libraries",
          description: "Search for libraries available in Context7",
          params: {
            query: { type: "string", description: "Search query (e.g. 'state management', 'http client')", required: true },
            limit: { type: "number", description: "Max results to return (default: 10)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const q = new URLSearchParams({ q: params.query as string });
            if (params.limit) q.set("limit", String(params.limit));
            const res = await fetch(`${BASE_URL}/libraries/search?${q}`, { headers });
            if (!res.ok) throw new Error(`Context7 API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
      ],
    };
  }
}

export const context7Connector = new Context7Connector();
