/**
 * OAuth 2.0 + PKCE flow for Anthropic authentication.
 * Mirrors the exact implementation from the original Claude Code CLI.
 */
import fs from "fs";
import path from "path";
import os from "os";
import { createServer } from "http";
import { spawn } from "child_process";
import { createHash, randomBytes } from "crypto";
import { fetchWithProxy } from "./fetchWithProxy.ts";
import { logger } from "./logger.ts";

// ── Constants (from decompiled source) ───────────────────────────────────────
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

const SCOPES = [
  "org:create_api_key",
  "user:profile",
  "user:inference",
  "user:sessions:claude_code",
  "user:mcp_servers",
];

const REDIRECT_PORT = 54321;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

const TOKEN_PATH = path.join(os.homedir(), ".sofik", "anthropic-token.json");

// ── Types ─────────────────────────────────────────────────────────────────────
export interface OAuthToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ── Token persistence ─────────────────────────────────────────────────────────
export function loadToken(): OAuthToken | null {
  try {
    const raw = fs.readFileSync(TOKEN_PATH, "utf-8");
    const token = JSON.parse(raw) as OAuthToken;
    logger.auth.debug("Token OAuth carregado do disco");
    return token;
  } catch {
    return null;
  }
}

function saveToken(token: OAuthToken): void {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), "utf-8");
  logger.auth.info("Token OAuth salvo", { expiresAt: token.expires_at ? new Date(token.expires_at).toISOString() : null });
}

// ── SSH detection ─────────────────────────────────────────────────────────────
function isSSH(): boolean {
  return !!(process.env.SSH_CLIENT || process.env.SSH_TTY || process.env.SSH_CONNECTION);
}

// ── Browser ───────────────────────────────────────────────────────────────────
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => { /* browser not available — ignore */ });
    child.unref();
  } catch {
    // Silently ignore if browser cannot be launched
  }
}

