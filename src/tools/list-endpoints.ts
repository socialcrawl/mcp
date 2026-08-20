import { findPlatform, PLATFORMS } from "../data/platforms.js";
import { ENDPOINTS, getEndpointsByPlatform } from "../data/endpoints.js";
import { page } from "../paginate.js";
import {
  endpointLabel,
  formatCost,
  formatTtl,
  worstCaseCost,
} from "../pricing.js";
import type { Endpoint } from "../types.js";

export interface ListEndpointsParams {
  platform?: string;
  search?: string;
  method?: string;
  maxCost?: number;
  detail?: "compact" | "full";
  /** 1-based page for output longer than one response. */
  page?: number;
}

/**
 * Endpoint catalogue for one platform, or a cross-platform search when no
 * platform is given. `full` detail (the default for a single platform) prints
 * every parameter with its type, bounds, enum values, and couplings — the
 * things that decide whether a call 400s before it is ever billed.
 */

function optionalParamLine(e: Endpoint, opt: Endpoint["optionalParams"][number]): string {
  const bits: string[] = [];

  if (opt.type === "enum" && opt.enumValues) {
    bits.push(`enum: ${opt.enumValues.join("|")}`);
  } else {
    bits.push(opt.type);
  }
  if (opt.minimum !== undefined || opt.maximum !== undefined) {
    const lo = opt.minimum !== undefined ? opt.minimum : "";
    const hi = opt.maximum !== undefined ? opt.maximum : "";
    bits.push(`range ${lo}-${hi}`);
  }
  const csv = e.csvConstraints?.[opt.name];
  if (csv) {
    const csvBits: string[] = ["CSV"];
    if (csv.max !== undefined) csvBits.push(`max ${csv.max} entries`);
    if (csv.enumValues) csvBits.push(`each of ${csv.enumValues.join("|")}`);
    bits.push(csvBits.join(", "));
  }
  if (opt.in === "query" && e.method !== "GET") bits.push("query param");

  const suffixes: string[] = [];
  if (opt.requires) {
    suffixes.push(`Only honoured alongside \`${opt.requires}\` (400 without it).`);
  }
  if (opt.couplesWith) {
    suffixes.push(
      `Requires \`${opt.couplesWith.param}=${opt.couplesWith.value}\` (auto-injected when absent, 400 when it conflicts).`,
    );
  }
  if (opt.example) suffixes.push(`Example: \`${opt.example}\``);

  const desc = opt.description ? ` — ${opt.description}` : "";
  const tail = suffixes.length > 0 ? ` ${suffixes.join(" ")}` : "";
  return `- \`${opt.name}\` (${bits.join("; ")})${desc}${tail}`;
}

