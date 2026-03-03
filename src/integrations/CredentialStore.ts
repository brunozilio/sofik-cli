/**
 * CLI credential store — persists integration credentials to SQLite.
 * Wraps src/db/queries/integrations.ts with encryption via AES-256-GCM.
 */
import { encryptCredentials, decryptCredentials } from "./crypto.ts";
import {
  upsertIntegration,
  getIntegrationByProvider,
  getAllIntegrations,
  deleteIntegration,
} from "../db/queries/integrations.ts";
import type { IntegrationCredentials } from "../types/integration.ts";
import type { IntegrationProvider } from "../types/integration.ts";

export interface StoredCredential {
  provider: string;
  name: string;
  connectedAt: string;
}

/**
 * Save credentials for a provider (encrypts before storing).
 */
export function saveCredentials(
  provider: IntegrationProvider | string,
  credentials: IntegrationCredentials,
  displayName?: string
): void {
  const encrypted = encryptCredentials(credentials);
  upsertIntegration(provider, displayName ?? provider, encrypted);
}

/**
 * Load and decrypt credentials for a provider.
 * Returns null if the provider is not connected.
 */
export function getCredentials(
  provider: IntegrationProvider | string
): IntegrationCredentials | null {
  const row = getIntegrationByProvider(provider);
  if (!row) return null;
  try {
    return decryptCredentials(row.credentials_encrypted);
  } catch {
    return null;
  }
}

/**
 * List all connected providers with display names.
 */
export function listConnectedProviders(): StoredCredential[] {
  return getAllIntegrations().map((row) => ({
    provider: row.provider,
    name: row.name,
    connectedAt: row.created_at,
  }));
}

/**
 * Check if a provider has stored credentials.
 */
export function isConnected(provider: IntegrationProvider | string): boolean {
  return getIntegrationByProvider(provider) !== null;
}

/**
 * Remove credentials for a provider.
 */
export function disconnectProvider(provider: IntegrationProvider | string): void {
  deleteIntegration(provider);
}