// ── Local callback server ─────────────────────────────────────────────────────
function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      const isSuccess = !error;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isSuccess ? "Login realizado" : "Falha no login"} — Sofik AI</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0a0a0f;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: #e2e8f0;
      overflow: hidden;
    }

    /* animated grid background */
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(rgba(99,102,241,.04) 1px, transparent 1px),
        linear-gradient(90deg, rgba(99,102,241,.04) 1px, transparent 1px);
      background-size: 48px 48px;
      pointer-events: none;
    }

    /* radial glow */
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      background: radial-gradient(ellipse 80% 60% at 50% 0%, ${isSuccess ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)"} 0%, transparent 70%);
      pointer-events: none;
    }

    .card {
      position: relative;
      z-index: 1;
      width: min(440px, calc(100vw - 2rem));
      padding: 2.5rem;
      background: rgba(15, 15, 25, 0.85);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 1.25rem;
      backdrop-filter: blur(20px);
      box-shadow: 0 0 0 1px rgba(255,255,255,.03), 0 32px 64px rgba(0,0,0,.5);
      animation: slideUp .45s cubic-bezier(.16,1,.3,1) both;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(24px) scale(.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .logo {
      display: flex;
      align-items: center;
      gap: .6rem;
      margin-bottom: 2rem;
    }

    .logo-mark {
      width: 32px;
      height: 32px;
      border-radius: .5rem;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: .85rem;
      font-weight: 800;
      color: #fff;
      letter-spacing: -.5px;
      flex-shrink: 0;
    }

    .logo-text {
      font-size: 1rem;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -.3px;
    }

    .logo-text span {
      color: #818cf8;
    }

    .status-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.5rem;
      font-size: 1.6rem;
      background: ${isSuccess ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.12)"};
      border: 1px solid ${isSuccess ? "rgba(34,197,94,.25)" : "rgba(239,68,68,.25)"};
      animation: popIn .4s .2s cubic-bezier(.34,1.56,.64,1) both;
    }

    @keyframes popIn {
      from { opacity: 0; transform: scale(.5); }
      to   { opacity: 1; transform: scale(1); }
    }

    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -.4px;
      margin-bottom: .5rem;
    }

    .subtitle {
      font-size: .925rem;
      color: #94a3b8;
      line-height: 1.6;
    }

    .error-box {
      margin-top: 1.25rem;
      padding: .75rem 1rem;
      background: rgba(239,68,68,.08);
      border: 1px solid rgba(239,68,68,.2);
      border-radius: .6rem;
      font-size: .825rem;
      color: #fca5a5;
      font-family: "SF Mono", "Fira Code", monospace;
    }

    .divider {
      height: 1px;
      background: rgba(255,255,255,.06);
      margin: 1.75rem 0;
    }

    .footer {
      display: flex;
      align-items: center;
      gap: .5rem;
      font-size: .8rem;
      color: #475569;
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${isSuccess ? "#22c55e" : "#ef4444"};
      flex-shrink: 0;
      ${isSuccess ? "animation: pulse 2s ease-in-out infinite;" : ""}
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: .4; }
    }

    .countdown {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
      color: #334155;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <div class="logo-mark">S</div>
      <div class="logo-text">SOFIK <span>AI</span></div>
    </div>

    <div class="status-icon">${isSuccess ? "✓" : "✕"}</div>

    <h1>${isSuccess ? "Autenticação concluída" : "Falha na autenticação"}</h1>
    <p class="subtitle">
      ${isSuccess
        ? "Você foi autenticado com sucesso. Pode fechar esta aba e voltar ao terminal."
        : "Ocorreu um erro durante o processo de login. Tente novamente no terminal."}
    </p>

    ${error ? `<div class="error-box">${error}</div>` : ""}

    <div class="divider"></div>

    <div class="footer">
      <div class="dot"></div>
      <span>${isSuccess ? "Sessão iniciada" : "Sessão encerrada"}</span>
      ${isSuccess ? '<span class="countdown" id="cd">Fechando em 5s…</span>' : ""}
    </div>
  </div>

  ${isSuccess ? `
  <script>
    let t = 5;
    const el = document.getElementById('cd');
    const iv = setInterval(() => {
      t--;
      if (t <= 0) { clearInterval(iv); window.close(); }
      else el.textContent = 'Fechando em ' + t + 's\u2026';
    }, 1000);
  </script>` : ""}
</body>
</html>`);

      server.close();

      if (error) reject(new Error(`OAuth error: ${error}`));
      else if (code) resolve(code);
      else reject(new Error("No authorization code received"));
    });

    server.listen(REDIRECT_PORT, () => {
      // Server is ready
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });

    // 5 minute timeout
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth timed out after 5 minutes"));
    }, 5 * 60_000);
  });
}

// ── Token exchange ────────────────────────────────────────────────────────────
async function exchangeCode(code: string, codeVerifier: string, state: string): Promise<OAuthToken> {
  const body = {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  };

  const res = await fetchWithProxy(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(
      res.status === 401
        ? "Authentication failed: Invalid authorization code"
        : `Token exchange failed (${res.status}): ${text}`
    );
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
  };
}

// ── Token refresh ─────────────────────────────────────────────────────────────
export async function refreshToken(token: OAuthToken): Promise<OAuthToken> {
  if (!token.refresh_token) throw new Error("No refresh token available");

  logger.auth.info("Renovando token OAuth");

  const res = await fetchWithProxy(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      client_id: CLIENT_ID,
      scope: SCOPES.join(" "),
    }),
  });

  if (!res.ok) {
    logger.auth.error("Falha ao renovar token", { status: res.status, statusText: res.statusText });
    throw new Error(`Token refresh failed: ${res.statusText}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  const newToken: OAuthToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? token.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
  };

  saveToken(newToken);
  logger.auth.info("Token OAuth renovado com sucesso");
  return newToken;
}

// ── Main login flow ───────────────────────────────────────────────────────────
export async function login(onUrl?: (url: string, ssh: boolean) => void): Promise<OAuthToken> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  const authUrl = `${AUTHORIZE_URL}?${params}`;
  const ssh = isSSH();

  logger.auth.info("Fluxo OAuth iniciado", { ssh, scopes: SCOPES });

  if (onUrl) {
    onUrl(authUrl, ssh);
  }

  if (!ssh) {
    openBrowser(authUrl);
  }

  const code = await waitForCallback();
  logger.auth.info("Código de autorização OAuth recebido");

  const token = await exchangeCode(code, codeVerifier, state);
  logger.auth.info("Login OAuth concluído com sucesso");

  saveToken(token);

  return token;
}

