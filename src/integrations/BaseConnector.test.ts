import { test, expect, describe } from "bun:test";
import { BaseConnector } from "./BaseConnector.ts";
import type { ConnectorDefinition, IntegrationCredentials } from "../types/integration.ts";

// ---------------------------------------------------------------------------
// Concrete subclass for testing the abstract BaseConnector
// ---------------------------------------------------------------------------

class TestConnector extends BaseConnector {
  get definition(): ConnectorDefinition {
    return {
      provider: "test" as any,
      name: "Test",
      description: "Test connector",
      authType: "api_key",
      actions: [
        {
          name: "test_action",
          description: "Test action",
          params: {},
          async execute(creds, params) {
            return { creds, params };
          },
        },
        {
          name: "echo_action",
          description: "Echoes the params",
          params: {
            message: { type: "string", description: "Message to echo" },
          },
          async execute(_creds, params) {
            return { echo: params.message };
          },
        },
        {
          name: "throw_action",
          description: "Always throws",
          params: {},
          async execute(_creds, _params) {
            throw new Error("intentional action error");
          },
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BaseConnector", () => {
  const connector = new TestConnector();
  const creds: IntegrationCredentials = { apiKey: "test-key-123" };

  // ── constructor ───────────────────────────────────────────────────────────

  test("constructor creates a valid instance", () => {
    const c = new TestConnector();
    expect(c.definition.provider).toBe("test");
  });

  // ── definition shape ──────────────────────────────────────────────────────

  describe("definition", () => {
    test("exposes a definition object", () => {
      expect(connector.definition).toBeDefined();
    });

    test("definition has provider field", () => {
      expect(connector.definition.provider).toBe("test");
    });

    test("definition has name field", () => {
      expect(connector.definition.name).toBe("Test");
    });

    test("definition has description field", () => {
      expect(connector.definition.description).toBe("Test connector");
    });

    test("definition has authType field", () => {
      expect(connector.definition.authType).toBe("api_key");
    });

    test("definition has actions array", () => {
      expect(Array.isArray(connector.definition.actions)).toBe(true);
    });

    test("definition actions have correct count", () => {
      expect(connector.definition.actions).toHaveLength(3);
    });

    test("each action has a name", () => {
      for (const action of connector.definition.actions) {
        expect(typeof action.name).toBe("string");
        expect(action.name.length).toBeGreaterThan(0);
      }
    });

    test("each action has an execute function", () => {
      for (const action of connector.definition.actions) {
        expect(typeof action.execute).toBe("function");
      }
    });
  });

  // ── executeAction — happy path ────────────────────────────────────────────

  describe("executeAction — valid action", () => {
    test("returns a result for a known action", async () => {
      const result = await connector.executeAction("test_action", creds, {});
      expect(result).toBeDefined();
    });

    test("passes credentials to execute", async () => {
      const result = await connector.executeAction("test_action", creds, {}) as any;
      expect(result.creds).toEqual(creds);
    });

    test("passes params to execute", async () => {
      const params = { foo: "bar", num: 42 };
      const result = await connector.executeAction("test_action", creds, params) as any;
      expect(result.params).toEqual(params);
    });

    test("returns value from execute function", async () => {
      const result = await connector.executeAction("echo_action", creds, { message: "hello" }) as any;
      expect(result.echo).toBe("hello");
    });

    test("passes empty params object when no params supplied", async () => {
      const result = await connector.executeAction("test_action", creds, {}) as any;
      expect(result.params).toEqual({});
    });

    test("works with accessToken credential instead of apiKey", async () => {
      const tokenCreds: IntegrationCredentials = { accessToken: "oauth-token" };
      const result = await connector.executeAction("test_action", tokenCreds, {}) as any;
      expect(result.creds.accessToken).toBe("oauth-token");
    });

    test("works with multiple credential fields", async () => {
      const fullCreds: IntegrationCredentials = {
        apiKey: "key",
        accessToken: "token",
        refreshToken: "refresh",
        extra: { orgId: "org-1" },
      };
      const result = await connector.executeAction("test_action", fullCreds, {}) as any;
      expect(result.creds).toEqual(fullCreds);
    });
  });

  // ── executeAction — unknown action ────────────────────────────────────────

  describe("executeAction — unknown action", () => {
    test("throws an Error for unknown action name", async () => {
      await expect(
        connector.executeAction("nonexistent_action", creds, {})
      ).rejects.toThrow();
    });

    test("error message includes the action name", async () => {
      await expect(
        connector.executeAction("nonexistent_action", creds, {})
      ).rejects.toThrow("nonexistent_action");
    });

    test("error message includes the provider name", async () => {
      await expect(
        connector.executeAction("bad_action", creds, {})
      ).rejects.toThrow("test");
    });

    test('throws with message containing "not found"', async () => {
      await expect(
        connector.executeAction("missing", creds, {})
      ).rejects.toThrow(/not found/i);
    });

    test("throws an actual Error instance (not a plain string)", async () => {
      let caught: unknown;
      try {
        await connector.executeAction("ghost", creds, {});
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });

    test("rejects with different unknown action names each time", async () => {
      const names = ["a", "b", "c"];
      for (const name of names) {
        await expect(
          connector.executeAction(name, creds, {})
        ).rejects.toThrow(name);
      }
    });
  });

  // ── executeAction — action that throws internally ─────────────────────────

  describe("executeAction — action throws", () => {
    test("propagates errors thrown by execute", async () => {
      await expect(
        connector.executeAction("throw_action", creds, {})
      ).rejects.toThrow("intentional action error");
    });

    test("rejection is an Error instance from the action", async () => {
      let caught: unknown;
      try {
        await connector.executeAction("throw_action", creds, {});
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
    });
  });
});
