/**
 * Tests for all exported (and indirectly exercised) functions in oauth.ts.
 *
 * The login() and loginCopilot() flows are tested with mocked network and
 * mocked child_process so no real browser is opened and no real HTTP round-
 * trips are made to external services.
 */
import { mock, test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { request as httpRequest } from "node:http";

// ── Prevent openBrowser from opening a real browser during tests ──────────────
// (spawn is called with detached:true so it won't block, but on macOS `open`
//  would actually launch Safari — mock it away cleanly.)
mock.module("child_process", () => ({
  spawn: (_cmd: string, _args: string[], _opts?: object) => ({
    on: (_ev: string, _fn: () => void) => {},
    unref: () => {},
  }),
  execSync: () => Buffer.from(""),
}));
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Paths that the module uses (mirrors oauth.ts constants) ──────────────────

const TOKEN_PATH = path.join(os.homedir(), ".sofik", "anthropic-token.json");
const COPILOT_TOKEN_PATH = path.join(os.homedir(), ".sofik", "copilot-token.json");

// ── Save & restore real tokens so tests don't destroy user state ─────────────

let savedToken: string | null = null;
let savedCopilotToken: string | null = null;

beforeAll(() => {
  try { savedToken = fs.readFileSync(TOKEN_PATH, "utf-8"); } catch { savedToken = null; }
  try { savedCopilotToken = fs.readFileSync(COPILOT_TOKEN_PATH, "utf-8"); } catch { savedCopilotToken = null; }
  // Make sure the directory exists for write tests
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
});

afterAll(() => {
  if (savedToken !== null) {
    fs.writeFileSync(TOKEN_PATH, savedToken, "utf-8");
  } else {
    try { fs.unlinkSync(TOKEN_PATH); } catch { /* fine */ }
  }

  if (savedCopilotToken !== null) {
    fs.writeFileSync(COPILOT_TOKEN_PATH, savedCopilotToken, "utf-8");
  } else {
    try { fs.unlinkSync(COPILOT_TOKEN_PATH); } catch { /* fine */ }
  }
});

// Remove any token files and clear in-memory cache before each test
beforeEach(() => {
  clearTokenCache();
  try { fs.unlinkSync(TOKEN_PATH); } catch { /* ok if missing */ }
  try { fs.unlinkSync(COPILOT_TOKEN_PATH); } catch { /* ok if missing */ }
});

// ── Import after setup so module initialises correctly ───────────────────────

import {
  loadToken,
  loadCopilotToken,
  logout,
  logoutCopilot,
  isLoggedIn,
  getAccessToken,
  getValidToken,
  refreshToken,
  loginCopilot,
  login,
  clearTokenCache,
} from "./oauth.ts";
import type { OAuthToken, CopilotToken } from "./oauth.ts";

// ── loadToken ─────────────────────────────────────────────────────────────────

describe("loadToken", () => {
  test("returns null when token file does not exist", () => {
    const result = loadToken();
    expect(result).toBeNull();
  });

  test("returns parsed OAuthToken when file exists", () => {
    const token: OAuthToken = {
      access_token: "sk-ant-test-abc",
      refresh_token: "rt-xyz",
      expires_at: Date.now() + 3_600_000,
      scope: "org:create_api_key",
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    const result = loadToken();
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe("sk-ant-test-abc");
    expect(result!.refresh_token).toBe("rt-xyz");
  });

  test("returns token with optional fields", () => {
    const token: OAuthToken = { access_token: "sk-ant-minimal" };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    const result = loadToken();
    expect(result!.access_token).toBe("sk-ant-minimal");
    expect(result!.refresh_token).toBeUndefined();
    expect(result!.expires_at).toBeUndefined();
  });

  test("returns null when file contains invalid JSON", () => {
    fs.writeFileSync(TOKEN_PATH, "{ not valid json !!", "utf-8");
    const result = loadToken();
    expect(result).toBeNull();
  });

  test("returns token with expires_at preserved as number", () => {
    const expiresAt = Date.now() + 7200_000;
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: "tok", expires_at: expiresAt }), "utf-8");
    const result = loadToken();
    expect(result!.expires_at).toBe(expiresAt);
  });
});

// ── loadCopilotToken ──────────────────────────────────────────────────────────

