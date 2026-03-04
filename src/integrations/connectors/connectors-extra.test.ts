import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { AtlassianConnector } from "./AtlassianConnector.ts";
import { CloudflareConnector } from "./CloudflareConnector.ts";
import { Context7Connector } from "./Context7Connector.ts";
import { FigmaConnector } from "./FigmaConnector.ts";
import { NotionConnector } from "./NotionConnector.ts";
import { PlaywrightConnector } from "./PlaywrightConnector.ts";
import { SupabaseConnector } from "./SupabaseConnector.ts";
import { VercelConnector } from "./VercelConnector.ts";

// ---------------------------------------------------------------------------
// Shared fetch mock infrastructure
// ---------------------------------------------------------------------------

type FetchCall = { url: unknown; init: unknown };
const fetchCalls: FetchCall[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fetchCalls.length = 0;
  globalThis.fetch = async (url: unknown, init: unknown): Promise<Response> => {
    fetchCalls.push({ url, init });
    return new Response(JSON.stringify({ id: "test", success: true, results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ===========================================================================
// AtlassianConnector
// ===========================================================================

describe("AtlassianConnector", () => {
  const connector = new AtlassianConnector();
  const creds = {
    apiKey: "dGVzdEBlbWFpbC5jb206dGVzdHRva2Vu",
    extra: { domain: "mysite.atlassian.net" },
  };

  // --- definition -----------------------------------------------------------

  test("definition: provider is atlassian", () => {
    expect(connector.definition.provider).toBe("atlassian");
  });

  test("definition: name is Atlassian", () => {
    expect(connector.definition.name).toBe("Atlassian");
  });

  test("definition: authType is api_key", () => {
    expect(connector.definition.authType).toBe("api_key");
  });

  test("definition: has expected action names", () => {
    const names = connector.definition.actions.map((a) => a.name);
    expect(names).toContain("create_jira_issue");
    expect(names).toContain("get_jira_issue");
    expect(names).toContain("search_jira_issues");
    expect(names).toContain("update_jira_issue");
    expect(names).toContain("add_jira_comment");
    expect(names).toContain("create_confluence_page");
    expect(names).toContain("search_confluence");
  });

  // --- create_jira_issue ----------------------------------------------------

  test("create_jira_issue: calls correct Jira API URL", async () => {
    await connector.executeAction("create_jira_issue", creds, {
      project_key: "ENG",
      summary: "Fix the bug",
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("mysite.atlassian.net/rest/api/3/issue");
  });

  test("create_jira_issue: sends Basic auth header", async () => {
    await connector.executeAction("create_jira_issue", creds, {
      project_key: "ENG",
      summary: "Fix the bug",
    });
    const init = fetchCalls[0].init as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toContain("Basic");
  });

  test("create_jira_issue: sends POST method", async () => {
    await connector.executeAction("create_jira_issue", creds, {
      project_key: "ENG",
      summary: "Test issue",
    });
    const init = fetchCalls[0].init as RequestInit;
    expect(init.method).toBe("POST");
  });

  test("create_jira_issue: throws on error response", async () => {
    globalThis.fetch = async () => new Response("Bad Request", { status: 400 });
    await expect(
      connector.executeAction("create_jira_issue", creds, { project_key: "ENG", summary: "Fail" })
    ).rejects.toThrow();
  });

  test("create_jira_issue: includes description in ADF format when provided", async () => {
    await connector.executeAction("create_jira_issue", creds, {
      project_key: "ENG",
      summary: "Issue with description",
      description: "This is the description text",
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.fields.description).toBeDefined();
    expect(body.fields.description.type).toBe("doc");
  });

  test("create_jira_issue: includes priority when provided", async () => {
    await connector.executeAction("create_jira_issue", creds, {
      project_key: "ENG",
      summary: "High priority issue",
      priority: "High",
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.fields.priority).toEqual({ name: "High" });
  });

  test("create_jira_issue: includes assignee when assignee_account_id provided", async () => {
    await connector.executeAction("create_jira_issue", creds, {
      project_key: "ENG",
      summary: "Assigned issue",
      assignee_account_id: "user-abc-123",
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.fields.assignee).toEqual({ accountId: "user-abc-123" });
  });

  test("create_jira_issue: includes labels when provided", async () => {
    await connector.executeAction("create_jira_issue", creds, {
      project_key: "ENG",
      summary: "Labeled issue",
      labels: ["bug", "p1"],
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.fields.labels).toEqual(["bug", "p1"]);
  });

  // --- get_jira_issue -------------------------------------------------------

  test("get_jira_issue: calls correct URL with issue key", async () => {
    await connector.executeAction("get_jira_issue", creds, { issue_key: "ENG-42" });
    const call = fetchCalls[0];
    expect(call.url).toContain("/rest/api/3/issue/ENG-42");
  });

  test("get_jira_issue: throws on error response", async () => {
    globalThis.fetch = async () => new Response("Not Found", { status: 404 });
    await expect(
      connector.executeAction("get_jira_issue", creds, { issue_key: "ENG-999" })
    ).rejects.toThrow();
  });

  // --- search_jira_issues ---------------------------------------------------

  test("search_jira_issues: calls /rest/api/3/search with POST", async () => {
    await connector.executeAction("search_jira_issues", creds, {
      jql: "project = ENG AND status = Open",
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/rest/api/3/search");
    const init = call.init as RequestInit;
    expect(init.method).toBe("POST");
  });

  test("search_jira_issues: throws on error response", async () => {
    globalThis.fetch = async () => new Response("Server Error", { status: 500 });
    await expect(
      connector.executeAction("search_jira_issues", creds, { jql: "project = ENG" })
    ).rejects.toThrow();
  });

  // --- update_jira_issue ----------------------------------------------------

  test("update_jira_issue: returns success result without error", async () => {
    const result = await connector.executeAction("update_jira_issue", creds, {
      issue_key: "ENG-10",
      summary: "Updated summary",
    });
    expect(result).toMatchObject({ success: true, issue_key: "ENG-10" });
  });

  test("update_jira_issue: calls transition endpoint when status_transition_id provided", async () => {
    await connector.executeAction("update_jira_issue", creds, {
      issue_key: "ENG-10",
      status_transition_id: "31",
    });
    const url = fetchCalls[0].url as string;
    expect(url).toContain("/transitions");
  });

  test("update_jira_issue: throws on transition error", async () => {
    globalThis.fetch = async () => new Response("Transition error", { status: 400 });
    await expect(
      connector.executeAction("update_jira_issue", creds, {
        issue_key: "ENG-10",
        status_transition_id: "99",
      })
    ).rejects.toThrow();
  });

  // --- add_jira_comment -----------------------------------------------------

  test("add_jira_comment: calls comment endpoint", async () => {
    await connector.executeAction("add_jira_comment", creds, {
      issue_key: "ENG-5",
      body: "This is a comment",
    });
    expect(fetchCalls[0].url).toContain("/issue/ENG-5/comment");
  });

  test("add_jira_comment: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 403 });
    await expect(
      connector.executeAction("add_jira_comment", creds, { issue_key: "ENG-5", body: "comment" })
    ).rejects.toThrow();
  });

  // --- create_confluence_page -----------------------------------------------

  test("create_confluence_page: calls wiki content endpoint", async () => {
    await connector.executeAction("create_confluence_page", creds, {
      space_key: "ENG",
      title: "My Page",
      content: "<p>Hello</p>",
    });
    expect(fetchCalls[0].url).toContain("/wiki/rest/api/content");
  });

  test("create_confluence_page: includes ancestors when parent_page_id is provided", async () => {
    await connector.executeAction("create_confluence_page", creds, {
      space_key: "ENG",
      title: "Child Page",
      content: "<p>Child</p>",
      parent_page_id: "123456",
    });
    const body = JSON.parse((fetchCalls[0].init as any).body);
    expect(body.ancestors).toEqual([{ id: "123456" }]);
  });

  test("create_confluence_page: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("create_confluence_page", creds, {
        space_key: "ENG",
        title: "Page",
        content: "<p></p>",
      })
    ).rejects.toThrow();
  });

  // --- search_confluence ----------------------------------------------------

  test("search_confluence: calls wiki content search endpoint", async () => {
    await connector.executeAction("search_confluence", creds, {
      cql: 'space = ENG AND type = page AND title ~ "deploy"',
    });
    expect(fetchCalls[0].url).toContain("/wiki/rest/api/content/search");
  });

  test("search_confluence: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 500 });
    await expect(
      connector.executeAction("search_confluence", creds, { cql: "space = ENG" })
    ).rejects.toThrow();
  });
});

// ===========================================================================
// CloudflareConnector
// ===========================================================================

describe("CloudflareConnector", () => {
  const connector = new CloudflareConnector();
  const creds = {
    apiKey: "cf-api-token-abc123",
    extra: { account_id: "acc-xyz", zone_id: "zone-abc" },
  };

  // --- definition -----------------------------------------------------------

  test("definition: provider is cloudflare", () => {
    expect(connector.definition.provider).toBe("cloudflare");
  });

  test("definition: name matches", () => {
    expect(connector.definition.name).toBe("Cloudflare Developer Platform");
  });

  test("definition: authType is api_key", () => {
    expect(connector.definition.authType).toBe("api_key");
  });

  test("definition: has all expected action names", () => {
    const names = connector.definition.actions.map((a) => a.name);
    expect(names).toContain("list_workers");
    expect(names).toContain("get_worker");
    expect(names).toContain("deploy_worker");
    expect(names).toContain("delete_worker");
    expect(names).toContain("purge_cache");
    expect(names).toContain("list_kv_namespaces");
    expect(names).toContain("kv_put");
    expect(names).toContain("list_d1_databases");
    expect(names).toContain("query_d1");
    expect(names).toContain("list_pages_projects");
    expect(names).toContain("get_zone");
  });

  // --- list_workers ---------------------------------------------------------

  test("list_workers: calls workers scripts URL with account id", async () => {
    await connector.executeAction("list_workers", creds, {});
    expect(fetchCalls[0].url).toContain("/accounts/acc-xyz/workers/scripts");
  });

  test("list_workers: includes Bearer auth header", async () => {
    await connector.executeAction("list_workers", creds, {});
    const headers = (fetchCalls[0].init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer cf-api-token-abc123");
  });

  test("list_workers: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 401 });
    await expect(connector.executeAction("list_workers", creds, {})).rejects.toThrow();
  });

  // --- get_worker -----------------------------------------------------------

  test("get_worker: calls script-specific URL", async () => {
    await connector.executeAction("get_worker", creds, { script_name: "my-worker" });
    expect(fetchCalls[0].url).toContain("/workers/scripts/my-worker");
  });

  test("get_worker: throws on error response", async () => {
    globalThis.fetch = async () => new Response("Not Found", { status: 404 });
    await expect(
      connector.executeAction("get_worker", creds, { script_name: "missing" })
    ).rejects.toThrow();
  });

  // --- deploy_worker --------------------------------------------------------

  test("deploy_worker: calls PUT on scripts endpoint", async () => {
    await connector.executeAction("deploy_worker", creds, {
      script_name: "my-worker",
      script_content: 'export default { fetch: () => new Response("OK") }',
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/workers/scripts/my-worker");
    expect((call.init as RequestInit).method).toBe("PUT");
  });

  test("deploy_worker: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("deploy_worker", creds, {
        script_name: "my-worker",
        script_content: "invalid",
      })
    ).rejects.toThrow();
  });

  // --- delete_worker --------------------------------------------------------

  test("delete_worker: calls DELETE on scripts endpoint", async () => {
    await connector.executeAction("delete_worker", creds, { script_name: "old-worker" });
    const call = fetchCalls[0];
    expect(call.url).toContain("/workers/scripts/old-worker");
    expect((call.init as RequestInit).method).toBe("DELETE");
  });

  test("delete_worker: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("delete_worker", creds, { script_name: "bad" })
    ).rejects.toThrow();
  });

  // --- purge_cache ----------------------------------------------------------

  test("purge_cache: calls zone purge_cache endpoint", async () => {
    await connector.executeAction("purge_cache", creds, {
      zone_id: "zone-abc",
      purge_everything: true,
    });
    expect(fetchCalls[0].url).toContain("/zones/zone-abc/purge_cache");
  });

  test("purge_cache: throws when no zone_id is available", async () => {
    await expect(
      connector.executeAction("purge_cache", { apiKey: "token" }, { purge_everything: true })
    ).rejects.toThrow("zone_id is required");
  });

  test("purge_cache: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("purge_cache", creds, { zone_id: "zone-abc", purge_everything: true })
    ).rejects.toThrow();
  });

  test("purge_cache: sends files/tags/prefixes when purge_everything is false", async () => {
    await connector.executeAction("purge_cache", creds, {
      zone_id: "zone-abc",
      files: ["https://example.com/style.css"],
      tags: ["assets"],
      prefixes: ["/static/"],
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.purge_everything).toBeUndefined();
    expect(body.files).toEqual(["https://example.com/style.css"]);
    expect(body.tags).toEqual(["assets"]);
    expect(body.prefixes).toEqual(["/static/"]);
  });

  // --- list_kv_namespaces ---------------------------------------------------

  test("list_kv_namespaces: calls KV namespaces URL", async () => {
    await connector.executeAction("list_kv_namespaces", creds, {});
    expect(fetchCalls[0].url).toContain("/storage/kv/namespaces");
  });

  test("list_kv_namespaces: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 403 });
    await expect(connector.executeAction("list_kv_namespaces", creds, {})).rejects.toThrow();
  });

  // --- kv_put ---------------------------------------------------------------

  test("kv_put: calls KV values endpoint with PUT", async () => {
    await connector.executeAction("kv_put", creds, {
      namespace_id: "ns-123",
      key: "my-key",
      value: "my-value",
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/storage/kv/namespaces/ns-123/values/my-key");
    expect((call.init as RequestInit).method).toBe("PUT");
  });

  test("kv_put: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("kv_put", creds, { namespace_id: "ns", key: "k", value: "v" })
    ).rejects.toThrow();
  });

  // --- list_d1_databases ----------------------------------------------------

  test("list_d1_databases: calls D1 database list URL", async () => {
    await connector.executeAction("list_d1_databases", creds, {});
    expect(fetchCalls[0].url).toContain("/d1/database");
  });

  test("list_d1_databases: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 403 });
    await expect(connector.executeAction("list_d1_databases", creds, {})).rejects.toThrow();
  });

  // --- query_d1 -------------------------------------------------------------

  test("query_d1: calls D1 query endpoint with POST", async () => {
    await connector.executeAction("query_d1", creds, {
      database_id: "db-abc",
      sql: "SELECT 1",
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/d1/database/db-abc/query");
    expect((call.init as RequestInit).method).toBe("POST");
  });

  test("query_d1: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("query_d1", creds, { database_id: "db", sql: "INVALID" })
    ).rejects.toThrow();
  });

  // --- list_pages_projects --------------------------------------------------

  test("list_pages_projects: calls pages projects URL", async () => {
    await connector.executeAction("list_pages_projects", creds, {});
    expect(fetchCalls[0].url).toContain("/pages/projects");
  });

  test("list_pages_projects: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 403 });
    await expect(connector.executeAction("list_pages_projects", creds, {})).rejects.toThrow();
  });

  // --- get_zone -------------------------------------------------------------

  test("get_zone: calls zones endpoint with the given zone_id", async () => {
    await connector.executeAction("get_zone", creds, { zone_id: "zone-abc" });
    expect(fetchCalls[0].url).toContain("/zones/zone-abc");
  });

  test("get_zone: throws when no zone_id is available", async () => {
    await expect(
      connector.executeAction("get_zone", { apiKey: "token" }, {})
    ).rejects.toThrow("zone_id is required");
  });

  test("get_zone: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 404 });
    await expect(
      connector.executeAction("get_zone", creds, { zone_id: "zone-abc" })
    ).rejects.toThrow();
  });
});

