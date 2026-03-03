import { loadSettings } from "./settings.ts";

function getEnvProxyForUrl(targetUrl: string): string | undefined {
  const isHttps = targetUrl.startsWith("https:");
  if (isHttps) {
    return (
      process.env["https_proxy"] ??
      process.env["HTTPS_PROXY"] ??
      process.env["all_proxy"] ??
      process.env["ALL_PROXY"]
    );
  }
  return (
    process.env["http_proxy"] ??
    process.env["HTTP_PROXY"] ??
    process.env["all_proxy"] ??
    process.env["ALL_PROXY"]
  );
}

function getNoProxyList(): string[] {
  const envVal = process.env["no_proxy"] ?? process.env["NO_PROXY"] ?? "";
  const envList = envVal ? envVal.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const settingsList = loadSettings().proxy?.noProxy ?? [];
  return [...envList, ...settingsList];
}

/**
 * Returns true if targetUrl should bypass the proxy.
 *
 * Supported formats in noProxyList:
 *   "*"           → bypass everything
 *   ".example.com"→ match example.com and any subdomain
 *   "example.com" → match example.com and subdomains (curl-compat)
 *   "host:8080"   → match exact host + port
 */
export function isNoProxy(targetUrl: string, noProxyList: string[]): boolean {
  if (noProxyList.length === 0) return false;
  if (noProxyList.includes("*")) return true;

  let hostname: string;
  let port: string;
  try {
    const parsed = new URL(targetUrl);
    hostname = parsed.hostname.toLowerCase();
    port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return false;
  }

  for (const entry of noProxyList) {
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed || trimmed === ".") continue;

    // Split off optional port suffix (last colon followed by digits)
    const colonIdx = trimmed.lastIndexOf(":");
    let entryHost = trimmed;
    let entryPort: string | undefined;
    if (colonIdx > 0) {
      const maybePort = trimmed.slice(colonIdx + 1);
      if (/^\d+$/.test(maybePort)) {
        entryHost = trimmed.slice(0, colonIdx);
        entryPort = maybePort;
      }
    }

    // Port mismatch → skip
    if (entryPort && entryPort !== port) continue;

    // Wildcard
    if (entryHost === "*") return true;

    // Domain suffix match (strip leading dot for comparison)
    const domain = entryHost.startsWith(".") ? entryHost.slice(1) : entryHost;
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return true;
  }

  return false;
}

/**
 * Returns the proxy URL to use for targetUrl, or undefined for a direct connection.
 *
 * Priority: settings.proxy.url > HTTPS_PROXY/HTTP_PROXY env vars > no proxy
 * NO_PROXY entries from env and settings are combined (additive).
 */
export function getProxyUrl(targetUrl: string): string | undefined {
  const noProxyList = getNoProxyList();
  if (isNoProxy(targetUrl, noProxyList)) return undefined;

  const settings = loadSettings();
  if (settings.proxy?.url) return settings.proxy.url;

  return getEnvProxyForUrl(targetUrl);
}
