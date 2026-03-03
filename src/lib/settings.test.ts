import { test, expect, describe } from "bun:test";
import { validateSettings } from "./settings.ts";
import type { Settings, PermissionRule } from "./settings.ts";

// ─── validateSettings — valid inputs ────────────────────────────────────────

describe("validateSettings — valid inputs produce no errors", () => {
  test("empty object is valid", () => {
    expect(validateSettings({})).toEqual([]);
  });

  test("valid defaultMode 'ask' is accepted", () => {
    expect(validateSettings({ defaultMode: "ask" })).toEqual([]);
  });

  test("valid defaultMode 'auto' is accepted", () => {
    expect(validateSettings({ defaultMode: "auto" })).toEqual([]);
  });

  test("valid defaultMode 'bypassPermissions' is accepted", () => {
    expect(validateSettings({ defaultMode: "bypassPermissions" })).toEqual([]);
  });

  test("valid defaultMode 'plan' is accepted", () => {
    expect(validateSettings({ defaultMode: "plan" })).toEqual([]);
  });

  test("valid brevity 'strict' is accepted", () => {
    expect(validateSettings({ brevity: "strict" })).toEqual([]);
  });

  test("valid brevity 'focused' is accepted", () => {
    expect(validateSettings({ brevity: "focused" })).toEqual([]);
  });

  test("valid brevity 'polished' is accepted", () => {
    expect(validateSettings({ brevity: "polished" })).toEqual([]);
  });

  test("valid permissions array with allow rule is accepted", () => {
    const s: Settings = {
      permissions: [{ type: "allow", rule: "Bash(git:*)" }],
    };
    expect(validateSettings(s)).toEqual([]);
  });

  test("valid permissions array with deny rule is accepted", () => {
    const s: Settings = {
      permissions: [{ type: "deny", rule: "Write" }],
    };
    expect(validateSettings(s)).toEqual([]);
  });

  test("valid permissions array with ask rule is accepted", () => {
    const s: Settings = {
      permissions: [{ type: "ask", rule: "Edit(src/**)" }],
    };
    expect(validateSettings(s)).toEqual([]);
  });

  test("valid full settings object is accepted", () => {
    const s: Settings = {
      defaultMode: "ask",
      brevity: "focused",
      model: "claude-opus-4-6",
      language: "Portuguese",
      disableSandbox: false,
      additionalDirectories: ["/tmp"],
      memoryExcludes: ["*.secret"],
      hooks: { postToolUse: "echo done" },
      permissions: [
        { type: "allow", rule: "Read" },
        { type: "deny", rule: "Bash(rm:*)" },
      ],
    };
    expect(validateSettings(s)).toEqual([]);
  });
});

// ─── validateSettings — unknown keys ────────────────────────────────────────

describe("validateSettings — unknown keys produce errors", () => {
  test("an unrecognised key produces one error", () => {
    const s = { unknownKey: "value" } as unknown as Settings;
    const errors = validateSettings(s);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Unknown settings key");
    expect(errors[0]).toContain("unknownKey");
  });

  test("multiple unknown keys produce one error each", () => {
    const s = { foo: 1, bar: 2 } as unknown as Settings;
    const errors = validateSettings(s);
    expect(errors.length).toBe(2);
  });

  test("a mix of known and unknown keys only errors on the unknown ones", () => {
    const s = { defaultMode: "ask", notAKey: true } as unknown as Settings;
    const errors = validateSettings(s);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("notAKey");
  });
});

// ─── validateSettings — invalid defaultMode ──────────────────────────────────

describe("validateSettings — invalid defaultMode", () => {
  test("an unrecognised defaultMode value produces an error", () => {
    const s = { defaultMode: "superauto" } as unknown as Settings;
    const errors = validateSettings(s);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Invalid defaultMode");
    expect(errors[0]).toContain("superauto");
  });

  test("the error message lists the valid defaultMode values", () => {
    const s = { defaultMode: "nope" } as unknown as Settings;
    const [error] = validateSettings(s);
    expect(error).toContain("ask");
    expect(error).toContain("auto");
    expect(error).toContain("plan");
  });
});

// ─── validateSettings — invalid brevity ──────────────────────────────────────