describe("loadCopilotToken", () => {
  test("returns null when copilot token file does not exist", () => {
    const result = loadCopilotToken();
    expect(result).toBeNull();
  });

  test("returns parsed CopilotToken when file exists", () => {
    const token: CopilotToken = {
      access_token: "ghu_abc123",
      token_type: "bearer",
      scope: "read:user",
    };
    fs.writeFileSync(COPILOT_TOKEN_PATH, JSON.stringify(token), "utf-8");
    const result = loadCopilotToken();
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe("ghu_abc123");
    expect(result!.token_type).toBe("bearer");
    expect(result!.scope).toBe("read:user");
  });

  test("returns null when copilot token file contains invalid JSON", () => {
    fs.writeFileSync(COPILOT_TOKEN_PATH, "{ bad json }", "utf-8");
    const result = loadCopilotToken();
    expect(result).toBeNull();
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe("logout", () => {
  test("removes the token file when it exists", () => {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: "tok" }), "utf-8");
    expect(fs.existsSync(TOKEN_PATH)).toBe(true);
    logout();
    expect(fs.existsSync(TOKEN_PATH)).toBe(false);
  });

  test("does not throw when token file does not exist", () => {
    expect(() => logout()).not.toThrow();
  });

  test("loadToken returns null after logout", () => {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: "tok" }), "utf-8");
    logout();
    expect(loadToken()).toBeNull();
  });
});

// ── logoutCopilot ─────────────────────────────────────────────────────────────

describe("logoutCopilot", () => {
  test("removes the copilot token file when it exists", () => {
    fs.writeFileSync(COPILOT_TOKEN_PATH, JSON.stringify({ access_token: "ghu" }), "utf-8");
    expect(fs.existsSync(COPILOT_TOKEN_PATH)).toBe(true);
    logoutCopilot();
    expect(fs.existsSync(COPILOT_TOKEN_PATH)).toBe(false);
  });

  test("does not throw when copilot token file does not exist", () => {
    expect(() => logoutCopilot()).not.toThrow();
  });

  test("loadCopilotToken returns null after logoutCopilot", () => {
    fs.writeFileSync(COPILOT_TOKEN_PATH, JSON.stringify({ access_token: "ghu" }), "utf-8");
    logoutCopilot();
    expect(loadCopilotToken()).toBeNull();
  });
});

// ── isLoggedIn ────────────────────────────────────────────────────────────────

describe("isLoggedIn", () => {
  test("returns false when no token file exists", () => {
    expect(isLoggedIn()).toBe(false);
  });

  test("returns true for a valid non-expiring token", () => {
    const token: OAuthToken = {
      access_token: "sk-ant-valid",
      // No expires_at → treated as never expiring
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    expect(isLoggedIn()).toBe(true);
  });

  test("returns true for a token that expires far in the future", () => {
    const token: OAuthToken = {
      access_token: "sk-ant-future",
      expires_at: Date.now() + 3_600_000, // 1 hour from now
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    expect(isLoggedIn()).toBe(true);
  });

  test("returns false for a token that is already expired", () => {
    const token: OAuthToken = {
      access_token: "sk-ant-expired",
      expires_at: Date.now() - 5_000, // expired 5 seconds ago
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    expect(isLoggedIn()).toBe(false);
  });

  test("returns false for a token expiring within 60 seconds (grace window)", () => {
    const token: OAuthToken = {
      access_token: "sk-ant-soon",
      expires_at: Date.now() + 30_000, // 30s from now — inside 60s grace
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    expect(isLoggedIn()).toBe(false);
  });

  test("returns false after logout", () => {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: "sk-ant-x" }), "utf-8");
    logout();
    expect(isLoggedIn()).toBe(false);
  });
});

// ── getAccessToken ────────────────────────────────────────────────────────────

describe("getAccessToken", () => {
  test("returns null when no token file exists", () => {
    expect(getAccessToken()).toBeNull();
  });

  test("returns the access_token string from the token file", () => {
    const token: OAuthToken = { access_token: "sk-ant-get-me" };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    expect(getAccessToken()).toBe("sk-ant-get-me");
  });

  test("returns null after logout", () => {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: "sk-ant-bye" }), "utf-8");
    logout();
    expect(getAccessToken()).toBeNull();
  });
});

// ── refreshToken ─────────────────────────────────────────────────────────────

