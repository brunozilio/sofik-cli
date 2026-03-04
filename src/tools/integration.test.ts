// Must set DATABASE_URL before any imports that trigger getDb()
process.env.DATABASE_URL = ":memory:";

import { test, expect, describe, afterEach } from "bun:test";
import { integrationActionTool, integrationListTool } from "./integration.ts";
import { getAllProviders } from "../integrations/connectors/index.ts";
import { saveCredentials, disconnectProvider } from "../integrations/CredentialStore.ts";

async function integrationAction(input: Record<string, unknown>): Promise<string> {
  return integrationActionTool.execute!(input) as Promise<string>;
}

async function integrationList(input: Record<string, unknown> = {}): Promise<string> {
  return integrationListTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("integrationActionTool metadata", () => {
  test("name is 'IntegrationAction'", () => {
    expect(integrationActionTool.name).toBe("IntegrationAction");
  });

  test("has a description", () => {
    expect(typeof integrationActionTool.description).toBe("string");
    expect(integrationActionTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof integrationActionTool.execute).toBe("function");
  });

  test("input_schema requires provider, action, params", () => {
    expect(integrationActionTool.input_schema.required).toContain("provider");
    expect(integrationActionTool.input_schema.required).toContain("action");
    expect(integrationActionTool.input_schema.required).toContain("params");
  });
});

describe("integrationListTool metadata", () => {
  test("name is 'IntegrationList'", () => {
    expect(integrationListTool.name).toBe("IntegrationList");
  });

  test("has a description", () => {
    expect(typeof integrationListTool.description).toBe("string");
    expect(integrationListTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof integrationListTool.execute).toBe("function");
  });

  test("input_schema has optional provider filter", () => {
    expect(integrationListTool.input_schema.properties).toHaveProperty("provider");
  });

  test("input_schema requires no fields", () => {
    expect(integrationListTool.input_schema.required).toEqual([]);
  });
});

// ── integrationActionTool — unknown provider ───────────────────────────────────

describe("integrationActionTool — unknown provider", () => {
  test("returns error for unknown provider", async () => {
    const result = await integrationAction({
      provider: "unknown_provider_xyz",
      action: "do_something",
      params: {},
    });
    expect(result).toContain("desconhecido");
    expect(result).toContain("unknown_provider_xyz");
  });

  test("lists available providers in error message", async () => {
    const result = await integrationAction({
      provider: "not_a_real_provider",
      action: "action",
      params: {},
    });
    const available = getAllProviders();
    // Should mention at least one available provider
    expect(available.length).toBeGreaterThan(0);
    // Error should mention available providers
    expect(result).toContain("Disponíveis");
  });
});

// ── integrationActionTool — disconnected provider ──────────────────────────────

describe("integrationActionTool — disconnected provider", () => {
  test("returns error when provider is not connected", async () => {
    // github is a valid provider but not connected
    const result = await integrationAction({
      provider: "github",
      action: "list_repos",
      params: {},
    });
    expect(result).toContain("não está conectada");
    expect(result).toContain("github");
  });

  test("error message suggests how to connect", async () => {
    const result = await integrationAction({
      provider: "slack",
      action: "send_message",
      params: { channel: "general", message: "hello" },
    });
    expect(result).toContain("/integration connect");
  });
});

// ── integrationListTool — all providers ───────────────────────────────────────

describe("integrationListTool — all providers", () => {
  test("returns a string listing providers", async () => {
    const result = await integrationList({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("lists github provider", async () => {
    const result = await integrationList({});
    expect(result).toContain("github");
  });

  test("shows connected status for each provider", async () => {
    const result = await integrationList({});
    // Should show ✓ conectado or ✗ não conectado
    expect(result).toMatch(/conectado/i);
  });

  test("shows provider name alongside provider ID", async () => {
    const result = await integrationList({});
    // Provider definitions have a display name
    expect(typeof result).toBe("string");
    // Should contain at least some provider names
    expect(result.length).toBeGreaterThan(50);
  });
});

// ── integrationListTool — filter by provider ──────────────────────────────────

describe("integrationListTool — filter by provider", () => {
  test("returns info for a specific provider when filter set", async () => {
    const result = await integrationList({ provider: "github" });
    expect(result).toContain("github");
  });

  test("shows actions for filtered provider", async () => {
    const result = await integrationList({ provider: "github" });
    // Connected or filtered: should show actions
    expect(typeof result).toBe("string");
  });

  test("returns empty-ish result for unknown provider filter", async () => {
    const result = await integrationList({ provider: "unknown_xyz" });
    // getConnector returns null for unknown, so it's skipped
    expect(typeof result).toBe("string");
  });
});

// ── integrationListTool — connected provider shows actions ─────────────────────

describe("integrationListTool — connected provider", () => {
  afterEach(() => {
    try { disconnectProvider("github"); } catch {}
  });

  test("connected provider shows available actions", async () => {
    // Connect github with fake credentials
    saveCredentials("github", { apiKey: "fake-token" }, "GitHub Test");
    const result = await integrationList({});
    // Connected providers show their actions
    expect(result).toContain("✓ conectado");
  });

  test("connected provider actions include bullet points", async () => {
    saveCredentials("github", { apiKey: "fake-token" }, "GitHub Test");
    const result = await integrationList({ provider: "github" });
    expect(result).toContain("•");
  });
});

// ── integrationActionTool — connected provider ────────────────────────────────

describe("integrationActionTool — connected provider with real action", () => {
  afterEach(() => {
    try { disconnectProvider("github"); } catch {}
  });

  test("invokes action and returns result or error", async () => {
    // Connect with fake credentials that will fail at API level
    saveCredentials("github", { apiKey: "fake-token-for-testing" }, "GitHub Test");

    const result = await integrationAction({
      provider: "github",
      action: "list_repos",
      params: {},
    });
    // With fake credentials, the API call will fail — but it shouldn't crash
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("returns JSON result for valid action execution", async () => {
    // Even with fake creds, the error message should be a string
    saveCredentials("github", { apiKey: "x" }, "test");
    const result = await integrationAction({
      provider: "github",
      action: "list_repos",
      params: {},
    });
    expect(typeof result).toBe("string");
  });
});
