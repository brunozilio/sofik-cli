import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { editTool } from "./edit.ts";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofik-edit-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let counter = 0;
function tmpFile(content: string): string {
  const p = path.join(tmpDir, `file-${counter++}.txt`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

async function edit(input: Record<string, unknown>): Promise<string> {
  return editTool.execute!(input) as Promise<string>;
}

// ── Tool metadata ──────────────────────────────────────────────────────────────

describe("editTool metadata", () => {
  test("name is 'Edit'", () => {
    expect(editTool.name).toBe("Edit");
  });

  test("has a description", () => {
    expect(typeof editTool.description).toBe("string");
    expect(editTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof editTool.execute).toBe("function");
  });

  test("input_schema requires file_path", () => {
    expect(editTool.input_schema.required).toContain("file_path");
  });

  test("input_schema requires old_string", () => {
    expect(editTool.input_schema.required).toContain("old_string");
  });

  test("input_schema requires new_string", () => {
    expect(editTool.input_schema.required).toContain("new_string");
  });

  test("input_schema has replace_all property", () => {
    expect(editTool.input_schema.properties).toHaveProperty("replace_all");
  });
});

// ── Basic editing ──────────────────────────────────────────────────────────────

describe("editTool — basic editing", () => {
  test("replaces a unique string in a file", async () => {
    const p = tmpFile("hello world\n");
    await edit({ file_path: p, old_string: "hello", new_string: "goodbye" });
    expect(fs.readFileSync(p, "utf-8")).toBe("goodbye world\n");
  });

  test("returns success message with file name", async () => {
    const p = tmpFile("foo bar\n");
    const result = await edit({ file_path: p, old_string: "foo", new_string: "baz" });
    expect(result).toContain(path.basename(p));
  });

  test("returns diff in output", async () => {
    const p = tmpFile("old text\n");
    const result = await edit({ file_path: p, old_string: "old text", new_string: "new text" });
    expect(result).toContain("__DIFF__");
    expect(result).toContain("__END_DIFF__");
  });

  test("diff contains minus line for old_string", async () => {
    const p = tmpFile("remove me\n");
    const result = await edit({ file_path: p, old_string: "remove me", new_string: "add me" });
    expect(result).toContain("- remove me");
  });

  test("diff contains plus line for new_string", async () => {
    const p = tmpFile("old content\n");
    const result = await edit({ file_path: p, old_string: "old content", new_string: "new content" });
    expect(result).toContain("+ new content");
  });

  test("replaces multiline old_string", async () => {
    const p = tmpFile("line1\nline2\nline3\n");
    await edit({ file_path: p, old_string: "line1\nline2", new_string: "replaced" });
    expect(fs.readFileSync(p, "utf-8")).toBe("replaced\nline3\n");
  });

  test("replaces string with empty string (deletion)", async () => {
    const p = tmpFile("keep delete keep\n");
    await edit({ file_path: p, old_string: " delete", new_string: "" });
    expect(fs.readFileSync(p, "utf-8")).toBe("keep keep\n");
  });

  test("handles unicode replacement correctly", async () => {
    const p = tmpFile("héllo wörld\n");
    await edit({ file_path: p, old_string: "héllo", new_string: "ciao" });
    expect(fs.readFileSync(p, "utf-8")).toBe("ciao wörld\n");
  });
});

// ── Error cases ────────────────────────────────────────────────────────────────

describe("editTool — errors", () => {
  test("returns error when old_string not found", async () => {
    const p = tmpFile("hello world\n");
    const result = await edit({ file_path: p, old_string: "nonexistent", new_string: "x" });
    expect(result).toContain("Erro:");
    expect(result).toContain("old_string não encontrado");
  });

  test("file is unchanged when old_string not found", async () => {
    const original = "unchanged content\n";
    const p = tmpFile(original);
    await edit({ file_path: p, old_string: "missing", new_string: "replacement" });
    expect(fs.readFileSync(p, "utf-8")).toBe(original);
  });

  test("returns error when old_string appears multiple times (no replace_all)", async () => {
    const p = tmpFile("abc abc abc\n");
    const result = await edit({ file_path: p, old_string: "abc", new_string: "xyz" });
    expect(result).toContain("Erro:");
    expect(result).toContain("3");
    expect(result).toContain("replace_all");
  });

  test("file is unchanged when ambiguous (no replace_all)", async () => {
    const original = "dup dup dup\n";
    const p = tmpFile(original);
    await edit({ file_path: p, old_string: "dup", new_string: "unique" });
    expect(fs.readFileSync(p, "utf-8")).toBe(original);
  });

  test("returns error when file does not exist", async () => {
    const result = await edit({
      file_path: path.join(tmpDir, "ghost.txt"),
      old_string: "foo",
      new_string: "bar",
    });
    expect(result).toContain("Erro");
  });
});

// ── replace_all ────────────────────────────────────────────────────────────────

describe("editTool — replace_all", () => {
  test("replaces all occurrences when replace_all is true", async () => {
    const p = tmpFile("cat dog cat bird cat\n");
    await edit({ file_path: p, old_string: "cat", new_string: "lion", replace_all: true });
    expect(fs.readFileSync(p, "utf-8")).toBe("lion dog lion bird lion\n");
  });

  test("replaces single occurrence when replace_all is true", async () => {
    const p = tmpFile("only once\n");
    await edit({ file_path: p, old_string: "once", new_string: "once!", replace_all: true });
    expect(fs.readFileSync(p, "utf-8")).toBe("only once!\n");
  });

  test("replace_all with count > 1 succeeds", async () => {
    const p = tmpFile("x x x\n");
    const result = await edit({ file_path: p, old_string: "x", new_string: "y", replace_all: true });
    expect(result).not.toContain("Erro");
    expect(fs.readFileSync(p, "utf-8")).toBe("y y y\n");
  });

  test("replace_all: false treats as default (single unique required)", async () => {
    const p = tmpFile("a a a\n");
    const result = await edit({ file_path: p, old_string: "a", new_string: "b", replace_all: false });
    // Should error because 3 occurrences
    expect(result).toContain("Erro");
  });
});

// ── Diff output ────────────────────────────────────────────────────────────────

describe("editTool — diff output", () => {
  test("diff is limited to 20 lines when content is large", async () => {
    const longOld = Array.from({ length: 15 }, (_, i) => `old-line-${i}`).join("\n");
    const longNew = Array.from({ length: 15 }, (_, i) => `new-line-${i}`).join("\n");
    const p = tmpFile(longOld + "\n");
    const result = await edit({ file_path: p, old_string: longOld, new_string: longNew });
    // Combined diff is 30 lines, truncated to 20
    expect(result).toContain("linhas a mais");
  });

  test("diff is not truncated when under 20 lines", async () => {
    const p = tmpFile("short old\n");
    const result = await edit({ file_path: p, old_string: "short old", new_string: "short new" });
    expect(result).not.toContain("linhas a mais");
  });
});

// ── Error handling ─────────────────────────────────────────────────────────────

describe("editTool — write error handling", () => {
  test("returns error message when writeFileSync fails (read-only file)", async () => {
    const readonlyFile = tmpFile("readonly content to edit\n");
    fs.chmodSync(readonlyFile, 0o444); // make read-only

    try {
      const result = await edit({
        file_path: readonlyFile,
        old_string: "readonly content to edit",
        new_string: "new content",
      });
      expect(result).toContain("Erro ao escrever arquivo:");
    } finally {
      fs.chmodSync(readonlyFile, 0o644); // restore permissions
    }
  });
});
