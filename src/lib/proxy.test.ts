import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use a temp dir so project-level settings ({proxy:{}}) override any user proxy
// settings — without mocking the settings module.
const TEST_DIR = mkdtempSync(join(tmpdir(), "sofik-proxy-"));
const ORIG_CWD = process.cwd();

import { invalidateSettingsCache } from "./settings.ts";
import { isNoProxy, getProxyUrl } from "./proxy.ts";

beforeAll(() => {
  mkdirSync(join(TEST_DIR, ".sofik"), { recursive: true });
  writeFileSync(join(TEST_DIR, ".sofik", "settings.json"), JSON.stringify({ proxy: {} }), "utf-8");
  process.chdir(TEST_DIR);
  invalidateSettingsCache();
});

afterAll(() => {
  process.chdir(ORIG_CWD);
  invalidateSettingsCache();
  rmSync(TEST_DIR, { recursive: true });
});

// ── Env-var save/restore helpers ───────────────────────────────────────────
const PROXY_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of PROXY_VARS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of PROXY_VARS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
});

// ── isNoProxy ──────────────────────────────────────────────────────────────

describe("isNoProxy — basic", () => {
  test("returns false for empty list", () => {
    expect(isNoProxy("https://example.com", [])).toBe(false);
  });

  test("returns true for wildcard '*'", () => {
    expect(isNoProxy("https://example.com", ["*"])).toBe(true);
  });

  test("returns false for no match", () => {
    expect(isNoProxy("https://example.com", ["other.com"])).toBe(false);
  });
});

describe("isNoProxy — exact hostname match", () => {
  test("exact hostname matches", () => {
    expect(isNoProxy("https://example.com", ["example.com"])).toBe(true);
  });

  test("exact hostname match is case-insensitive", () => {
    expect(isNoProxy("https://EXAMPLE.COM", ["example.com"])).toBe(true);
  });

  test("different hostname does not match", () => {
    expect(isNoProxy("https://other.com", ["example.com"])).toBe(false);
  });
});

describe("isNoProxy — subdomain matching", () => {
  test("subdomain matches parent domain entry", () => {
    expect(isNoProxy("https://sub.example.com", ["example.com"])).toBe(true);
  });

  test("deep subdomain matches parent domain entry", () => {
    expect(isNoProxy("https://a.b.example.com", ["example.com"])).toBe(true);
  });

  test("subdomain does not match unrelated domain", () => {
    expect(isNoProxy("https://sub.other.com", ["example.com"])).toBe(false);
  });
});

describe("isNoProxy — leading dot entries", () => {
  test("leading dot entry matches exact hostname", () => {
    expect(isNoProxy("https://example.com", [".example.com"])).toBe(true);
  });

  test("leading dot entry matches subdomain", () => {
    expect(isNoProxy("https://sub.example.com", [".example.com"])).toBe(true);
  });

  test("leading dot entry matches deep subdomain", () => {
    expect(isNoProxy("https://a.b.example.com", [".example.com"])).toBe(true);
  });

  test("leading dot entry does not match unrelated host", () => {
    expect(isNoProxy("https://other.com", [".example.com"])).toBe(false);
  });
});

describe("isNoProxy — port handling", () => {
  test("port match: same host and port → true", () => {
    expect(isNoProxy("http://example.com:8080", ["example.com:8080"])).toBe(true);
  });

  test("port mismatch: different port → false", () => {
    expect(isNoProxy("http://example.com:9090", ["example.com:8080"])).toBe(false);
  });

  test("no port in entry matches URL with any port", () => {
    expect(isNoProxy("http://example.com:8080", ["example.com"])).toBe(true);
  });

  test("entry with port does not affect non-matching host", () => {
    expect(isNoProxy("http://other.com:8080", ["example.com:8080"])).toBe(false);
  });
});

describe("isNoProxy — wildcard host entry", () => {
  test("entry '*' anywhere in list → true", () => {
    expect(isNoProxy("https://anything.com", ["example.com", "*", "other.com"])).toBe(true);
  });

  test("entry '*' as only element → true", () => {
    expect(isNoProxy("https://anyhost.net", ["*"])).toBe(true);
  });
});

describe("isNoProxy — invalid / edge-case URLs", () => {
  test("invalid URL returns false", () => {
    expect(isNoProxy("not-a-url", ["example.com"])).toBe(false);
  });

  test("empty string URL returns false", () => {
    expect(isNoProxy("", ["example.com"])).toBe(false);
  });

  test("empty entry in list is skipped, no crash", () => {
    expect(isNoProxy("https://example.com", ["", "example.com"])).toBe(true);
  });

  test("'.' entry in list is skipped, no crash", () => {
    expect(isNoProxy("https://example.com", [".", "example.com"])).toBe(true);
  });

  test("whitespace-only entry is skipped", () => {
    expect(isNoProxy("https://example.com", ["   ", "example.com"])).toBe(true);
  });
});

describe("isNoProxy — HTTPS default port", () => {
  test("https URL without port uses default 443", () => {
    expect(isNoProxy("https://example.com", ["example.com:443"])).toBe(true);
  });

  test("https URL without port does NOT match :8080 entry", () => {
    expect(isNoProxy("https://example.com", ["example.com:8080"])).toBe(false);
  });
});

describe("isNoProxy — HTTP default port", () => {
  test("http URL without port uses default 80", () => {
    expect(isNoProxy("http://example.com", ["example.com:80"])).toBe(true);
  });

  test("http URL without port does NOT match :8080 entry", () => {
    expect(isNoProxy("http://example.com", ["example.com:8080"])).toBe(false);
  });
});

// ── getProxyUrl ────────────────────────────────────────────────────────────

