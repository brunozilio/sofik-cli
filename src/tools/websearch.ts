import type { ToolDefinition } from "../lib/types.ts";

const MAX_RESULTS = 10;

interface SearchResult {
  title: string;
  url: string;
  body: string;
}

async function searchBrave(
  query: string,
  apiKey: string,
  allowedDomains?: string[],
  blockedDomains?: string[]
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: "10" });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Brave API error: ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title: string; url: string; description?: string }> };
  };
  let results = (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    body: r.description ?? "",
  }));
  if (allowedDomains?.length) results = results.filter((r) => allowedDomains.some((d) => r.url.includes(d)));
  if (blockedDomains?.length) results = results.filter((r) => !blockedDomains.some((d) => r.url.includes(d)));
  return results.slice(0, MAX_RESULTS);
}

async function searchSerpApi(
  query: string,
  apiKey: string,
  allowedDomains?: string[],
  blockedDomains?: string[]
): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, api_key: apiKey, engine: "google", num: "10" });
  const res = await fetch(`https://serpapi.com/search?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`SerpAPI error: ${res.status}`);
  const data = (await res.json()) as {
    organic_results?: Array<{ title: string; link: string; snippet?: string }>;
  };
  let results = (data.organic_results ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    body: r.snippet ?? "",
  }));
  if (allowedDomains?.length) results = results.filter((r) => allowedDomains.some((d) => r.url.includes(d)));
  if (blockedDomains?.length) results = results.filter((r) => !blockedDomains.some((d) => r.url.includes(d)));
  return results.slice(0, MAX_RESULTS);
}

async function searchDuckDuckGo(
  query: string,
  allowedDomains?: string[],
  blockedDomains?: string[]
): Promise<SearchResult[]> {
  // DuckDuckGo instant answer API (no key required)
  const params = new URLSearchParams({ q: query, format: "json", no_html: "1", t: "SofikAI" });
  const res = await fetch(`https://api.duckduckgo.com/?${params}`, {
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
    "Uses Brave Search API if BRAVE_API_KEY is set, Google via SerpAPI if SERPAPI_KEY is set, " +
    "or DuckDuckGo as a fallback (no key required). " +
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

    const braveKey = process.env.BRAVE_API_KEY;
    const serpKey = process.env.SERPAPI_KEY;

    let results: SearchResult[];
    let provider = "DuckDuckGo";
    try {
      if (braveKey) {
        provider = "Brave";
        results = await searchBrave(query, braveKey, allowedDomains, blockedDomains);
      } else if (serpKey) {
        provider = "Google (SerpAPI)";
        results = await searchSerpApi(query, serpKey, allowedDomains, blockedDomains);
      } else {
        results = await searchDuckDuckGo(query, allowedDomains, blockedDomains);
      }
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
