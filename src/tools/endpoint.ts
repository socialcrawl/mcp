import { apiRequest } from "../client.js";
import type { ApiContext } from "../context.js";
import { getAvailableTopics } from "../data/docs.js";
import { outputsFor, pagingFor } from "../data/outputs.js";
import { findPlatform, PLATFORMS } from "../data/platforms.js";
import { bestCaseCost, formatCost, worstCaseCost } from "../pricing.js";
import { errorFromText } from "../result.js";
import type { ToolOutput } from "../result.js";
import { didYouMean } from "../search/rank.js";
import { suggestEndpoints, suggestPlatforms } from "../search/catalog.js";
import { timeoutSecondsFor } from "../timeouts.js";
import { pageSizeOf } from "../walk-quote.js";
import type { Endpoint, OutputField } from "../types.js";
import { normalizeEndpointId } from "./discover.js";
import { getDocs } from "./get-docs.js";
import { listEndpoints } from "./list-endpoints.js";
import { resolveEndpoint } from "./request.js";
import { DISCOVERY_TIMEOUT_MS, noteRoute, routeMissing } from "../discovery-routes.js";

/**
 * `socialcrawl_endpoint` (MCP-04): the contract for one endpoint, so an agent
 * knows before it pays what to send and what comes back: purpose, params,
 * response rows and fields (at most MAX_FIELDS), cost, paging, latency,
 * timeout, next steps and a sample link. Built from the bundled registry data
 * (dump v4); with a key, `GET /v1/utility/endpoint` is read first and what it
 * adds (live price wording, outputs, next, latency) is laid over the bundled
 * contract. A 404 or any failure keeps the bundled one.
 *
 * The same tool answers a platform slug (its endpoint table) and a guide topic
 * (errors, pricing, pagination, ...), so docs need no tool of their own.
 */

export interface EndpointParams {
  id: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  page?: number;
}

export const MAX_FIELDS = 25;

const SITE = "https://www.socialcrawl.dev";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The public docs page that carries the endpoint's example response. */
export function sampleUrl(e: Pick<Endpoint, "platform" | "resource">): string {
  const resource = e.resource.replace(/\/\{[^}]+\}.*$/, "");
  return `${SITE}/platforms/${e.platform}/${resource.replace(/\//g, "-")}`;
}

