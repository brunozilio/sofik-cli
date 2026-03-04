import { createHmac, timingSafeEqual } from "crypto";
import { BaseConnector } from "../BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../../types/integration.ts";
import { fetchWithProxy } from "../../lib/fetchWithProxy.ts";

export class StripeConnector extends BaseConnector {
  readonly definition: ConnectorDefinition = {
      provider: "stripe",
      name: "Stripe",
      description: "Automate payment workflows, subscription management, and revenue operations.",
      authType: "api_key",
      actions: [
        {
          name: "create_refund",
          description: "Issue a refund for a payment",
          params: {
            payment_intent: { type: "string", description: "Payment intent ID", required: true },
            amount: { type: "number", description: "Amount in cents (partial refund)" },
            reason: { type: "string", description: "Refund reason" },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const body = new URLSearchParams({ payment_intent: String(params.payment_intent) });
            if (params.amount) body.set("amount", String(params.amount));
            if (params.reason) body.set("reason", String(params.reason));

            const res = await fetchWithProxy("https://api.stripe.com/v1/refunds", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${creds.apiKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: body.toString(),
            });
            if (!res.ok) throw new Error(`Stripe error: ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "cancel_subscription",
          description: "Cancel a customer subscription",
          params: {
            subscription_id: { type: "string", description: "Subscription ID", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetchWithProxy(`https://api.stripe.com/v1/subscriptions/${params.subscription_id}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${creds.apiKey}` },
            });
            if (!res.ok) throw new Error(`Stripe error: ${await res.text()}`);
            return res.json();
          },
        },
        {
          name: "get_customer",
          description: "Get customer details",
          params: {
            customer_id: { type: "string", description: "Customer ID", required: true },
          },
          async execute(creds: IntegrationCredentials, params: Record<string, unknown>) {
            const res = await fetchWithProxy(`https://api.stripe.com/v1/customers/${params.customer_id}`, {
              headers: { Authorization: `Bearer ${creds.apiKey}` },
            });
            if (!res.ok) throw new Error(`Stripe error: ${await res.text()}`);
            return res.json();
          },
        },
      ],
      verifyWebhook(payload: string, signature: string, secret: string): boolean {
        const parts = signature.split(",");
        const t = parts.find((p) => p.startsWith("t="))?.slice(2);
        const v1 = parts.find((p) => p.startsWith("v1="))?.slice(3);
        if (!t || !v1) return false;

        const expected = createHmac("sha256", secret)
          .update(`${t}.${payload}`)
          .digest("hex");
        try {
          return timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
        } catch {
          return false;
        }
      },
  };
}

export const stripeConnector = new StripeConnector();
