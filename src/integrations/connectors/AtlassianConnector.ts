import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";
import { fetchWithProxy } from "../../lib/fetchWithProxy.ts";

// Atlassian covers both Jira and Confluence.
// Credentials: apiKey = base64(email:api_token), extra.domain = "yoursite.atlassian.net"

function atlassianHeaders(creds: IntegrationCredentials): Record<string, string> {
  const token = creds.apiKey ?? creds.accessToken;
  return {
    Authorization: `Basic ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function domain(creds: IntegrationCredentials): string {
  return (creds.extra?.domain as string) ?? "";
}

export class AtlassianConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "atlassian",
      name: "Atlassian",
      description: "Connect to Atlassian suite: Jira for issue tracking and Confluence for documentation.",
      authType: "api_key",
      actions: [
        {
          name: "create_jira_issue",
          description: "Create a new Jira issue",
          params: {
            project_key: { type: "string", description: "Jira project key (e.g. ENG, PROJ)", required: true },
            summary: { type: "string", description: "Issue summary/title", required: true },
            issue_type: { type: "string", description: "Issue type: Bug | Task | Story | Epic (default: Task)" },
            description: { type: "string", description: "Issue description (plain text or Atlassian Document Format)" },
            priority: { type: "string", description: "Priority: Highest | High | Medium | Low | Lowest" },
            assignee_account_id: { type: "string", description: "Assignee's Atlassian account ID" },
            labels: { type: "array", description: "Array of label strings" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const base = `https://${domain(creds)}/rest/api/3/issue`;
            const fields: Record<string, unknown> = {
              project: { key: params.project_key },
              summary: params.summary,
              issuetype: { name: (params.issue_type as string) ?? "Task" },
            };
            if (params.description) {
              fields.description = {
                type: "doc",
                version: 1,
                content: [{ type: "paragraph", content: [{ type: "text", text: params.description }] }],
              };
            }
            if (params.priority) fields.priority = { name: params.priority };
            if (params.assignee_account_id) fields.assignee = { accountId: params.assignee_account_id };
            if (params.labels) fields.labels = params.labels;
            const res = await fetchWithProxy(base, {
              method: "POST",
              headers: atlassianHeaders(creds),
              body: JSON.stringify({ fields }),
            });
            if (!res.ok) throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_jira_issue",
          description: "Get a Jira issue by its key",
          params: {
            issue_key: { type: "string", description: "Issue key (e.g. ENG-123)", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetchWithProxy(`https://${domain(creds)}/rest/api/3/issue/${params.issue_key}`, {
              headers: atlassianHeaders(creds),
            });
            if (!res.ok) throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "search_jira_issues",
          description: "Search Jira issues using JQL",
          params: {
            jql: { type: "string", description: "JQL query string (e.g. 'project = ENG AND status = Open')", required: true },
            max_results: { type: "number", description: "Max results to return (default: 20)" },
            fields: { type: "array", description: "Fields to include in response (default: summary, status, assignee)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const body = {
              jql: params.jql,
              maxResults: params.max_results ?? 20,
              fields: (params.fields as string[]) ?? ["summary", "status", "assignee", "priority", "issuetype"],
            };
            const res = await fetchWithProxy(`https://${domain(creds)}/rest/api/3/search`, {
              method: "POST",
              headers: atlassianHeaders(creds),
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "update_jira_issue",
          description: "Update fields of an existing Jira issue",
          params: {
            issue_key: { type: "string", description: "Issue key (e.g. ENG-123)", required: true },
            status_transition_id: { type: "string", description: "Transition ID to change issue status" },
            summary: { type: "string", description: "New summary" },
            assignee_account_id: { type: "string", description: "New assignee account ID" },
            priority: { type: "string", description: "New priority: Highest | High | Medium | Low | Lowest" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const base = `https://${domain(creds)}/rest/api/3/issue/${params.issue_key}`;
            if (params.status_transition_id) {
              const transRes = await fetchWithProxy(`${base}/transitions`, {
                method: "POST",
                headers: atlassianHeaders(creds),
                body: JSON.stringify({ transition: { id: params.status_transition_id } }),
              });
              if (!transRes.ok) throw new Error(`Jira transition error: ${transRes.status} ${await transRes.text()}`);
            }
            const fields: Record<string, unknown> = {};
            if (params.summary) fields.summary = params.summary;
            if (params.assignee_account_id) fields.assignee = { accountId: params.assignee_account_id };
            if (params.priority) fields.priority = { name: params.priority };
            if (Object.keys(fields).length > 0) {
              const res = await fetchWithProxy(base, {
                method: "PUT",
                headers: atlassianHeaders(creds),
                body: JSON.stringify({ fields }),
              });
              if (!res.ok) throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
            }
            return { success: true, issue_key: params.issue_key };
          },
        },
        {
          name: "add_jira_comment",
          description: "Add a comment to a Jira issue",
          params: {
            issue_key: { type: "string", description: "Issue key (e.g. ENG-123)", required: true },
            body: { type: "string", description: "Comment text", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetchWithProxy(`https://${domain(creds)}/rest/api/3/issue/${params.issue_key}/comment`, {
              method: "POST",
              headers: atlassianHeaders(creds),
              body: JSON.stringify({
                body: {
                  type: "doc",
                  version: 1,
                  content: [{ type: "paragraph", content: [{ type: "text", text: params.body }] }],
                },
              }),
            });
            if (!res.ok) throw new Error(`Jira API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "create_confluence_page",
          description: "Create a page in Confluence",
          params: {
            space_key: { type: "string", description: "Confluence space key (e.g. ENG, DOCS)", required: true },
            title: { type: "string", description: "Page title", required: true },
            content: { type: "string", description: "Page content in Confluence Storage Format (HTML-like XHTML)", required: true },
            parent_page_id: { type: "string", description: "ID of the parent page (optional)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const body: Record<string, unknown> = {
              type: "page",
              title: params.title,
              space: { key: params.space_key },
              body: {
                storage: { value: params.content, representation: "storage" },
              },
            };
            if (params.parent_page_id) {
              body.ancestors = [{ id: params.parent_page_id }];
            }
            const res = await fetchWithProxy(`https://${domain(creds)}/wiki/rest/api/content`, {
              method: "POST",
              headers: atlassianHeaders(creds),
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Confluence API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "search_confluence",
          description: "Search Confluence content using CQL",
          params: {
            cql: { type: "string", description: "CQL query (e.g. 'space = ENG AND type = page AND title ~ \"deploy\"')", required: true },
            limit: { type: "number", description: "Max results (default: 10)" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const q = new URLSearchParams({ cql: params.cql as string, limit: String(params.limit ?? 10) });
            const res = await fetchWithProxy(`https://${domain(creds)}/wiki/rest/api/content/search?${q}`, {
              headers: atlassianHeaders(creds),
            });
            if (!res.ok) throw new Error(`Confluence API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
      ],
    };
  }
}

export const atlassianConnector = new AtlassianConnector();
