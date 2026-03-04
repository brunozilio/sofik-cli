// Must set DATABASE_URL before any import that triggers getDb()
process.env.DATABASE_URL = ":memory:";

import { test, expect, describe, beforeEach } from "bun:test";
import {
  saveCredentials,
  getCredentials,
  listConnectedProviders,
  isConnected,
  disconnectProvider,
  type StoredCredential,
} from "./CredentialStore.ts";
import { dbRun } from "../db/index.ts";
import type { IntegrationCredentials } from "../types/integration.ts";

// ── Reset state between tests ─────────────────────────────────────────────────

beforeEach(() => {
  dbRun("DELETE FROM integrations", []);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

let counter = 0;
function uniqueProvider(): string {
  return `test-provider-${counter++}`;
}

// ── saveCredentials ────────────────────────────────────────────────────────────

describe("saveCredentials", () => {
  test("saves credentials without throwing", () => {
    expect(() => {
      saveCredentials("github", { apiKey: "test-key" });
    }).not.toThrow();
  });

  test("returns void", () => {
    const result = saveCredentials("github", { apiKey: "key" });
    expect(result).toBeUndefined();
  });

  test("saved credentials can be retrieved", () => {
    const creds: IntegrationCredentials = { apiKey: "my-api-key" };
    saveCredentials("github", creds);
    const retrieved = getCredentials("github");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.apiKey).toBe("my-api-key");
  });

  test("saves with accessToken", () => {
    saveCredentials("slack", { accessToken: "xoxb-token-123" });
    const retrieved = getCredentials("slack");
    expect(retrieved!.accessToken).toBe("xoxb-token-123");
  });

  test("saves with refreshToken", () => {
    saveCredentials("github", { accessToken: "access", refreshToken: "refresh-xyz" });
    const retrieved = getCredentials("github");
    expect(retrieved!.refreshToken).toBe("refresh-xyz");
  });

  test("saves with expiresAt", () => {
    const expiresAt = Date.now() + 3600_000;
    saveCredentials("linear", { accessToken: "token", expiresAt });
    const retrieved = getCredentials("linear");
    expect(retrieved!.expiresAt).toBe(expiresAt);
  });

  test("saves with extra fields", () => {
    saveCredentials("stripe", { apiKey: "sk_test_123", extra: { workspace: "my-workspace" } });
    const retrieved = getCredentials("stripe");
    expect(retrieved!.extra?.workspace).toBe("my-workspace");
  });

  test("uses provider as displayName when displayName not provided", () => {
    const provider = uniqueProvider();
    saveCredentials(provider, { apiKey: "key" });
    const connected = listConnectedProviders();
    const entry = connected.find((c) => c.provider === provider);
    expect(entry!.name).toBe(provider);
  });

  test("uses provided displayName", () => {
    const provider = uniqueProvider();
    saveCredentials(provider, { apiKey: "key" }, "My GitHub Account");
    const connected = listConnectedProviders();
    const entry = connected.find((c) => c.provider === provider);
    expect(entry!.name).toBe("My GitHub Account");
  });

  test("overwriting credentials updates the stored value", () => {
    saveCredentials("github", { apiKey: "old-key" });
    saveCredentials("github", { apiKey: "new-key" });
    const retrieved = getCredentials("github");
    expect(retrieved!.apiKey).toBe("new-key");
  });
});

// ── getCredentials ────────────────────────────────────────────────────────────

describe("getCredentials", () => {
  test("returns null when provider is not connected", () => {
    const result = getCredentials("nonexistent_provider_xyz");
    expect(result).toBeNull();
  });

  test("returns credentials object when provider is connected", () => {
    saveCredentials("github", { apiKey: "key-123" });
    const result = getCredentials("github");
    expect(result).not.toBeNull();
    expect(typeof result).toBe("object");
  });

  test("returns all saved credential fields", () => {
    const creds: IntegrationCredentials = {
      accessToken: "access",
      refreshToken: "refresh",
      apiKey: "key",
      expiresAt: 9999999,
      extra: { org: "myorg" },
    };
    saveCredentials("github", creds);
    const retrieved = getCredentials("github");
    expect(retrieved!.accessToken).toBe("access");
    expect(retrieved!.refreshToken).toBe("refresh");
    expect(retrieved!.apiKey).toBe("key");
    expect(retrieved!.expiresAt).toBe(9999999);
    expect(retrieved!.extra?.org).toBe("myorg");
  });

  test("credentials are decrypted correctly", () => {
    const secretKey = "super-secret-key-${Date.now()}";
    saveCredentials("sentry", { apiKey: secretKey });
    const retrieved = getCredentials("sentry");
    expect(retrieved!.apiKey).toBe(secretKey);
  });

  test("returns null for provider removed via disconnectProvider", () => {
    saveCredentials("github", { apiKey: "key" });
    disconnectProvider("github");
    const result = getCredentials("github");
    expect(result).toBeNull();
  });
});

// ── listConnectedProviders ────────────────────────────────────────────────────

describe("listConnectedProviders", () => {
  test("returns empty array when no providers are connected", () => {
    const result = listConnectedProviders();
    expect(result).toEqual([]);
  });

  test("returns one entry after connecting one provider", () => {
    saveCredentials("github", { apiKey: "key" });
    const result = listConnectedProviders();
    expect(result.length).toBe(1);
  });

  test("returns multiple entries for multiple providers", () => {
    const p1 = uniqueProvider();
    const p2 = uniqueProvider();
    saveCredentials(p1, { apiKey: "k1" });
    saveCredentials(p2, { apiKey: "k2" });
    const result = listConnectedProviders();
    expect(result.length).toBe(2);
  });

  test("each entry has provider field", () => {
    saveCredentials("github", { apiKey: "key" });
    const result = listConnectedProviders();
    expect(typeof result[0].provider).toBe("string");
  });

  test("each entry has name field", () => {
    saveCredentials("github", { apiKey: "key" }, "GitHub");
    const result = listConnectedProviders();
    const github = result.find((r) => r.provider === "github");
    expect(github!.name).toBe("GitHub");
  });

  test("each entry has connectedAt field (as ISO string)", () => {
    saveCredentials("github", { apiKey: "key" });
    const result = listConnectedProviders();
    expect(typeof result[0].connectedAt).toBe("string");
    expect(result[0].connectedAt.length).toBeGreaterThan(0);
  });

  test("does not include disconnected providers", () => {
    const provider = uniqueProvider();
    saveCredentials(provider, { apiKey: "key" });
    disconnectProvider(provider);
    const result = listConnectedProviders();
    expect(result.some((r) => r.provider === provider)).toBe(false);
  });
});

// ── isConnected ───────────────────────────────────────────────────────────────

describe("isConnected", () => {
  test("returns false when provider is not connected", () => {
    expect(isConnected("nonexistent_provider_xyz")).toBe(false);
  });

  test("returns true when provider is connected", () => {
    saveCredentials("github", { apiKey: "key" });
    expect(isConnected("github")).toBe(true);
  });

  test("returns false after provider is disconnected", () => {
    saveCredentials("github", { apiKey: "key" });
    disconnectProvider("github");
    expect(isConnected("github")).toBe(false);
  });

  test("returns true after credentials are updated", () => {
    saveCredentials("github", { apiKey: "old" });
    saveCredentials("github", { apiKey: "new" });
    expect(isConnected("github")).toBe(true);
  });

  test("works with various provider strings", () => {
    const p = uniqueProvider();
    expect(isConnected(p)).toBe(false);
    saveCredentials(p, { apiKey: "k" });
    expect(isConnected(p)).toBe(true);
  });
});

// ── disconnectProvider ────────────────────────────────────────────────────────

describe("disconnectProvider", () => {
  test("removes provider credentials", () => {
    saveCredentials("github", { apiKey: "key" });
    disconnectProvider("github");
    expect(isConnected("github")).toBe(false);
  });

  test("returns void", () => {
    saveCredentials("github", { apiKey: "key" });
    const result = disconnectProvider("github");
    expect(result).toBeUndefined();
  });

  test("disconnecting nonexistent provider does not throw", () => {
    expect(() => {
      disconnectProvider("never-connected-provider-xyz");
    }).not.toThrow();
  });

  test("does not affect other connected providers", () => {
    const p1 = uniqueProvider();
    const p2 = uniqueProvider();
    saveCredentials(p1, { apiKey: "k1" });
    saveCredentials(p2, { apiKey: "k2" });
    disconnectProvider(p1);
    expect(isConnected(p1)).toBe(false);
    expect(isConnected(p2)).toBe(true);
  });

  test("credentials cannot be retrieved after disconnect", () => {
    saveCredentials("github", { apiKey: "key" });
    disconnectProvider("github");
    expect(getCredentials("github")).toBeNull();
  });

  test("provider does not appear in list after disconnect", () => {
    const provider = uniqueProvider();
    saveCredentials(provider, { apiKey: "key" });
    disconnectProvider(provider);
    const list = listConnectedProviders();
    expect(list.some((c) => c.provider === provider)).toBe(false);
  });
});