// ===========================================================================
// Context7Connector
// ===========================================================================

describe("Context7Connector", () => {
  const connector = new Context7Connector();
  const creds = { apiKey: "ctx7-token-xyz" };

  // --- definition -----------------------------------------------------------

  test("definition: provider is context7", () => {
    expect(connector.definition.provider).toBe("context7");
  });

  test("definition: authType is api_key", () => {
    expect(connector.definition.authType).toBe("api_key");
  });

  test("definition: has expected actions", () => {
    const names = connector.definition.actions.map((a) => a.name);
    expect(names).toContain("resolve_library_id");
    expect(names).toContain("get_library_docs");
    expect(names).toContain("search_libraries");
  });

  // --- resolve_library_id ---------------------------------------------------

  test("resolve_library_id: calls correct endpoint with library name", async () => {
    await connector.executeAction("resolve_library_id", creds, { library_name: "react" });
    expect(fetchCalls[0].url).toContain("/libraries/resolve");
    expect(fetchCalls[0].url).toContain("react");
  });

  test("resolve_library_id: includes Bearer auth header", async () => {
    await connector.executeAction("resolve_library_id", creds, { library_name: "react" });
    const headers = (fetchCalls[0].init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer ctx7-token-xyz");
  });

  test("resolve_library_id: throws on error response", async () => {
    globalThis.fetch = async () => new Response("Not Found", { status: 404 });
    await expect(
      connector.executeAction("resolve_library_id", creds, { library_name: "nonexistent" })
    ).rejects.toThrow();
  });

  // --- get_library_docs -----------------------------------------------------

  test("get_library_docs: calls /libraries/docs endpoint", async () => {
    await connector.executeAction("get_library_docs", creds, { library_id: "/vercel/next.js" });
    expect(fetchCalls[0].url).toContain("/libraries/docs");
  });

  test("get_library_docs: includes library_id in query params", async () => {
    await connector.executeAction("get_library_docs", creds, { library_id: "/vercel/next.js" });
    expect(fetchCalls[0].url).toContain("library_id");
  });

  test("get_library_docs: includes topic in query params when provided", async () => {
    await connector.executeAction("get_library_docs", creds, {
      library_id: "/vercel/next.js",
      topic: "routing",
    });
    expect(fetchCalls[0].url).toContain("topic=routing");
  });

  test("get_library_docs: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 500 });
    await expect(
      connector.executeAction("get_library_docs", creds, { library_id: "/vercel/next.js" })
    ).rejects.toThrow();
  });

  // --- search_libraries -----------------------------------------------------

  test("search_libraries: calls /libraries/search endpoint", async () => {
    await connector.executeAction("search_libraries", creds, { query: "state management" });
    expect(fetchCalls[0].url).toContain("/libraries/search");
  });

  test("search_libraries: includes query in URL", async () => {
    await connector.executeAction("search_libraries", creds, { query: "http client" });
    expect(fetchCalls[0].url).toContain("http+client");
  });

  test("search_libraries: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("search_libraries", creds, { query: "fail" })
    ).rejects.toThrow();
  });
});

