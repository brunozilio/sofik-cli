/**
 * Simple AES-256-GCM encryption for credential storage.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import type { IntegrationCredentials } from "../types/integration.ts";

const ENCRYPTION_KEY_RAW = process.env.ENCRYPTION_KEY ?? "dev-encryption-key-change-in-prod";

// Derive a 32-byte key from the raw string
const ENCRYPTION_KEY = createHash("sha256").update(ENCRYPTION_KEY_RAW).digest();
const ALGORITHM = "aes-256-gcm";

export function encryptCredentials(credentials: IntegrationCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const plaintext = JSON.stringify(credentials);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all base64)
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

export function decryptCredentials(encryptedStr: string): IntegrationCredentials {
  const [ivB64, authTagB64, ciphertextB64] = encryptedStr.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Invalid encrypted credentials format");
  }

  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as IntegrationCredentials;
}
