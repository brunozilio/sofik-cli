/**
 * AI tool for integration actions.
 * IntegrationAction — call any action on a connected integration
 */
import { getConnector, getAllProviders } from "../integrations/connectors/index.ts";
import { getCredentials, listConnectedProviders, isConnected } from "../integrations/CredentialStore.ts";
import type { ToolDefinition } from "../lib/types.ts";
import { logger } from "../lib/logger.ts";

export const integrationActionTool: ToolDefinition = {
  name: "IntegrationAction",
  description:
    "Execute an action on a connected integration (GitHub, Slack, Linear, Stripe, Sentry). " +
    "Use IntegrationList to discover available actions and their parameters.",
  input_schema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        description: "Integration provider (github, slack, linear, stripe, sentry)",
      },
      action: {
        type: "string",
        description: "Action name (e.g. create_issue_comment, send_message)",
      },
      params: {
        type: "object",
        description: "Action parameters (specific to each action)",
      },
    },
    required: ["provider", "action", "params"],
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const provider = input.provider as string;
    const action = input.action as string;
    const params = (input.params as Record<string, unknown>) ?? {};

    const connector = getConnector(provider);
    if (!connector) {
      const available = getAllProviders().join(", ");
      logger.tool.warn("IntegrationAction provedor desconhecido", { provider, available });
      return `Provedor desconhecido "${provider}". Disponíveis: ${available}`;
    }

    const credentials = getCredentials(provider);
    if (!credentials) {
      logger.tool.warn("IntegrationAction não conectado", { provider, action });
      return `Integração "${provider}" não está conectada. Execute /integration connect ${provider}`;
    }

    const t0 = Date.now();
    logger.tool.info("IntegrationAction iniciado", { provider, action, paramKeys: Object.keys(params) });
    try {
      const result = await connector.executeAction(action, credentials, params);
      const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      logger.tool.info("IntegrationAction concluído", { provider, action, durationMs: Date.now() - t0, resultLength: resultStr.length });
      return resultStr;
    } catch (err) {
      logger.tool.error("IntegrationAction erro", { provider, action, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 });
      return `Erro: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const integrationListTool: ToolDefinition = {
  name: "IntegrationList",
  description:
    "List available integration providers and their actions. Shows which providers are connected and what actions they support.",
  input_schema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        description: "Filter by provider name (optional)",
      },
    },
    required: [],
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const filterProvider = input.provider as string | undefined;
    const connected = listConnectedProviders();
    const connectedSet = new Set(connected.map((c) => c.provider));

    const providers = filterProvider ? [filterProvider] : getAllProviders();
    const lines: string[] = [];

    for (const provider of providers) {
      const connector = getConnector(provider);
      if (!connector) continue;

      const status = connectedSet.has(provider) ? "✓ conectado" : "✗ não conectado";
      lines.push(`${provider} (${connector.definition.name}) — ${status}`);

      if (connectedSet.has(provider) || filterProvider) {
        for (const action of connector.definition.actions) {
          lines.push(`  • ${action.name}: ${action.description}`);
          const reqParams = Object.entries(action.params)
            .filter(([, s]) => s.required)
            .map(([k]) => k);
          if (reqParams.length > 0) {
            lines.push(`    Parâmetros obrigatórios: ${reqParams.join(", ")}`);
          }
        }
      }
      lines.push("");
    }

    if (lines.length === 0) {
      return "Nenhuma integração disponível.";
    }

    return lines.join("\n");
  },
};