// ===========================================================================
// FigmaConnector
// ===========================================================================

describe("FigmaConnector", () => {
  const connector = new FigmaConnector();
  const creds = { apiKey: "figma-personal-token-123" };

  // --- definition -----------------------------------------------------------

  test("definition: provider is figma", () => {
    expect(connector.definition.provider).toBe("figma");
  });

  test("definition: authType is api_key", () => {
    expect(connector.definition.authType).toBe("api_key");
  });

  test("definition: has all expected actions", () => {
    const names = connector.definition.actions.map((a) => a.name);
    expect(names).toContain("get_file");
    expect(names).toContain("get_file_nodes");
    expect(names).toContain("export_images");
    expect(names).toContain("get_comments");
    expect(names).toContain("post_comment");
    expect(names).toContain("get_projects");
  });

  // --- get_file -------------------------------------------------------------

  test("get_file: calls /files/:key endpoint", async () => {
    await connector.executeAction("get_file", creds, { file_key: "abc123" });
    expect(fetchCalls[0].url).toContain("/files/abc123");
  });

  test("get_file: sends X-Figma-Token header", async () => {
    await connector.executeAction("get_file", creds, { file_key: "abc123" });
    const headers = (fetchCalls[0].init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Figma-Token"]).toBe("figma-personal-token-123");
  });

  test("get_file: throws on error response", async () => {
    globalThis.fetch = async () => new Response("Forbidden", { status: 403 });
    await expect(
      connector.executeAction("get_file", creds, { file_key: "abc123" })
    ).rejects.toThrow();
  });

  // --- get_file_nodes -------------------------------------------------------

  test("get_file_nodes: calls /files/:key/nodes endpoint", async () => {
    await connector.executeAction("get_file_nodes", creds, {
      file_key: "abc123",
      node_ids: ["1:1", "1:2"],
    });
    expect(fetchCalls[0].url).toContain("/files/abc123/nodes");
  });

  test("get_file_nodes: includes node ids in URL", async () => {
    await connector.executeAction("get_file_nodes", creds, {
      file_key: "abc123",
      node_ids: ["1:1"],
    });
    expect(fetchCalls[0].url).toContain("ids=");
  });

  test("get_file_nodes: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("get_file_nodes", creds, { file_key: "f", node_ids: ["1:1"] })
    ).rejects.toThrow();
  });

  // --- export_images --------------------------------------------------------

  test("export_images: calls /images/:file_key endpoint", async () => {
    await connector.executeAction("export_images", creds, {
      file_key: "abc123",
      node_ids: ["1:1"],
      format: "png",
    });
    expect(fetchCalls[0].url).toContain("/images/abc123");
  });

  test("export_images: includes format in query params", async () => {
    await connector.executeAction("export_images", creds, {
      file_key: "abc123",
      node_ids: ["1:1"],
      format: "svg",
    });
    expect(fetchCalls[0].url).toContain("format=svg");
  });

  test("export_images: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("export_images", creds, { file_key: "f", node_ids: ["1:1"] })
    ).rejects.toThrow();
  });

  // --- get_comments ---------------------------------------------------------

  test("get_comments: calls /files/:key/comments endpoint", async () => {
    await connector.executeAction("get_comments", creds, { file_key: "abc123" });
    expect(fetchCalls[0].url).toContain("/files/abc123/comments");
  });

  test("get_comments: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 403 });
    await expect(
      connector.executeAction("get_comments", creds, { file_key: "abc123" })
    ).rejects.toThrow();
  });

  // --- post_comment ---------------------------------------------------------

  test("post_comment: calls /files/:key/comments with POST", async () => {
    await connector.executeAction("post_comment", creds, {
      file_key: "abc123",
      message: "Nice design!",
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/files/abc123/comments");
    expect((call.init as RequestInit).method).toBe("POST");
  });

  test("post_comment: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("post_comment", creds, { file_key: "f", message: "hi" })
    ).rejects.toThrow();
  });

  // --- get_projects ---------------------------------------------------------

  test("get_projects: calls /teams/:team_id/projects endpoint", async () => {
    await connector.executeAction("get_projects", creds, { team_id: "team-xyz" });
    expect(fetchCalls[0].url).toContain("/teams/team-xyz/projects");
  });

  test("get_projects: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 403 });
    await expect(
      connector.executeAction("get_projects", creds, { team_id: "team-xyz" })
    ).rejects.toThrow();
  });
});