describe("refreshToken", () => {
  const _originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = _originalFetch;
    clearTokenCache();
    try { fs.unlinkSync(TOKEN_PATH); } catch { /* ok */ }
  });

  test("throws immediately when token has no refresh_token", async () => {
    const token: OAuthToken = { access_token: "sk-ant-no-rt" };
    await expect(refreshToken(token)).rejects.toThrow("No refresh token");
  });

  test("returns refreshed token on success", async () => {
    // @ts-ignore
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ access_token: "sk-ant-new", refresh_token: "rt-new", expires_in: 3600 }),
        { status: 200 }
      );

    const token: OAuthToken = { access_token: "sk-ant-old", refresh_token: "rt-old" };
    const result = await refreshToken(token);
    expect(result.access_token).toBe("sk-ant-new");
    expect(result.refresh_token).toBe("rt-new");
    expect(result.expires_at).toBeGreaterThan(Date.now());
  });

  test("preserves original refresh_token when server omits it", async () => {
    // @ts-ignore
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ access_token: "sk-ant-no-rt-resp", expires_in: 3600 }),
        { status: 200 }
      );

    const token: OAuthToken = { access_token: "old", refresh_token: "rt-keep-me" };
    const result = await refreshToken(token);
    expect(result.refresh_token).toBe("rt-keep-me");
  });

  test("saves the refreshed token to disk", async () => {
    // @ts-ignore
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ access_token: "sk-ant-saved", expires_in: 3600 }),
        { status: 200 }
      );

    const token: OAuthToken = { access_token: "old", refresh_token: "rt-save" };
    await refreshToken(token);

    const saved = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")) as OAuthToken;
    expect(saved.access_token).toBe("sk-ant-saved");
  });

  test("throws when server returns non-ok status", async () => {
    // @ts-ignore
    globalThis.fetch = async () =>
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });

    const token: OAuthToken = { access_token: "old", refresh_token: "rt-bad" };
    await expect(refreshToken(token)).rejects.toThrow();
  });

  test("400 response removes token from disk and throws", async () => {
    // @ts-ignore
    globalThis.fetch = async () =>
      new Response("Bad Request", { status: 400, statusText: "Bad Request" });

    const token: OAuthToken = { access_token: "old", refresh_token: "rt-expired" };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");

    await expect(refreshToken(token)).rejects.toThrow("Token refresh failed: Bad Request");
    // Token file must be deleted after 400
    expect(fs.existsSync(TOKEN_PATH)).toBe(false);
    // Cache must be cleared — loadToken() should return null
    expect(loadToken()).toBeNull();
  });

  test("getValidToken refreshes and returns token when expired and refresh_token present", async () => {
    // @ts-ignore
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ access_token: "sk-ant-refreshed", expires_in: 3600 }),
        { status: 200 }
      );

    const token: OAuthToken = {
      access_token: "sk-ant-expired",
      refresh_token: "rt-for-refresh",
      expires_at: Date.now() - 5_000, // expired
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");

    const result = await getValidToken();
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe("sk-ant-refreshed");
  });
});

// ── loginCopilot ─────────────────────────────────────────────────────────────

