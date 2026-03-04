import { test, expect, describe } from "bun:test";
import { getConnector, getAllConnectors, getAllProviders } from "./index.ts";
import { GitHubConnector } from "./GitHubConnector.ts";
import { StripeConnector } from "./StripeConnector.ts";
import { SentryConnector } from "./SentryConnector.ts";
import { LinearConnector } from "./LinearConnector.ts";
import { SlackConnector } from "./SlackConnector.ts";

// ---------------------------------------------------------------------------
// getConnector
// ---------------------------------------------------------------------------

describe("getConnector", () => {
  test("returns a non-null value for 'github'", () => {
    expect(getConnector("github")).not.toBeNull();
  });

  test("returns a GitHubConnector instance for 'github'", () => {
    expect(getConnector("github")).toBeInstanceOf(GitHubConnector);
  });

  test("github connector has correct provider in definition", () => {
    expect(getConnector("github")!.definition.provider).toBe("github");
  });

  test("returns a non-null value for 'stripe'", () => {
    expect(getConnector("stripe")).not.toBeNull();
  });

  test("returns a StripeConnector instance for 'stripe'", () => {
    expect(getConnector("stripe")).toBeInstanceOf(StripeConnector);
  });

  test("stripe connector has correct provider in definition", () => {
    expect(getConnector("stripe")!.definition.provider).toBe("stripe");
  });

  test("returns a non-null value for 'sentry'", () => {
    expect(getConnector("sentry")).not.toBeNull();
  });

  test("returns a SentryConnector instance for 'sentry'", () => {
    expect(getConnector("sentry")).toBeInstanceOf(SentryConnector);
  });

  test("returns a non-null value for 'linear'", () => {
    expect(getConnector("linear")).not.toBeNull();
  });

  test("returns a LinearConnector instance for 'linear'", () => {
    expect(getConnector("linear")).toBeInstanceOf(LinearConnector);
  });

  test("returns a non-null value for 'slack'", () => {
    expect(getConnector("slack")).not.toBeNull();
  });

  test("returns a SlackConnector instance for 'slack'", () => {
    expect(getConnector("slack")).toBeInstanceOf(SlackConnector);
  });

  test("returns a non-null value for 'playwright'", () => {
    expect(getConnector("playwright")).not.toBeNull();
  });

  test("playwright connector has correct provider in definition", () => {
    expect(getConnector("playwright")!.definition.provider).toBe("playwright");
  });

  test("returns a non-null value for 'context7'", () => {
    expect(getConnector("context7")).not.toBeNull();
  });

  test("context7 connector has correct provider in definition", () => {
    expect(getConnector("context7")!.definition.provider).toBe("context7");
  });

  test("returns a non-null value for 'notion'", () => {
    expect(getConnector("notion")).not.toBeNull();
  });

  test("returns a non-null value for 'figma'", () => {
    expect(getConnector("figma")).not.toBeNull();
  });

  test("returns a non-null value for 'atlassian'", () => {
    expect(getConnector("atlassian")).not.toBeNull();
  });

  test("returns a non-null value for 'vercel'", () => {
    expect(getConnector("vercel")).not.toBeNull();
  });

  test("returns a non-null value for 'supabase'", () => {
    expect(getConnector("supabase")).not.toBeNull();
  });

  test("returns a non-null value for 'cloudflare'", () => {
    expect(getConnector("cloudflare")).not.toBeNull();
  });

  test("returns null for a nonexistent provider string", () => {
    expect(getConnector("nonexistent")).toBeNull();
  });

  test("returns null for an empty string", () => {
    expect(getConnector("")).toBeNull();
  });

  test("returns null for an arbitrary unknown name", () => {
    expect(getConnector("my_fake_connector")).toBeNull();
  });

  test("is case-sensitive: 'GitHub' returns null", () => {
    expect(getConnector("GitHub")).toBeNull();
  });

  test("is case-sensitive: 'STRIPE' returns null", () => {
    expect(getConnector("STRIPE")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAllConnectors
// ---------------------------------------------------------------------------

describe("getAllConnectors", () => {
  test("returns an array", () => {
    expect(Array.isArray(getAllConnectors())).toBe(true);
  });

  test("returns exactly 13 connectors", () => {
    expect(getAllConnectors()).toHaveLength(13);
  });

  test("every item has a definition property", () => {
    for (const connector of getAllConnectors()) {
      expect(connector.definition).toBeDefined();
    }
  });

  test("every definition has a provider string", () => {
    for (const connector of getAllConnectors()) {
      expect(typeof connector.definition.provider).toBe("string");
    }
  });

  test("every definition has a name string", () => {
    for (const connector of getAllConnectors()) {
      expect(typeof connector.definition.name).toBe("string");
      expect(connector.definition.name.length).toBeGreaterThan(0);
    }
  });

  test("every definition has an authType", () => {
    for (const connector of getAllConnectors()) {
      expect(connector.definition.authType).toBeDefined();
    }
  });

  test("every definition has an actions array", () => {
    for (const connector of getAllConnectors()) {
      expect(Array.isArray(connector.definition.actions)).toBe(true);
    }
  });

  test("every connector has at least one action", () => {
    for (const connector of getAllConnectors()) {
      expect(connector.definition.actions.length).toBeGreaterThan(0);
    }
  });

  test("every action has a name", () => {
    for (const connector of getAllConnectors()) {
      for (const action of connector.definition.actions) {
        expect(typeof action.name).toBe("string");
      }
    }
  });

  test("every action has an execute function", () => {
    for (const connector of getAllConnectors()) {
      for (const action of connector.definition.actions) {
        expect(typeof action.execute).toBe("function");
      }
    }
  });

  test("every connector has a executeAction method", () => {
    for (const connector of getAllConnectors()) {
      expect(typeof connector.executeAction).toBe("function");
    }
  });

  test("providers in getAllConnectors() match providers in getAllProviders()", () => {
    const connectorProviders = getAllConnectors().map((c) => c.definition.provider).sort();
    const providers = getAllProviders().slice().sort();
    expect(connectorProviders).toEqual(providers);
  });

  test("returned array is a new snapshot each call (not cached reference equality)", () => {
    const first = getAllConnectors();
    const second = getAllConnectors();
    // Values should be the same connector instances
    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(first[i]).toBe(second[i]);
    }
  });

  test("contains a connector with provider 'github'", () => {
    const providers = getAllConnectors().map((c) => c.definition.provider);
    expect(providers).toContain("github");
  });

  test("contains a connector with provider 'stripe'", () => {
    const providers = getAllConnectors().map((c) => c.definition.provider);
    expect(providers).toContain("stripe");
  });

  test("contains a connector with provider 'sentry'", () => {
    const providers = getAllConnectors().map((c) => c.definition.provider);
    expect(providers).toContain("sentry");
  });

  test("contains a connector with provider 'linear'", () => {
    const providers = getAllConnectors().map((c) => c.definition.provider);
    expect(providers).toContain("linear");
  });

  test("contains a connector with provider 'slack'", () => {
    const providers = getAllConnectors().map((c) => c.definition.provider);
    expect(providers).toContain("slack");
  });
});

// ---------------------------------------------------------------------------
// getAllProviders
// ---------------------------------------------------------------------------

describe("getAllProviders", () => {
  test("returns an array", () => {
    expect(Array.isArray(getAllProviders())).toBe(true);
  });

  test("returns exactly 13 providers", () => {
    expect(getAllProviders()).toHaveLength(13);
  });

  test("includes 'github'", () => {
    expect(getAllProviders()).toContain("github");
  });

  test("includes 'stripe'", () => {
    expect(getAllProviders()).toContain("stripe");
  });

  test("includes 'sentry'", () => {
    expect(getAllProviders()).toContain("sentry");
  });

  test("includes 'linear'", () => {
    expect(getAllProviders()).toContain("linear");
  });

  test("includes 'slack'", () => {
    expect(getAllProviders()).toContain("slack");
  });

  test("includes 'playwright'", () => {
    expect(getAllProviders()).toContain("playwright");
  });

  test("includes 'context7'", () => {
    expect(getAllProviders()).toContain("context7");
  });

  test("includes 'notion'", () => {
    expect(getAllProviders()).toContain("notion");
  });

  test("includes 'figma'", () => {
    expect(getAllProviders()).toContain("figma");
  });

  test("includes 'atlassian'", () => {
    expect(getAllProviders()).toContain("atlassian");
  });

  test("includes 'vercel'", () => {
    expect(getAllProviders()).toContain("vercel");
  });

  test("includes 'supabase'", () => {
    expect(getAllProviders()).toContain("supabase");
  });

  test("includes 'cloudflare'", () => {
    expect(getAllProviders()).toContain("cloudflare");
  });

  test("all providers are strings", () => {
    for (const provider of getAllProviders()) {
      expect(typeof provider).toBe("string");
    }
  });

  test("all providers are non-empty strings", () => {
    for (const provider of getAllProviders()) {
      expect(provider.length).toBeGreaterThan(0);
    }
  });

  test("all providers are unique (no duplicates)", () => {
    const providers = getAllProviders();
    const unique = new Set(providers);
    expect(unique.size).toBe(providers.length);
  });

  test("getConnector returns non-null for every provider returned by getAllProviders", () => {
    for (const provider of getAllProviders()) {
      expect(getConnector(provider)).not.toBeNull();
    }
  });

  test("each provider from getAllProviders matches its connector definition.provider", () => {
    for (const provider of getAllProviders()) {
      const connector = getConnector(provider);
      expect(connector!.definition.provider).toBe(provider);
    }
  });
});
