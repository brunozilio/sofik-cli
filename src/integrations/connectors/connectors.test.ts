import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createHmac } from "crypto";
import { GitHubConnector } from "./GitHubConnector.ts";
import { StripeConnector } from "./StripeConnector.ts";
import { SentryConnector } from "./SentryConnector.ts";
import { LinearConnector } from "./LinearConnector.ts";
import { SlackConnector } from "./SlackConnector.ts";
import type { IntegrationCredentials } from "../../types/integration.ts";

// ---------------------------------------------------------------------------
// Fetch mock infrastructure
// ---------------------------------------------------------------------------

type FetchCall = { url: unknown; init: unknown };
const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

function mockFetch(
  responseBody: unknown = { id: "123", success: true },
  status = 200
) {
  globalThis.fetch = async (url: unknown, init: unknown): Promise<Response> => {
    fetchCalls.push({ url, init });
    const body =
      typeof responseBody === "string"
        ? responseBody
        : JSON.stringify(responseBody);
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

beforeEach(() => {
  fetchCalls.length = 0;
  mockFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const githubCreds: IntegrationCredentials = { apiKey: "ghp_test_token" };
const stripeCreds: IntegrationCredentials = { apiKey: "sk_test_stripe" };
const sentryCreds: IntegrationCredentials = { apiKey: "sntrys_test_key" };
const linearCreds: IntegrationCredentials = { apiKey: "lin_api_test_key" };
const slackCreds: IntegrationCredentials = { apiKey: "xoxb-test-slack-token" };

// ---------------------------------------------------------------------------
// GitHubConnector
// ---------------------------------------------------------------------------

describe("GitHubConnector", () => {
  const connector = new GitHubConnector();
  const def = connector.definition;

  // ── definition ────────────────────────────────────────────────────────────

  test("constructor creates a valid instance", () => {
    const c = new GitHubConnector();
    expect(c.definition.provider).toBe("github");
  });

  test("definition.provider === 'github'", () => {
    expect(def.provider).toBe("github");
  });

  test("definition.name === 'GitHub'", () => {
    expect(def.name).toBe("GitHub");
  });

  test("definition.authType === 'api_key'", () => {
    expect(def.authType).toBe("api_key");
  });

  test("has action create_issue_comment", () => {
    expect(def.actions.find((a) => a.name === "create_issue_comment")).toBeDefined();
  });

  test("has action create_pr_review", () => {
    expect(def.actions.find((a) => a.name === "create_pr_review")).toBeDefined();
  });

  test("has action create_label", () => {
    expect(def.actions.find((a) => a.name === "create_label")).toBeDefined();
  });

  test("has action get_file_content", () => {
    expect(def.actions.find((a) => a.name === "get_file_content")).toBeDefined();
  });

  test("has action list_pr_files", () => {
    expect(def.actions.find((a) => a.name === "list_pr_files")).toBeDefined();
  });

  test("has action trigger_workflow", () => {
    expect(def.actions.find((a) => a.name === "trigger_workflow")).toBeDefined();
  });

  // ── create_issue_comment ──────────────────────────────────────────────────

  describe("create_issue_comment", () => {
    test("posts to the correct GitHub issues URL", async () => {
      await connector.executeAction("create_issue_comment", githubCreds, {
        owner: "acme",
        repo: "widget",
        issue_number: 42,
        body: "LGTM!",
      });
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe(
        "https://api.github.com/repos/acme/widget/issues/42/comments"
      );
    });

    test("uses POST method", async () => {
      await connector.executeAction("create_issue_comment", githubCreds, {
        owner: "acme",
        repo: "widget",
        issue_number: 1,
        body: "hello",
      });
      expect((fetchCalls[0].init as any).method).toBe("POST");
    });

    test("includes Authorization Bearer header", async () => {
      await connector.executeAction("create_issue_comment", githubCreds, {
        owner: "acme",
        repo: "widget",
        issue_number: 1,
        body: "hello",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer ghp_test_token"
      );
    });

    test("falls back to accessToken when apiKey is absent", async () => {
      const oauthCreds: IntegrationCredentials = { accessToken: "gho_oauth" };
      await connector.executeAction("create_issue_comment", oauthCreds, {
        owner: "acme",
        repo: "widget",
        issue_number: 1,
        body: "hello",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer gho_oauth"
      );
    });

    test("throws on non-ok response", async () => {
      mockFetch("Bad Request", 400);
      await expect(
        connector.executeAction("create_issue_comment", githubCreds, {
          owner: "acme",
          repo: "widget",
          issue_number: 1,
          body: "hello",
        })
      ).rejects.toThrow(/GitHub API error/);
    });
  });

  // ── create_pr_review ──────────────────────────────────────────────────────

  describe("create_pr_review", () => {
    test("posts to the correct pull reviews URL", async () => {
      await connector.executeAction("create_pr_review", githubCreds, {
        owner: "acme",
        repo: "widget",
        pull_number: 7,
        body: "Looks good",
        event: "APPROVE",
      });
      expect(fetchCalls[0].url).toBe(
        "https://api.github.com/repos/acme/widget/pulls/7/reviews"
      );
    });

    test("uses POST method", async () => {
      await connector.executeAction("create_pr_review", githubCreds, {
        owner: "acme",
        repo: "widget",
        pull_number: 7,
        body: "Needs changes",
        event: "REQUEST_CHANGES",
      });
      expect((fetchCalls[0].init as any).method).toBe("POST");
    });

    test("throws on error response", async () => {
      mockFetch("Not Found", 404);
      await expect(
        connector.executeAction("create_pr_review", githubCreds, {
          owner: "acme",
          repo: "widget",
          pull_number: 7,
          body: "body",
          event: "COMMENT",
        })
      ).rejects.toThrow(/GitHub API error/);
    });
  });

  // ── create_label ──────────────────────────────────────────────────────────

  describe("create_label", () => {
    test("posts to the correct labels URL", async () => {
      await connector.executeAction("create_label", githubCreds, {
        owner: "acme",
        repo: "widget",
        issue_number: 3,
        labels: ["bug", "priority:high"],
      });
      expect(fetchCalls[0].url).toBe(
        "https://api.github.com/repos/acme/widget/issues/3/labels"
      );
    });

    test("body includes labels array", async () => {
      await connector.executeAction("create_label", githubCreds, {
        owner: "acme",
        repo: "widget",
        issue_number: 3,
        labels: ["bug"],
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.labels).toEqual(["bug"]);
    });
  });

  // ── get_file_content ──────────────────────────────────────────────────────

  describe("get_file_content", () => {
    test("calls the correct contents URL", async () => {
      mockFetch({ content: btoa("hello world"), encoding: "base64" });
      await connector.executeAction("get_file_content", githubCreds, {
        owner: "acme",
        repo: "widget",
        path: "README.md",
      });
      expect(fetchCalls[0].url).toBe(
        "https://api.github.com/repos/acme/widget/contents/README.md"
      );
    });

    test("appends ?ref= when ref is provided", async () => {
      mockFetch({ content: btoa("data"), encoding: "base64" });
      await connector.executeAction("get_file_content", githubCreds, {
        owner: "acme",
        repo: "widget",
        path: "src/index.ts",
        ref: "main",
      });
      expect(fetchCalls[0].url).toContain("?ref=main");
    });

    test("decodes base64 content into decoded_content", async () => {
      mockFetch({ content: btoa("hello world"), encoding: "base64" });
      const result = await connector.executeAction("get_file_content", githubCreds, {
        owner: "acme",
        repo: "widget",
        path: "README.md",
      }) as any;
      expect(result.decoded_content).toBe("hello world");
    });

    test("returns raw data when encoding is not base64", async () => {
      mockFetch({ content: "plain text", encoding: "none" });
      const result = await connector.executeAction("get_file_content", githubCreds, {
        owner: "acme",
        repo: "widget",
        path: "README.md",
      }) as any;
      expect(result.decoded_content).toBeUndefined();
    });

    test("throws on error response", async () => {
      mockFetch("Forbidden", 403);
      await expect(
        connector.executeAction("get_file_content", githubCreds, {
          owner: "acme",
          repo: "widget",
          path: "secret.txt",
        })
      ).rejects.toThrow(/GitHub API error/);
    });
  });

  // ── list_pr_files ─────────────────────────────────────────────────────────

  describe("list_pr_files", () => {
    test("calls the correct PR files URL", async () => {
      mockFetch([{ filename: "src/index.ts", status: "modified" }]);
      await connector.executeAction("list_pr_files", githubCreds, {
        owner: "acme",
        repo: "widget",
        pull_number: 12,
      });
      expect(fetchCalls[0].url).toBe(
        "https://api.github.com/repos/acme/widget/pulls/12/files"
      );
    });

    test("uses GET method (no method override)", async () => {
      mockFetch([]);
      await connector.executeAction("list_pr_files", githubCreds, {
        owner: "acme",
        repo: "widget",
        pull_number: 12,
      });
      // When method is not set, init.method will be undefined (default GET)
      expect((fetchCalls[0].init as any).method).toBeUndefined();
    });
  });

  // ── trigger_workflow ──────────────────────────────────────────────────────

  describe("trigger_workflow", () => {
    test("posts to the correct dispatches URL", async () => {
      // GitHub returns 204 for workflow dispatch — simulate with 200 here
      mockFetch({}, 200);
      await connector.executeAction("trigger_workflow", githubCreds, {
        owner: "acme",
        repo: "widget",
        workflow_id: "deploy.yml",
        ref: "main",
      });
      expect(fetchCalls[0].url).toBe(
        "https://api.github.com/repos/acme/widget/actions/workflows/deploy.yml/dispatches"
      );
    });

    test("returns { success: true }", async () => {
      mockFetch({}, 200);
      const result = await connector.executeAction("trigger_workflow", githubCreds, {
        owner: "acme",
        repo: "widget",
        workflow_id: "ci.yml",
        ref: "develop",
      });
      expect(result).toEqual({ success: true });
    });

    test("sends inputs in body", async () => {
      mockFetch({}, 200);
      await connector.executeAction("trigger_workflow", githubCreds, {
        owner: "acme",
        repo: "widget",
        workflow_id: "deploy.yml",
        ref: "main",
        inputs: { environment: "production" },
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.inputs).toEqual({ environment: "production" });
    });

    test("throws on error response", async () => {
      mockFetch("Unprocessable Entity", 422);
      await expect(
        connector.executeAction("trigger_workflow", githubCreds, {
          owner: "acme",
          repo: "widget",
          workflow_id: "bad.yml",
          ref: "main",
        })
      ).rejects.toThrow(/GitHub API error/);
    });
  });

  // ── verifyWebhook ─────────────────────────────────────────────────────────

  describe("verifyWebhook", () => {
    const secret = "webhook_secret";
    const payload = JSON.stringify({ action: "opened" });

    test("returns true for a correct HMAC-SHA256 signature", () => {
      const sig = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
      expect(def.verifyWebhook!(payload, sig, secret)).toBe(true);
    });

    test("returns false for a mismatched signature", () => {
      expect(def.verifyWebhook!(payload, "sha256=abc123", secret)).toBe(false);
    });

    test("returns false for a completely wrong format", () => {
      expect(def.verifyWebhook!(payload, "invalid", secret)).toBe(false);
    });

    test("returns false when secret does not match", () => {
      const sig = `sha256=${createHmac("sha256", "wrong_secret").update(payload).digest("hex")}`;
      expect(def.verifyWebhook!(payload, sig, secret)).toBe(false);
    });

    test("returns false when payload is tampered", () => {
      const sig = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
      expect(def.verifyWebhook!("tampered_payload", sig, secret)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// StripeConnector
// ---------------------------------------------------------------------------

describe("StripeConnector", () => {
  const connector = new StripeConnector();
  const def = connector.definition;

  test("constructor creates a valid instance", () => {
    const c = new StripeConnector();
    expect(c.definition.provider).toBe("stripe");
  });

  test("definition.provider === 'stripe'", () => {
    expect(def.provider).toBe("stripe");
  });

  test("definition.name === 'Stripe'", () => {
    expect(def.name).toBe("Stripe");
  });

  test("definition.authType === 'api_key'", () => {
    expect(def.authType).toBe("api_key");
  });

  test("has action create_refund", () => {
    expect(def.actions.find((a) => a.name === "create_refund")).toBeDefined();
  });

  test("has action cancel_subscription", () => {
    expect(def.actions.find((a) => a.name === "cancel_subscription")).toBeDefined();
  });

  test("has action get_customer", () => {
    expect(def.actions.find((a) => a.name === "get_customer")).toBeDefined();
  });

  // ── create_refund ─────────────────────────────────────────────────────────

  describe("create_refund", () => {
    test("posts to https://api.stripe.com/v1/refunds", async () => {
      await connector.executeAction("create_refund", stripeCreds, {
        payment_intent: "pi_test_123",
      });
      expect(fetchCalls[0].url).toBe("https://api.stripe.com/v1/refunds");
    });

    test("uses POST method", async () => {
      await connector.executeAction("create_refund", stripeCreds, {
        payment_intent: "pi_test_123",
      });
      expect((fetchCalls[0].init as any).method).toBe("POST");
    });

    test("sends URLSearchParams body with payment_intent", async () => {
      await connector.executeAction("create_refund", stripeCreds, {
        payment_intent: "pi_test_xyz",
      });
      const body = (fetchCalls[0].init as any).body as string;
      expect(body).toContain("payment_intent=pi_test_xyz");
    });

    test("sends amount when provided", async () => {
      await connector.executeAction("create_refund", stripeCreds, {
        payment_intent: "pi_test_xyz",
        amount: 500,
      });
      const body = (fetchCalls[0].init as any).body as string;
      expect(body).toContain("amount=500");
    });

    test("sends reason when provided", async () => {
      await connector.executeAction("create_refund", stripeCreds, {
        payment_intent: "pi_test_xyz",
        reason: "fraudulent",
      });
      const body = (fetchCalls[0].init as any).body as string;
      expect(body).toContain("reason=fraudulent");
    });

    test("includes Authorization Bearer header", async () => {
      await connector.executeAction("create_refund", stripeCreds, {
        payment_intent: "pi_test",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer sk_test_stripe"
      );
    });

    test("throws on non-ok response", async () => {
      mockFetch("card_declined", 402);
      await expect(
        connector.executeAction("create_refund", stripeCreds, {
          payment_intent: "pi_bad",
        })
      ).rejects.toThrow(/Stripe error/);
    });
  });

  // ── cancel_subscription ───────────────────────────────────────────────────

  describe("cancel_subscription", () => {
    test("sends DELETE to the subscriptions URL", async () => {
      await connector.executeAction("cancel_subscription", stripeCreds, {
        subscription_id: "sub_abc123",
      });
      expect(fetchCalls[0].url).toBe(
        "https://api.stripe.com/v1/subscriptions/sub_abc123"
      );
      expect((fetchCalls[0].init as any).method).toBe("DELETE");
    });

    test("includes Authorization header", async () => {
      await connector.executeAction("cancel_subscription", stripeCreds, {
        subscription_id: "sub_abc123",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer sk_test_stripe"
      );
    });

    test("throws on non-ok response", async () => {
      mockFetch("Not Found", 404);
      await expect(
        connector.executeAction("cancel_subscription", stripeCreds, {
          subscription_id: "sub_missing",
        })
      ).rejects.toThrow(/Stripe error/);
    });
  });

  // ── get_customer ──────────────────────────────────────────────────────────

  describe("get_customer", () => {
    test("GETs the correct customer URL", async () => {
      await connector.executeAction("get_customer", stripeCreds, {
        customer_id: "cus_test_456",
      });
      expect(fetchCalls[0].url).toBe(
        "https://api.stripe.com/v1/customers/cus_test_456"
      );
    });

    test("uses GET method (no method override)", async () => {
      await connector.executeAction("get_customer", stripeCreds, {
        customer_id: "cus_test_456",
      });
      expect((fetchCalls[0].init as any).method).toBeUndefined();
    });

    test("throws on non-ok response", async () => {
      mockFetch("No such customer", 404);
      await expect(
        connector.executeAction("get_customer", stripeCreds, {
          customer_id: "cus_bad",
        })
      ).rejects.toThrow(/Stripe error/);
    });
  });

  // ── verifyWebhook ─────────────────────────────────────────────────────────

  describe("verifyWebhook", () => {
    const secret = "whsec_test";
    const payload = JSON.stringify({ type: "payment_intent.succeeded" });
    const timestamp = "1700000000";

    function buildStripeSignature(ts: string, pl: string, sec: string) {
      const hmac = createHmac("sha256", sec)
        .update(`${ts}.${pl}`)
        .digest("hex");
      return `t=${ts},v1=${hmac}`;
    }

    test("returns true for a valid Stripe webhook signature", () => {
      const sig = buildStripeSignature(timestamp, payload, secret);
      expect(def.verifyWebhook!(payload, sig, secret)).toBe(true);
    });

    test("returns false when signature is missing t= component", () => {
      const hmac = createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      expect(def.verifyWebhook!(payload, `v1=${hmac}`, secret)).toBe(false);
    });

    test("returns false when signature is missing v1= component", () => {
      expect(def.verifyWebhook!(payload, `t=${timestamp}`, secret)).toBe(false);
    });

    test("returns false for a completely wrong signature", () => {
      expect(def.verifyWebhook!(payload, "bad_signature", secret)).toBe(false);
    });

    test("returns false when v1 hash does not match", () => {
      const sig = `t=${timestamp},v1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
      expect(def.verifyWebhook!(payload, sig, secret)).toBe(false);
    });

    test("returns false when payload is tampered after signing", () => {
      const sig = buildStripeSignature(timestamp, payload, secret);
      expect(def.verifyWebhook!("tampered", sig, secret)).toBe(false);
    });

    test("returns false when v1 is too short (timingSafeEqual throws on length mismatch)", () => {
      // v1 = "short" (5 bytes) vs expected (64-byte hex) → timingSafeEqual throws → catch { return false }
      expect(def.verifyWebhook!(payload, `t=${timestamp},v1=short`, secret)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// SentryConnector
// ---------------------------------------------------------------------------

describe("SentryConnector", () => {
  const connector = new SentryConnector();
  const def = connector.definition;

  test("constructor creates a valid instance", () => {
    const c = new SentryConnector();
    expect(c.definition.provider).toBe("sentry");
  });

  test("definition.provider === 'sentry'", () => {
    expect(def.provider).toBe("sentry");
  });

  test("definition.name === 'Sentry'", () => {
    expect(def.name).toBe("Sentry");
  });

  test("definition.authType === 'api_key'", () => {
    expect(def.authType).toBe("api_key");
  });

  test("does not expose verifyWebhook", () => {
    expect(def.verifyWebhook).toBeUndefined();
  });

  test("has action update_issue", () => {
    expect(def.actions.find((a) => a.name === "update_issue")).toBeDefined();
  });

  test("has action get_issue", () => {
    expect(def.actions.find((a) => a.name === "get_issue")).toBeDefined();
  });

  test("has action get_issue_events", () => {
    expect(def.actions.find((a) => a.name === "get_issue_events")).toBeDefined();
  });

  // ── update_issue ──────────────────────────────────────────────────────────

  describe("update_issue", () => {
    test("PUTs to the correct Sentry issue URL", async () => {
      await connector.executeAction("update_issue", sentryCreds, {
        organization_slug: "acme-corp",
        issue_id: "PROJ-42",
        status: "resolved",
      });
      expect(fetchCalls[0].url).toBe(
        "https://sentry.io/api/0/organizations/acme-corp/issues/PROJ-42/"
      );
    });

    test("uses PUT method", async () => {
      await connector.executeAction("update_issue", sentryCreds, {
        organization_slug: "acme-corp",
        issue_id: "PROJ-42",
        status: "resolved",
      });
      expect((fetchCalls[0].init as any).method).toBe("PUT");
    });

    test("includes Authorization Bearer header", async () => {
      await connector.executeAction("update_issue", sentryCreds, {
        organization_slug: "acme-corp",
        issue_id: "PROJ-42",
        status: "resolved",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer sntrys_test_key"
      );
    });

    test("sends status in JSON body", async () => {
      await connector.executeAction("update_issue", sentryCreds, {
        organization_slug: "acme",
        issue_id: "123",
        status: "ignored",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.status).toBe("ignored");
    });

    test("sends assignedTo in JSON body when provided", async () => {
      await connector.executeAction("update_issue", sentryCreds, {
        organization_slug: "acme",
        issue_id: "123",
        assignedTo: "user@example.com",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.assignedTo).toBe("user@example.com");
    });

    test("does not include assignedTo in body when not provided", async () => {
      await connector.executeAction("update_issue", sentryCreds, {
        organization_slug: "acme",
        issue_id: "123",
        status: "resolved",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.assignedTo).toBeUndefined();
    });

    test("throws on non-ok response", async () => {
      mockFetch("Unauthorized", 401);
      await expect(
        connector.executeAction("update_issue", sentryCreds, {
          organization_slug: "acme",
          issue_id: "123",
          status: "resolved",
        })
      ).rejects.toThrow(/Sentry error/);
    });
  });

  // ── get_issue ─────────────────────────────────────────────────────────────

  describe("get_issue", () => {
    test("GETs the correct issue URL", async () => {
      await connector.executeAction("get_issue", sentryCreds, {
        issue_id: "999",
      });
      expect(fetchCalls[0].url).toBe("https://sentry.io/api/0/issues/999/");
    });

    test("includes Authorization header", async () => {
      await connector.executeAction("get_issue", sentryCreds, {
        issue_id: "999",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer sntrys_test_key"
      );
    });

    test("throws on non-ok response", async () => {
      mockFetch("Not Found", 404);
      await expect(
        connector.executeAction("get_issue", sentryCreds, { issue_id: "0" })
      ).rejects.toThrow(/Sentry error/);
    });
  });

  // ── get_issue_events ──────────────────────────────────────────────────────

  describe("get_issue_events", () => {
    test("GETs the correct events/latest URL", async () => {
      await connector.executeAction("get_issue_events", sentryCreds, {
        issue_id: "456",
      });
      expect(fetchCalls[0].url).toBe(
        "https://sentry.io/api/0/issues/456/events/latest/"
      );
    });

    test("includes Authorization header", async () => {
      await connector.executeAction("get_issue_events", sentryCreds, {
        issue_id: "456",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer sntrys_test_key"
      );
    });

    test("throws on non-ok response", async () => {
      mockFetch("Internal Server Error", 500);
      await expect(
        connector.executeAction("get_issue_events", sentryCreds, {
          issue_id: "456",
        })
      ).rejects.toThrow(/Sentry error/);
    });
  });
});

// ---------------------------------------------------------------------------
// LinearConnector
// ---------------------------------------------------------------------------

describe("LinearConnector", () => {
  const connector = new LinearConnector();
  const def = connector.definition;

  test("constructor creates a valid instance", () => {
    const c = new LinearConnector();
    expect(c.definition.provider).toBe("linear");
  });

  test("definition.provider === 'linear'", () => {
    expect(def.provider).toBe("linear");
  });

  test("definition.name === 'Linear'", () => {
    expect(def.name).toBe("Linear");
  });

  test("definition.authType === 'api_key'", () => {
    expect(def.authType).toBe("api_key");
  });

  test("has action create_issue", () => {
    expect(def.actions.find((a) => a.name === "create_issue")).toBeDefined();
  });

  test("has action update_issue", () => {
    expect(def.actions.find((a) => a.name === "update_issue")).toBeDefined();
  });

  test("has action create_comment", () => {
    expect(def.actions.find((a) => a.name === "create_comment")).toBeDefined();
  });

  // ── create_issue ──────────────────────────────────────────────────────────

  describe("create_issue", () => {
    test("POSTs to https://api.linear.app/graphql", async () => {
      mockFetch({ data: { issueCreate: { success: true, issue: { id: "abc" } } } });
      await connector.executeAction("create_issue", linearCreds, {
        title: "Fix bug",
        teamId: "team-123",
      });
      expect(fetchCalls[0].url).toBe("https://api.linear.app/graphql");
      expect((fetchCalls[0].init as any).method).toBe("POST");
    });

    test("sends Authorization: Bearer header", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("create_issue", linearCreds, {
        title: "Fix bug",
        teamId: "team-123",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer lin_api_test_key"
      );
    });

    test("sends a GraphQL mutation in the body", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("create_issue", linearCreds, {
        title: "New feature",
        teamId: "team-456",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(typeof body.query).toBe("string");
      expect(body.query).toContain("mutation");
    });

    test("sends title and teamId in variables.input", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("create_issue", linearCreds, {
        title: "Crash on login",
        teamId: "team-789",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.variables.input.title).toBe("Crash on login");
      expect(body.variables.input.teamId).toBe("team-789");
    });

    test("throws when response has GraphQL errors", async () => {
      mockFetch({
        errors: [{ message: "Field 'teamId' is required" }],
      });
      await expect(
        connector.executeAction("create_issue", linearCreds, {
          title: "bad",
          teamId: "",
        })
      ).rejects.toThrow(/Linear GraphQL error/);
    });

    test("throws on non-ok HTTP status", async () => {
      mockFetch("Unauthorized", 401);
      await expect(
        connector.executeAction("create_issue", linearCreds, {
          title: "test",
          teamId: "t",
        })
      ).rejects.toThrow(/Linear API error/);
    });
  });

  // ── update_issue ──────────────────────────────────────────────────────────

  describe("update_issue", () => {
    test("POSTs to Linear GraphQL endpoint", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("update_issue", linearCreds, {
        id: "issue-id-001",
        title: "Updated title",
      });
      expect(fetchCalls[0].url).toBe("https://api.linear.app/graphql");
    });

    test("sends mutation in body", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("update_issue", linearCreds, {
        id: "issue-id-001",
        stateId: "state-done",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.query).toContain("mutation");
    });

    test("separates id from the input variables", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("update_issue", linearCreds, {
        id: "issue-xyz",
        title: "New title",
        priority: 1,
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.variables.id).toBe("issue-xyz");
      expect(body.variables.input.title).toBe("New title");
      // id should NOT be inside input
      expect(body.variables.input.id).toBeUndefined();
    });

    test("throws when response has GraphQL errors", async () => {
      mockFetch({ errors: [{ message: "Issue not found" }] });
      await expect(
        connector.executeAction("update_issue", linearCreds, {
          id: "bad-id",
          title: "x",
        })
      ).rejects.toThrow(/Linear GraphQL error/);
    });
  });

  // ── create_comment ────────────────────────────────────────────────────────

  describe("create_comment", () => {
    test("POSTs to Linear GraphQL endpoint", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("create_comment", linearCreds, {
        issueId: "issue-001",
        body: "This is a comment",
      });
      expect(fetchCalls[0].url).toBe("https://api.linear.app/graphql");
    });

    test("sends Authorization header", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("create_comment", linearCreds, {
        issueId: "issue-001",
        body: "Comment text",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer lin_api_test_key"
      );
    });

    test("sends mutation keyword in query", async () => {
      mockFetch({ data: {} });
      await connector.executeAction("create_comment", linearCreds, {
        issueId: "issue-002",
        body: "Another comment",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.query).toContain("mutation");
    });

    test("throws when response has GraphQL errors", async () => {
      mockFetch({ errors: [{ message: "Not authorized" }] });
      await expect(
        connector.executeAction("create_comment", linearCreds, {
          issueId: "issue-x",
          body: "text",
        })
      ).rejects.toThrow(/Linear GraphQL error/);
    });
  });
});

// ---------------------------------------------------------------------------
// SlackConnector
// ---------------------------------------------------------------------------

describe("SlackConnector", () => {
  const connector = new SlackConnector();
  const def = connector.definition;

  test("constructor creates a valid instance", () => {
    const c = new SlackConnector();
    expect(c.definition.provider).toBe("slack");
  });

  test("definition.provider === 'slack'", () => {
    expect(def.provider).toBe("slack");
  });

  test("definition.name === 'Slack'", () => {
    expect(def.name).toBe("Slack");
  });

  test("definition.authType === 'api_key'", () => {
    expect(def.authType).toBe("api_key");
  });

  test("has action send_message", () => {
    expect(def.actions.find((a) => a.name === "send_message")).toBeDefined();
  });

  test("has action create_channel", () => {
    expect(def.actions.find((a) => a.name === "create_channel")).toBeDefined();
  });

  // ── send_message ──────────────────────────────────────────────────────────

  describe("send_message", () => {
    test("posts to https://slack.com/api/chat.postMessage", async () => {
      mockFetch({ ok: true, ts: "1234567890.000001" });
      await connector.executeAction("send_message", slackCreds, {
        channel: "C01234567",
        text: "Hello from tests!",
      });
      expect(fetchCalls[0].url).toBe("https://slack.com/api/chat.postMessage");
    });

    test("uses POST method", async () => {
      mockFetch({ ok: true, ts: "111" });
      await connector.executeAction("send_message", slackCreds, {
        channel: "C01234567",
        text: "hi",
      });
      expect((fetchCalls[0].init as any).method).toBe("POST");
    });

    test("includes Authorization Bearer header", async () => {
      mockFetch({ ok: true, ts: "111" });
      await connector.executeAction("send_message", slackCreds, {
        channel: "C01234567",
        text: "hi",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer xoxb-test-slack-token"
      );
    });

    test("falls back to accessToken when apiKey is absent", async () => {
      mockFetch({ ok: true, ts: "111" });
      const oauthCreds: IntegrationCredentials = { accessToken: "xoxb-oauth" };
      await connector.executeAction("send_message", oauthCreds, {
        channel: "C01234567",
        text: "hi",
      });
      expect((fetchCalls[0].init as any).headers["Authorization"]).toBe(
        "Bearer xoxb-oauth"
      );
    });

    test("sends channel and text in JSON body", async () => {
      mockFetch({ ok: true, ts: "111" });
      await connector.executeAction("send_message", slackCreds, {
        channel: "general",
        text: "test message",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.channel).toBe("general");
      expect(body.text).toBe("test message");
    });

    test("includes blocks in body when provided", async () => {
      mockFetch({ ok: true, ts: "111" });
      const blocks = [{ type: "section", text: { type: "mrkdwn", text: "hello" } }];
      await connector.executeAction("send_message", slackCreds, {
        channel: "general",
        text: "hello",
        blocks,
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.blocks).toEqual(blocks);
    });

    test("includes thread_ts in body when provided", async () => {
      mockFetch({ ok: true, ts: "222" });
      await connector.executeAction("send_message", slackCreds, {
        channel: "general",
        text: "reply",
        thread_ts: "1234567890.000001",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.thread_ts).toBe("1234567890.000001");
    });

    test("throws when data.ok is false", async () => {
      mockFetch({ ok: false, error: "channel_not_found" });
      await expect(
        connector.executeAction("send_message", slackCreds, {
          channel: "C_BAD",
          text: "hi",
        })
      ).rejects.toThrow(/Slack error/);
    });

    test("error message includes the Slack error code", async () => {
      mockFetch({ ok: false, error: "not_in_channel" });
      await expect(
        connector.executeAction("send_message", slackCreds, {
          channel: "C_BAD",
          text: "hi",
        })
      ).rejects.toThrow(/not_in_channel/);
    });
  });

  // ── create_channel ────────────────────────────────────────────────────────

  describe("create_channel", () => {
    test("posts to https://slack.com/api/conversations.create", async () => {
      mockFetch({ ok: true, channel: { id: "C_NEW", name: "test-channel" } });
      await connector.executeAction("create_channel", slackCreds, {
        name: "test-channel",
      });
      expect(fetchCalls[0].url).toBe(
        "https://slack.com/api/conversations.create"
      );
    });

    test("sends channel name in body", async () => {
      mockFetch({ ok: true, channel: { id: "C_NEW", name: "my-channel" } });
      await connector.executeAction("create_channel", slackCreds, {
        name: "my-channel",
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.name).toBe("my-channel");
    });

    test("sends is_private flag in body", async () => {
      mockFetch({ ok: true, channel: { id: "C_PRIV", name: "private-ch" } });
      await connector.executeAction("create_channel", slackCreds, {
        name: "private-ch",
        is_private: true,
      });
      const body = JSON.parse((fetchCalls[0].init as any).body);
      expect(body.is_private).toBe(true);
    });

    test("returns channel data", async () => {
      const channelData = { id: "C_RETURNED", name: "returned-channel" };
      mockFetch({ ok: true, channel: channelData });
      const result = await connector.executeAction("create_channel", slackCreds, {
        name: "returned-channel",
      });
      expect(result).toEqual(channelData);
    });

    test("throws when data.ok is false", async () => {
      mockFetch({ ok: false, error: "name_taken" });
      await expect(
        connector.executeAction("create_channel", slackCreds, {
          name: "existing-channel",
        })
      ).rejects.toThrow(/Slack error/);
    });
  });

  // ── verifyWebhook ─────────────────────────────────────────────────────────

  describe("verifyWebhook", () => {
    const secret = "slack_signing_secret";

    function buildSlackSignature(payload: string, sec: string) {
      const timestamp = (JSON.parse(payload) as Record<string, unknown>).timestamp ?? "";
      const baseString = `v0:${timestamp}:${payload}`;
      return `v0=${createHmac("sha256", sec).update(baseString).digest("hex")}`;
    }

    test("returns true for a correct Slack signature", () => {
      const payload = JSON.stringify({ timestamp: "1700000000", event: "message" });
      const sig = buildSlackSignature(payload, secret);
      expect(def.verifyWebhook!(payload, sig, secret)).toBe(true);
    });

    test("returns false for a mismatched signature", () => {
      const payload = JSON.stringify({ timestamp: "1700000000" });
      expect(def.verifyWebhook!(payload, "v0=bad_signature", secret)).toBe(false);
    });

    test("returns false when payload is tampered after signing", () => {
      const payload = JSON.stringify({ timestamp: "1700000000", event: "message" });
      const sig = buildSlackSignature(payload, secret);
      const tampered = JSON.stringify({ timestamp: "1700000000", event: "tampered" });
      expect(def.verifyWebhook!(tampered, sig, secret)).toBe(false);
    });

    test("returns false when secret does not match", () => {
      const payload = JSON.stringify({ timestamp: "1700000000" });
      const sig = buildSlackSignature(payload, "wrong_secret");
      expect(def.verifyWebhook!(payload, sig, secret)).toBe(false);
    });
  });
});
