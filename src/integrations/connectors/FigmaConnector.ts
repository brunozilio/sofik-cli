import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";

const BASE_URL = "https://api.figma.com/v1";

function figmaHeaders(token: string | undefined): Record<string, string> {
  return { "X-Figma-Token": token ?? "" };
}

export class FigmaConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "figma",
      name: "Figma",
      description: "Connect to Figma to read design files, export assets, and manage comments.",
      authType: "api_key",
      actions: [
        {
          name: "get_file",
          description: "Get a Figma file with its document structure",
          params: {
            file_key: { type: "string", description: "Figma file key (from the file URL)", required: true },
            depth: { type: "number", description: "Depth of document tree to return (default: 2)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const q = new URLSearchParams({ depth: String(params.depth ?? 2) });
            const res = await fetch(`${BASE_URL}/files/${params.file_key}?${q}`, {
              headers: figmaHeaders(token),
            });
            if (!res.ok) throw new Error(`Figma API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_file_nodes",
          description: "Get specific nodes from a Figma file by their IDs",
          params: {
            file_key: { type: "string", description: "Figma file key", required: true },
            node_ids: { type: "array", description: "Array of node IDs to retrieve", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const ids = (params.node_ids as string[]).join(",");
            const res = await fetch(`${BASE_URL}/files/${params.file_key}/nodes?ids=${encodeURIComponent(ids)}`, {
              headers: figmaHeaders(token),
            });
            if (!res.ok) throw new Error(`Figma API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "export_images",
          description: "Export nodes from a Figma file as images",
          params: {
            file_key: { type: "string", description: "Figma file key", required: true },
            node_ids: { type: "array", description: "Array of node IDs to export", required: true },
            format: { type: "string", description: "Export format: png | jpg | svg | pdf (default: png)" },
            scale: { type: "number", description: "Export scale 0.01–4 (default: 1)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const ids = (params.node_ids as string[]).join(",");
            const q = new URLSearchParams({
              ids,
              format: (params.format as string) ?? "png",
              scale: String(params.scale ?? 1),
            });
            const res = await fetch(`${BASE_URL}/images/${params.file_key}?${q}`, {
              headers: figmaHeaders(token),
            });
            if (!res.ok) throw new Error(`Figma API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_comments",
          description: "Get all comments on a Figma file",
          params: {
            file_key: { type: "string", description: "Figma file key", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetch(`${BASE_URL}/files/${params.file_key}/comments`, {
              headers: figmaHeaders(token),
            });
            if (!res.ok) throw new Error(`Figma API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "post_comment",
          description: "Post a comment on a Figma file",
          params: {
            file_key: { type: "string", description: "Figma file key", required: true },
            message: { type: "string", description: "Comment text", required: true },
            node_id: { type: "string", description: "Node ID to anchor the comment to" },
            client_meta: { type: "object", description: "Coordinate position: { x, y } or vector { node_id, node_offset }" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const body: Record<string, unknown> = { message: params.message };
            if (params.client_meta) body.client_meta = params.client_meta;
            const res = await fetch(`${BASE_URL}/files/${params.file_key}/comments`, {
              method: "POST",
              headers: { ...figmaHeaders(token), "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Figma API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_projects",
          description: "List projects in a Figma team",
          params: {
            team_id: { type: "string", description: "Figma team ID", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetch(`${BASE_URL}/teams/${params.team_id}/projects`, {
              headers: figmaHeaders(token),
            });
            if (!res.ok) throw new Error(`Figma API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
      ],
    };
  }
}

export const figmaConnector = new FigmaConnector();