describe("getProxyUrl — no proxy configured", () => {
  test("returns undefined when no env vars set", () => {
    expect(getProxyUrl("https://example.com")).toBeUndefined();
  });

  test("returns undefined for http URL with no env vars", () => {
    expect(getProxyUrl("http://example.com")).toBeUndefined();
  });
});

describe("getProxyUrl — HTTPS_PROXY env var", () => {
  test("HTTPS_PROXY used for https URL", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    expect(getProxyUrl("https://example.com")).toBe("http://proxy.corp:3128");
  });

  test("HTTPS_PROXY not used for http URL", () => {
    process.env["HTTPS_PROXY"] = "http://proxy.corp:3128";
    expect(getProxyUrl("http://example.com")).toBeUndefined();
  });
});

describe("getProxyUrl — HTTP_PROXY env var", () => {
  test("HTTP_PROXY used for http URL", () => {
    process.env["HTTP_PROXY"] = "http://proxy.corp:3128";
    expect(getProxyUrl("http://example.com")).toBe("http://proxy.corp:3128");
  });

  test("HTTP_PROXY not used for https URL", () => {
    process.env["HTTP_PROXY"] = "http://proxy.corp:3128";
    expect(getProxyUrl("https://example.com")).toBeUndefined();
  });
});

describe("getProxyUrl — lowercase env vars", () => {
  test("https_proxy (lowercase) used for https URL", () => {
    process.env["https_proxy"] = "http://lc-proxy:8080";
    expect(getProxyUrl("https://example.com")).toBe("http://lc-proxy:8080");
  });

  test("http_proxy (lowercase) used for http URL", () => {
    process.env["http_proxy"] = "http://lc-proxy:8080";
    expect(getProxyUrl("http://example.com")).toBe("http://lc-proxy:8080");
  });

  test("lowercase https_proxy takes precedence over ALL_PROXY for https", () => {
    process.env["https_proxy"] = "http://specific:3128";
    process.env["ALL_PROXY"] = "http://all-proxy:3128";
    expect(getProxyUrl("https://example.com")).toBe("http://specific:3128");
  });
});

describe("getProxyUrl — ALL_PROXY env var", () => {
  test("ALL_PROXY used for https URL when no HTTPS_PROXY", () => {
    process.env["ALL_PROXY"] = "http://all-proxy:3128";
    expect(getProxyUrl("https://example.com")).toBe("http://all-proxy:3128");
  });

  test("ALL_PROXY used for http URL when no HTTP_PROXY", () => {
    process.env["ALL_PROXY"] = "http://all-proxy:3128";
    expect(getProxyUrl("http://example.com")).toBe("http://all-proxy:3128");
  });

  test("all_proxy (lowercase) used for https URL when no https_proxy", () => {
    process.env["all_proxy"] = "http://all-lower:3128";
    expect(getProxyUrl("https://example.com")).toBe("http://all-lower:3128");
  });

  test("all_proxy (lowercase) used for http URL when no http_proxy", () => {
    process.env["all_proxy"] = "http://all-lower:3128";
    expect(getProxyUrl("http://example.com")).toBe("http://all-lower:3128");
  });
});

describe("getProxyUrl — NO_PROXY exclusions", () => {
  test("URL in NO_PROXY list → returns undefined even when proxy set", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:3128";
    process.env["NO_PROXY"] = "example.com";
    expect(getProxyUrl("https://example.com")).toBeUndefined();
  });

  test("URL NOT in NO_PROXY list → returns proxy", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:3128";
    process.env["NO_PROXY"] = "other.com";
    expect(getProxyUrl("https://example.com")).toBe("http://proxy:3128");
  });

  test("no_proxy (lowercase) is also respected", () => {
    process.env["HTTP_PROXY"] = "http://proxy:3128";
    process.env["no_proxy"] = "example.com";
    expect(getProxyUrl("http://example.com")).toBeUndefined();
  });

  test("NO_PROXY wildcard '*' bypasses all proxies", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:3128";
    process.env["NO_PROXY"] = "*";
    expect(getProxyUrl("https://example.com")).toBeUndefined();
  });

  test("subdomain in NO_PROXY list → returns undefined", () => {
    process.env["HTTPS_PROXY"] = "http://proxy:3128";
    process.env["NO_PROXY"] = "example.com";
    expect(getProxyUrl("https://sub.example.com")).toBeUndefined();
  });
});

describe("getProxyUrl — env var priority for https", () => {
  test("https_proxy takes priority over ALL_PROXY", () => {
    process.env["https_proxy"] = "http://specific-https:3128";
    process.env["all_proxy"] = "http://fallback:3128";
    expect(getProxyUrl("https://example.com")).toBe("http://specific-https:3128");
  });

  test("HTTPS_PROXY takes priority over all_proxy", () => {
    process.env["HTTPS_PROXY"] = "http://upper-https:3128";
    process.env["all_proxy"] = "http://fallback:3128";
    expect(getProxyUrl("https://example.com")).toBe("http://upper-https:3128");
  });
});

describe("getProxyUrl — env var priority for http", () => {
  test("http_proxy takes priority over ALL_PROXY", () => {
    process.env["http_proxy"] = "http://specific-http:3128";
    process.env["all_proxy"] = "http://fallback:3128";
    expect(getProxyUrl("http://example.com")).toBe("http://specific-http:3128");
  });

  test("HTTP_PROXY takes priority over all_proxy", () => {
    process.env["HTTP_PROXY"] = "http://upper-http:3128";
    process.env["all_proxy"] = "http://fallback:3128";
    expect(getProxyUrl("http://example.com")).toBe("http://upper-http:3128");
  });
});
