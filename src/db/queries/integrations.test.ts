// Must set DATABASE_URL before any import that triggers getDb()
process.env.DATABASE_URL = ":memory:";

import { test, expect, describe, beforeEach } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  upsertIntegration,
  getIntegrationByProvider,
  getAllIntegrations,
  deleteIntegration,
  type DbIntegration,
} from "./integrations.ts";
import { dbRun } from "../index.ts";

// ── Reset state between every test ────────────────────────────────────────────

beforeEach(() => {
  dbRun("DELETE FROM integrations", []);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function uniqueProvider(): string {
  return `test-provider-${randomUUID().slice(0, 8)}`;
}

// ── upsertIntegration ─────────────────────────────────────────────────────────

describe("upsertIntegration — create", () => {
  test("creates a new integration and returns it", () => {
    const provider = uniqueProvider();
    const result = upsertIntegration(provider, "Test Integration", "encrypted-creds");
    expect(result).toBeDefined();
    expect(result.provider).toBe(provider);
  });

  test("created integration has an id", () => {
    const provider = uniqueProvider();
    const result = upsertIntegration(provider, "Test", "encrypted");
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  test("created integration has correct provider", () => {
    const provider = uniqueProvider();
    const result = upsertIntegration(provider, "Name", "encrypted");
    expect(result.provider).toBe(provider);
  });

  test("created integration has correct name", () => {
    const provider = uniqueProvider();
    const result = upsertIntegration(provider, "My Integration Name", "encrypted");
    expect(result.name).toBe("My Integration Name");
  });

  test("created integration has correct credentials_encrypted", () => {
    const provider = uniqueProvider();
    const creds = "encrypted-data-xyz";
    const result = upsertIntegration(provider, "Name", creds);
    expect(result.credentials_encrypted).toBe(creds);
  });

  test("created integration has 'active' status", () => {
    const provider = uniqueProvider();
    const result = upsertIntegration(provider, "Name", "encrypted");
    expect(result.status).toBe("active");
  });

  test("created integration has created_at timestamp", () => {
    const provider = uniqueProvider();
    const result = upsertIntegration(provider, "Name", "encrypted");
    expect(typeof result.created_at).toBe("string");
    expect(result.created_at.length).toBeGreaterThan(0);
  });

  test("created integration has updated_at timestamp", () => {
    const provider = uniqueProvider();
    const result = upsertIntegration(provider, "Name", "encrypted");
    expect(typeof result.updated_at).toBe("string");
  });

  test("creates multiple integrations with different providers", () => {
    const p1 = uniqueProvider();
    const p2 = uniqueProvider();
    upsertIntegration(p1, "First", "enc1");
    upsertIntegration(p2, "Second", "enc2");
    const all = getAllIntegrations();
    const providers = all.map((i) => i.provider);
    expect(providers).toContain(p1);
    expect(providers).toContain(p2);
  });
});

describe("upsertIntegration — update", () => {
  test("updates an existing integration's name", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Original Name", "enc");
    const updated = upsertIntegration(provider, "Updated Name", "enc");
    expect(updated.name).toBe("Updated Name");
  });

  test("updates an existing integration's credentials", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Name", "original-enc");
    const updated = upsertIntegration(provider, "Name", "new-enc");
    expect(updated.credentials_encrypted).toBe("new-enc");
  });

  test("update does not create a duplicate", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Name", "enc");
    upsertIntegration(provider, "Name Updated", "enc");
    const all = getAllIntegrations().filter((i) => i.provider === provider);
    expect(all.length).toBe(1);
  });

  test("updated integration retains same id", () => {
    const provider = uniqueProvider();
    const first = upsertIntegration(provider, "Name", "enc");
    const second = upsertIntegration(provider, "New Name", "new-enc");
    expect(second.id).toBe(first.id);
  });
});

// ── getIntegrationByProvider ──────────────────────────────────────────────────

describe("getIntegrationByProvider", () => {
  test("returns the integration when it exists", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Name", "enc");
    const result = getIntegrationByProvider(provider);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe(provider);
  });

  test("returns null when provider does not exist", () => {
    const result = getIntegrationByProvider("nonexistent-provider-xyz");
    expect(result).toBeNull();
  });

  test("returns all fields of the integration", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Full Name", "full-enc");
    const result = getIntegrationByProvider(provider)!;
    expect(result.id).toBeDefined();
    expect(result.provider).toBe(provider);
    expect(result.name).toBe("Full Name");
    expect(result.credentials_encrypted).toBe("full-enc");
    expect(result.status).toBe("active");
    expect(result.created_at).toBeDefined();
    expect(result.updated_at).toBeDefined();
  });

  test("only returns active integrations", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Active", "enc");
    // Manually set status to inactive
    dbRun("UPDATE integrations SET status = 'inactive' WHERE provider = ?", [provider]);
    const result = getIntegrationByProvider(provider);
    expect(result).toBeNull();
  });

  test("returns correct integration when multiple providers exist", () => {
    const p1 = uniqueProvider();
    const p2 = uniqueProvider();
    upsertIntegration(p1, "First", "enc1");
    upsertIntegration(p2, "Second", "enc2");
    const result = getIntegrationByProvider(p1);
    expect(result!.name).toBe("First");
  });
});

