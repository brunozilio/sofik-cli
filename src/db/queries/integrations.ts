import { dbQuery, dbQueryOne, dbRun, randomUUID } from "../index.ts";

export interface DbIntegration {
  id: string;
  provider: string;
  name: string;
  credentials_encrypted: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function upsertIntegration(
  provider: string,
  name: string,
  credentialsEncrypted: string
): DbIntegration {
  const existing = getIntegrationByProvider(provider);
  if (existing) {
    dbRun(
      "UPDATE integrations SET name = ?, credentials_encrypted = ?, updated_at = datetime('now') WHERE provider = ?",
      [name, credentialsEncrypted, provider]
    );
    return getIntegrationByProvider(provider)!;
  }
  const id = randomUUID();
  dbRun(
    "INSERT INTO integrations (id, provider, name, credentials_encrypted) VALUES (?, ?, ?, ?)",
    [id, provider, name, credentialsEncrypted]
  );
  return getIntegrationByProvider(provider)!;
}

export function getIntegrationByProvider(provider: string): DbIntegration | null {
  return dbQueryOne<DbIntegration>(
    "SELECT * FROM integrations WHERE provider = ? AND status = 'active'",
    [provider]
  );
}

export function getAllIntegrations(): DbIntegration[] {
  return dbQuery<DbIntegration>(
    "SELECT * FROM integrations WHERE status = 'active' ORDER BY provider"
  );
}

export function deleteIntegration(provider: string): void {
  dbRun("DELETE FROM integrations WHERE provider = ?", [provider]);
}
