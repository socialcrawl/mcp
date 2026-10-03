import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiContext } from "../context.js";
import { ENDPOINTS } from "../data/endpoints.js";
import { DOCS } from "../data/docs.js";
import { ERRORS_GUIDE, GUIDE } from "../data/guide.js";
import { outputsFor } from "../data/outputs.js";
import { findPlatform, PLATFORMS } from "../data/platforms.js";
import { RECIPES_DATA } from "../data/recipes.js";
import { formatCost } from "../pricing.js";
import { didYouMean } from "../search/rank.js";
import { suggestPlatforms } from "../search/catalog.js";
import { discover, localCapabilities, localQuickstart } from "../tools/discover.js";
import { endpointStructured } from "../tools/endpoint.js";
import { resolveEndpoint } from "../tools/request.js";

/**
 * MCP-05: reference material an agent can browse without a tool call. Static
 * resources (guide, recipes, pricing, errors, llms, quickstart, capabilities)
 * and the templates platform / endpoint / schema / example. The `results`
 * template (MCP-03) is registered in `server.ts`, next to the store it reads.
 */

const MD = "text/markdown";
const JSON_MIME = "application/json";

const bad = (message: string): McpError => new McpError(ErrorCode.InvalidParams, message);
const first = (v: string | string[] | undefined): string => {
  const raw = String(Array.isArray(v) ? v[0] : v ?? "");
  try {
    return decodeURIComponent(raw);
  } catch {
    throw bad(`Malformed escape in "${raw}".`);
  }
};

/** The samples are the bulk of the bundle: parse them on first use, not at startup. */
const examples = (): Promise<typeof import("../data/examples.js")> => import("../data/examples.js");
const text = (uri: URL, body: string, mimeType = MD): ReadResourceResult => ({ contents: [{ uri: uri.href, mimeType, text: body }] });

const GUIDE_NOTE =
  "> The `references/<name>.md` files this guide mentions are served here: `socialcrawl://platform/<platform>` for a platform's endpoints, `socialcrawl://endpoint/<platform>/<resource>` for one contract, `socialcrawl://recipes`, `socialcrawl://pricing` and `socialcrawl://errors`. Prefer the socialcrawl_* tools to the `scripts/` it names.\n\n";

const archetypes = (): string[] => [...new Set(ENDPOINTS.map((e) => e.archetype))].sort();

function platformTable(slug: string): string {
  const platform = findPlatform(slug)!;
  const rows = ENDPOINTS.filter((e) => e.platform === slug).sort((a, b) => a.resource.localeCompare(b.resource));
  return [
    `# ${platform.name} (${slug})`,
    "",
    `${rows.length} endpoints. ${platform.description}`,
    "",
    "| Endpoint | Cost | Returns | Use when |",
    "|---|---|---|---|",
    ...rows.map((e) => {
      const cell = (s: string | null | undefined): string => (s ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
      return `| ${e.method === "GET" ? "" : `${e.method} `}${e.resource} | ${formatCost(e.pricing)} | ${cell(e.purpose?.returns ?? e.summary)} | ${cell(e.purpose?.use_when)} |`;
    }),
    "",
    `Read one contract with socialcrawl://endpoint/${slug}/<resource> or socialcrawl_endpoint; call with socialcrawl_request.`,
  ].join("\n");
}

function schemaDoc(name: string, archetypeExamples: Record<string, string>): string {
  const rows = ENDPOINTS.filter((e) => e.archetype === name);
  const counts = new Map<string, { type: string; n: number }>();
  const rowsAt = new Map<string, number>();
  let withFields = 0;
  for (const e of rows) {
    const out = outputsFor(e);
    if (!out || out.fields.length === 0) continue;
    withFields++;
    if (out.rows_at) rowsAt.set(out.rows_at, (rowsAt.get(out.rows_at) ?? 0) + 1);
    for (const f of out.fields) {
      const c = counts.get(f.path);
      if (c) c.n++;
      else counts.set(f.path, { type: f.type, n: 1 });
    }
  }
  const common = [...counts].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 60);
  const topRowsAt = [...rowsAt].sort((a, b) => b[1] - a[1])[0]?.[0];
  const lines = [
    `# ${name}`,
    "",
    `Response shape of ${rows.length} endpoints.${topRowsAt ? ` Rows are usually at \`${topRowsAt}\`.` : ""} Pass these paths as \`fields\`.`,
    "",
    ...(common.length > 0
      ? [`Fields (of ${counts.size}; most shared first, n = endpoints with the field out of ${withFields}):`, ...common.map(([path, c]) => `- ${path} ${c.type} (n=${c.n})`)]
      : ["No field list is published for these endpoints yet; see the sample."]),
    "",
    `Endpoints: ${rows.slice(0, 12).map((e) => `${e.platform}/${e.resource}`).join(", ")}${rows.length > 12 ? `, and ${rows.length - 12} more` : ""}.`,
  ];
  const sample = archetypeExamples[name];
  if (sample) lines.push("", "Sample (redacted):", "```json", JSON.stringify(JSON.parse(sample), null, 2), "```");
  return lines.join("\n");
}

function complete(values: string[], value: string): string[] {
  const v = value.toLowerCase();
  return values.filter((s) => s.toLowerCase().startsWith(v));
}

/** Resources of `platform` (those with a bundled sample when `sampled`). */
async function resourcesOf(platform: string | undefined, sampled: boolean): Promise<string[]> {
  if (!platform) return [];
  const have = sampled ? (await examples()).EXAMPLES : {};
  return ENDPOINTS.filter((e) => e.platform === platform && (!sampled || `${e.platform}/${e.resource}` in have)).map((e) => e.resource);
}

