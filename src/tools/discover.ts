import { apiRequest, makeRequest } from "../client.js";
import { ENDPOINTS, findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { PLATFORMS, findPlatform } from "../data/platforms.js";
import { REGISTRY_FINGERPRINT, REGISTRY_STATS } from "../data/registry-meta.js";
import { capabilityIndex } from "../judgments.js";
import { SERVER_VERSION } from "../constants.js";
import { page } from "../paginate.js";
import {
  endpointPath,
  explainPricing,
  formatCost,
  formatRange,
  formatTtl,
  worstCaseCost,
} from "../pricing.js";
import type { ApiContext } from "../context.js";
import type { Endpoint } from "../types.js";

/**
 * The `/v1/utility/*` family — SocialCrawl describing itself, from inside
 * itself, at 0 credits.
 *
 * Six endpoints, all free and served in-process from the endpoint registry
 * (no upstream, no network, no retries):
 *
 * - `utility/quickstart`   — everything needed for a first successful call.
 * - `utility/endpoints`    — the machine-readable catalogue of every endpoint.
 * - `utility/endpoint`     — the full usage guide for one endpoint.
 * - `utility/capabilities` — each cross-cutting param, its price, its endpoints.
 * - `utility/plan`         — a plain-words job turned into priced calls.
 * - `utility/llms`         — the agent context corpus, whole-API or per-platform.
 *
 * Two things make this worth its own tool rather than raw `socialcrawl_request`:
 *
 * 1. **Shape.** These return large structured payloads meant for a program, not
 *    a reader. Dumped as raw JSON the catalogue alone would swamp a response.
 *    Here each payload is rendered as markdown an agent can act on directly.
 *
 * 2. **Truth.** This server ships a catalogue generated at build time; the
 *    utility endpoints answer from the live registry. They are the authority
 *    when the two disagree — which is exactly what `action: "freshness"`
 *    checks, and the only way an agent can know its bundled data has aged out.
 *
 * Without an API key every action except `llms` still answers from the bundled
 * catalogue, clearly labelled as such, so discovery never hard-requires auth.
 */

export type DiscoverAction =
  | "quickstart"
  | "catalog"
  | "endpoint"
  | "capabilities"
  | "plan"
  | "llms"
  | "freshness"
  | "status";

export interface DiscoverParams {
  action?: DiscoverAction;
  platform?: string;
  search?: string;
  method?: string;
  id?: string;
  /** capabilities: one parameter only. */
  param?: string;
  /** plan: the job in plain words. */
  query?: string;
  format?: "markdown" | "json";
  live?: boolean;
  page?: number;
}

const LOCAL_NOTE =
  "> Answered from this server's bundled catalogue (no API key configured, or `live: false`). " +
  "It is generated from the same registry, but it is a snapshot. For the live answer, configure " +
  "`SOCIALCRAWL_API_KEY` and call again — the underlying `/v1/utility/*` endpoints cost 0 credits.";

const LIVE_NOTE =
  "> Answered live by `/v1/utility/*` — generated from the endpoint registry at request time, so it cannot drift from what is callable. Cost: 0 credits.";

/** Parse an API envelope, returning `data` or null when the call failed. */
function envelopeData(response: string): Record<string, unknown> | null {
  if (response.startsWith("Error:")) return null;
  try {
    const parsed = JSON.parse(response) as { success?: boolean; data?: unknown };
    if (parsed.success === false) return null;
    return (parsed.data ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

/** Normalise `tiktok/profile`, `/v1/tiktok/profile`, or a full URL to `platform/resource`. */
export function normalizeEndpointId(raw: string): string {
  let s = raw.trim().replace(/^https?:\/\/[^/]*/i, "");
  const cut = s.search(/[?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  s = s.replace(/^\/+/, "").replace(/\/+$/, "");
  if (s.startsWith("v1/")) s = s.slice(3);
  return s;
}

// ── quickstart ─────────────────────────────────────────────────────────

export function localQuickstart(platformSlug?: string): string {
  const platform = platformSlug ? findPlatform(platformSlug) : undefined;
  const example =
    (platform ? getEndpointsByPlatform(platform.slug)[0] : undefined) ??
    findEndpoint("tiktok", "profile")!;
  const exampleParam = example.params[0] ?? example.optionalParams[0];
  const query = exampleParam ? `?${exampleParam.name}=${exampleParam.example ?? "value"}` : "";
  const url = `https://www.socialcrawl.dev/v1/${example.platform}/${example.resource}${query}`;

  return [
    `# SocialCrawl Quickstart${platform ? ` — ${platform.name}` : ""}`,
    "",
    LOCAL_NOTE,
    "",
    "## 1. Get a key",
    "",
    "Sign up at https://www.socialcrawl.dev — 100 free credits, no credit card. Keys start with `sc_`.",
    "",
    "## 2. Configure it",
    "",
    "**This MCP server, locally (stdio):** set `SOCIALCRAWL_API_KEY` in your MCP client's env config.",
    "**This MCP server, remotely (Streamable HTTP):** send `Authorization: Bearer sc_…` or `x-api-key: sc_…` on every request to `https://mcp.socialcrawl.dev/mcp`.",
    "**Direct HTTP:** pass `x-api-key: sc_…` on every request. Never put the key in a URL or query string.",
    "",
    "See the `setup` docs topic for per-client configuration.",
    "",
    "## 3. Make a call",
    "",
    "```bash",
    `curl -H "x-api-key: $SOCIALCRAWL_API_KEY" "${url}"`,
    "```",
    "",
    `Through this server: \`socialcrawl_request\` with platform \`${example.platform}\`, resource \`${example.resource}\`${exampleParam ? `, params \`{ "${exampleParam.name}": "${exampleParam.example ?? "value"}" }\`` : ""}.`,
    "",
    "## 4. Read the envelope",
    "",
    "```json",
    "{",
    '  "success": true,',
    `  "platform": "${example.platform}",`,
    `  "endpoint": "/v1/${example.platform}/${example.resource}",`,
    '  "data": { "...": "..." },',
    '  "credits_used": 1,',
    '  "credits_remaining": 99,',
    '  "request_id": "req-…",',
    '  "cached": false',
    "}",
    "```",
    "",
    "`credits_used` is the **settled** charge — for a metered endpoint that is the post-refund number, not the upfront hold.",
    "",
    "## The surface",
    "",
    `${REGISTRY_STATS.totalPlatforms} platforms, ${REGISTRY_STATS.totalEndpoints} endpoints. Rate limits: 600 requests/minute and 50 concurrent per key.`,
    "",
    "## Next steps",
    "",
    "| Want to… | Do this |",
    "|----------|---------|",
    "| See what exists | `socialcrawl_find` with no task |",
    "| Find an endpoint | `socialcrawl_find` with the task in plain words |",
    "| Know what it costs | `socialcrawl_estimate` with the exact params |",
    "| Turn a job into calls | `socialcrawl_find` for each step, `socialcrawl_estimate` with a `plan` to total it |",
    "| Learn one endpoint fully | `socialcrawl_endpoint` with its `id` |",
    "| Understand a contract | `socialcrawl_endpoint` with a topic id — credits, errors, pagination, caching, limits |",
    "| Check this server is current | `socialcrawl_account` with `view: \"freshness\"` |",
  ].join("\n");
}

function renderQuickstart(data: Record<string, unknown>): string {
  const d = data as {
    base_url?: string;
    auth?: { type?: string; header?: string; get_key_url?: string };
    first_call?: { description?: string; url?: string; curl?: string; how_to_use?: string };
    billing?: { model?: string; tiers?: Record<string, number>; rules?: string[] };
    errors?: { code: string; http: number; meaning: string }[];
    pagination?: { how?: string; params?: string[] };
    rate_limits?: { requests_per_minute?: number; concurrent_requests?: number };
    stats?: { platforms?: number; endpoints?: number };
    next_steps?: Record<string, string>;
  };

  const lines: string[] = ["# SocialCrawl Quickstart", "", LIVE_NOTE, ""];

  lines.push("## Authentication", "");
  lines.push(
    `Pass your key in the \`${d.auth?.header ?? "x-api-key"}\` header on every request. Get one at ${d.auth?.get_key_url ?? "https://www.socialcrawl.dev/dashboard/api"}.`,
    "",
    `Base URL: \`${d.base_url ?? "https://www.socialcrawl.dev/v1"}\``,
    "",
    "In this MCP server the key is configured once — `SOCIALCRAWL_API_KEY` for stdio, or an `Authorization: Bearer` header for the remote transport. See the `setup` docs topic.",
    "",
  );

  if (d.first_call) {
    lines.push("## First call", "");
    if (d.first_call.description) lines.push(d.first_call.description, "");
    if (d.first_call.curl) lines.push("```bash", d.first_call.curl, "```", "");
  }

  if (d.billing) {
    lines.push("## Billing", "");
    if (d.billing.tiers) {
      lines.push(
        "| Tier | Credits |",
        "|------|---------|",
        ...Object.entries(d.billing.tiers).map(([tier, cost]) => `| ${tier} | ${cost} |`),
        "",
      );
    }
    if (d.billing.rules) lines.push(...d.billing.rules.map((r) => `- ${r}`), "");
    lines.push(
      "Use `socialcrawl_estimate` for any endpoint's exact cost — including the metered bands, where the base cost understates the real charge.",
      "",
    );
  }

  if (d.errors && d.errors.length > 0) {
    lines.push(
      "## Errors",
      "",
      "| Code | HTTP | Meaning |",
      "|------|------|---------|",
      ...d.errors.map((e) => `| \`${e.code}\` | ${e.http} | ${e.meaning} |`),
      "",
    );
  }

  if (d.pagination) {
    lines.push("## Pagination", "", d.pagination.how ?? "", "");
  }

  if (d.rate_limits) {
    lines.push(
      "## Limits",
      "",
      `${d.rate_limits.requests_per_minute ?? 600} requests/minute · ${d.rate_limits.concurrent_requests ?? 50} concurrent, per key.`,
      "",
    );
  }

  if (d.stats) {
    lines.push(
      "## Surface",
      "",
      `${d.stats.platforms ?? "?"} platforms, ${d.stats.endpoints ?? "?"} endpoints.`,
      "",
    );
  }

  if (d.next_steps) {
    lines.push(
      "## Next steps",
      "",
      ...Object.entries(d.next_steps).map(([k, v]) => `- **${k.replace(/_/g, " ")}:** ${v}`),
      "",
    );
  }

  return lines.join("\n");
}

// ── catalog ────────────────────────────────────────────────────────────

interface CatalogRow {
  id?: string;
  path?: string;
  method?: string;
  platform?: string;
  summary?: string;
  credits?: number;
  credits_label?: string;
  archetype?: string;
  required_params?: string[];
  one_of?: string[][];
  optional_params?: string[];
  paginated?: boolean;
  how_to_use?: string;
}

function catalogTable(rows: string[][]): string[] {
  return [
    "| Endpoint | Price | Required | Optional | Paginated | Summary |",
    "|----------|-------|----------|----------|-----------|---------|",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
}

function localCatalog(params: DiscoverParams): string {
  let matches = ENDPOINTS;
  if (params.platform) {
    if (!findPlatform(params.platform)) {
      return `Error: Unknown platform "${params.platform}". Use socialcrawl_find to see the ${PLATFORMS.length} available platforms.`;
    }
    matches = matches.filter((e) => e.platform === params.platform);
  }
  if (params.method) {
    matches = matches.filter((e) => e.method === params.method!.toUpperCase());
  }
  if (params.search) {
    const q = params.search.toLowerCase();
    matches = matches.filter((e) =>
      `${e.platform}/${e.resource} ${e.summary}`.toLowerCase().includes(q),
    );
  }

  const rows = matches.map((e) => [
    `\`${endpointPath(e)}\``,
    formatCost(e.pricing),
    e.params.length > 0
      ? e.params.map((p) => `\`${p.name}\``).join(", ")
      : e.oneOfGroups.length > 0
        ? e.oneOfGroups.map((g) => `one of ${g.map((n) => `\`${n}\``).join("/")}`).join("; ")
        : "—",
    e.optionalParams.length > 0 ? String(e.optionalParams.length) : "—",
    e.pagination || e.paginatable ? "yes" : "no",
    e.summary,
  ]);

  return [
    `# Endpoint catalogue — ${matches.length} of ${ENDPOINTS.length} endpoints`,
    "",
    LOCAL_NOTE,
    "",
    ...(rows.length === 0
      ? ["No endpoints match those filters."]
      : catalogTable(rows)),
    "",
    "For one endpoint's full usage guide, call this tool with `action: \"endpoint\"` and its `id` (e.g. `tiktok/profile`).",
  ].join("\n");
}

function renderCatalog(data: Record<string, unknown>): string {
  const d = data as {
    stats?: { platforms?: number; endpoints?: number };
    filters?: Record<string, string | null>;
    total?: number;
    endpoints?: CatalogRow[];
  };
  const rows = (d.endpoints ?? []).map((e) => [
    `\`${e.method && e.method !== "GET" ? `${e.method} ` : ""}${e.path ?? e.id ?? "?"}\``,
    // `credits_label` is the live, metered-aware label (e.g. "2-120 (metered)")
    // — always prefer it over the bare `credits` base number.
    e.credits_label ?? String(e.credits ?? "?"),
    e.required_params && e.required_params.length > 0
      ? e.required_params.map((p) => `\`${p}\``).join(", ")
      : e.one_of && e.one_of.length > 0
        ? e.one_of.map((g) => `one of ${g.map((n) => `\`${n}\``).join("/")}`).join("; ")
        : "—",
    e.optional_params && e.optional_params.length > 0
      ? String(e.optional_params.length)
      : "—",
    e.paginated ? "yes" : "no",
    e.summary ?? "",
  ]);

  const filters = Object.entries(d.filters ?? {})
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return [
    `# Endpoint catalogue — ${d.total ?? rows.length} endpoint${rows.length === 1 ? "" : "s"}${filters ? ` (${filters})` : ""}`,
    "",
    LIVE_NOTE,
    "",
    `Live registry: **${d.stats?.platforms ?? "?"} platforms, ${d.stats?.endpoints ?? "?"} endpoints.**`,
    "",
    ...(rows.length === 0 ? ["No endpoints match those filters."] : catalogTable(rows)),
    "",
    "The `Price` column is the live label — metered endpoints show their real band, not their base cost. For one endpoint's full usage guide, call this tool with `action: \"endpoint\"` and its `id`.",
  ].join("\n");
}

// ── endpoint guide ─────────────────────────────────────────────────────

function localGuide(id: string, method?: string): string {
  const key = normalizeEndpointId(id);
  const slash = key.indexOf("/");
  if (slash === -1) {
    return `Error: "${id}" is not an endpoint id. Use \`platform/resource\` (e.g. \`tiktok/profile\`) or a path (e.g. \`/v1/tiktok/profile\`).`;
  }
  const platform = key.slice(0, slash);
  const resource = key.slice(slash + 1);
  const e = findEndpoint(platform, resource, method?.toUpperCase());
  if (!e) {
    return `Error: Unknown endpoint "${key}". Call this tool with \`action: "catalog"\` to see every endpoint.`;
  }
  return [`# ${endpointPath(e)}`, "", LOCAL_NOTE, "", ...guideBody(e)].join("\n");
}

/** Full usage guide for one endpoint, rendered from bundled registry data. */
function guideBody(e: Endpoint): string[] {
  const lines: string[] = [e.summary, ""];
  if (e.description && e.description !== e.summary) lines.push(e.description, "");

  lines.push("## Pricing", "", ...explainPricing(e), "");

  if (e.featuredParams && e.featuredParams.length > 0) {
    lines.push(
      "## Worth knowing",
      "",
      ...e.featuredParams.map((f) => `- \`${f.name}=${f.example}\` — ${f.benefit}`),
      "",
    );
  }

  lines.push("## Parameters", "");
  if (e.params.length > 0) {
    lines.push(e.method === "POST" ? "**Required (JSON body unless noted):**" : "**Required:**");
    for (const p of e.params) {
      lines.push(`- \`${p.name}\`: ${p.description} Example: \`${p.example}\``);
    }
    lines.push("");
  }
  for (const group of e.oneOfGroups) {
    lines.push(`**Provide at least one of:** ${group.map((n) => `\`${n}\``).join(", ")}`, "");
  }
  if (e.optionalParams.length > 0) {
    lines.push("**Optional:**");
    for (const opt of e.optionalParams) {
      const bits: string[] = [
        opt.type === "enum" && opt.enumValues ? `enum: ${opt.enumValues.join("|")}` : opt.type,
      ];
      if (opt.minimum !== undefined || opt.maximum !== undefined) bits.push(formatRange(opt.minimum, opt.maximum));
      const csv = e.csvConstraints?.[opt.name];
      if (csv) {
        bits.push(
          `CSV${csv.max !== undefined ? `, max ${csv.max}` : ""}${csv.enumValues ? `, each of ${csv.enumValues.join("|")}` : ""}`,
        );
      }
      const notes: string[] = [];
      if (opt.requires) notes.push(`Requires \`${opt.requires}\`.`);
      if (opt.couplesWith) {
        notes.push(`Requires \`${opt.couplesWith.param}=${opt.couplesWith.value}\`.`);
      }
      if (opt.example) notes.push(`Example: \`${opt.example}\``);
      lines.push(
        `- \`${opt.name}\` (${bits.join("; ")})${opt.description ? ` — ${opt.description}` : ""}${notes.length > 0 ? ` ${notes.join(" ")}` : ""}`,
      );
    }
    lines.push("");
  }
  if (e.params.length === 0 && e.optionalParams.length === 0 && e.oneOfGroups.length === 0) {
    lines.push("This endpoint takes no parameters.", "");
  }

  lines.push("## Response", "");
  lines.push(`Archetype: \`${e.archetype}\`.`);
  if (e.emptyOn404) {
    lines.push(
      "An upstream 404 here means zero items — you get `200 {items: []}` and the credit back, not an error.",
    );
  }
  lines.push("");

  lines.push("## Paging", "");
  if (e.paginatable) {
    lines.push("Walks every page server-side — one call returns the complete set.");
  } else if (e.pagination) {
    lines.push(
      `${e.pagination.style} style. Pass \`cursor\` (the universal alias for \`${e.pagination.nativeParam}\`)` +
        (e.pagination.limitParam
          ? `, page size via \`${e.pagination.limitParam}\`${e.pagination.limitMax !== undefined ? ` (max ${e.pagination.limitMax})` : ""}`
          : "") +
        ". Stop when `pagination.has_more` is false. Each page is billed separately.",
    );
  } else {
    lines.push(e.singlePage ?? "Not paginated.");
  }
  if (e.collectUntilN) {
    lines.push("", `\`limit\` here is **collect-until-N**, not a page size: ${e.collectUntilN}`);
  }
  lines.push("");

  if (e.execution === "async" || e.streaming) {
    lines.push("## Delivery", "");
    if (e.execution === "async") lines.push("Async — submits a job (202); poll for the result.");
    if (e.streaming === "accept-header") {
      lines.push("Send `Accept: text/event-stream` for SSE, or `application/json` for one envelope.");
    } else if (e.streaming === "always") {
      lines.push("Always SSE — there is no sync variant.");
    } else if (e.streaming) {
      lines.push(`Streams SSE when \`${e.streaming}\`.`);
    }
    lines.push("");
  }

  if (e.contractDetails && e.contractDetails.length > 0) {
    lines.push("## Contract", "", ...e.contractDetails.map((d) => `- ${d}`), "");
  }

  lines.push("## Call it", "");
  lines.push(
    e.platform === "web"
      ? "Use `socialcrawl_manage` with area web — the `web` platform is action-based, not registry-driven."
      : `\`socialcrawl_request\` with platform \`${e.platform}\`, resource \`${e.resource}\`${e.method !== "GET" ? ` (${e.method} — array/object params go in \`body\`)` : ""}.`,
  );
  if (e.related && e.related.length > 0) {
    lines.push("", "## Related endpoints", "", ...e.related.map((r) => `- \`${r.id}\` — ${r.why}`));
  } else {
    lines.push("", `Related: ${relatedIds(e).map((r) => `\`${r}\``).join(", ") || "—"}`);
  }
  return lines;
}

/** Sibling endpoints on the same platform, nearest resource prefix first. */
function relatedIds(e: Endpoint): string[] {
  const root = e.resource.split("/")[0];
  return getEndpointsByPlatform(e.platform)
    .filter((o) => o !== e)
    .sort((a, b) => {
      const aRoot = a.resource.split("/")[0] === root ? 0 : 1;
      const bRoot = b.resource.split("/")[0] === root ? 0 : 1;
      return aRoot - bRoot || a.resource.localeCompare(b.resource);
    })
    .slice(0, 5)
    .map((o) => `${o.platform}/${o.resource}`);
}

function renderGuide(data: Record<string, unknown>): string {
  const d = data as {
    id?: string;
    path?: string;
    method?: string;
    summary?: string;
    description?: string;
    credits?: {
      cost?: number;
      label?: string;
      tier?: string;
      pricing_notes?: string | null;
      billing_rules?: string[];
    };
    params?: {
      required?: { name: string; type?: string; description?: string; example?: string | null }[];
      one_of?: { options: string[]; rule?: string }[];
      optional?: {
        name: string;
        type?: string;
        description?: string;
        example?: string | null;
        requires?: string | null;
      }[];
    };
    pagination?: Record<string, unknown> | null;
    cache?: { ttl_seconds?: number; note?: string };
    response?: { archetype?: string; schema_url?: string; example?: unknown };
    request?: { url?: string | null; curl?: string | null };
    links?: Record<string, string>;
    related?: { id?: string; path?: string; summary?: string }[];
  };

  const lines: string[] = [
    `# ${d.method ?? "GET"} ${d.path ?? d.id ?? "endpoint"}`,
    "",
    LIVE_NOTE,
    "",
  ];
  if (d.summary) lines.push(d.summary, "");
  if (d.description) lines.push(d.description, "");

  if (d.credits) {
    lines.push(
      "## Pricing",
      "",
      `**${d.credits.label ?? `${d.credits.cost} credits`}** (tier: ${d.credits.tier ?? "?"})`,
      "",
    );
    if (d.credits.pricing_notes) lines.push(`**Rule:** ${d.credits.pricing_notes}`, "");
    if (d.credits.billing_rules) lines.push(...d.credits.billing_rules.map((r) => `- ${r}`), "");
    lines.push("");
  }

  lines.push("## Parameters", "");
  const req = d.params?.required ?? [];
  if (req.length > 0) {
    lines.push("**Required:**");
    for (const p of req) {
      lines.push(
        `- \`${p.name}\` (${p.type ?? "string"})${p.description ? `: ${p.description}` : ""}${p.example ? ` Example: \`${p.example}\`` : ""}`,
      );
    }
    lines.push("");
  }
  for (const g of d.params?.one_of ?? []) {
    lines.push(
      `**${g.rule ?? "Provide at least one"}:** ${g.options.map((o) => `\`${o}\``).join(", ")}`,
      "",
    );
  }
  const opt = d.params?.optional ?? [];
  if (opt.length > 0) {
    lines.push("**Optional:**");
    for (const p of opt) {
      lines.push(
        `- \`${p.name}\` (${p.type ?? "string"})${p.description ? ` — ${p.description}` : ""}${p.requires ? ` Requires \`${p.requires}\`.` : ""}${p.example ? ` Example: \`${p.example}\`` : ""}`,
      );
    }
    lines.push("");
  }
  if (req.length === 0 && opt.length === 0 && (d.params?.one_of ?? []).length === 0) {
    lines.push("This endpoint takes no parameters.", "");
  }

  if (d.cache) {
    lines.push(
      "## Cache",
      "",
      `TTL ${formatTtl(d.cache.ttl_seconds ?? 0)}. ${d.cache.note ?? ""}`,
      "",
    );
  }

  if (d.pagination) {
    lines.push("## Paging", "", "```json", JSON.stringify(d.pagination, null, 2), "```", "");
  }

  if (d.response) {
    lines.push("## Response", "", `Archetype: \`${d.response.archetype ?? "?"}\``);
    if (d.response.schema_url) lines.push(`Schema: ${d.response.schema_url}`);
    lines.push("");
    if (d.response.example !== undefined && d.response.example !== null) {
      lines.push("Example response:", "", "```json", JSON.stringify(d.response.example, null, 2), "```", "");
    }
  }

  if (d.request?.curl) {
    lines.push("## Call it", "", "```bash", d.request.curl, "```", "");
  }

  if (d.related && d.related.length > 0) {
    lines.push(
      "## Related endpoints",
      "",
      ...d.related.map((r) => `- \`${r.id ?? r.path}\`${r.summary ? ` — ${r.summary}` : ""}`),
      "",
    );
  }

  if (d.links) {
    lines.push(
      "## Links",
      "",
      ...Object.entries(d.links).map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`),
    );
  }

  return lines.join("\n");
}

// ── capabilities ───────────────────────────────────────────────────────

interface CapabilityRow {
  param: string;
  family?: string;
  what: string;
  cost: string;
  values?: string[];
  free_values?: string[];
  metered_values?: string[];
  endpoints: string[];
}

function capabilityLines(c: CapabilityRow): string[] {
  const title = c.family ? `\`${c.param}\` (${c.family} rows)` : `\`${c.param}\``;
  const lines = [`## ${title}`, "", c.what, "", `**Cost:** ${c.cost}`];
  if (c.free_values && c.free_values.length > 0) lines.push(`**Free values:** ${c.free_values.join(", ")}`);
  if (c.metered_values && c.metered_values.length > 0) lines.push(`**Metered values:** ${c.metered_values.join(", ")}`);
  if (c.values && c.values.length > 0) lines.push(`**Values:** ${c.values.join(", ")}`);
  lines.push(
    `**Endpoints (${c.endpoints.length}):** ${c.endpoints.map((id) => `\`${id}\``).join(", ")}`,
    "",
  );
  return lines;
}

export function localCapabilities(param?: string): string {
  const all: CapabilityRow[] = capabilityIndex().map((c) => ({
    param: c.param,
    family: c.family,
    what: c.what,
    cost: c.cost,
    free_values: c.freeValues,
    metered_values: c.meteredValues,
    endpoints: c.endpoints,
  }));
  const rows = param ? all.filter((c) => c.param === param) : all;
  if (param && rows.length === 0) {
    return `Error: No capability '${param}'. Known: ${[...new Set(all.map((c) => c.param))].join(", ")}.`;
  }
  return [
    `# Cross-cutting parameters${param ? ` — \`${param}\`` : ""}`,
    "",
    LOCAL_NOTE,
    "",
    ...rows.flatMap(capabilityLines),
  ].join("\n");
}

