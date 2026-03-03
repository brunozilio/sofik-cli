import { getProxyUrl } from "./proxy.ts";

// Bun's fetch supports a `proxy` option natively since v1.x
interface BunRequestInit extends RequestInit {
  proxy?: string;
}

/**
 * Drop-in replacement for `fetch` that automatically routes requests through
 * the configured proxy (settings.proxy.url or HTTPS_PROXY/HTTP_PROXY env vars),
 * respecting NO_PROXY exclusions.
 *
 * When no proxy is configured this is a zero-overhead passthrough.
 */
export async function fetchWithProxy(
  url: string | URL | Request,
  init?: BunRequestInit,
): Promise<Response> {
  const targetUrl = url instanceof Request ? url.url : String(url);
  const proxyUrl = getProxyUrl(targetUrl);
  if (!proxyUrl) return fetch(url, init);
  return fetch(url, { ...init, proxy: proxyUrl } as BunRequestInit);
}
