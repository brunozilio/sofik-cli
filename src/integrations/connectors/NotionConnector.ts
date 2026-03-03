import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";

const BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionHeaders(token: string | undefined): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

export class NotionConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "notion",
      name: "Notion",
      description: "Connect to Notion for page creation, database management, and workspace search.",
      authType: "api_key",
      actions: [
        {
          name: "search",
          description: "Search pages and databases in the Notion workspace",
          params: {
            query: { type: "string", description: "Text to search for", required: true },
            filter_type: { type: "string", description: "Filter results to 'page' or 'database'" },
            page_size: { type: "number", description: "Max results (default: 10, max: 100)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const body: Record<string, unknown> = { query: params.query, page_size: params.page_size ?? 10 };
            if (params.filter_type) body.filter = { value: params.filter_type, property: "object" };
            const res = await fetch(`${BASE_URL}/search`, {
              method: "POST",
              headers: notionHeaders(token),
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Notion API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_page",
          description: "Retrieve a Notion page by its ID",
          params: {
            page_id: { type: "string", description: "Notion page ID (UUID format)", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetch(`${BASE_URL}/pages/${params.page_id}`, {
              headers: notionHeaders(token),
            });
            if (!res.ok) throw new Error(`Notion API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "create_page",
          description: "Create a new page in a Notion database or as a child of an existing page",
          params: {
            parent_id: { type: "string", description: "Parent page ID or database ID", required: true },
            parent_type: { type: "string", description: "'page_id' or 'database_id' (default: page_id)" },
            title: { type: "string", description: "Page title", required: true },
            content: { type: "string", description: "Plain text content for the page body" },
            properties: { type: "object", description: "Database properties (for database parent)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const parentType = (params.parent_type as string) ?? "page_id";
            const body: Record<string, unknown> = {
              parent: { [parentType]: params.parent_id },
              properties: params.properties ?? {
                title: { title: [{ text: { content: params.title } }] },
              },
            };
            if (params.content) {
              body.children = [
                {
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: [{ type: "text", text: { content: params.content } }] },
                },
              ];
            }
            const res = await fetch(`${BASE_URL}/pages`, {
              method: "POST",
              headers: notionHeaders(token),
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Notion API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "update_page",
          description: "Update properties of a Notion page",
          params: {
            page_id: { type: "string", description: "Page ID to update", required: true },
            properties: { type: "object", description: "Properties to update", required: true },
            archived: { type: "boolean", description: "Set to true to archive the page" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const body: Record<string, unknown> = { properties: params.properties };
            if (params.archived !== undefined) body.archived = params.archived;
            const res = await fetch(`${BASE_URL}/pages/${params.page_id}`, {
              method: "PATCH",
              headers: notionHeaders(token),
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Notion API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "append_block",
          description: "Append content blocks to a Notion page",
          params: {
            page_id: { type: "string", description: "Page ID to append content to", required: true },
            content: { type: "string", description: "Plain text content to append as a paragraph", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetch(`${BASE_URL}/blocks/${params.page_id}/children`, {
              method: "PATCH",
              headers: notionHeaders(token),
              body: JSON.stringify({
                children: [
                  {
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: [{ type: "text", text: { content: params.content } }] },
                  },
                ],
              }),
            });
            if (!res.ok) throw new Error(`Notion API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "query_database",
          description: "Query a Notion database with optional filters",
          params: {
            database_id: { type: "string", description: "Database ID to query", required: true },
            filter: { type: "object", description: "Notion filter object" },
            sorts: { type: "array", description: "Array of sort objects" },
            page_size: { type: "number", description: "Max results (default: 10)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const body: Record<string, unknown> = { page_size: params.page_size ?? 10 };
            if (params.filter) body.filter = params.filter;
            if (params.sorts) body.sorts = params.sorts;
            const res = await fetch(`${BASE_URL}/databases/${params.database_id}/query`, {
              method: "POST",
              headers: notionHeaders(token),
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Notion API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
      ],
    };
  }
}

export const notionConnector = new NotionConnector();