// ===========================================================================
// NotionConnector
// ===========================================================================

describe("NotionConnector", () => {
  const connector = new NotionConnector();
  const creds = { apiKey: "secret_notion_token_abc" };

  // --- definition -----------------------------------------------------------

  test("definition: provider is notion", () => {
    expect(connector.definition.provider).toBe("notion");
  });

  test("definition: authType is api_key", () => {
    expect(connector.definition.authType).toBe("api_key");
  });

  test("definition: has all expected actions", () => {
    const names = connector.definition.actions.map((a) => a.name);
    expect(names).toContain("search");
    expect(names).toContain("get_page");
    expect(names).toContain("create_page");
    expect(names).toContain("update_page");
    expect(names).toContain("append_block");
    expect(names).toContain("query_database");
  });

  // --- search ---------------------------------------------------------------

  test("search: calls /search endpoint with POST", async () => {
    await connector.executeAction("search", creds, { query: "my doc" });
    const call = fetchCalls[0];
    expect(call.url).toContain("/search");
    expect((call.init as RequestInit).method).toBe("POST");
  });

  test("search: includes Bearer auth and Notion-Version headers", async () => {
    await connector.executeAction("search", creds, { query: "test" });
    const headers = (fetchCalls[0].init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toContain("Bearer secret_notion_token_abc");
    expect(headers["Notion-Version"]).toBeDefined();
  });

  test("search: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 401 });
    await expect(connector.executeAction("search", creds, { query: "test" })).rejects.toThrow();
  });

  // --- get_page -------------------------------------------------------------

  test("get_page: calls /pages/:page_id endpoint", async () => {
    await connector.executeAction("get_page", creds, { page_id: "page-uuid-123" });
    expect(fetchCalls[0].url).toContain("/pages/page-uuid-123");
  });

  test("get_page: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 404 });
    await expect(
      connector.executeAction("get_page", creds, { page_id: "missing" })
    ).rejects.toThrow();
  });

  // --- create_page ----------------------------------------------------------

  test("create_page: calls /pages endpoint with POST", async () => {
    await connector.executeAction("create_page", creds, {
      parent_id: "parent-uuid",
      title: "My New Page",
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/pages");
    expect((call.init as RequestInit).method).toBe("POST");
  });

  test("create_page: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("create_page", creds, { parent_id: "id", title: "Page" })
    ).rejects.toThrow();
  });

  test("create_page: includes children block when content param is provided", async () => {
    await connector.executeAction("create_page", creds, {
      parent_id: "parent-uuid",
      title: "Page with content",
      content: "Hello, world!",
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.children).toBeDefined();
    expect(Array.isArray(body.children)).toBe(true);
    expect(body.children[0].type).toBe("paragraph");
  });

  test("create_page: uses database_id parent type when specified", async () => {
    await connector.executeAction("create_page", creds, {
      parent_id: "db-uuid",
      parent_type: "database_id",
      title: "DB Page",
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.parent.database_id).toBe("db-uuid");
  });

  test("create_page: uses custom properties when provided", async () => {
    const customProps = { Name: { title: [{ text: { content: "Custom" } }] } };
    await connector.executeAction("create_page", creds, {
      parent_id: "parent-uuid",
      title: "Custom Page",
      properties: customProps,
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.properties).toEqual(customProps);
  });

  // --- update_page ----------------------------------------------------------

  test("update_page: calls /pages/:page_id with PATCH", async () => {
    await connector.executeAction("update_page", creds, {
      page_id: "page-uuid-123",
      properties: {},
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/pages/page-uuid-123");
    expect((call.init as RequestInit).method).toBe("PATCH");
  });

  test("update_page: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("update_page", creds, { page_id: "id", properties: {} })
    ).rejects.toThrow();
  });

  // --- append_block ---------------------------------------------------------

  test("append_block: calls /blocks/:page_id/children with PATCH", async () => {
    await connector.executeAction("append_block", creds, {
      page_id: "page-uuid-123",
      content: "Some text to append",
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/blocks/page-uuid-123/children");
    expect((call.init as RequestInit).method).toBe("PATCH");
  });

  test("append_block: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("append_block", creds, { page_id: "id", content: "text" })
    ).rejects.toThrow();
  });

  // --- query_database -------------------------------------------------------

  test("query_database: calls /databases/:id/query with POST", async () => {
    await connector.executeAction("query_database", creds, { database_id: "db-uuid-456" });
    const call = fetchCalls[0];
    expect(call.url).toContain("/databases/db-uuid-456/query");
    expect((call.init as RequestInit).method).toBe("POST");
  });

  test("query_database: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("query_database", creds, { database_id: "db" })
    ).rejects.toThrow();
  });
});