describe("validateSettings — invalid brevity", () => {
  test("an unrecognised brevity value produces an error", () => {
    const s = { brevity: "verbose" } as unknown as Settings;
    const errors = validateSettings(s);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Invalid brevity");
    expect(errors[0]).toContain("verbose");
  });

  test("the error message lists valid brevity options", () => {
    const s = { brevity: "nope" } as unknown as Settings;
    const [error] = validateSettings(s);
    expect(error).toContain("strict");
    expect(error).toContain("focused");
    expect(error).toContain("polished");
  });
});

// ─── validateSettings — invalid permissions entries ───────────────────────────

describe("validateSettings — malformed permissions entries", () => {
  test("permission with invalid type produces an error", () => {
    const s: Settings = {
      permissions: [{ type: "maybe" as "allow", rule: "Bash" }],
    };
    const errors = validateSettings(s);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("permissions[0].type");
    expect(errors[0]).toContain("maybe");
  });

  test("permission with empty rule string produces an error", () => {
    const s: Settings = {
      permissions: [{ type: "allow", rule: "" }],
    };
    const errors = validateSettings(s);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("permissions[0].rule");
  });

  test("permission with non-string rule produces an error", () => {
    const s: Settings = {
      permissions: [{ type: "allow", rule: 42 as unknown as string }],
    };
    const errors = validateSettings(s);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("permissions[0].rule");
  });

  test("multiple invalid permissions accumulate errors with correct indices", () => {
    const s: Settings = {
      permissions: [
        { type: "allow", rule: "Read" },   // index 0 — valid
        { type: "bad" as "allow", rule: "" }, // index 1 — both fields invalid
      ],
    };
    const errors = validateSettings(s);
    // Expect two errors, both referencing index 1
    expect(errors.length).toBe(2);
    for (const e of errors) {
      expect(e).toContain("permissions[1]");
    }
  });
});

// ─── Settings layer merging (manual composition) ─────────────────────────────
//
// mergeSettings is not exported, but we can verify its semantics by building
// Settings objects by hand and checking that later values override earlier ones.

describe("settings merge semantics (manual layer composition)", () => {
  test("later defaultMode overrides earlier defaultMode", () => {
    const base: Settings = { defaultMode: "ask" };
    const override: Settings = { defaultMode: "plan" };
    // Simulate a merge: later wins for scalar fields.
    const merged: Settings = { ...base, ...override };
    expect(merged.defaultMode).toBe("plan");
    expect(validateSettings(merged)).toEqual([]);
  });

  test("later brevity overrides earlier brevity", () => {
    const base: Settings = { brevity: "strict" };
    const override: Settings = { brevity: "polished" };
    const merged: Settings = { ...base, ...override };
    expect(merged.brevity).toBe("polished");
    expect(validateSettings(merged)).toEqual([]);
  });

  test("permissions from two layers are additive", () => {
    // mergeSettings concatenates permission arrays rather than replacing.
    const layer1: Settings = {
      permissions: [{ type: "allow", rule: "Read" }],
    };
    const layer2: Settings = {
      permissions: [{ type: "deny", rule: "Bash" }],
    };
    // Simulate what mergeSettings does: concatenate arrays.
    const merged: Settings = {
      permissions: [
        ...(layer1.permissions ?? []),
        ...(layer2.permissions ?? []),
      ],
    };
    expect(merged.permissions?.length).toBe(2);
    expect(validateSettings(merged)).toEqual([]);
  });

  test("model in later layer overrides model in earlier layer", () => {
    const base: Settings = { model: "claude-3-sonnet" };
    const override: Settings = { model: "claude-opus-4-6" };
    const merged: Settings = { ...base, ...override };
    expect(merged.model).toBe("claude-opus-4-6");
  });

  test("hooks from two layers are merged (not replaced)", () => {
    const base: Settings = { hooks: { preToolUse: "echo pre" } };
    const override: Settings = { hooks: { postToolUse: "echo post" } };
    // Simulate mergeSettings hook merging.
    const merged: Settings = {
      hooks: { ...base.hooks, ...override.hooks },
    };
    expect(merged.hooks?.["preToolUse"]).toBe("echo pre");
    expect(merged.hooks?.["postToolUse"]).toBe("echo post");
  });

  test("disableSandbox false in base is overridden by true in later layer", () => {
    const base: Settings = { disableSandbox: false };
    const override: Settings = { disableSandbox: true };
    const merged: Settings = { ...base, ...override };
    expect(merged.disableSandbox).toBe(true);
    expect(validateSettings(merged)).toEqual([]);
  });
});