function detailBlock(e: Endpoint): string[] {
  const lines: string[] = [`### \`${e.method} ${e.resource}\` — ${formatCost(e.pricing)}`];

  if (e.description && e.description !== e.summary) {
    lines.push("", e.description);
  }

  if (e.params.length > 0) {
    lines.push("", e.method === "POST" ? "**Required** (JSON body unless noted):" : "**Required:**");
    for (const p of e.params) {
      const csv = e.csvConstraints?.[p.name];
      const csvNote = csv
        ? ` (CSV${csv.max !== undefined ? `, max ${csv.max} entries` : ""}${csv.enumValues ? `, each of ${csv.enumValues.join("|")}` : ""})`
        : "";
      lines.push(`- \`${p.name}\`${csvNote}: ${p.description} Example: \`${p.example}\``);
    }
  }

  for (const group of e.oneOfGroups) {
    lines.push(
      "",
      `**Constraint:** supply at least one of ${group.map((n) => `\`${n}\``).join(", ")}.`,
    );
  }

  if (e.optionalParams.length > 0) {
    lines.push("", "**Optional:**");
    for (const opt of e.optionalParams) lines.push(optionalParamLine(e, opt));
  }

  // Facts that change how a caller must drive the endpoint.
  const notes: string[] = [];
  if (e.pricing.model === "metered" && e.pricing.description) {
    notes.push(`**Metered:** ${e.pricing.description}`);
  }
  if (e.pagination) {
    notes.push(
      `**Paging:** ${e.pagination.style} style — pass \`cursor\` (universal alias for \`${e.pagination.nativeParam}\`)` +
        (e.pagination.limitParam
          ? `, page size via \`${e.pagination.limitParam}\`${e.pagination.limitMax !== undefined ? ` (max ${e.pagination.limitMax})` : ""}`
          : "") +
        `. Stop on \`pagination.has_more === false\`.`,
    );
  }
  if (e.paginatable) {
    notes.push("**Paging:** walks every page server-side — one call returns the complete set.");
  }
  if (e.collectUntilN) {
    notes.push(`**\`limit\` is collect-until-N**, not a page size: ${e.collectUntilN}`);
  }
  if (e.singlePage) {
    notes.push(`**Single page:** ${e.singlePage}`);
  }
  if (e.execution === "async") {
    notes.push("**Async:** submits a job (202) — poll for the result.");
  }
  if (e.streaming) {
    notes.push(
      e.streaming === "accept-header"
        ? "**Streaming:** send `Accept: text/event-stream` for SSE, or `application/json` for one sync envelope."
        : e.streaming === "always"
          ? "**Streaming:** always SSE — there is no sync variant."
          : `**Streaming:** streams SSE when \`${e.streaming}\`.`,
    );
  }
  if (e.emptyOn404) {
    notes.push("**Empty is not an error:** an upstream 404 here means zero items — returned as 200 `{items: []}` with the credit refunded.");
  }
  if (e.upstream.fallbackKinds && e.upstream.fallbackKinds.length > 0) {
    notes.push(
      `**Sources:** \`${e.upstream.kind}\` primary, falling back to ${e.upstream.fallbackKinds.map((k) => `\`${k}\``).join(", ")}.`,
    );
  }
  notes.push(
    `**Cache:** ${formatTtl(e.cache.ttlSeconds)} (\`${e.cache.category}\`) — a hit costs 0 credits.`,
  );
  if (e.contractDetails && e.contractDetails.length > 0) {
    notes.push(`**Contract:** ${e.contractDetails.join(" ")}`);
  }

  lines.push("", ...notes);
  lines.push("");
  return lines;
}

function summaryRow(e: Endpoint, withPlatform: boolean): string {
  let paramsCell: string;
  if (e.params.length > 0) {
    paramsCell = e.params.map((p) => `\`${p.name}\``).join(", ");
  } else if (e.oneOfGroups.length > 0) {
    paramsCell = e.oneOfGroups
      .map((g) => `one of ${g.map((n) => `\`${n}\``).join("/")}`)
      .join("; ");
  } else {
    paramsCell = "*(none)*";
  }
  if (e.optionalParams.length > 0) {
    paramsCell += ` +${e.optionalParams.length} optional`;
  }
  const label = withPlatform
    ? `/v1/${e.platform}/${e.resource}`
    : e.resource;
  return `| ${e.method} | \`${label}\` | ${paramsCell} | ${formatCost(e.pricing)} | ${e.archetype} | ${e.summary} |`;
}

/**
 * Page rather than truncate. A single platform can hold 44 endpoints whose full
 * parameter contract runs past the response limit, and "narrow your filters" is
 * not an answer when the caller wants the whole platform.
 */