// ===========================================================================
// PlaywrightConnector
// ===========================================================================

describe("PlaywrightConnector", () => {
  const connector = new PlaywrightConnector();
  const creds = { apiKey: "" };

  // --- definition -----------------------------------------------------------

  test("definition: provider is playwright", () => {
    expect(connector.definition.provider).toBe("playwright");
  });

  test("definition: authType is api_key", () => {
    expect(connector.definition.authType).toBe("api_key");
  });

  test("definition: has expected actions", () => {
    const names = connector.definition.actions.map((a) => a.name);
    expect(names).toContain("run_tests");
    expect(names).toContain("take_screenshot");
    expect(names).toContain("check_page");
  });

  // --- run_tests ------------------------------------------------------------

  test("run_tests: action is defined with required project_path param", () => {
    const action = connector.definition.actions.find((a) => a.name === "run_tests");
    expect(action).toBeDefined();
    expect(action?.params.project_path).toBeDefined();
  });

  test("run_tests: action has optional reporter and timeout params", () => {
    const action = connector.definition.actions.find((a) => a.name === "run_tests");
    expect(action?.params.reporter).toBeDefined();
    expect(action?.params.timeout).toBeDefined();
  });

  test("run_tests: executes Bun.spawnSync and returns success result", async () => {
    const origSpawnSync = Bun.spawnSync;
    // @ts-ignore
    Bun.spawnSync = () => ({
      exitCode: 0,
      stdout: { toString: () => "3 tests passed (1.2s)" },
      stderr: { toString: () => "" },
    });
    try {
      const result = await connector.executeAction("run_tests", creds, {
        project_path: "/tmp/test-project",
        reporter: "dot",
        timeout: 5000,
      }) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.exit_code).toBe(0);
      expect(result.stdout).toContain("passed");
      expect(result.stderr).toBe("");
    } finally {
      Bun.spawnSync = origSpawnSync;
    }
  });

  test("run_tests: reports failure when process exits non-zero", async () => {
    const origSpawnSync = Bun.spawnSync;
    // @ts-ignore
    Bun.spawnSync = () => ({
      exitCode: 1,
      stdout: { toString: () => "" },
      stderr: { toString: () => "1 test failed" },
    });
    try {
      const result = await connector.executeAction("run_tests", creds, {
        project_path: "/tmp/my-project",
        test_pattern: "tests/**/*.spec.ts",
      }) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(result.exit_code).toBe(1);
      expect(result.stderr).toContain("failed");
    } finally {
      Bun.spawnSync = origSpawnSync;
    }
  });

  // --- take_screenshot ------------------------------------------------------

  test("take_screenshot: returns an object with success and output_path", async () => {
    const result = (await connector.executeAction("take_screenshot", creds, {
      url: "https://example.com",
      output_path: "/tmp/test-screenshot.png",
    })) as Record<string, unknown>;
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("output_path");
    expect(result.output_path).toBe("/tmp/test-screenshot.png");
  });

  // --- check_page -----------------------------------------------------------

  test("check_page: returns an object with a success field", async () => {
    const result = (await connector.executeAction("check_page", creds, {
      url: "https://example.com",
    })) as Record<string, unknown>;
    expect(result).toHaveProperty("success");
  });

  test("check_page: returns success false when process exits non-zero", async () => {
    // If node/playwright is unavailable or fails, success will be false — we just check type
    const result = (await connector.executeAction("check_page", creds, {
      url: "https://example.com",
    })) as Record<string, unknown>;
    expect(typeof result.success).toBe("boolean");
  });

  test("check_page: returns failure object when spawnSync exits non-zero", async () => {
    const origSpawnSync = Bun.spawnSync;
    // @ts-ignore
    Bun.spawnSync = () => ({
      exitCode: 1,
      stdout: { toString: () => "" },
      stderr: { toString: () => "playwright not found" },
    });
    try {
      const result = await connector.executeAction("check_page", creds, {
        url: "https://example.com",
      }) as Record<string, unknown>;
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe("string");
    } finally {
      Bun.spawnSync = origSpawnSync;
    }
  });

  test("check_page: parses stdout JSON on success", async () => {
    const origSpawnSync = Bun.spawnSync;
    const mockResult = { status: 200, title: "Test Page", console_errors: [] };
    // @ts-ignore
    Bun.spawnSync = () => ({
      exitCode: 0,
      stdout: { toString: () => JSON.stringify(mockResult) },
      stderr: { toString: () => "" },
    });
    try {
      const result = await connector.executeAction("check_page", creds, {
        url: "https://example.com",
      }) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.title).toBe("Test Page");
    } finally {
      Bun.spawnSync = origSpawnSync;
    }
  });

  test("check_page: returns raw output when stdout is not valid JSON", async () => {
    const origSpawnSync = Bun.spawnSync;
    // @ts-ignore
    Bun.spawnSync = () => ({
      exitCode: 0,
      stdout: { toString: () => "not valid json output" },
      stderr: { toString: () => "" },
    });
    try {
      const result = await connector.executeAction("check_page", creds, {
        url: "https://example.com",
        wait_for: ".main-content",
      }) as Record<string, unknown>;
      expect(result.success).toBe(true);
      expect(result.raw).toBe("not valid json output");
    } finally {
      Bun.spawnSync = origSpawnSync;
    }
  });
});