function renderCapabilities(data: Record<string, unknown>): string {
  const d = data as { capabilities?: CapabilityRow[]; filters?: { param?: string | null } };
  const rows = d.capabilities ?? [];
  return [
    `# Cross-cutting parameters${d.filters?.param ? ` — \`${d.filters.param}\`` : ""}`,
    "",
    LIVE_NOTE,
    "",
    ...rows.flatMap(capabilityLines),
  ].join("\n");
}

// ── plan ───────────────────────────────────────────────────────────────

interface PlanStepRow {
  id?: string;
  method?: string;
  path?: string;
  params?: Record<string, string>;
  missing?: string[];
  binds?: Record<string, string>;
  depends_on?: string;
  body?: Record<string, unknown>;
  credits?: number | null;
  run?: string;
  notes?: string[];
  curl?: string;
}

function renderPlan(data: Record<string, unknown>, query: string): string {
  const d = data as {
    recipe?: string | null;
    uncertain?: boolean;
    reason?: string;
    confidence?: number;
    steps?: PlanStepRow[];
    ask?: { step: string; param: string }[];
    cannot?: string[];
    alternatives?: { endpoint: string; probability: number }[];
    cheaper?: string | null;
    deeper?: string | null;
  };
  const steps = d.steps ?? [];
  const lines: string[] = [`# Call plan — "${query}"`, "", LIVE_NOTE, ""];
  if (d.uncertain || steps.length === 0) {
    lines.push(
      `**No confident plan** (reason: \`${d.reason ?? "unknown"}\`). The planner never guesses a chain. Try \`socialcrawl_find\` with the job in plain words, or rephrase the job more concretely.`,
      "",
    );
  } else {
    const total = steps.reduce((n, st) => n + (st.credits ?? 0), 0);
    lines.push(
      `Recipe: \`${d.recipe ?? "?"}\` · confidence ${d.confidence ?? "?"} · ${steps.length} step${steps.length === 1 ? "" : "s"} · ${total} credits at published page prices (one call each).`,
      "",
    );
    steps.forEach((st, i) => {
      lines.push(
        `## ${i + 1}. \`${st.method ?? "GET"} ${st.path ?? "?"}\` — ${st.credits === null || st.credits === undefined ? "price on run" : `${st.credits}cr`} · ${st.run ?? ""}`,
        "",
      );
      if (st.params && Object.keys(st.params).length > 0) lines.push(`Params: \`${JSON.stringify(st.params)}\``);
      if (st.missing && st.missing.length > 0) lines.push(`Still needed: ${st.missing.map((m) => `\`${m}\``).join(", ")}`);
      if (st.binds) {
        lines.push(
          `Filled from earlier rows: ${Object.entries(st.binds).map(([k, v]) => `\`${k}\` ← \`${v}\``).join(", ")}`,
        );
      }
      if (st.body) lines.push(`Body: \`${JSON.stringify(st.body)}\``);
      for (const n of st.notes ?? []) lines.push(`- ${n}`);
      if (st.curl) lines.push("", "```bash", st.curl, "```");
      lines.push("");
    });
  }
  if (d.ask && d.ask.length > 0) {
    lines.push(`**Ask the user for:** ${d.ask.map((a) => `\`${a.param}\` (step ${a.step})`).join(", ")}`, "");
  }
  if (d.cannot && d.cannot.length > 0) lines.push("**Not available:**", ...d.cannot.map((c) => `- ${c}`), "");
  if (d.alternatives && d.alternatives.length > 0) {
    lines.push(`**Alternatives:** ${d.alternatives.map((a) => `\`${a.endpoint}\` (${a.probability})`).join(", ")}`, "");
  }
  if (d.cheaper) lines.push(`**Cheaper:** ${d.cheaper}`);
  if (d.deeper) lines.push(`**Deeper:** ${d.deeper}`);
  lines.push(
    "",
    "Run each step with `socialcrawl_request`, and quote any step exactly with `socialcrawl_estimate` (`id` plus `params`).",
  );
  return lines.join("\n");
}

// ── freshness ──────────────────────────────────────────────────────────

function renderFreshness(live: { platforms?: number; endpoints?: number } | null): string {
  if (!live) {
    return [
      "# Catalogue freshness — could not reach the live registry",
      "",
      "The check calls `GET /v1/utility/endpoints` (0 credits) and compares its live registry stats against this server's bundled catalogue. It needs a configured API key and network access.",
      "",
      `Bundled catalogue: **${REGISTRY_STATS.totalPlatforms} platforms, ${REGISTRY_STATS.totalEndpoints} endpoints** (socialcrawl-mcp v${SERVER_VERSION}, registry fingerprint \`${REGISTRY_FINGERPRINT.slice(0, 12)}\`).`,
    ].join("\n");
  }

  const samePlatforms = live.platforms === REGISTRY_STATS.totalPlatforms;
  const sameEndpoints = live.endpoints === REGISTRY_STATS.totalEndpoints;
  const current = samePlatforms && sameEndpoints;

  const lines = [
    `# Catalogue freshness — ${current ? "up to date" : "OUT OF DATE"}`,
    "",
    "| | Platforms | Endpoints |",
    "|---|-----------|-----------|",
    `| Live API | ${live.platforms ?? "?"} | ${live.endpoints ?? "?"} |`,
    `| This server (v${SERVER_VERSION}) | ${REGISTRY_STATS.totalPlatforms} | ${REGISTRY_STATS.totalEndpoints} |`,
    "",
    `Bundled registry fingerprint: \`${REGISTRY_FINGERPRINT.slice(0, 12)}\` (a hash of every endpoint's method, path and parameter names). Equal counts with a different backend fingerprint mean a parameter changed; \`action: "endpoint"\` always reads the live contract.`,
    "",
  ];

  if (current) {
    lines.push(
      "This server's bundled catalogue matches the live registry. Discovery, pricing, and validation answered from bundled data are current.",
    );
  } else {
    const dPlatforms = (live.platforms ?? 0) - REGISTRY_STATS.totalPlatforms;
    const dEndpoints = (live.endpoints ?? 0) - REGISTRY_STATS.totalEndpoints;
    lines.push(
      `The live API has **${dEndpoints >= 0 ? "+" : ""}${dEndpoints} endpoints** and **${dPlatforms >= 0 ? "+" : ""}${dPlatforms} platforms** relative to this server's bundled catalogue.`,
      "",
      "**What this means:** `socialcrawl_request` still calls the live API and works for any endpoint — but this server's *discovery* surfaces (`list_platforms`, `list_endpoints`, `pricing`, `get_docs`) and its local parameter validation are answering from a snapshot, so a newer endpoint will look unknown.",
      "",
      "**What to do:**",
      "- Upgrade the package: `npx -y socialcrawl-mcp@latest` (or bump the pinned version in your MCP client config).",
      "- Until then, use `socialcrawl_endpoint` with a key — it reads the live registry and is always correct.",
    );
  }

  return lines.join("\n");
}

