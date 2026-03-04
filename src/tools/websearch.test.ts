import { test, expect, describe, beforeEach, afterEach } from "bun:test";

import { webSearchTool } from "./websearch.ts";

// ── Fetch mock infrastructure ─────────────────────────────────────────────────
// websearch.ts uses fetchWithProxy → globalThis.fetch internally.

const originalFetch = globalThis.fetch;

function mockFetchJson(data: object, status = 200) {
  globalThis.fetch = async (_url: unknown, _init: unknown): Promise<Response> => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

beforeEach(() => {
  mockFetchJson({});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function search(input: Record<string, unknown>): Promise<string> {
  return webSearchTool.execute!(input) as Promise<string>;
}

// ── metadata ──────────────────────────────────────────────────────────────────

describe("webSearchTool metadata", () => {
  test("name is 'WebSearch'", () => {
    expect(webSearchTool.name).toBe("WebSearch");
  });

  test("has a description", () => {
    expect(typeof webSearchTool.description).toBe("string");
    expect(webSearchTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof webSearchTool.execute).toBe("function");
  });

  test("requires query", () => {
    expect(webSearchTool.input_schema.required).toContain("query");
  });

  test("has allowed_domains property", () => {
    expect(webSearchTool.input_schema.properties).toHaveProperty("allowed_domains");
  });

  test("has blocked_domains property", () => {
    expect(webSearchTool.input_schema.properties).toHaveProperty("blocked_domains");
  });
});

// ── no results ────────────────────────────────────────────────────────────────

describe("webSearchTool — no results", () => {
  test("returns no-results message when DDG returns empty data", async () => {
    mockFetchJson({});
    const result = await search({ query: "xyzzy nonexistent" });
    expect(result).toContain("No results found");
  });

  test("no-results message includes the query", async () => {
    mockFetchJson({});
    const result = await search({ query: "my specific query" });
    expect(result).toContain("my specific query");
  });
});

// ── AbstractText result ───────────────────────────────────────────────────────

describe("webSearchTool — AbstractText result", () => {
  test("includes abstract text in results", async () => {
    mockFetchJson({
      AbstractText: "Bun is a fast JavaScript runtime.",
      AbstractURL: "https://bun.sh",
      AbstractTitle: "Bun",
    });
    const result = await search({ query: "bun runtime" });
    expect(result).toContain("Bun is a fast JavaScript runtime.");
  });

  test("includes abstract URL in results", async () => {
    mockFetchJson({
      AbstractText: "Some text",
      AbstractURL: "https://example.com/abstract",
      AbstractTitle: "Example",
    });
    const result = await search({ query: "test" });
    expect(result).toContain("https://example.com/abstract");
  });

  test("uses AbstractTitle in result", async () => {
    mockFetchJson({
      AbstractText: "Content here",
      AbstractURL: "https://example.com",
      AbstractTitle: "My Title",
    });
    const result = await search({ query: "test" });
    expect(result).toContain("My Title");
  });

  test("uses 'Abstract' as title when AbstractTitle is missing", async () => {
    mockFetchJson({
      AbstractText: "Content",
      AbstractURL: "https://example.com",
    });
    const result = await search({ query: "test" });
    expect(result).toContain("Abstract");
  });

  test("includes query in result header", async () => {
    mockFetchJson({
      AbstractText: "Result",
      AbstractURL: "https://example.com",
      AbstractTitle: "Title",
    });
    const result = await search({ query: "my search term" });
    expect(result).toContain("my search term");
  });

  test("mentions DuckDuckGo as provider", async () => {
    mockFetchJson({
      AbstractText: "Result",
      AbstractURL: "https://example.com",
      AbstractTitle: "Title",
    });
    const result = await search({ query: "test" });
    expect(result).toContain("DuckDuckGo");
  });

  test("does not include AbstractText when AbstractURL is missing", async () => {
    mockFetchJson({
      AbstractText: "Abstract without URL",
      AbstractTitle: "No URL",
    });
    const result = await search({ query: "test" });
    // Without AbstractURL, the result should not include the abstract
    expect(result).toContain("No results found");
  });
});

// ── RelatedTopics results ─────────────────────────────────────────────────────

describe("webSearchTool — RelatedTopics results", () => {
  test("includes related topic text in results", async () => {
    mockFetchJson({
      RelatedTopics: [
        { Text: "TypeScript is a typed superset of JavaScript.", FirstURL: "https://ts.dev" },
        { Text: "Node.js is a JavaScript runtime.", FirstURL: "https://nodejs.org" },
      ],
    });
    const result = await search({ query: "javascript" });
    expect(result).toContain("TypeScript is a typed superset");
    expect(result).toContain("https://ts.dev");
  });

  test("skips related topics with missing FirstURL", async () => {
    mockFetchJson({
      RelatedTopics: [
        { Text: "Valid topic", FirstURL: "https://valid.com" },
        { Text: "No URL topic" },
      ],
    });
    const result = await search({ query: "test" });
    expect(result).toContain("Valid topic");
    expect(result).not.toContain("No URL topic");
  });

  test("skips related topics with missing Text", async () => {
    mockFetchJson({
      RelatedTopics: [
        { FirstURL: "https://notext.com" },
        { Text: "Has text", FirstURL: "https://hastext.com" },
      ],
    });
    const result = await search({ query: "test" });
    expect(result).toContain("Has text");
  });

  test("limits results to 10", async () => {
    const topics = Array.from({ length: 15 }, (_, i) => ({
      Text: `Topic result number ${i} with some content here`,
      FirstURL: `https://example.com/${i}`,
    }));
    mockFetchJson({ RelatedTopics: topics });
    const result = await search({ query: "test" });
    // Each result starts with a numbered list entry
    const matchCount = (result.match(/^\d+\./gm) ?? []).length;
    expect(matchCount).toBeLessThanOrEqual(10);
  });

  test("result body is truncated at 200 chars per entry", async () => {
    const longText = "x".repeat(300);
    mockFetchJson({
      RelatedTopics: [{ Text: longText, FirstURL: "https://example.com" }],
    });
    const result = await search({ query: "test" });
    // Each entry's body is sliced at 200
    expect(result).toContain("x".repeat(200));
    expect(result).not.toContain("x".repeat(201));
  });

  test("handles empty RelatedTopics array", async () => {
    mockFetchJson({ RelatedTopics: [] });
    const result = await search({ query: "empty" });
    expect(result).toContain("No results found");
  });
});

// ── allowed_domains filter ────────────────────────────────────────────────────

describe("webSearchTool — allowed_domains filter", () => {
  test("filters to only allowed domains", async () => {
    mockFetchJson({
      RelatedTopics: [
        { Text: "Allowed result", FirstURL: "https://allowed.com/page" },
        { Text: "Blocked result", FirstURL: "https://blocked.com/page" },
      ],
    });
    const result = await search({ query: "test", allowed_domains: ["allowed.com"] });
    expect(result).toContain("Allowed result");
    expect(result).not.toContain("Blocked result");
  });

  test("returns no results if no domains match filter", async () => {
    mockFetchJson({
      RelatedTopics: [
        { Text: "Some result", FirstURL: "https://example.com" },
      ],
    });
    const result = await search({ query: "test", allowed_domains: ["notfound.xyz"] });
    expect(result).toContain("No results found");
  });

  test("allows multiple domains in filter", async () => {
    mockFetchJson({
      RelatedTopics: [
        { Text: "Alpha", FirstURL: "https://alpha.com" },
        { Text: "Beta", FirstURL: "https://beta.com" },
        { Text: "Gamma", FirstURL: "https://gamma.com" },
      ],
    });
    const result = await search({ query: "test", allowed_domains: ["alpha.com", "beta.com"] });
    expect(result).toContain("Alpha");
    expect(result).toContain("Beta");
    expect(result).not.toContain("Gamma");
  });
});

// ── blocked_domains filter ────────────────────────────────────────────────────

describe("webSearchTool — blocked_domains filter", () => {
  test("excludes blocked domains", async () => {
    mockFetchJson({
      RelatedTopics: [
        { Text: "Good result", FirstURL: "https://good.com" },
        { Text: "Bad result", FirstURL: "https://bad.com/page" },
      ],
    });
    const result = await search({ query: "test", blocked_domains: ["bad.com"] });
    expect(result).toContain("Good result");
    expect(result).not.toContain("Bad result");
  });

  test("blocks multiple domains", async () => {
    mockFetchJson({
      RelatedTopics: [
        { Text: "Keep", FirstURL: "https://keep.com" },
        { Text: "Block1", FirstURL: "https://block1.com" },
        { Text: "Block2", FirstURL: "https://block2.com" },
      ],
    });
    const result = await search({ query: "test", blocked_domains: ["block1.com", "block2.com"] });
    expect(result).toContain("Keep");
    expect(result).not.toContain("Block1");
    expect(result).not.toContain("Block2");
  });
});

// ── HTTP error ────────────────────────────────────────────────────────────────

describe("webSearchTool — HTTP error", () => {
  test("returns error message on 500 status", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      return new Response("error", { status: 500 });
    };
    const result = await search({ query: "test" });
    expect(result).toContain("Error");
  });

  test("returns error message on 404 status", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      return new Response("not found", { status: 404 });
    };
    const result = await search({ query: "test" });
    expect(typeof result).toBe("string");
    expect(result).toContain("Error");
  });

  test("error result is a string (not a thrown exception)", async () => {
    globalThis.fetch = async (): Promise<Response> => {
      return new Response("bad", { status: 503 });
    };
    const result = await search({ query: "test" });
    expect(typeof result).toBe("string");
  });
});

// ── network errors ────────────────────────────────────────────────────────────

describe("webSearchTool — network errors", () => {
  test("returns error string on thrown exception", async () => {
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const result = await search({ query: "test" });
    expect(typeof result).toBe("string");
    expect(result).toContain("Error");
  });

  test("error message contains the exception message", async () => {
    globalThis.fetch = async () => {
      throw new Error("connection refused");
    };
    const result = await search({ query: "test" });
    expect(result).toContain("connection refused");
  });

  test("TypeError is also handled", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const result = await search({ query: "test" });
    expect(typeof result).toBe("string");
    expect(result).toContain("Error");
  });
});