/** The MCP resource that will carry an endpoint's redacted sample response (MCP-05). */
export function exampleUri(e: Pick<Endpoint, "platform" | "resource">): string {
  return `socialcrawl://example/${e.platform}/${e.resource}`;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Valid output fields only: an object with a string path and type; anything else is skipped. */
function cleanFields(raw: unknown): OutputField[] {
  if (!Array.isArray(raw)) return [];
  const out: OutputField[] = [];
  for (const f of raw) {
    if (!isObj(f) || typeof f.path !== "string" || typeof f.type !== "string") continue;
    out.push({
      path: f.path,
      type: f.type,
      nullable: f.nullable === true,
      meaning: str(f.meaning) ?? null,
      fill: num(f.fill) ?? null,
      live: typeof f.live === "boolean" ? f.live : null,
      ...(str(f.opt_in) ? { opt_in: str(f.opt_in) } : {}),
      ...(str(f.source_hint) ? { source_hint: str(f.source_hint) } : {}),
    });
  }
  return out;
}

/** Plain fields first (registry order), then fallback-only fields, then opt-in fields; nulls dropped. */
function pickFields(fields: OutputField[]): Record<string, unknown>[] {
  const rank = (f: OutputField): number => (f.opt_in ? 2 : f.source_hint ? 1 : 0);
  return [...fields]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .slice(0, MAX_FIELDS)
    .map(({ f }) => {
      const out: Record<string, unknown> = { path: f.path, type: f.type };
      if (f.nullable) out.nullable = true;
      if (f.meaning) out.meaning = f.meaning;
      if (f.fill !== null) out.fill = f.fill;
      if (f.opt_in) out.opt_in = f.opt_in;
      if (f.source_hint) out.source_hint = f.source_hint;
      return out;
    });
}

/**
 * One paging schema for the bundled and the live contract (the contract's
 * `paging` keys plus how to send the cursor): style, page_size and where it
 * came from, page_size_max, max_pages, per_n_items, price_basis,
 * cursor_param, limit_param, note.
 */
export interface Paging {
  style: string;
  page_size: number | null;
  page_size_source: string | null;
  observed_n: number | null;
  page_size_max: number | null;
  max_pages: number | null;
  per_n_items: string | null;
  price_basis: string | null;
  cursor_param: string | null;
  limit_param: string | null;
  note: string | null;
}

const PAGING_STYLES = new Set(["cursor", "offset", "page", "server_walk", "none"]);

function bundledPaging(e: Endpoint): Paging | null {
  const base = {
    page_size: null,
    page_size_source: null,
    observed_n: null,
    page_size_max: null,
    max_pages: null,
    per_n_items: null,
    price_basis: null,
    cursor_param: null,
    limit_param: null,
  };
  // The registry dump's paging block (page size precedence already applied).
  const p = pagingFor(e);
  const size = pageSizeOf(e);
  const facts = {
    page_size: size,
    page_size_source: size === null ? null : (p?.page_size_source ?? null),
    observed_n: p?.observed_n ?? null,
    page_size_max: p?.page_size_max ?? e.pagination?.limitMax ?? null,
    max_pages: p?.max_pages ?? null,
    per_n_items: p?.per_n_items ?? null,
    price_basis: p?.price_basis ?? null,
  };
  if (e.paginatable) {
    return { ...base, ...facts, style: "server_walk", note: "One call walks every page server-side." };
  }
  if (e.pagination) {
    return {
      ...facts,
      style: e.pagination.style,
      cursor_param: "cursor",
      limit_param: e.pagination.limitParam ?? null,
      note: p?.max_pages_when ?? (e.collectUntilN ? `limit is collect-until-N: ${e.collectUntilN}` : null),
    };
  }
  if (e.singlePage) return { ...base, style: "none", note: e.singlePage };
  return null;
}

/** A live `paging` block in the shared schema; undefined when malformed (keep the bundled one). */
function livePaging(raw: unknown, fallback: Paging | null): Paging | null | undefined {
  if (raw === null) return null;
  if (!isObj(raw) || typeof raw.style !== "string" || !PAGING_STYLES.has(raw.style)) return undefined;
  return {
    style: raw.style,
    page_size: num(raw.page_size) ?? null,
    page_size_source: str(raw.page_size_source) ?? null,
    observed_n: num(raw.observed_n) ?? null,
    page_size_max: num(raw.page_size_max) ?? fallback?.page_size_max ?? null,
    max_pages: num(raw.max_pages) ?? null,
    per_n_items: str(raw.per_n_items) ?? null,
    price_basis: str(raw.price_basis) ?? null,
    cursor_param: raw.style === "none" || raw.style === "server_walk" ? null : "cursor",
    limit_param: fallback?.limit_param ?? null,
    note: str(raw.max_pages_when) ?? fallback?.note ?? null,
  };
}

/** Next steps as `{ id, why, bind? }`; live entries name the target `to`. Malformed entries are skipped. */
function cleanNext(raw: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<Record<string, unknown>> = [];
  for (const n of raw) {
    if (!isObj(n)) continue;
    const id = str(n.to) ?? str(n.id);
    if (!id) continue;
    out.push({ id, ...(str(n.why) ? { why: str(n.why) } : {}), ...(isObj(n.bind) ? { bind: n.bind } : {}) });
  }
  return out;
}

/** The bundled contract for one endpoint. */
export function contractFor(e: Endpoint): Record<string, unknown> {
  const out = outputsFor(e);
  const contract: Record<string, unknown> = {
    purpose: e.purpose ? { ...e.purpose, summary: e.purpose.summary ?? e.summary } : { summary: e.summary },
    params: {
      required: e.params.map((p) => ({ name: p.name, description: p.description, example: p.example })),
      one_of: e.oneOfGroups,
      optional: e.optionalParams.map((p) => {
        const o: Record<string, unknown> = { name: p.name, type: p.type };
        if (p.enumValues) o.enum = p.enumValues;
        if (p.minimum !== undefined) o.min = p.minimum;
        if (p.maximum !== undefined) o.max = p.maximum;
        if (p.requires) o.requires = p.requires;
        if (p.couplesWith) o.couples_with = `${p.couplesWith.param}=${p.couplesWith.value}`;
        if (p.in && e.method !== "GET") o.in = p.in;
        if (p.description) o.description = p.description;
        if (p.example) o.example = p.example;
        return o;
      }),
    },
    outputs: out
      ? {
          archetype: out.archetype,
          rows_at: out.rows_at,
          source: out.source,
          ...(out.inferred_from ? { inferred_from: out.inferred_from } : {}),
          fields: pickFields(out.fields),
          fields_total: out.fields.length,
          page_level: out.page_level,
          never_filled: out.never_filled,
        }
      : { archetype: e.archetype, rows_at: e.responseShape ? `${e.responseShape.root}` : null, source: "unknown", fields: [], fields_total: 0 },
    cost: {
      label: formatCost(e.pricing),
      model: e.pricing.model,
      tier: e.pricing.tier,
      min: bestCaseCost(e.pricing),
      max: worstCaseCost(e.pricing),
      ...(e.pricing.description ? { rule: e.pricing.description } : {}),
      cache_ttl_s: e.cache.ttlSeconds,
    },
    paging: bundledPaging(e),
    timeout_s: timeoutSecondsFor(e),
    next: (e.related ?? []).map((r) => ({ id: r.id, why: r.why })),
    sample: sampleUrl(e),
    sample_resource: exampleUri(e),
  };
  if (e.latency_ms) contract.latency_ms = e.latency_ms;
  if (e.execution && e.execution !== "sync") contract.execution = e.execution;
  if (e.streaming) contract.streaming = e.streaming;
  return contract;
}

/**
 * Lay what the live answer adds over the bundled contract. Reads the older
 * guide keys at the top of `data` (credits, links) and then the Phase-1
 * contract under `data.contract` (purpose, outputs, cost, paging, latency_ms,
 * next, freshness). Every block is checked; a malformed one is skipped, never
 * thrown on. True when anything was used.
 */
function overlay(contract: Record<string, unknown>, data: Record<string, unknown>, bundledPaths: string[] = []): boolean {
  let used = false;
  const cost = contract.cost as Record<string, unknown>;
  if (isObj(data.credits)) {
    if (str(data.credits.label)) (cost.label = data.credits.label), (used = true);
    if (str(data.credits.pricing_notes)) (cost.rule = data.credits.pricing_notes), (used = true);
  }
  if (isObj(data.links) && str(data.links.docs)) (contract.sample = data.links.docs), (used = true);

  // The older guide carried next / latency at the top; the contract nests them.
  const blocks: Record<string, unknown>[] = [data];
  if (isObj(data.contract)) blocks.push(data.contract);
  for (const c of blocks) {
    if (isObj(c.purpose) && str(c.purpose.summary)) (contract.purpose = c.purpose), (used = true);
    if (isObj(c.outputs)) {
      const fields = cleanFields(c.outputs.fields);
      const prev = contract.outputs as Record<string, unknown>;
      // A deployed API can lag this release's field list: a live list that is empty, or only a
      // part of the bundled one, would hide fields this server already knows. Keep the bundled list then.
      const bundled = new Set(bundledPaths);
      const stale = bundled.size > 0 && fields.length < bundled.size && fields.every((f) => bundled.has(f.path));
      if ((fields.length > 0 || c.outputs.source === "unknown") && !stale) {
        contract.outputs = {
          archetype: str(c.outputs.archetype) ?? prev.archetype,
          rows_at: str(c.outputs.rows_at) ?? prev.rows_at ?? null,
          source: str(c.outputs.source) ?? prev.source,
          fields: pickFields(fields),
          fields_total: fields.length,
          page_level: Array.isArray(c.outputs.page_level) ? c.outputs.page_level.filter((x) => typeof x === "string") : prev.page_level ?? [],
          never_filled: Array.isArray(c.outputs.never_filled) ? c.outputs.never_filled.filter((x) => typeof x === "string") : prev.never_filled ?? [],
        };
        used = true;
      }
    }
    const next = cleanNext(c.next);
    // A contract's explicit empty list means "no next step"; an all-malformed one is ignored.
    if (next && (next.length > 0 || (c === data.contract && Array.isArray(c.next) && c.next.length === 0))) (contract.next = next), (used = true);
    if (isObj(c.latency_ms) && num(c.latency_ms.p50) !== undefined && num(c.latency_ms.p95) !== undefined) {
      contract.latency_ms = c.latency_ms;
      const rec = num(c.latency_ms.recommended_timeout_s);
      if (rec && rec > 0) contract.timeout_s = Math.min(120, rec);
      used = true;
    }
    if ("paging" in c) {
      const p = livePaging(c.paging, contract.paging as Paging | null);
      if (p !== undefined) (contract.paging = p), (used = true);
    }
    if (isObj(c.cost)) {
      if (str(c.cost.rule)) cost.rule = c.cost.rule;
      if (num(c.cost.min) !== undefined) cost.min = c.cost.min;
      if (num(c.cost.max) !== undefined) cost.max = c.cost.max;
      if (Array.isArray(c.cost.levers)) cost.levers = c.cost.levers.filter((x) => typeof x === "string");
      used = true;
    }
    if (isObj(c.freshness) && num(c.freshness.cache_ttl_s) !== undefined) (cost.cache_ttl_s = c.freshness.cache_ttl_s), (used = true);
    const rto = num(c.recommended_timeout_s);
    if (rto && rto > 0) (contract.timeout_s = Math.min(120, rto)), (used = true);
  }
  return used;
}

async function liveGuide(ctx: ApiContext, e: Endpoint): Promise<Record<string, unknown> | undefined> {
  if (!ctx.apiKey || routeMissing(ctx.baseUrl, "/v1/utility/endpoint")) return undefined;
  const query: Record<string, string> = { id: `${e.platform}/${e.resource}` };
  if (e.method !== "GET") query.method = e.method;
  const response = await apiRequest(ctx, { method: "GET", path: "/v1/utility/endpoint", query, raw: true, timeoutMs: DISCOVERY_TIMEOUT_MS });
  noteRoute(ctx.baseUrl, "/v1/utility/endpoint", response);
  if (/^Error(?::| \(\d+\):)/.test(response)) return undefined;
  try {
    const parsed = JSON.parse(response) as unknown;
    if (!isObj(parsed) || parsed.success === false || !isObj(parsed.data)) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

function errorOutput(text: string): ToolOutput {
  return { text, structured: errorFromText(text) };
}

function didYouMeanBlock(items: string[]): string[] {
  return items.length > 0 ? ["", "Did you mean:", ...items.map((s) => `- \`${s}\``)] : [];
}

export async function endpointStructured(ctx: ApiContext, params: EndpointParams): Promise<ToolOutput> {
  const key = normalizeEndpointId(params.id);
  const slash = key.indexOf("/");

  if (slash === -1) {
    if (findPlatform(key)) {
      const pageHint = (next: number): string => `Call socialcrawl_endpoint again with id "${key}" and page ${next} for the rest.`;
      return { text: listEndpoints({ platform: key, detail: "compact", page: params.page, pageHint }), structured: { ok: true, id: key } };
    }
    if (getAvailableTopics().includes(key)) {
      return { text: getDocs(key, params.page ?? 1), structured: { ok: true, id: key } };
    }
    const near = didYouMean(key, [...getAvailableTopics(), ...PLATFORMS.map((p) => p.slug)]);
    return errorOutput(
      [`Error: Unknown endpoint, platform or topic "${params.id}". Use 'platform/resource', a platform slug, or a topic.`, ...didYouMeanBlock(near)].join("\n"),
    );
  }

  const platform = key.slice(0, slash);
  const resource = key.slice(slash + 1);
  if (!findPlatform(platform)) {
    return errorOutput([`Error: Unknown platform "${platform}".`, ...didYouMeanBlock(suggestPlatforms(platform))].join("\n"));
  }
  const resolved = resolveEndpoint(platform, resource, params.method);
  if (!resolved) {
    const near = suggestEndpoints(platform, resource).map((id) => id.slice(platform.length + 1));
    return errorOutput(
      [`Error: Unknown resource "${resource}" for platform "${platform}"${params.method ? ` (${params.method})` : ""}.`, ...didYouMeanBlock(near)].join("\n"),
    );
  }

  const e = resolved.endpoint;
  const contract = contractFor(e);
  const live = await liveGuide(ctx, e);
  const isLive = live !== undefined && overlay(contract, live, (outputsFor(e)?.fields ?? []).map((f) => f.path));
  const id = `${e.platform}/${e.resource}`;
  const structured = { ok: true, id, method: e.method, source: isLive ? "live" : "bundled", contract };
  return { text: render(id, e, contract, isLive), structured };
}

function render(id: string, e: Endpoint, c: Record<string, unknown>, live: boolean): string {
  const purpose = c.purpose as Record<string, string | null>;
  const params = c.params as {
    required: Array<{ name: string; example: string }>;
    one_of: string[][];
    optional: Array<Record<string, unknown>>;
  };
  const out = c.outputs as {
    archetype: string;
    rows_at: string | null;
    source?: string;
    fields: Array<Record<string, unknown>>;
    fields_total: number;
    page_level?: string[];
  };
  const cost = c.cost as Record<string, unknown>;
  const lines: string[] = [`${id} (${e.method}) - ${purpose.summary ?? e.summary}${live ? " [live]" : ""}`];
  if (purpose.returns) lines.push(`Returns: ${purpose.returns}`);
  if (purpose.use_when) lines.push(`Use when: ${purpose.use_when}`);
  if (purpose.not_for) lines.push(purpose.not_for);
  lines.push(`Cost: ${String(cost.label)}${cost.rule ? `. ${String(cost.rule)}` : ""} Cache ${String(cost.cache_ttl_s)}s.`);

  const req = params.required.map((p) => `${p.name} (e.g. ${p.example})`);
  const oneOf = params.one_of.map((g) => `one of ${g.join("|")}`);
  lines.push(`Required: ${[...req, ...oneOf].join("; ") || "none"}`);
  if (params.optional.length > 0) {
    const opt = params.optional.map((o) => {
      const bits: string[] = [];
      if (Array.isArray(o.enum)) bits.push((o.enum as string[]).join("|"));
      else bits.push(String(o.type));
      if (o.min !== undefined || o.max !== undefined) bits.push(`${o.min ?? ""}-${o.max ?? ""}`);
      if (o.requires) bits.push(`needs ${String(o.requires)}`);
      return `${String(o.name)} (${bits.join(", ")})`;
    });
    lines.push(`Optional: ${opt.join(", ")}`);
  }

  if (out.source === "unknown" || out.fields_total === 0) {
    lines.push(
      `Response: ${out.archetype}${out.rows_at ? `, rows at ${out.rows_at}` : ""}. Fields not published yet — see the sample response (${String(c.sample_resource ?? exampleUri(e))}, or ${String(c.sample)}) or call it once with a small limit.`,
    );
  } else {
    lines.push(
      `Response: ${out.archetype}${out.rows_at ? `, rows at ${out.rows_at}` : ""}; ${out.fields.length} of ${out.fields_total} fields${out.source === "inferred_sample" ? " (inferred from a sample)" : ""}. Use these paths as \`fields\`:`,
    );
  }
  for (const f of out.fields) {
    const extra = [f.opt_in ? `opt-in ${String(f.opt_in)}` : "", f.source_hint ? String(f.source_hint) : "", typeof f.fill === "number" ? `fill ${f.fill}` : ""]
      .filter(Boolean)
      .join(", ");
    lines.push(`- ${String(f.path)} ${String(f.type)}${f.nullable ? "?" : ""}${f.meaning ? `: ${String(f.meaning)}` : ""}${extra ? ` (${extra})` : ""}`);
  }
  if (out.page_level && out.page_level.length > 0) lines.push(`Page-level: ${out.page_level.join(", ")}`);

  const pg = c.paging as Record<string, unknown> | null;
  if (pg) {
    lines.push(
      pg.style === "none" || pg.style === "server_walk"
        ? `Paging: ${String(pg.note ?? pg.style)}`
        : `Paging: ${String(pg.style)}${pg.page_size ? `, ${String(pg.page_size)}/page` : ""}${pg.max_pages ? `, at most ${String(pg.max_pages)} pages` : ""}; send paging.next_cursor as cursor${pg.limit_param ? `, page size via ${String(pg.limit_param)}${pg.page_size_max !== null ? ` (max ${String(pg.page_size_max)})` : ""}` : ""}${pg.per_n_items ? `; N rows cost ${String(pg.per_n_items)}` : ""}; stop when has_more is false. Walk many pages with socialcrawl_collect.`,
    );
  }
  const lat = c.latency_ms as Record<string, number> | undefined;
  lines.push(`Latency: ${lat ? `p50 ${(lat.p50 / 1000).toFixed(1)}s, p95 ${(lat.p95 / 1000).toFixed(1)}s; ` : ""}timeout ${String(c.timeout_s)}s.`);
  const next = (c.next as Array<{ id: string; why?: string }>) ?? [];
  if (next.length > 0) lines.push(`Next: ${next.map((n) => `${n.id}${n.why ? ` (${n.why})` : ""}`).join("; ")}`);
  lines.push(`Sample response: ${String(c.sample)}`);
  lines.push(
    e.platform === "web"
      ? "Call it with socialcrawl_manage, area web."
      : `Call it with socialcrawl_request { platform: "${e.platform}", resource: "${e.resource}"${e.method !== "GET" ? `, method: "${e.method}"` : ""}, params }.`,
  );
  return lines.join("\n");
}