// ── GitHub Copilot device flow ────────────────────────────────────────────────

const COPILOT_TOKEN_PATH = path.join(os.homedir(), ".sofik", "copilot-token.json");
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
// Public client ID used by GitHub Copilot CLI tools
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const COPILOT_SCOPE = "read:user";

export interface CopilotToken {
  access_token: string;
  token_type: string;
  scope: string;
}

export function loadCopilotToken(): CopilotToken | null {
  try {
    const raw = fs.readFileSync(COPILOT_TOKEN_PATH, "utf-8");
    return JSON.parse(raw) as CopilotToken;
  } catch {
    return null;
  }
}

function saveCopilotToken(token: CopilotToken): void {
  fs.mkdirSync(path.dirname(COPILOT_TOKEN_PATH), { recursive: true });
  fs.writeFileSync(COPILOT_TOKEN_PATH, JSON.stringify(token, null, 2), "utf-8");
}

export function logoutCopilot(): void {
  try {
    fs.unlinkSync(COPILOT_TOKEN_PATH);
  } catch { /* file may not exist */ }
}

export async function loginCopilot(
  onUserCode: (userCode: string, verificationUri: string) => void
): Promise<CopilotToken> {
  // Step 1: request device + user codes
  const deviceRes = await fetchWithProxy(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: COPILOT_SCOPE }),
  });

  if (!deviceRes.ok) {
    throw new Error(`GitHub device code request failed: ${deviceRes.statusText}`);
  }

  const deviceData = await deviceRes.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  // Notify caller so it can display the code to the user
  onUserCode(deviceData.user_code, deviceData.verification_uri);

  // Step 2: open browser at verification URI
  openBrowser(deviceData.verification_uri);

  // Step 3: poll until authorized or expired
  const expiresAt = Date.now() + deviceData.expires_in * 1000;
  const interval = Math.max(deviceData.interval ?? 5, 5) * 1000;

  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, interval));

    const pollRes = await fetchWithProxy(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const pollData = await pollRes.json() as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
    };

    if (pollData.access_token) {
      const token: CopilotToken = {
        access_token: pollData.access_token,
        token_type: pollData.token_type ?? "bearer",
        scope: pollData.scope ?? COPILOT_SCOPE,
      };
      saveCopilotToken(token);
      return token;
    }

    if (pollData.error === "access_denied") {
      throw new Error("GitHub login was denied.");
    }
    if (pollData.error === "expired_token") {
      throw new Error("Device code expired. Please run /login again.");
    }
    // "authorization_pending" or "slow_down" → keep polling
  }

  throw new Error("GitHub login timed out.");
}

// ── Logout ────────────────────────────────────────────────────────────────────
export function logout(): void {
  try {
    fs.unlinkSync(TOKEN_PATH);
    logger.auth.info("Logout realizado — token removido");
  } catch { /* file may not exist */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function isLoggedIn(): boolean {
  const token = loadToken();
  if (!token) return false;
  // Consider expired if within 60s of expiry
  if (token.expires_at && Date.now() > token.expires_at - 60_000) return false;
  return true;
}

export async function getValidToken(): Promise<OAuthToken | null> {
  const token = loadToken();
  if (!token) {
    logger.auth.debug("Nenhum token encontrado");
    return null;
  }

  // Still valid
  if (!token.expires_at || Date.now() < token.expires_at - 60_000) {
    return token;
  }

  // Try to refresh
  logger.auth.info("Token expirado, tentando renovar");
  try {
    const refreshed = await refreshToken(token);
    return refreshed;
  } catch (err) {
    logger.auth.error("Falha ao renovar token expirado", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function getAccessToken(): string | null {
  const token = loadToken();
  return token?.access_token ?? null;
}
