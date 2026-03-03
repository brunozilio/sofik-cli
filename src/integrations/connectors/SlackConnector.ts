import { createHmac, timingSafeEqual } from "crypto";
import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";
import { fetchWithProxy } from "../../lib/fetchWithProxy.ts";

export class SlackConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "slack",
      name: "Slack",
      description: "Send notifications, post to channels, and respond to slash commands.",
      authType: "api_key",
      actions: [
        {
          name: "send_message",
          description: "Send a message to a Slack channel",
          params: {
            channel: { type: "string", description: "Channel ID or name", required: true },
            text: { type: "string", description: "Message text", required: true },
            blocks: { type: "array", description: "Block Kit blocks for rich formatting" },
            thread_ts: { type: "string", description: "Thread timestamp for replying in thread" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetchWithProxy("https://slack.com/api/chat.postMessage", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                channel: params.channel,
                text: params.text,
                ...(params.blocks ? { blocks: params.blocks } : {}),
                ...(params.thread_ts ? { thread_ts: params.thread_ts } : {}),
              }),
            });
            const data = await res.json() as { ok: boolean; error?: string; ts?: string };
            if (!data.ok) throw new Error(`Slack error: ${data.error}`);
            return data;
          },
        },
        {
          name: "create_channel",
          description: "Create a new Slack channel",
          params: {
            name: { type: "string", description: "Channel name (lowercase, no spaces)", required: true },
            is_private: { type: "boolean", description: "Make channel private" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const token = creds.apiKey ?? creds.accessToken;
            const res = await fetchWithProxy("https://slack.com/api/conversations.create", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ name: params.name, is_private: params.is_private ?? false }),
            });
            const data = await res.json() as { ok: boolean; error?: string; channel?: unknown };
            if (!data.ok) throw new Error(`Slack error: ${data.error}`);
            return data.channel;
          },
        },
      ],
      verifyWebhook(payload: string, signature: string, secret: string): boolean {
        const timestamp = (JSON.parse(payload) as Record<string, unknown>).timestamp ?? "";
        const baseString = `v0:${timestamp}:${payload}`;
        const expected = `v0=${createHmac("sha256", secret).update(baseString).digest("hex")}`;
        try {
          return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
        } catch {
          return false;
        }
      },
    };
  }
}

export const slackConnector = new SlackConnector();