// ── entrypoint ─────────────────────────────────────────────────────────

export async function discover(ctx: ApiContext, params: DiscoverParams): Promise<string> {
  const action = params.action ?? "quickstart";
  // Every /v1/utility/* endpoint is api-key-authed. Without a key (or with
  // `live: false`) we answer from bundled data rather than failing — discovery
  // is the one thing that must work before a key exists.
  const canGoLive = Boolean(ctx.apiKey) && params.live !== false;

  const paged = (text: string): string =>
    page(
      text,
      params.page ?? 1,
      (next) =>
        `Call socialcrawl_discover again with action "${action}" and page ${next} for the rest.`,
    );

  switch (action) {
    case "quickstart": {
      if (!canGoLive) return paged(localQuickstart(params.platform));
      const query: Record<string, string> = {};
      if (params.platform) query.platform = params.platform;
      const response = await makeRequest(ctx, {
        platform: "utility",
        resource: "quickstart",
        params: Object.keys(query).length > 0 ? query : undefined,
      });
      const data = envelopeData(response);
      if (!data) return paged(`${localQuickstart(params.platform)}\n\n> Live call failed: ${response.split("\n")[0]}`);
      return paged(renderQuickstart(data));
    }

    case "catalog": {
      if (!canGoLive) return paged(localCatalog(params));
      const query: Record<string, string> = {};
      if (params.platform) query.platform = params.platform;
      if (params.search) query.search = params.search;
      if (params.method) query.method = params.method.toUpperCase();
      const response = await makeRequest(ctx, {
        platform: "utility",
        resource: "endpoints",
        params: Object.keys(query).length > 0 ? query : undefined,
      });
      const data = envelopeData(response);
      if (!data) {
        // A 404 here is a real answer (unknown platform), not a transport
        // failure — surface it rather than masking it with local data.
        if (response.startsWith("Error:") && response.includes("not found")) return response;
        return paged(`${localCatalog(params)}\n\n> Live call failed: ${response.split("\n")[0]}`);
      }
      return paged(renderCatalog(data));
    }

    case "endpoint": {
      if (!params.id) {
        return 'Error: `action: "endpoint"` requires `id` — an endpoint id (`tiktok/profile`) or path (`/v1/tiktok/profile`).';
      }
      if (!canGoLive) return paged(localGuide(params.id, params.method));
      const query: Record<string, string> = { id: normalizeEndpointId(params.id) };
      if (params.method) query.method = params.method.toUpperCase();
      const response = await makeRequest(ctx, {
        platform: "utility",
        resource: "endpoint",
        params: query,
      });
      const data = envelopeData(response);
      if (!data) return paged(localGuide(params.id, params.method));
      return paged(renderGuide(data));
    }

    case "capabilities": {
      if (!canGoLive) return paged(localCapabilities(params.param));
      const response = await makeRequest(ctx, {
        platform: "utility",
        resource: "capabilities",
        params: params.param ? { param: params.param } : undefined,
      });
      const data = envelopeData(response);
      if (!data) {
        if (response.startsWith("Error:") && response.includes("No capability")) return response;
        return paged(`${localCapabilities(params.param)}\n\n> Live call failed: ${response.split("\n")[0]}`);
      }
      return paged(renderCapabilities(data));
    }

    case "plan": {
      const q = params.query?.trim();
      if (!q) {
        return 'Error: `action: "plan"` requires `query` — the job in plain words, e.g. "track mentions of Acme on TikTok and Reddit".';
      }
      if (!canGoLive) {
        return [
          `# Call plan — "${q}"`,
          "",
          LOCAL_NOTE,
          "",
          "`utility/plan` runs the planner server-side and has no bundled equivalent (it is free, but needs an API key). Without one: rank candidates with `socialcrawl_find`, then quote each with `socialcrawl_estimate` (`id` plus `params`).",
        ].join("\n");
      }
      const response = await makeRequest(ctx, {
        platform: "utility",
        resource: "plan",
        params: { query: q },
      });
      const data = envelopeData(response);
      if (!data) return response;
      return paged(renderPlan(data, q));
    }

    case "llms": {
      if (!canGoLive) {
        return [
          "# Agent context corpus",
          "",
          LOCAL_NOTE,
          "",
          "`utility/llms` is generated server-side and has no bundled equivalent. Without a key, read the static corpus directly:",
          "",
          "- https://www.socialcrawl.dev/llms.txt — short form",
          "- https://www.socialcrawl.dev/llms-full.txt — every endpoint",
          `- https://www.socialcrawl.dev/llms-${params.platform ?? "{platform}"}.txt — one platform`,
          "",
          "Or use `socialcrawl_endpoint` with `id: \"full\"` for the same ground truth from this server's bundled catalogue.",
        ].join("\n");
      }
      const query: Record<string, string> = {};
      if (params.platform) query.platform = params.platform;
      if (params.format) query.format = params.format;
      const response = await makeRequest(ctx, {
        platform: "utility",
        resource: "llms",
        params: Object.keys(query).length > 0 ? query : undefined,
      });
      const data = envelopeData(response);
      if (!data) return response;
      const content = (data as { content?: string; format?: string }).content;
      if (typeof content === "string") {
        return paged(`# Agent context corpus\n\n${LIVE_NOTE}\n\n${content}`);
      }
      return paged(
        `# Agent context corpus\n\n${LIVE_NOTE}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
      );
    }

    case "freshness": {
      if (!canGoLive) return renderFreshness(null);
      // Ask for a filter that matches nothing: the `stats` block is always the
      // whole-registry totals regardless of filter, so this returns the live
      // counts in a few hundred bytes instead of all 381 catalogue rows.
      const response = await makeRequest(ctx, {
        platform: "utility",
        resource: "endpoints",
        params: { search: " freshness-probe" },
      });
      const data = envelopeData(response);
      const stats = (data as { stats?: { platforms?: number; endpoints?: number } } | null)?.stats;
      return renderFreshness(stats ?? null);
    }

    case "status": {
      // `GET /v1/status` is a public meta route (`security: []`), not a
      // `/v1/utility/*` endpoint: it reports every platform's circuit-breaker
      // state. It is the right thing to read before retrying a persistent 502,
      // and it answers without a key — hence `anonymous`.
      const response = await apiRequest(ctx, {
        method: "GET",
        path: "/v1/status",
        anonymous: true,
        errorPlatform: "status",
      });
      return paged(renderStatus(response));
    }

    default:
      return `Error: Unknown action "${String(action)}". Valid actions: quickstart, catalog, endpoint, capabilities, plan, llms, freshness, status.`;
  }
}

/**
 * Render `GET /v1/status`: overall health first, then only the platforms that
 * are not operational, because a 65-row all-green table buries the one line
 * that matters.
 */
function renderStatus(response: string): string {
  const header = [
    "# SocialCrawl platform status",
    "",
    "> Live from `GET /v1/status` — every platform's circuit-breaker state and the upstream-version mix. Public meta route: no API key, no credit cost, no upstream call.",
    "",
  ].join("\n");

  if (response.startsWith("Error:")) return `${header}${response}`;

  let parsed: {
    status?: string;
    platforms?: Record<string, { status?: string }>;
    [k: string]: unknown;
  };
  try {
    parsed = JSON.parse(response) as typeof parsed;
  } catch {
    return `${header}${response}`;
  }

  const platforms = parsed.platforms ?? {};
  const entries = Object.entries(platforms);
  const impaired = entries.filter(([, v]) => v.status !== "operational");

  const lines = [header, `**Overall:** ${parsed.status ?? "unknown"}`, ""];
  if (entries.length > 0) {
    lines.push(
      `${entries.length - impaired.length} of ${entries.length} platforms operational.`,
      "",
    );
  }
  if (impaired.length > 0) {
    lines.push("| Platform | Status |", "|----------|--------|");
    for (const [slug, v] of impaired) lines.push(`| \`${slug}\` | ${v.status} | `);
    lines.push(
      "",
      "A `degraded` or `down` platform is the circuit breaker holding traffic off a failing upstream. Single-source endpoints there return 503 with a full refund; multi-source endpoints route around it. Retry after 30 seconds rather than hammering.",
      "",
    );
  } else if (entries.length > 0) {
    lines.push("No platform is degraded or down.", "");
  }

  lines.push("Full payload:", "", "```json", JSON.stringify(parsed, null, 2), "```");
  return lines.join("\n");
}

/** Exported for the coverage test: which utility resource each action calls. */
export const DISCOVER_ACTION_RESOURCES: Record<DiscoverAction, string | null> = {
  quickstart: "quickstart",
  catalog: "endpoints",
  endpoint: "endpoint",
  capabilities: "capabilities",
  plan: "plan",
  llms: "llms",
  freshness: "endpoints",
  // Not a utility endpoint — the public `/v1/status` meta route.
  status: null,
};

/** Exported so the pricing surface can note that discovery is free. */
export function discoveryEndpoints(): Endpoint[] {
  return getEndpointsByPlatform("utility").filter((e) => worstCaseCost(e.pricing) === 0);
}
