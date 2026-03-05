import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";
import { fetchWithProxy } from "../../lib/fetchWithProxy.ts";

export class SentryConnector extends BaseConnector {
  constructor() { super(); }
  readonly definition: ConnectorDefinition = {
      provider: "sentry",
      name: "Sentry",
      description: "Automate error triage, incident response, and issue management.",
      authType: "api_key",
      actions: [
        {
          name: "update_issue",
          description: "Update an issue status or assignment",
          params: {
            organization_slug: { type: "string", description: "Organization slug", required: true },
            issue_id: { type: "string", description: "Issue ID", required: true },
            status: { type: "string", description: "resolved | unresolved | ignored" },
            assignedTo: { type: "string", description: "Username or email to assign to" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const updates: Record<string, unknown> = {};
            if (params.status) updates.status = params.status;
            if (params.assignedTo) updates.assignedTo = params.assignedTo;

            const res = await fetchWithProxy(
              `https://sentry.io/api/0/organizations/${params.organization_slug}/issues/${params.issue_id}/`,
              {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${creds.apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(updates),
              }
            );
            if (!res.ok) throw new Error(`Sentry error: ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_issue",
          description: "Get Sentry issue details including stack trace",
          params: {
            issue_id: { type: "string", description: "Issue ID", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetchWithProxy(
              `https://sentry.io/api/0/issues/${params.issue_id}/`,
              {
                headers: { Authorization: `Bearer ${creds.apiKey}` },
              }
            );
            if (!res.ok) throw new Error(`Sentry error: ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_issue_events",
          description: "Get recent events/stack traces for an issue",
          params: {
            issue_id: { type: "string", description: "Issue ID", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetchWithProxy(
              `https://sentry.io/api/0/issues/${params.issue_id}/events/latest/`,
              {
                headers: { Authorization: `Bearer ${creds.apiKey}` },
              }
            );
            if (!res.ok) throw new Error(`Sentry error: ${await res.text()}`);
            return res.json();
          },
        },
      ],
  };
}

export const sentryConnector = new SentryConnector();