export function registerResources(server: McpServer, ctx: ApiContext): void {
  const fixed = (name: string, title: string, description: string, mimeType: string, body: () => string | Promise<string>): void => {
    const uri = `socialcrawl://${name}`;
    server.registerResource(name, uri, { title, description, mimeType }, async (u) => text(u, await body(), mimeType));
  };

  fixed("guide", "SocialCrawl guide", "The agent guide: how to find, price, call and page endpoints, with the rules that save credits. Start here.", MD, () => GUIDE_NOTE + GUIDE);
  fixed(
    "recipes",
    "Task recipes",
    "Every task recipe as JSON: typed inputs, the exact calls, setup steps, a computed credit cost, cheaper and deeper options and pitfalls. Recipes with up to three inputs are also prompts.",
    JSON_MIME,
    () => JSON.stringify(RECIPES_DATA, null, 1),
  );
  fixed("pricing", "Pricing reference", "Credit costs for every endpoint: tiers, flat and metered rules, cache windows and the pricing model.", MD, () => DOCS.pricing ?? "");
  fixed("errors", "Errors and retries", "Error codes, which are retryable, what each fix is, and the 402 rule (never retry).", MD, () => `${ERRORS_GUIDE}\n\n---\n\n${DOCS.errors ?? ""}`);
  fixed("llms", "Agent context corpus", "Where the full agent context (llms.txt) lives; read live with an API key.", MD, () => discover(ctx, { action: "llms" }));
  fixed("quickstart", "Quickstart", "Everything for a first successful call: base URL, auth, response envelope, billing and the error taxonomy.", MD, () => localQuickstart());
  fixed("capabilities", "Cross-cutting parameters", "Parameters most endpoints share (labels, relevance, judgments, include, since, row filters, trim, fit): what each does, its price and where it applies.", MD, () => localCapabilities());

  const platformList = (): string[] => PLATFORMS.map((p) => p.slug);

  server.registerResource(
    "platform",
    new ResourceTemplate("socialcrawl://platform/{platform}", {
      list: undefined,
      complete: { platform: (v) => complete(platformList(), v) },
    }),
    { title: "Platform endpoints", description: "One platform's endpoints as a table: cost, what each returns and when to use it.", mimeType: MD },
    async (uri, vars: Variables) => {
      const slug = first(vars.platform);
      if (!findPlatform(slug)) {
        const near = suggestPlatforms(slug);
        throw bad(`Unknown platform "${slug}".${near.length > 0 ? ` Did you mean: ${near.join(", ")}?` : ""}`);
      }
      return text(uri, platformTable(slug));
    },
  );

  server.registerResource(
    "endpoint",
    new ResourceTemplate("socialcrawl://endpoint/{platform}/{+resource}", {
      list: undefined,
      complete: { platform: (v) => complete(platformList(), v), resource: async (v, c) => complete(await resourcesOf(c?.arguments?.platform, false), v) },
    }),
    { title: "Endpoint contract", description: "One endpoint's contract: params, where the rows are, response fields, cost, paging, latency and next steps (what socialcrawl_endpoint returns).", mimeType: MD },
    async (uri, vars: Variables) => {
      const out = await endpointStructured(ctx, { id: `${first(vars.platform)}/${first(vars.resource)}` });
      if ((out.structured as { ok?: boolean }).ok === false) throw bad(out.text);
      return text(uri, out.text);
    },
  );

  server.registerResource(
    "schema",
    new ResourceTemplate("socialcrawl://schema/{archetype}", {
      list: undefined,
      complete: { archetype: (v) => complete(archetypes(), v) },
    }),
    { title: "Response schema", description: "A response archetype (Post, PostList, Author, ...): the fields its endpoints share and a redacted sample.", mimeType: MD },
    async (uri, vars: Variables) => {
      const name = first(vars.archetype);
      if (!archetypes().includes(name)) {
        const near = didYouMean(name, archetypes());
        throw bad(`Unknown archetype "${name}".${near.length > 0 ? ` Did you mean: ${near.join(", ")}?` : ` Known: ${archetypes().join(", ")}.`}`);
      }
      return text(uri, schemaDoc(name, (await examples()).ARCHETYPE_EXAMPLES));
    },
  );

  server.registerResource(
    "example",
    new ResourceTemplate("socialcrawl://example/{platform}/{+resource}", {
      list: undefined,
      complete: { platform: (v) => complete(platformList(), v), resource: async (v, c) => complete(await resourcesOf(c?.arguments?.platform, true), v) },
    }),
    { title: "Sample response", description: "A redacted sample response (two rows) captured from the endpoint. Free; costs no credits.", mimeType: JSON_MIME },
    async (uri, vars: Variables) => {
      const platform = first(vars.platform);
      const resource = first(vars.resource);
      if (!findPlatform(platform)) throw bad(`Unknown platform "${platform}".`);
      if (!resolveEndpoint(platform, resource, undefined)) throw bad(`Unknown resource "${resource}" for platform "${platform}".`);
      const sample = (await examples()).EXAMPLES[`${platform}/${resource}`];
      if (!sample) {
        throw bad(`No bundled sample for ${platform}/${resource}. Read its contract (socialcrawl://endpoint/${platform}/${resource}) or call it once with a small limit.`);
      }
      return text(uri, JSON.stringify(JSON.parse(sample), null, 2), JSON_MIME);
    },
  );
}
