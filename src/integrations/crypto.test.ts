import { test, expect, describe } from "bun:test";
import { encryptCredentials, decryptCredentials } from "./crypto.ts";
import { createHash } from "crypto";

// ─── Round-trip correctness ──────────────────────────────────────────────────

describe("AES-256-GCM round-trip", () => {
  test("encrypt then decrypt returns the original credentials", () => {
    const creds = { apiKey: "sk-test-12345" };
    const encrypted = encryptCredentials(creds);
    const decrypted = decryptCredentials(encrypted);
    expect(decrypted).toEqual(creds);
  });

  test("round-trip preserves accessToken and refreshToken", () => {
    const creds = {
      accessToken: "access_abc",
      refreshToken: "refresh_xyz",
    };
    const decrypted = decryptCredentials(encryptCredentials(creds));
    expect(decrypted).toEqual(creds);
  });

  test("round-trip preserves a numeric expiresAt field", () => {
    const creds = {
      apiKey: "key-999",
      expiresAt: 1700000000,
    };
    const decrypted = decryptCredentials(encryptCredentials(creds));
    expect(decrypted.expiresAt).toBe(1700000000);
  });

  test("round-trip preserves complex objects with an 'extra' field", () => {
    const creds = {
      accessToken: "tok-abc",
      extra: {
        orgId: "org-123",
        scopes: ["read", "write"],
        nested: { deep: true },
      },
    };
    const decrypted = decryptCredentials(encryptCredentials(creds));
    expect(decrypted).toEqual(creds);
  });

  test("round-trip works with an empty object", () => {
    const creds = {};
    const decrypted = decryptCredentials(encryptCredentials(creds));
    expect(decrypted).toEqual(creds);
  });

  test("round-trip works with all fields populated", () => {
    const creds = {
      accessToken: "access-full",
      refreshToken: "refresh-full",
      apiKey: "api-full",
      expiresAt: 9999999999,
      extra: { region: "us-east-1" },
    };
    const decrypted = decryptCredentials(encryptCredentials(creds));
    expect(decrypted).toEqual(creds);
  });
});

// ─── Ciphertext uniqueness ───────────────────────────────────────────────────

describe("ciphertext properties", () => {
  test("two encryptions of the same data produce different ciphertexts (random IV)", () => {
    const creds = { apiKey: "same-key" };
    const enc1 = encryptCredentials(creds);
    const enc2 = encryptCredentials(creds);
    // The IV is random, so the outputs should differ even for identical inputs.
    expect(enc1).not.toBe(enc2);
  });

  test("encrypted output is a non-empty string", () => {
    const encrypted = encryptCredentials({ apiKey: "test" });
    expect(typeof encrypted).toBe("string");
    expect(encrypted.length).toBeGreaterThan(0);
  });

  test("encrypted output contains exactly two colons (iv:authTag:ciphertext format)", () => {
    const encrypted = encryptCredentials({ apiKey: "test" });
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    // Each part must be a non-empty base64 string
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
    }
  });
});

// ─── Wrong-format input ──────────────────────────────────────────────────────

describe("decryptCredentials error handling", () => {
  test("throws on an empty string", () => {
    expect(() => decryptCredentials("")).toThrow();
  });

  test("throws when the format is missing colons", () => {
    expect(() => decryptCredentials("notavalidformat")).toThrow();
  });

  test("throws when ciphertext segment is empty", () => {
    // Two colons but empty third segment
    expect(() => decryptCredentials("aXY=:dGFn:")).toThrow();
  });

  test("throws when any segment is missing", () => {
    // Only one colon
    expect(() => decryptCredentials("aXY=:dGFn")).toThrow();
  });

  test("throws or produces garbage when given tampered ciphertext", () => {
    // Flip one character in the ciphertext segment of a real encrypted value
    const creds = { apiKey: "tamper-test" };
    const enc = encryptCredentials(creds);
    const parts = enc.split(":");
    // Corrupt the ciphertext segment by appending extra characters
    const tampered = `${parts[0]}:${parts[1]}:AAAA${parts[2]}`;
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  test("throws when auth tag is corrupted (GCM integrity check fails)", () => {
    const creds = { apiKey: "integrity-test" };
    const enc = encryptCredentials(creds);
    const parts = enc.split(":");
    // Replace auth tag with zeroed-out base64
    const fakeTag = Buffer.alloc(16, 0).toString("base64");
    const tampered = `${parts[0]}:${fakeTag}:${parts[2]}`;
    expect(() => decryptCredentials(tampered)).toThrow();
  });
});

// ─── Key sensitivity ─────────────────────────────────────────────────────────

describe("encryption key sensitivity", () => {
  test("encrypting with the default key and decrypting works (smoke test for env key)", () => {
    // This confirms the module's own ENCRYPTION_KEY is consistent within
    // a single process — encrypt and decrypt use the same derived key.
    const creds = { apiKey: "env-key-test" };
    expect(() => {
      const enc = encryptCredentials(creds);
      const dec = decryptCredentials(enc);
      expect(dec).toEqual(creds);
    }).not.toThrow();
  });

  test("manually constructed encrypt/decrypt with two different keys produces different ciphertexts", () => {
    // We can't call encryptCredentials with a custom key (it uses the module-level
    // derived key), but we can confirm that two independently encrypted blobs
    // using the same function are unique due to random IVs, and verify that
    // a payload encrypted with the module's key cannot be decrypted if the
    // ciphertext bytes are replaced with those from a different encryption.
    const creds1 = { apiKey: "key-A" };
    const creds2 = { apiKey: "key-B" };

    const enc1 = encryptCredentials(creds1);
    const enc2 = encryptCredentials(creds2);

    // Cross-swap ciphertext segment — auth-tag mismatch must cause decryption to fail
    const parts1 = enc1.split(":");
    const parts2 = enc2.split(":");
    const crossWired = `${parts1[0]}:${parts1[1]}:${parts2[2]}`;
    expect(() => decryptCredentials(crossWired)).toThrow();
  });
});
