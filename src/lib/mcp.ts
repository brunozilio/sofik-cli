/**
 * MCP (Model Context Protocol) server integration.
 * Reads .mcp.json from the project root, spawns stdio servers,
 * and converts their tools into ToolDefinition objects.
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import type { ToolDefinition } from "./types.ts";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

class McpClient {
  private proc: ChildProcess;
  private buffer = "";
  private pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  public name: string;

  constructor(name: string, config: McpServerConfig) {
    this.name = name;
    this.proc = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "ignore"],
    });

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcMessage;
          if (msg.id !== undefined) {
            const p = this.pending.get(msg.id as number);
            if (p) {
              this.pending.delete(msg.id as number);
              if (msg.error) p.reject(new Error(msg.error.message));
              else p.resolve(msg.result);
            }
          }
        } catch { /* ignore malformed */ }
      }
    });
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      this.proc.stdin?.write(msg);
      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP call timed out: ${method}`));
        }
      }, 30_000);
    });
  }

  async initialize(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sofik", version: "1.0.0" },
    });
    await this.send("notifications/initialized");
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = await this.send("tools/list") as { tools?: unknown[] };
    return (result.tools ?? []) as Array<{ name: string; description?: string; inputSchema?: unknown }>;
  }

  async callTool(name: string, args: unknown): Promise<string> {
    const result = await this.send("tools/call", { name, arguments: args }) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    if (result.isError) throw new Error(text);
    return text;
  }

  dispose(): void {
    this.proc.kill();
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastErr;
}

const _activeClients: McpClient[] = [];
const _mcpHealth = new Map<string, boolean>();

export function getMcpStatus(): Array<{ name: string; healthy: boolean }> {
  return Array.from(_mcpHealth.entries()).map(([name, healthy]) => ({ name, healthy }));
}

export function disposeMcpClients(): void {
  for (const client of _activeClients) {
    try { client.dispose(); } catch { /* ignore */ }
  }
  _activeClients.length = 0;
  _mcpHealth.clear();
}

export async function loadMcpTools(): Promise<ToolDefinition[]> {
  const configPath = path.join(process.cwd(), ".mcp.json");
  if (!fs.existsSync(configPath)) return [];

  let config: McpConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as McpConfig;
  } catch {
    return [];
  }

  const toolDefs: ToolDefinition[] = [];

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers ?? {})) {
    const client = new McpClient(serverName, serverConfig);
    _activeClients.push(client);
    _mcpHealth.set(serverName, false);

    try {
      await withRetry(() => client.initialize());
      _mcpHealth.set(serverName, true);

      const mcpTools = await client.listTools();

      for (const mcpTool of mcpTools) {
        const toolName = `mcp__${serverName}__${mcpTool.name}`;
        toolDefs.push({
          name: toolName,
          description: `[MCP:${serverName}] ${mcpTool.description ?? mcpTool.name}`,
          input_schema: (mcpTool.inputSchema ?? { type: "object", properties: {} }) as ToolDefinition["input_schema"],
          async execute(input) {
            return await withRetry(() => client.callTool(mcpTool.name, input));
          },
        });
      }
    } catch (err) {
      _mcpHealth.set(serverName, false);
      console.error(`MCP server "${serverName}" failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return toolDefs;
}
