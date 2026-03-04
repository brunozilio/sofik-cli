import { test, expect, describe, beforeEach, afterEach } from "bun:test";

import { webFetchTool } from "./webfetch.ts";

// ── Fetch mock infrastructure ────────────────────────────────────────────────
// webfetch.ts uses fetchWithProxy → which calls globalThis.fetch internally.
// We intercept at the global fetch level.

const originalFetch = globalThis.fetch;

function mockFetch(responseBody: string, status = 200, contentType = "text/plain") {
  globalThis.fetch = async (_url: unknown, _init: unknown): Promise<Response> => {
    return new Response(responseBody, {
      status,
      headers: { "Content-Type": contentType },
    });
  };
}

beforeEach(() => {
  mockFetch("default content");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function fetchUrl(input: Record<string, unknown>): Promise<string> {
  return webFetchTool.execute!(input) as Promise<string>;
}

// ── metadata ─────────────────────────────────────────────────────────────────

describe("webFetchTool metadata", () => {
  test("name is 'WebFetch'", () => {
    expect(webFetchTool.name).toBe("WebFetch");
  });

  test("has a description", () => {
    expect(typeof webFetchTool.description).toBe("string");
    expect(webFetchTool.description.length).toBeGreaterThan(0);
  });

  test("has execute function", () => {
    expect(typeof webFetchTool.execute).toBe("function");
  });

  test("requires url", () => {
    expect(webFetchTool.input_schema.required).toContain("url");
  });

  test("has prompt as optional property", () => {
    expect(webFetchTool.input_schema.properties).toHaveProperty("prompt");
  });
});

// ── execute: plain text response ─────────────────────────────────────────────

describe("webFetchTool — plain text response", () => {
  test("returns string result", async () => {
    mockFetch("hello world", 200, "text/plain");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(typeof result).toBe("string");
  });

  test("includes fetched URL in header", async () => {
    mockFetch("content", 200, "text/plain");
    const result = await fetchUrl({ url: "https://example.com/page" });
    expect(result).toContain("https://example.com/page");
  });

  test("includes content in result", async () => {
    mockFetch("the actual content", 200, "text/plain");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("the actual content");
  });

  test("header shows [Fetched: URL] format when no prompt", async () => {
    mockFetch("text", 200, "text/plain");
    const result = await fetchUrl({ url: "https://test.com" });
    expect(result).toMatch(/\[Fetched: https:\/\/test\.com\]/);
  });

  test("header shows prompt when provided", async () => {
    mockFetch("result", 200, "text/plain");
    const result = await fetchUrl({ url: "https://test.com", prompt: "find the title" });
    expect(result).toContain("find the title");
  });
});

// ── execute: HTML response ────────────────────────────────────────────────────

describe("webFetchTool — HTML response", () => {
  test("strips HTML tags from response", async () => {
    mockFetch("<html><body><p>Hello world</p></body></html>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).not.toContain("<html>");
    expect(result).not.toContain("<body>");
    expect(result).toContain("Hello world");
  });

  test("converts h1 to markdown heading", async () => {
    mockFetch("<h1>My Title</h1>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("# My Title");
  });

  test("converts h2 to markdown heading", async () => {
    mockFetch("<h2>Section</h2>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("## Section");
  });

  test("converts h3 to markdown heading", async () => {
    mockFetch("<h3>Subsection</h3>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("### Subsection");
  });

  test("converts h4-h6 to #### heading", async () => {
    mockFetch("<h4>Deep</h4>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("#### Deep");
  });

  test("converts li to markdown list item", async () => {
    mockFetch("<ul><li>Item one</li><li>Item two</li></ul>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("- Item one");
    expect(result).toContain("- Item two");
  });

  test("converts code blocks to markdown fences", async () => {
    mockFetch('<pre><code>const x = 1;</code></pre>', 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("```");
    expect(result).toContain("const x = 1;");
  });

  test("converts anchor tags to markdown links", async () => {
    mockFetch('<a href="https://link.com">Click here</a>', 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("Click here");
    expect(result).toContain("https://link.com");
  });

  test("converts strong/b to bold markdown", async () => {
    mockFetch("<strong>Bold text</strong>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("**Bold text**");
  });

  test("converts em/i to italic markdown", async () => {
    mockFetch("<em>Italic text</em>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("_Italic text_");
  });

  test("replaces HTML entities", async () => {
    mockFetch("<p>a &amp; b &lt; c &gt; d &quot;e&quot;</p>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("a & b < c > d");
  });

  test("replaces &nbsp;", async () => {
    mockFetch("<p>hello&nbsp;world</p>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("hello world");
  });

  test("strips scripts and styles", async () => {
    mockFetch(
      "<script>alert('xss')</script><style>.x{color:red}</style><p>clean</p>",
      200,
      "text/html"
    );
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).not.toContain("alert");
    expect(result).not.toContain("color:red");
    expect(result).toContain("clean");
  });

  test("converts inline code to backtick markdown", async () => {
    mockFetch("<code>myVar</code>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("`myVar`");
  });
});

// ── execute: truncation ───────────────────────────────────────────────────────

describe("webFetchTool — content truncation", () => {
  test("truncates content longer than 20000 chars", async () => {
    const longContent = "x".repeat(25_000);
    mockFetch(longContent, 200, "text/plain");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("[content truncated]");
    // The result should be <= 20000 chars + header
    const contentPart = result.replace(/\[Fetched:.*?\]\n\n/, "");
    expect(contentPart.length).toBeLessThanOrEqual(20_100);
  });

  test("does not add truncation notice for content under 20000 chars", async () => {
    mockFetch("x".repeat(100), 200, "text/plain");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).not.toContain("[content truncated]");
  });
});

// ── execute: HTTP errors ──────────────────────────────────────────────────────

describe("webFetchTool — HTTP error responses", () => {
  test("returns error message for 404", async () => {
    mockFetch("Not Found", 404, "text/plain");
    const result = await fetchUrl({ url: "https://example.com/missing" });
    expect(result).toContain("404");
  });

  test("returns error message for 500", async () => {
    mockFetch("Server Error", 500, "text/plain");
    const result = await fetchUrl({ url: "https://example.com/error" });
    expect(result).toContain("500");
  });

  test("error response contains the URL", async () => {
    mockFetch("Forbidden", 403, "text/plain");
    const result = await fetchUrl({ url: "https://example.com/secret" });
    expect(result).toContain("https://example.com/secret");
  });
});

// ── execute: network errors ───────────────────────────────────────────────────

describe("webFetchTool — network errors", () => {
  test("returns error message when fetch throws", async () => {
    globalThis.fetch = async () => {
      throw new Error("Network connection refused");
    };
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("Error");
    expect(result).toContain("Network connection refused");
  });

  test("returns error message for TypeError (network)", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const result = await fetchUrl({ url: "https://bad.url" });
    expect(result).toContain("Error");
  });

  test("error result includes the URL", async () => {
    globalThis.fetch = async () => {
      throw new Error("timeout");
    };
    const result = await fetchUrl({ url: "https://slow.example.com" });
    expect(result).toContain("https://slow.example.com");
  });

  test("error result is a string (not a thrown exception)", async () => {
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const result = await fetchUrl({ url: "https://offline.test" });
    expect(typeof result).toBe("string");
  });
});

// ── execute: pre tag without code ────────────────────────────────────────────

describe("webFetchTool — pre without code tag", () => {
  test("converts standalone pre to code fence", async () => {
    mockFetch("<pre>plain preformatted text</pre>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("```");
    expect(result).toContain("plain preformatted text");
  });
});

// ── execute: HTML entities ────────────────────────────────────────────────────

describe("webFetchTool — extended HTML entities", () => {
  test("replaces &hellip; with ellipsis", async () => {
    mockFetch("<p>Wait&hellip;</p>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("…");
  });

  test("replaces &mdash; with em dash", async () => {
    mockFetch("<p>A&mdash;B</p>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("—");
  });

  test("replaces &ndash; with en dash", async () => {
    mockFetch("<p>A&ndash;B</p>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("–");
  });

  test("replaces &#39; with apostrophe", async () => {
    mockFetch("<p>it&#39;s</p>", 200, "text/html");
    const result = await fetchUrl({ url: "https://example.com" });
    expect(result).toContain("it's");
  });
});