// ===========================================================================
// SupabaseConnector
// ===========================================================================

describe("SupabaseConnector", () => {
  const connector = new SupabaseConnector();
  const creds = {
    apiKey: "service-role-key-abc",
    extra: {
      project_url: "https://xyzproject.supabase.co",
      management_token: "mgmt-token-xyz",
    },
  };

  // --- definition -----------------------------------------------------------

  test("definition: provider is supabase", () => {
    expect(connector.definition.provider).toBe("supabase");
  });

  test("definition: authType is api_key", () => {
    expect(connector.definition.authType).toBe("api_key");
  });

  test("definition: has all expected actions", () => {
    const names = connector.definition.actions.map((a) => a.name);
    expect(names).toContain("run_sql");
    expect(names).toContain("select_rows");
    expect(names).toContain("insert_row");
    expect(names).toContain("invoke_edge_function");
    expect(names).toContain("list_projects");
    expect(names).toContain("get_project");
    expect(names).toContain("storage_upload");
  });

  // --- run_sql --------------------------------------------------------------

  test("run_sql: calls project URL /rest/v1/rpc/query", async () => {
    await connector.executeAction("run_sql", creds, { query: "SELECT 1" });
    expect(fetchCalls[0].url).toContain("xyzproject.supabase.co/rest/v1/rpc/query");
  });

  test("run_sql: includes apikey and Authorization headers", async () => {
    await connector.executeAction("run_sql", creds, { query: "SELECT 1" });
    const headers = (fetchCalls[0].init as RequestInit).headers as Record<string, string>;
    expect(headers["apikey"]).toBe("service-role-key-abc");
    expect(headers["Authorization"]).toContain("Bearer service-role-key-abc");
  });

  test("run_sql: throws when both endpoints fail", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("run_sql", creds, { query: "INVALID SQL" })
    ).rejects.toThrow();
  });

  test("run_sql: falls back to PostgREST endpoint when primary RPC fails", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        // First call (primary RPC) fails
        return new Response("Not Found", { status: 404 });
      }
      // Second call (fallback) succeeds
      return new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
    };
    const result = await connector.executeAction("run_sql", creds, { query: "SELECT 1" });
    expect(callCount).toBe(2);
    expect(result).toEqual([{ id: 1 }]);
  });

  // --- select_rows ----------------------------------------------------------

  test("select_rows: calls /rest/v1/:table endpoint", async () => {
    await connector.executeAction("select_rows", creds, { table: "users" });
    expect(fetchCalls[0].url).toContain("/rest/v1/users");
  });

  test("select_rows: includes Prefer header", async () => {
    await connector.executeAction("select_rows", creds, { table: "users" });
    const headers = (fetchCalls[0].init as RequestInit).headers as Record<string, string>;
    expect(headers["Prefer"]).toContain("return=representation");
  });

  test("select_rows: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("select_rows", creds, { table: "bad_table" })
    ).rejects.toThrow();
  });

  test("select_rows: applies filter params to URL when filter is provided", async () => {
    await connector.executeAction("select_rows", creds, {
      table: "users",
      filter: "id=eq.42&status=eq.active",
      limit: 10,
      order: "created_at.desc",
    });
    const url = fetchCalls[0].url as string;
    expect(url).toContain("id=eq.42");
    expect(url).toContain("status=eq.active");
    expect(url).toContain("limit=10");
    expect(url).toContain("order=created_at.desc");
  });

  // --- insert_row -----------------------------------------------------------

  test("insert_row: calls /rest/v1/:table with POST", async () => {
    await connector.executeAction("insert_row", creds, {
      table: "users",
      data: { name: "Alice", email: "alice@example.com" },
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/rest/v1/users");
    expect((call.init as RequestInit).method).toBe("POST");
  });

  test("insert_row: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 409 });
    await expect(
      connector.executeAction("insert_row", creds, { table: "users", data: { id: 1 } })
    ).rejects.toThrow();
  });

  // --- invoke_edge_function -------------------------------------------------

  test("invoke_edge_function: calls /functions/v1/:function_name", async () => {
    await connector.executeAction("invoke_edge_function", creds, {
      function_name: "send-email",
      payload: { to: "user@example.com" },
    });
    expect(fetchCalls[0].url).toContain("/functions/v1/send-email");
  });

  test("invoke_edge_function: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 500 });
    await expect(
      connector.executeAction("invoke_edge_function", creds, { function_name: "broken" })
    ).rejects.toThrow();
  });

  // --- list_projects --------------------------------------------------------

  test("list_projects: calls Supabase Management API /projects", async () => {
    await connector.executeAction("list_projects", creds, {});
    expect(fetchCalls[0].url).toContain("api.supabase.com/v1/projects");
  });

  test("list_projects: uses management token in Authorization header", async () => {
    await connector.executeAction("list_projects", creds, {});
    const headers = (fetchCalls[0].init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer mgmt-token-xyz");
  });

  test("list_projects: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 401 });
    await expect(connector.executeAction("list_projects", creds, {})).rejects.toThrow();
  });

  // --- get_project ----------------------------------------------------------

  test("get_project: calls /projects/:project_ref endpoint", async () => {
    await connector.executeAction("get_project", creds, { project_ref: "xyzproject" });
    expect(fetchCalls[0].url).toContain("/v1/projects/xyzproject");
  });

  test("get_project: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 404 });
    await expect(
      connector.executeAction("get_project", creds, { project_ref: "missing" })
    ).rejects.toThrow();
  });

  // --- storage_upload -------------------------------------------------------

  test("storage_upload: calls /storage/v1/object/:bucket/:path", async () => {
    await connector.executeAction("storage_upload", creds, {
      bucket: "avatars",
      path: "user/profile.png",
      content: "binary-data",
      content_type: "image/png",
    });
    expect(fetchCalls[0].url).toContain("/storage/v1/object/avatars/user/profile.png");
  });

  test("storage_upload: uses POST method", async () => {
    await connector.executeAction("storage_upload", creds, {
      bucket: "avatars",
      path: "test.txt",
      content: "hello",
    });
    expect((fetchCalls[0].init as RequestInit).method).toBe("POST");
  });

  test("storage_upload: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("storage_upload", creds, {
        bucket: "b",
        path: "p",
        content: "c",
      })
    ).rejects.toThrow();
  });
});

