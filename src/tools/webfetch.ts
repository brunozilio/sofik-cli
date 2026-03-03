import type { ToolDefinition } from "../lib/types.ts";
import { fetchWithProxy } from "../lib/fetchWithProxy.ts";

const MAX_CHARS = 20_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Convert structural elements to Markdown
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n")
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "#### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "```\n$1\n```\n")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n")
    .replace(/<code[^>]*>([^<]+)<\/code>/gi, "`$1`")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "_$2_")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool: ToolDefinition = {
  name: "WebFetch",
  description:
    "Fetch content from a URL and return the page text. Useful for reading documentation, APIs, or any public web page. HTML is stripped to plain text.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
      prompt: {
        type: "string",
        description:
          "Optional: what information to extract from the page (used as a hint in the result header)",
      },
    },
    required: ["url"],
  },
  async execute(input) {
    const url = input["url"] as string;
    const prompt = input["prompt"] as string | undefined;

    let response: Response;
    try {
      response = await fetchWithProxy(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; SofikAI/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!response.ok) {
      return `Erro: HTTP ${response.status} ${response.statusText} para ${url}`;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();

    let content: string;
    if (contentType.includes("text/html")) {
      content = stripHtml(text);
    } else {
      content = text;
    }

    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS) + "\n\n[content truncated]";
    }

    const header = prompt ? `[Fetched: ${url} — looking for: ${prompt}]\n\n` : `[Fetched: ${url}]\n\n`;
    return header + content;
  },
};
