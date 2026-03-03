import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";
import { fetchWithProxy } from "../../lib/fetchWithProxy.ts";

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

async function linearQuery(apiKey: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetchWithProxy(LINEAR_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API error: ${res.status}`);
  const json = await res.json() as { data?: unknown; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

export class LinearConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "linear",
      name: "Linear",
      description: "Streamline engineering project management and issue tracking.",
      authType: "api_key",
      actions: [
        {
          name: "create_issue",
          description: "Create a new Linear issue",
          params: {
            title: { type: "string", description: "Issue title", required: true },
            description: { type: "string", description: "Issue description (markdown)" },
            teamId: { type: "string", description: "Team ID", required: true },
            priority: { type: "number", description: "Priority 0-4 (0=No priority, 1=Urgent)" },
            labelIds: { type: "array", description: "Array of label IDs" },
            assigneeId: { type: "string", description: "Assignee user ID" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            return linearQuery(creds.apiKey!, `
              mutation CreateIssue($input: IssueCreateInput!) {
                issueCreate(input: $input) { success issue { id identifier title url } }
              }
            `, { input: params });
          },
        },
        {
          name: "update_issue",
          description: "Update a Linear issue",
          params: {
            id: { type: "string", description: "Issue ID", required: true },
            title: { type: "string", description: "New title" },
            description: { type: "string", description: "New description" },
            stateId: { type: "string", description: "State ID to transition to" },
            priority: { type: "number", description: "Priority 0-4" },
            assigneeId: { type: "string", description: "Assignee user ID" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const { id, ...input } = params;
            return linearQuery(creds.apiKey!, `
              mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
                issueUpdate(id: $id, input: $input) { success issue { id state { name } } }
              }
            `, { id, input });
          },
        },
        {
          name: "create_comment",
          description: "Add a comment to an issue",
          params: {
            issueId: { type: "string", description: "Issue ID", required: true },
            body: { type: "string", description: "Comment body (markdown)", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            return linearQuery(creds.apiKey!, `
              mutation CreateComment($input: CommentCreateInput!) {
                commentCreate(input: $input) { success comment { id body } }
              }
            `, { input: params });
          },
        },
      ],
    };
  }
}

export const linearConnector = new LinearConnector();