describe("loginCopilot", () => {
  const _originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = _originalFetch;
    try { fs.unlinkSync(COPILOT_TOKEN_PATH); } catch { /* ok */ }
  });

  test("throws when device code request fails", async () => {
    // @ts-ignore
    globalThis.fetch = async () =>
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" });

    await expect(loginCopilot(() => {})).rejects.toThrow("device code request failed");
  });

  test("calls onUserCode callback with user code and verification URI", async () => {
    const devicePayload = {
      device_code: "dc-test",
      user_code: "ABCD-1234",
      verification_uri: "https://github.com/login/device",
      expires_in: -1, // already expired → loop skipped immediately
      interval: 5,
    };

    // @ts-ignore
    globalThis.fetch = async (url: string) => {
      if ((url as string).includes("device/code")) {
        return new Response(JSON.stringify(devicePayload), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const userCodes: string[] = [];
    await expect(
      loginCopilot((code, uri) => {
        userCodes.push(code);
      })
    ).rejects.toThrow("timed out");

    expect(userCodes).toContain("ABCD-1234");
  });

  test("throws 'timed out' when device code expires before poll", async () => {
    const devicePayload = {
      device_code: "dc-expired",
      user_code: "ZZZZ-9999",
      verification_uri: "https://github.com/login/device",
      expires_in: -1, // already expired
      interval: 5,
    };

    // @ts-ignore
    globalThis.fetch = async (url: string) => {
      if ((url as string).includes("device/code")) {
        return new Response(JSON.stringify(devicePayload), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    await expect(loginCopilot(() => {})).rejects.toThrow("timed out");
  });
});

// ── getValidToken ─────────────────────────────────────────────────────────────

describe("getValidToken", () => {
  test("returns null when no token file exists", async () => {
    const result = await getValidToken();
    expect(result).toBeNull();
  });

  test("returns the token when it has no expiry (never expires)", async () => {
    const token: OAuthToken = { access_token: "sk-ant-no-expiry" };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    const result = await getValidToken();
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe("sk-ant-no-expiry");
  });

  test("returns the token when it expires far in the future", async () => {
    const token: OAuthToken = {
      access_token: "sk-ant-future-valid",
      expires_at: Date.now() + 3_600_000,
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    const result = await getValidToken();
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe("sk-ant-future-valid");
  });

  test("returns null for an expired token with no refresh_token (refresh fails)", async () => {
    // Token expired + no refresh_token → refreshToken() throws → getValidToken returns null
    const token: OAuthToken = {
      access_token: "sk-ant-expired-no-rt",
      expires_at: Date.now() - 5_000,
      // no refresh_token
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token), "utf-8");
    const result = await getValidToken();
    expect(result).toBeNull();
  });
});

// ── login ─────────────────────────────────────────────────────────────────────
// Tests the full OAuth PKCE flow by:
//   1. Starting the login() Promise (which opens a local HTTP server on a unique port)
//   2. Waiting briefly for the server to bind
//   3. Hitting the callback URL using Node.js http.request with agent:false
//   4. The globalThis.fetch mock intercepts the token-exchange HTTP call
//
// Each test gets its own port (54321, 54322, …) to avoid any inter-test port
// conflicts. The port parameter is threaded through login() → waitForCallback()
// → exchangeCode(), so no real REDIRECT_URI is needed.

describe("login", () => {
  const _origFetch = globalThis.fetch;

  // Each test allocates a unique port so servers never conflict.
  // Start at 54400 to avoid port 54321 which may be used by SSH tunnels.
  let _nextPort = 54400;
  function allocatePort() { return _nextPort++; }

  afterEach(() => {
    globalThis.fetch = _origFetch;
    clearTokenCache();
    delete process.env.SSH_CLIENT;
    try { fs.unlinkSync(TOKEN_PATH); } catch { /* ok */ }
  });

  /** Fire a single GET request to the given port and consume the response.
   *  Uses node:http directly with agent:false so the TCP connection closes
   *  immediately after the response. */
  function hitCallback(port: number, urlPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { hostname: "localhost", port, path: urlPath, method: "GET", agent: false,
          headers: { "Connection": "close" } },
        (res) => { res.resume(); res.on("end", resolve); res.on("error", reject); }
      );
      req.on("error", reject);
      req.end();
    });
  }

  /** Replace globalThis.fetch so TOKEN_URL calls return a canned response. */
  function mockTokenExchange(accessToken = "sk-ant-ok", httpStatus = 200) {
    // @ts-ignore
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const u = url instanceof Request ? url.url : String(url);
      if (u.includes("platform.claude.com")) {
        if (httpStatus === 401) return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
        if (httpStatus !== 200) return new Response("Server Error", { status: httpStatus, statusText: "Error" });
        return new Response(
          JSON.stringify({ access_token: accessToken, refresh_token: "rt-x", expires_in: 3600 }),
          { status: 200 }
        );
      }
      return _origFetch(url as string, init);
    };
  }

  /** Wait for the callback server to be ready (server.listen is async). */
  async function waitForServer() {
    await new Promise((r) => setTimeout(r, 80));
  }

  test("completes full PKCE flow and saves token", async () => {
    const port = allocatePort();
    process.env.SSH_CLIENT = "1.2.3.4 1234 1.2.3.4"; // skip openBrowser
    mockTokenExchange("sk-ant-full-flow");

    let capturedUrl = "";
    const loginPromise = login((url, ssh) => {
      capturedUrl = url;
      expect(typeof ssh).toBe("boolean");
    }, port);

    await waitForServer();
    await hitCallback(port, "/callback?code=pkce-code-abc");

    const token = await loginPromise;
    expect(token.access_token).toBe("sk-ant-full-flow");
    expect(token.refresh_token).toBe("rt-x");
    expect(token.expires_at).toBeGreaterThan(Date.now());

    // Verify auth URL has PKCE params
    expect(capturedUrl).toContain("code_challenge_method=S256");
    expect(capturedUrl).toContain("response_type=code");
    expect(capturedUrl).toContain("client_id=");
    expect(capturedUrl).toContain("state=");

    // Token must be persisted to disk
    const saved = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")) as OAuthToken;
    expect(saved.access_token).toBe("sk-ant-full-flow");
  });

  test("works without onUrl callback (optional parameter)", async () => {
    const port = allocatePort();
    process.env.SSH_CLIENT = "1.2.3.4 1234 1.2.3.4";
    mockTokenExchange("sk-ant-no-cb");

    const loginPromise = login(undefined, port); // no callback — covers the `if (onUrl)` false branch
    await waitForServer();
    await hitCallback(port, "/callback?code=no-cb-code");

    const token = await loginPromise;
    expect(token.access_token).toBe("sk-ant-no-cb");
  });

  test("rejects when callback URL contains error param", async () => {
    const port = allocatePort();
    process.env.SSH_CLIENT = "1.2.3.4 1234 1.2.3.4";
    mockTokenExchange();

    const loginPromise = login(() => {}, port);
    // Attach handler immediately so Bun doesn't flag this as unhandled rejection
    // before we reach the rejects.toThrow assertion below.
    void loginPromise.catch(() => {});
    await waitForServer();
    await hitCallback(port, "/callback?error=access_denied");

    await expect(loginPromise).rejects.toThrow("OAuth error: access_denied");
  });

  test("rejects when callback URL has neither code nor error", async () => {
    const port = allocatePort();
    process.env.SSH_CLIENT = "1.2.3.4 1234 1.2.3.4";
    mockTokenExchange();

    const loginPromise = login(() => {}, port);
    void loginPromise.catch(() => {});
    await waitForServer();
    await hitCallback(port, "/callback");

    await expect(loginPromise).rejects.toThrow("No authorization code received");
  });

  test("token exchange 401 throws authentication-failed error", async () => {
    const port = allocatePort();
    process.env.SSH_CLIENT = "1.2.3.4 1234 1.2.3.4";
    mockTokenExchange("", 401);

    const loginPromise = login(() => {}, port);
    void loginPromise.catch(() => {});
    await waitForServer();
    await hitCallback(port, "/callback?code=bad-code");

    await expect(loginPromise).rejects.toThrow(/Authentication failed/);
  });

  test("token exchange 500 throws generic error with status code", async () => {
    const port = allocatePort();
    process.env.SSH_CLIENT = "1.2.3.4 1234 1.2.3.4";
    mockTokenExchange("", 500);

    const loginPromise = login(() => {}, port);
    void loginPromise.catch(() => {});
    await waitForServer();
    await hitCallback(port, "/callback?code=err-code");

    await expect(loginPromise).rejects.toThrow(/500/);
  });

  test("isSSH() returns true when SSH_CLIENT is set", async () => {
    const port = allocatePort();
    process.env.SSH_CLIENT = "10.0.0.1 22 10.0.0.2";
    mockTokenExchange("sk-ant-ssh");

    let sshFlag: boolean | undefined;
    const loginPromise = login((_url, ssh) => { sshFlag = ssh; }, port);
    await waitForServer();
    await hitCallback(port, "/callback?code=ssh-test");
    await loginPromise;

    expect(sshFlag).toBe(true);
  });

  test("rejects with 'Failed to start callback server' when port is already in use", async () => {
    // Occupy the port with a raw TCP server before login() tries to bind
    const net = await import("net");
    const blockingServer = net.createServer();
    const port = allocatePort();
    await new Promise<void>((r) => blockingServer.listen(port, r));
    try {
      const loginPromise = login(undefined, port);
      void loginPromise.catch(() => {});
      await expect(loginPromise).rejects.toThrow(/Failed to start callback server/);
    } finally {
      await new Promise<void>((r) => blockingServer.close(() => r()));
    }
  });
});

