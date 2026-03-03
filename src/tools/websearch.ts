import type { ToolDefinition } from "../lib/types.ts";
import { fetchWithProxy } from "../lib/fetchWithProxy.ts";

const MAX_RESULTS = 10;

interface SearchResult {
  title: string;
  url: string;
  body: string;
}

async function searchDuckDuckGo(
  query: string,
  allowedDomains?: string[],
  blockedDomains?: string[]
): Promise<SearchResult[]> {
  // DuckDuckGo instant answer API (no key required)
  const params = new URLSearchParams({ q: query, format: "json", no_html: "1", t: "SofikAI" });
  const res = await fetchWithProxy(`https://api.duckduckgo.com/?${params}`, {
    headers: { "User-Agent": "SofikAI/1.0" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`DDG API error: ${res.status}`);

  const data = (await res.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    AbstractTitle?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Result?: string }>;
  };

  const results: SearchResult[] = [];

  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.AbstractTitle ?? "Abstract",
      url: data.AbstractURL,
      body: data.AbstractText,
    });
  }

  for (const topic of data.RelatedTopics ?? []) {
    if (!topic.FirstURL || !topic.Text) continue;
    results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, body: topic.Text });
  }

  let filtered = results;

  if (allowedDomains?.length) {
    filtered = filtered.filter((r) =>
      allowedDomains.some((d) => r.url.includes(d))
    );
  }
  if (blockedDomains?.length) {
    filtered = filtered.filter(
      (r) => !blockedDomains.some((d) => r.url.includes(d))
    );
  }

  return filtered.slice(0, MAX_RESULTS);
}

export const webSearchTool: ToolDefinition = {
  name: "WebSearch",
  description:
    "Search the web and return relevant results with titles, URLs, and snippets. " +
    "Uses DuckDuckGo as the search provider. " +
    "Use for finding up-to-date information, documentation, or anything beyond your knowledge cutoff.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      allowed_domains: {
        type: "array",
        items: { type: "string" },
        description: "Only include results from these domains (optional)",
      },
      blocked_domains: {
        type: "array",
        items: { type: "string" },
        description: "Exclude results from these domains (optional)",
      },
    },
    required: ["query"],
  },
  async execute(input) {
    const query = input["query"] as string;
    const allowedDomains = input["allowed_domains"] as string[] | undefined;
    const blockedDomains = input["blocked_domains"] as string[] | undefined;

    let results: SearchResult[];
    let provider = "DuckDuckGo";
    try {
        results = await searchDuckDuckGo(query, allowedDomains, blockedDomains);
    } catch (err) {
      return `Error searching: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (results.length === 0) {
      return `No results found for: "${query}"`;
    }

    return (
      `Search results for: "${query}" (via ${provider})\n\n` +
      results
        .map((r, i) => `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.body.slice(0, 200)}`)
        .join("\n\n")
    );
  },
};