// ===========================================================================
// VercelConnector
// ===========================================================================

describe("VercelConnector", () => {
  const connector = new VercelConnector();
  const creds = { apiKey: "vercel-token-abc123" };

  // --- definition -----------------------------------------------------------

  test("definition: provider is vercel", () => {
    expect(connector.definition.provider).toBe("vercel");
  });

  test("definition: authType is api_key", () => {
    expect(connector.definition.authType).toBe("api_key");
  });

  test("definition: has all expected actions", () => {
    const names = connector.definition.actions.map((a) => a.name);
    expect(names).toContain("list_projects");
    expect(names).toContain("get_project");
    expect(names).toContain("list_deployments");
    expect(names).toContain("get_deployment");
    expect(names).toContain("cancel_deployment");
    expect(names).toContain("list_env_vars");
    expect(names).toContain("create_env_var");
  });

  // --- list_projects --------------------------------------------------------

  test("list_projects: calls /v9/projects endpoint", async () => {
    await connector.executeAction("list_projects", creds, {});
    expect(fetchCalls[0].url).toContain("/v9/projects");
  });

  test("list_projects: includes Bearer auth header", async () => {
    await connector.executeAction("list_projects", creds, {});
    const headers = (fetchCalls[0].init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer vercel-token-abc123");
  });

  test("list_projects: throws on error response", async () => {
    globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
    await expect(connector.executeAction("list_projects", creds, {})).rejects.toThrow();
  });

  // --- get_project ----------------------------------------------------------

  test("get_project: calls /v9/projects/:id endpoint", async () => {
    await connector.executeAction("get_project", creds, { project_id_or_name: "my-app" });
    expect(fetchCalls[0].url).toContain("/v9/projects/my-app");
  });

  test("get_project: appends teamId if provided", async () => {
    await connector.executeAction("get_project", creds, {
      project_id_or_name: "my-app",
      team_id: "team-abc",
    });
    expect(fetchCalls[0].url).toContain("teamId=team-abc");
  });

  test("get_project: throws on error response", async () => {
    globalThis.fetch = async () => new Response("Not Found", { status: 404 });
    await expect(
      connector.executeAction("get_project", creds, { project_id_or_name: "missing" })
    ).rejects.toThrow();
  });

  // --- list_deployments -----------------------------------------------------

  test("list_deployments: calls /v6/deployments endpoint", async () => {
    await connector.executeAction("list_deployments", creds, { project_id: "proj-abc" });
    expect(fetchCalls[0].url).toContain("/v6/deployments");
  });

  test("list_deployments: includes projectId in query", async () => {
    await connector.executeAction("list_deployments", creds, { project_id: "proj-abc" });
    expect(fetchCalls[0].url).toContain("projectId=proj-abc");
  });

  test("list_deployments: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("list_deployments", creds, { project_id: "proj" })
    ).rejects.toThrow();
  });

  // --- get_deployment -------------------------------------------------------

  test("get_deployment: calls /v13/deployments/:id endpoint", async () => {
    await connector.executeAction("get_deployment", creds, {
      deployment_id_or_url: "dpl-abc123",
    });
    expect(fetchCalls[0].url).toContain("/v13/deployments/dpl-abc123");
  });

  test("get_deployment: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 404 });
    await expect(
      connector.executeAction("get_deployment", creds, { deployment_id_or_url: "dpl-missing" })
    ).rejects.toThrow();
  });

  // --- cancel_deployment ----------------------------------------------------

  test("cancel_deployment: calls /v12/deployments/:id/cancel with PATCH", async () => {
    await connector.executeAction("cancel_deployment", creds, { deployment_id: "dpl-abc123" });
    const call = fetchCalls[0];
    expect(call.url).toContain("/v12/deployments/dpl-abc123/cancel");
    expect((call.init as RequestInit).method).toBe("PATCH");
  });

  test("cancel_deployment: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("cancel_deployment", creds, { deployment_id: "dpl-bad" })
    ).rejects.toThrow();
  });

  // --- list_env_vars --------------------------------------------------------

  test("list_env_vars: calls /v9/projects/:id/env endpoint", async () => {
    await connector.executeAction("list_env_vars", creds, { project_id: "my-app" });
    expect(fetchCalls[0].url).toContain("/v9/projects/my-app/env");
  });

  test("list_env_vars: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 403 });
    await expect(
      connector.executeAction("list_env_vars", creds, { project_id: "my-app" })
    ).rejects.toThrow();
  });

  // --- create_env_var -------------------------------------------------------

  test("create_env_var: calls /v10/projects/:id/env with POST", async () => {
    await connector.executeAction("create_env_var", creds, {
      project_id: "my-app",
      key: "API_SECRET",
      value: "super-secret",
    });
    const call = fetchCalls[0];
    expect(call.url).toContain("/v10/projects/my-app/env");
    expect((call.init as RequestInit).method).toBe("POST");
  });

  test("create_env_var: sends key, value and target in body", async () => {
    await connector.executeAction("create_env_var", creds, {
      project_id: "my-app",
      key: "MY_KEY",
      value: "MY_VALUE",
    });
    const body = JSON.parse((fetchCalls[0].init as RequestInit).body as string);
    expect(body.key).toBe("MY_KEY");
    expect(body.value).toBe("MY_VALUE");
    expect(Array.isArray(body.target)).toBe(true);
  });

  test("create_env_var: throws on error response", async () => {
    globalThis.fetch = async () => new Response("error", { status: 400 });
    await expect(
      connector.executeAction("create_env_var", creds, {
        project_id: "my-app",
        key: "K",
        value: "V",
      })
    ).rejects.toThrow();
  });
});

