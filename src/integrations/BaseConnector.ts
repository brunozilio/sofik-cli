import type { ConnectorDefinition, IntegrationCredentials } from "../types/integration.ts";

export abstract class BaseConnector {
  abstract readonly definition: ConnectorDefinition;

  /**
   * Execute a named action with the given credentials and parameters.
   */
  async executeAction(
    actionName: string,
    credentials: IntegrationCredentials,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const action = this.definition.actions.find((a) => a.name === actionName);
    if (!action) throw new Error(`Action "${actionName}" not found in ${this.definition.provider}`);
    return action.execute(credentials, params);
  }
}