// ── getAllIntegrations ────────────────────────────────────────────────────────

describe("getAllIntegrations", () => {
  test("returns empty array when no integrations exist", () => {
    const result = getAllIntegrations();
    expect(result).toEqual([]);
  });

  test("returns all active integrations", () => {
    const p1 = uniqueProvider();
    const p2 = uniqueProvider();
    upsertIntegration(p1, "First", "enc1");
    upsertIntegration(p2, "Second", "enc2");
    const result = getAllIntegrations();
    expect(result.length).toBe(2);
  });

  test("returns integrations ordered by provider alphabetically", () => {
    const p_a = "aaa-" + uniqueProvider();
    const p_z = "zzz-" + uniqueProvider();
    upsertIntegration(p_z, "Z Provider", "enc");
    upsertIntegration(p_a, "A Provider", "enc");
    const result = getAllIntegrations();
    const providers = result.map((i) => i.provider);
    const idx_a = providers.findIndex((p) => p === p_a);
    const idx_z = providers.findIndex((p) => p === p_z);
    expect(idx_a).toBeLessThan(idx_z);
  });

  test("excludes inactive integrations", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Inactive", "enc");
    dbRun("UPDATE integrations SET status = 'deleted' WHERE provider = ?", [provider]);
    const result = getAllIntegrations();
    expect(result.some((i) => i.provider === provider)).toBe(false);
  });

  test("each result has required fields", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Test", "enc");
    const result = getAllIntegrations();
    const integration = result.find((i) => i.provider === provider)!;
    expect(integration.id).toBeDefined();
    expect(integration.provider).toBe(provider);
    expect(integration.name).toBe("Test");
    expect(integration.credentials_encrypted).toBe("enc");
    expect(integration.status).toBe("active");
  });
});

// ── deleteIntegration ─────────────────────────────────────────────────────────

describe("deleteIntegration", () => {
  test("removes the integration completely", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Name", "enc");
    deleteIntegration(provider);
    const result = getIntegrationByProvider(provider);
    expect(result).toBeNull();
  });

  test("does not affect other integrations", () => {
    const p1 = uniqueProvider();
    const p2 = uniqueProvider();
    upsertIntegration(p1, "First", "enc1");
    upsertIntegration(p2, "Second", "enc2");
    deleteIntegration(p1);
    const remaining = getIntegrationByProvider(p2);
    expect(remaining).not.toBeNull();
    expect(remaining!.name).toBe("Second");
  });

  test("deleting nonexistent provider does not throw", () => {
    expect(() => {
      deleteIntegration("nonexistent-provider-xyz");
    }).not.toThrow();
  });

  test("returns void", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Name", "enc");
    const result = deleteIntegration(provider);
    expect(result).toBeUndefined();
  });

  test("deleted integration does not appear in getAllIntegrations", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "ToDelete", "enc");
    deleteIntegration(provider);
    const all = getAllIntegrations();
    expect(all.some((i) => i.provider === provider)).toBe(false);
  });

  test("can recreate integration after deletion", () => {
    const provider = uniqueProvider();
    upsertIntegration(provider, "Original", "enc1");
    deleteIntegration(provider);
    upsertIntegration(provider, "Recreated", "enc2");
    const result = getIntegrationByProvider(provider);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Recreated");
  });
});