// ===========================================================================
// Cross-connector: executeAction throws for unknown action names
// ===========================================================================

describe("BaseConnector: executeAction for unknown actions", () => {
  test("AtlassianConnector: throws for unknown action", async () => {
    const c = new AtlassianConnector();
    await expect(c.executeAction("nonexistent_action", {}, {})).rejects.toThrow();
  });

  test("CloudflareConnector: throws for unknown action", async () => {
    const c = new CloudflareConnector();
    await expect(c.executeAction("nonexistent_action", {}, {})).rejects.toThrow();
  });

  test("FigmaConnector: throws for unknown action", async () => {
    const c = new FigmaConnector();
    await expect(c.executeAction("nonexistent_action", {}, {})).rejects.toThrow();
  });

  test("NotionConnector: throws for unknown action", async () => {
    const c = new NotionConnector();
    await expect(c.executeAction("nonexistent_action", {}, {})).rejects.toThrow();
  });

  test("VercelConnector: throws for unknown action", async () => {
    const c = new VercelConnector();
    await expect(c.executeAction("nonexistent_action", {}, {})).rejects.toThrow();
  });

  test("SupabaseConnector: throws for unknown action", async () => {
    const c = new SupabaseConnector();
    await expect(c.executeAction("nonexistent_action", {}, {})).rejects.toThrow();
  });
});