function paged(text: string, input: ListEndpointsParams): string {
  const filters = [
    input.platform ? `platform "${input.platform}"` : null,
    input.search ? `search "${input.search}"` : null,
    input.method ? `method "${input.method}"` : null,
    input.maxCost !== undefined ? `maxCost ${input.maxCost}` : null,
    input.detail ? `detail "${input.detail}"` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return page(
    text,
    input.page ?? 1,
    (next) =>
      `Call socialcrawl_list_endpoints again with ${filters ? `${filters} and ` : ""}page ${next} for the rest. Or narrow the result with \`search\`, \`method\`, or \`maxCost\`, or use \`detail: "compact"\`.`,
  );
}

function searchAcrossPlatforms(params: ListEndpointsParams): string {
  const q = (params.search ?? "").toLowerCase();
  const matches = ENDPOINTS.filter((e) => {
    if (params.method && e.method !== params.method.toUpperCase()) return false;
    if (params.maxCost !== undefined && worstCaseCost(e.pricing) > params.maxCost) return false;
    if (params.platform && e.platform !== params.platform) return false;
    if (!q) return true;
    const haystack =
      `${e.platform} ${e.resource} ${e.summary} ${e.description} ${e.archetype} ${e.actionLabel ?? ""} ${e.group ?? ""} ${(e.tags ?? []).join(" ")}`.toLowerCase();
    return haystack.includes(q);
  });

  if (matches.length === 0) {
    return [
      `No endpoints match ${q ? `"${params.search}"` : "those filters"}.`,
      "",
      `Try a broader term, or \`socialcrawl_list_platforms\` to browse the ${PLATFORMS.length} platforms.`,
    ].join("\n");
  }

  const detail = params.detail ?? "compact";
  const lines: string[] = [
    `# Endpoint search${params.search ? ` — "${params.search}"` : ""}`,
    "",
    `${matches.length} of ${ENDPOINTS.length} endpoints match across ${new Set(matches.map((e) => e.platform)).size} platform(s).`,
    "",
    "| Method | Endpoint | Required params | Price | Response | Description |",
    "|--------|----------|-----------------|-------|----------|-------------|",
    ...matches.map((e) => summaryRow(e, true)),
  ];

  if (detail === "full") {
    lines.push("", "## Parameter details", "");
    for (const e of matches) {
      lines.push(`## \`/v1/${e.platform}/${e.resource}\``, "");
      lines.push(...detailBlock(e));
    }
  } else {
    lines.push(
      "",
      'Pass `detail: "full"` for every parameter, or call `socialcrawl_list_endpoints` with a single `platform` for that platform\'s full reference.',
    );
  }

  return paged(lines.join("\n"), params);
}

export function listEndpoints(params: ListEndpointsParams | string): string {
  // Back-compat: a bare platform slug string.
  const input: ListEndpointsParams =
    typeof params === "string" ? { platform: params } : params;

  if (!input.platform) {
    return searchAcrossPlatforms(input);
  }

  const platformInfo = findPlatform(input.platform);
  if (!platformInfo) {
    return `Error: Unknown platform "${input.platform}". Use socialcrawl_list_platforms to see available platforms.`;
  }

  // A search term alongside a platform narrows within that platform.
  if (input.search) {
    return searchAcrossPlatforms(input);
  }

  let endpoints = getEndpointsByPlatform(input.platform);
  if (input.method) {
    endpoints = endpoints.filter((e) => e.method === input.method!.toUpperCase());
  }
  if (input.maxCost !== undefined) {
    endpoints = endpoints.filter((e) => worstCaseCost(e.pricing) <= input.maxCost!);
  }
  if (endpoints.length === 0) {
    return `Error: No endpoints on platform "${input.platform}" match those filters.`;
  }

  const isWeb = input.platform === "web";
  const detail = input.detail ?? "full";

  const lines: string[] = [
    `# ${platformInfo.name} — ${endpoints.length} endpoint${endpoints.length === 1 ? "" : "s"}`,
    "",
    platformInfo.description,
    "",
    ...(isWeb
      ? [
          "> Call these through the **`socialcrawl_web`** tool (not `socialcrawl_request`). Each row's method + path maps to a `socialcrawl_web` action — e.g. `GET /scrape` → `action: \"scrape\"`, `GET /jobs/{job_id}` → `action: \"job_get\"` with `id`.",
          "",
        ]
      : []),
    "| Method | Resource | Required params | Price | Response | Description |",
    "|--------|----------|-----------------|-------|----------|-------------|",
    ...endpoints.map((e) => summaryRow(e, false)),
  ];

  // Group chips (web's Crawl Jobs / Monitors / Sessions rows) when declared.
  const groups = [...new Set(endpoints.map((e) => e.group).filter(Boolean))] as string[];
  if (groups.length > 0) {
    lines.push("", `**Groups:** ${groups.map((g) => `${g} (${endpoints.filter((e) => e.group === g).map((e) => `\`${endpointLabel(e)}\``).join(", ")})`).join(" · ")}`);
  }

  if (detail === "full") {
    lines.push("", "## Parameter details", "");
    for (const e of endpoints) lines.push(...detailBlock(e));
  }

  lines.push(
    isWeb
      ? "Call these through `socialcrawl_web` — pick the `action` matching the method + resource, pass parameters in `input`, and the path id (job/monitor/session) in `id`."
      : "Use `socialcrawl_request` with the platform, resource, and required parameters (POST batch endpoints take their array/object body in `body`) to make an API call. Use `socialcrawl_pricing` for exact costs and metered rules.",
  );

  return paged(lines.join("\n"), input);
}
