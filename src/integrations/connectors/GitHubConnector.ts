import { createHmac, timingSafeEqual } from "crypto";
import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";
import { fetchWithProxy } from "../../lib/fetchWithProxy.ts";

export class GitHubConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "github",
      name: "GitHub",
      description: "Connect to GitHub for code review automation, issue tracking, and CI/CD triggers.",
      authType: "api_key",
      actions: [
        {
          name: "create_issue_comment",
          description: "Post a comment on a GitHub issue or PR",
          params: {
            owner: { type: "string", description: "Repository owner", required: true },
            repo: { type: "string", description: "Repository name", required: true },
            issue_number: { type: "number", description: "Issue or PR number", required: true },
            body: { type: "string", description: "Comment body (Markdown supported)", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetchWithProxy(
              `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ body: params.body }),
              }
            );
            if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "create_pr_review",
          description: "Submit a code review on a pull request",
          params: {
            owner: { type: "string", description: "Repository owner", required: true },
            repo: { type: "string", description: "Repository name", required: true },
            pull_number: { type: "number", description: "PR number", required: true },
            body: { type: "string", description: "Review summary", required: true },
            event: { type: "string", description: "APPROVE | REQUEST_CHANGES | COMMENT", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetchWithProxy(
              `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/reviews`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ body: params.body, event: params.event }),
              }
            );
            if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "create_label",
          description: "Add a label to an issue or PR",
          params: {
            owner: { type: "string", description: "Repository owner", required: true },
            repo: { type: "string", description: "Repository name", required: true },
            issue_number: { type: "number", description: "Issue or PR number", required: true },
            labels: { type: "array", description: "Array of label names", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetchWithProxy(
              `https://api.github.com/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/labels`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ labels: params.labels }),
              }
            );
            if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_file_content",
          description: "Get the content of a file from a repository",
          params: {
            owner: { type: "string", description: "Repository owner", required: true },
            repo: { type: "string", description: "Repository name", required: true },
            path: { type: "string", description: "File path in repo", required: true },
            ref: { type: "string", description: "Branch, tag, or commit SHA" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const url = `https://api.github.com/repos/${params.owner}/${params.repo}/contents/${params.path}${params.ref ? `?ref=${params.ref}` : ""}`;
            const res = await fetchWithProxy(url, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            });
            if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
            const data = await res.json() as { content?: string; encoding?: string };
            if (data.content && data.encoding === "base64") {
              return { ...data, decoded_content: Buffer.from(data.content, "base64").toString("utf8") };
            }
            return data;
          },
        },
        {
          name: "list_pr_files",
          description: "List files changed in a pull request",
          params: {
            owner: { type: "string", description: "Repository owner", required: true },
            repo: { type: "string", description: "Repository name", required: true },
            pull_number: { type: "number", description: "PR number", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetchWithProxy(
              `https://api.github.com/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/files`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                },
              }
            );
            if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
            return res.json();
          },
        },
        {
          name: "trigger_workflow",
          description: "Trigger a GitHub Actions workflow",
          params: {
            owner: { type: "string", description: "Repository owner", required: true },
            repo: { type: "string", description: "Repository name", required: true },
            workflow_id: { type: "string", description: "Workflow file name or ID", required: true },
            ref: { type: "string", description: "Branch or tag to run on", required: true },
            inputs: { type: "object", description: "Workflow inputs" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetchWithProxy(
              `https://api.github.com/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow_id}/dispatches`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  Accept: "application/vnd.github+json",
                  "X-GitHub-Api-Version": "2022-11-28",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ ref: params.ref, inputs: params.inputs ?? {} }),
              }
            );
            if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
            return { success: true };
          },
        },
      ],
      verifyWebhook(payload: string, signature: string, secret: string): boolean {
        const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
        try {
          return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        } catch {
          return false;
        }
      },
    };
  }
}

export const githubConnector = new GitHubConnector();