// ── loginCopilot — polling flow ───────────────────────────────────────────────
// Tests the device-code polling loop in loginCopilot().
// setTimeout is replaced with a no-op so the 5s minimum wait becomes instant.

describe("loginCopilot — polling flow", () => {
  const _origFetch = globalThis.fetch;
  const _origSetTimeout = globalThis.setTimeout;

  afterEach(() => {
    globalThis.fetch = _origFetch;
    globalThis.setTimeout = _origSetTimeout;
    try { fs.unlinkSync(COPILOT_TOKEN_PATH); } catch { /* ok */ }
  });

  /** Make setTimeout resolve Promises immediately (via microtask). */
  function mockSetTimeoutInstant() {
    // @ts-ignore — replace the global so the polling loop doesn't actually wait 5s
    globalThis.setTimeout = (fn: () => void, _delay?: number) => {
      Promise.resolve().then(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    };
  }

  const devicePayload = (expiresIn = 300) => ({
    device_code: "dc-test",
    user_code: "POLL-0001",
    verification_uri: "https://github.com/login/device",
    expires_in: expiresIn,
    interval: 5,
  });

  test("success: returns token when first poll responds with access_token", async () => {
    mockSetTimeoutInstant();

    let pollCount = 0;
    // @ts-ignore
    globalThis.fetch = async (url: string) => {
      if (url.includes("device/code")) {
        return new Response(JSON.stringify(devicePayload()), { status: 200 });
      }
      pollCount++;
      return new Response(
        JSON.stringify({ access_token: "ghu_success_token", token_type: "bearer", scope: "read:user" }),
        { status: 200 }
      );
    };

    const token = await loginCopilot(() => {});
    expect(token.access_token).toBe("ghu_success_token");
    expect(token.token_type).toBe("bearer");
    expect(pollCount).toBe(1);

    // Token must be saved to disk
    const saved = JSON.parse(fs.readFileSync(COPILOT_TOKEN_PATH, "utf-8")) as CopilotToken;
    expect(saved.access_token).toBe("ghu_success_token");
  });

  test("authorization_pending: polls multiple times before succeeding", async () => {
    mockSetTimeoutInstant();

    let pollCount = 0;
    // @ts-ignore
    globalThis.fetch = async (url: string) => {
      if (url.includes("device/code")) {
        return new Response(JSON.stringify(devicePayload()), { status: 200 });
      }
      pollCount++;
      if (pollCount < 3) {
        return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ access_token: "ghu_after_pending", token_type: "bearer", scope: "read:user" }),
        { status: 200 }
      );
    };

    const token = await loginCopilot(() => {});
    expect(token.access_token).toBe("ghu_after_pending");
    expect(pollCount).toBe(3); // 2 pending + 1 success
  });

  test("access_denied: throws when poll returns access_denied", async () => {
    mockSetTimeoutInstant();

    // @ts-ignore
    globalThis.fetch = async (url: string) => {
      if (url.includes("device/code")) {
        return new Response(JSON.stringify(devicePayload()), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "access_denied" }), { status: 200 });
    };

    await expect(loginCopilot(() => {})).rejects.toThrow(/denied/i);
  });

  test("expired_token: throws when poll returns expired_token", async () => {
    mockSetTimeoutInstant();

    // @ts-ignore
    globalThis.fetch = async (url: string) => {
      if (url.includes("device/code")) {
        return new Response(JSON.stringify(devicePayload()), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "expired_token" }), { status: 200 });
    };

    await expect(loginCopilot(() => {})).rejects.toThrow(/expired/i);
  });

  test("token without explicit token_type / scope uses defaults", async () => {
    mockSetTimeoutInstant();

    // @ts-ignore
    globalThis.fetch = async (url: string) => {
      if (url.includes("device/code")) {
        return new Response(JSON.stringify(devicePayload()), { status: 200 });
      }
      // Omit token_type and scope — code should fill in defaults
      return new Response(JSON.stringify({ access_token: "ghu_defaults" }), { status: 200 });
    };

    const token = await loginCopilot(() => {});
    expect(token.access_token).toBe("ghu_defaults");
    expect(token.token_type).toBe("bearer");   // default
    expect(token.scope).toBe("read:user");     // COPILOT_SCOPE constant
  });
});
