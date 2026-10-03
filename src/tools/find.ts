import { apiRequest } from "../client.js";
import { DISCOVERY_TIMEOUT_MS, noteRoute, routeMissing } from "../discovery-routes.js";
import type { ApiContext } from "../context.js";
import { findPlatform, PLATFORMS } from "../data/platforms.js";
import { localQuote, fetchEstimateData } from "../cost-guard.js";
import { bestCaseCost, formatCost, worstCaseCost } from "../pricing.js";
import { errorFromText } from "../result.js";
import type { ToolOutput } from "../result.js";
import { searchTasks, suggestPlatforms } from "../search/catalog.js";
import type { ManageDoc } from "../search/manage-docs.js";
import type { Endpoint } from "../types.js";
import { listEndpoints } from "./list-endpoints.js";
import { listPlatforms } from "./list-platforms.js";
import { JOB_ACTION_RESOURCES } from "./manage.js";
import { normalizeEndpointId } from "./discover.js";
import { resolveEndpoint } from "./request.js";
import { WEB_ACTION_RESOURCES } from "./web.js";

/**
 * `socialcrawl_find` (MCP-04): a task in plain words → the few endpoints that
 * answer it, each with the params the task already supplies, the ones still
 * missing, what it costs, and the exact call to make.
 *
 * With a key it asks the live API first: `GET /v1/utility/find` for the
 * ranking and `GET /v1/utility/resolve` for any URL or @handle in the task.
 * Neither is deployed yet, so a 404 (or any failure) falls back to the bundled
 * ranker (`search/rank.ts`) and to filling the URL / handle locally. A metered
 * candidate is quoted through `GET /v1/utility/estimate` with the filled
 * params, else locally. Every route here is free.
 */

export interface FindParams {
  task?: string;
  platform?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 3;
/** Candidates ranked before the resolve reorder and the limit cut. */
const POOL = 20;

const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const HANDLE_RE = /(^|[\s(,])@([A-Za-z0-9_.]{2,64})/g;
const QUOTED_RE = /"([^"]{2,200})"|“([^”]{2,200})”/;

/** Hosts whose label is not the platform slug. */
const HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)youtu\.be$/, "youtube"],
  [/(^|\.)x\.com$/, "twitter"],
  [/(^|\.)fb\.(com|watch)$/, "facebook"],
  [/(^|\.)redd\.it$/, "reddit"],
  [/^news\.ycombinator\.com$/, "hackernews"],
  [/^apps\.apple\.com$/, "app_store"],
  [/^play\.google\.com$/, "google_play"],
  [/(^|\.)threads\.(net|com)$/, "threads"],
];

/** Platforms that take any site's URL, so a URL from elsewhere still fills them. */
const ANY_URL_PLATFORMS = new Set(["web", "prism", "search", "tavily", "on_page", "content_analysis"]);


/** Params an @handle in the task fills, first one the endpoint declares. */
const HANDLE_PARAMS = ["handle", "username", "user", "screen_name", "user_name", "author_username"];

/** Query params a quoted phrase in the task fills. */
const TEXT_PARAMS = ["query", "keyword", "q", "term"];

/** The platform a URL belongs to, from its host. */
export function platformFromUrl(raw: string): string | undefined {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  for (const [re, slug] of HOSTS) if (re.test(host)) return slug;
  const labels = host.split(".");
  return PLATFORMS.find((p) => labels.includes(p.slug) || labels.includes(p.slug.replace(/_/g, "")))?.slug;
}

interface TaskFacts {
  urls: string[];
  handles: string[];
  /** `r/<name>` in the task. */
  subreddit?: string;
  quoted?: string;
  /** The task with URLs and handles taken out, plus the URLs' platform names, for the ranker. */
  rankQuery: string;
  urlPlatforms: string[];
}

export function readTask(task: string): TaskFacts {
  const urls = (task.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)\]]+$/, ""));
  let rest = task.replace(URL_RE, " ");
  const handles: string[] = [];
  rest = rest.replace(HANDLE_RE, (_m, lead: string, h: string) => {
    handles.push(h.replace(/\.+$/, ""));
    return lead;
  });
  const sub = /(?:^|[\s(])\/?r\/([A-Za-z0-9_]{2,21})\b/.exec(rest);
  const q = QUOTED_RE.exec(rest);
  const urlPlatforms = [...new Set(urls.map(platformFromUrl).filter((p): p is string => !!p))];
  const names = urlPlatforms.map((slug) => findPlatform(slug)?.name ?? slug);
  return {
    urls,
    handles,
    ...(sub ? { subreddit: sub[1] } : {}),
    quoted: q ? (q[1] ?? q[2]) : undefined,
    rankQuery: [rest, ...names].join(" ").replace(/\s+/g, " ").trim(),
    urlPlatforms,
  };
}

interface Resolved {
  input: string;
  platform: string | null;
  kind?: string;
  confidence?: string;
  canonical: Record<string, string>;
  endpoints: Array<{ id: string; param: string; credits?: number }>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function dataOf(response: string): unknown {
  if (/^Error(?::| \(\d+\):)/.test(response)) return undefined;
  try {
    const parsed = JSON.parse(response) as unknown;
    if (!isObj(parsed) || parsed.success === false) return undefined;
    return parsed.data ?? parsed;
  } catch {
    return undefined;
  }
}

/**
 * GET a free discovery route: skipped once it has answered 404 in this process,
 * and given up after DISCOVERY_TIMEOUT_MS. The payload's `data`, or undefined.
 */
async function discoveryGet(ctx: ApiContext, path: string, query: Record<string, string>): Promise<unknown> {
  if (!ctx.apiKey || routeMissing(ctx.baseUrl, path)) return undefined;
  const response = await apiRequest(ctx, { method: "GET", path, query, raw: true, timeoutMs: DISCOVERY_TIMEOUT_MS });
  noteRoute(ctx.baseUrl, path, response);
  return dataOf(response);
}

/** `GET /v1/utility/resolve` for the task's URLs and handles; [] when absent or not deployed. */
async function resolveInputs(ctx: ApiContext, inputs: string[]): Promise<Resolved[]> {
  if (inputs.length === 0 || !ctx.apiKey) return [];
  const query: Record<string, string> = inputs.length === 1 ? { input: inputs[0] } : { inputs: inputs.join(",") };
  const data = await discoveryGet(ctx, "/v1/utility/resolve", query);
  const rows = isObj(data) && Array.isArray(data.results) ? data.results : [];
  return rows.filter(isObj).map((r) => ({
    input: String(r.input ?? ""),
    platform: typeof r.platform === "string" ? r.platform : null,
    kind: typeof r.kind === "string" ? r.kind : undefined,
    confidence: typeof r.confidence === "string" ? r.confidence : undefined,
    canonical: isObj(r.canonical)
      ? Object.fromEntries(Object.entries(r.canonical).filter(([, v]) => typeof v === "string")) as Record<string, string>
      : {},
    endpoints: Array.isArray(r.endpoints)
      ? r.endpoints.filter(isObj).map((e) => ({ id: String(e.id), param: String(e.param), credits: typeof e.credits === "number" ? e.credits : undefined }))
      : [],
  }));
}

/**
 * How sure the API is of a match (top level and per row): `uncertain` with
 * `reason` ("no_match" keyword guesses, "not_a_data_job"), the ranker that
 * produced it (`source`, e.g. "lexical"), `confidence` (null when unknown) and
 * a `note`. Passed through as given, so a guess never reads as a hit.
 */
interface MatchMeta {
  uncertain?: boolean;
  reason?: string;
  source?: string;
  confidence?: number | null;
  note?: string;
}

function readMeta(o: Record<string, unknown>): MatchMeta {
  const m: MatchMeta = {};
  if (typeof o.uncertain === "boolean") m.uncertain = o.uncertain;
  if (typeof o.reason === "string") m.reason = o.reason;
  if (typeof o.source === "string") m.source = o.source;
  if ("confidence" in o && (o.confidence === null || (typeof o.confidence === "number" && Number.isFinite(o.confidence)))) {
    m.confidence = o.confidence as number | null;
  }
  if (typeof o.note === "string") m.note = o.note;
  return m;
}

interface ApiHit {
  id: string;
  method?: string;
  summary?: string;
  why?: string;
  meta: MatchMeta;
}

interface ApiFindAnswer {
  hits: ApiHit[];
  /** The payload's top-level match facts. */
  meta: MatchMeta;
}

/**
 * `GET /v1/utility/find`. Undefined only when there is no answer to use (not
 * deployed, network error, timeout, unparseable, or an empty list with no
 * reason), so the caller falls back to the bundled ranker. An empty list WITH
 * a reason ("not_a_data_job") is the answer and is returned as such.
 */
async function apiFind(ctx: ApiContext, params: FindParams, limit: number): Promise<ApiFindAnswer | undefined> {
  if (!ctx.apiKey || !params.task) return undefined;
  const query: Record<string, string> = { task: params.task, limit: String(Math.max(limit, DEFAULT_LIMIT)) };
  if (params.platform) query.platform = params.platform;
  const data = await discoveryGet(ctx, "/v1/utility/find", query);
  const list = Array.isArray(data)
    ? data
    : isObj(data)
      ? [data.results, data.candidates, data.endpoints, data.matches].find(Array.isArray)
      : undefined;
  if (!list) return undefined;
  const meta = isObj(data) ? readMeta(data) : {};
  const hits: ApiHit[] = [];
  for (const item of list) {
    if (!isObj(item)) continue;
    const raw = item.id ?? item.endpoint ?? (item.platform && item.resource ? `${item.platform}/${item.resource}` : undefined);
    if (typeof raw !== "string") continue;
    hits.push({
      id: normalizeEndpointId(raw),
      method: typeof item.method === "string" ? item.method.toUpperCase() : undefined,
      summary: typeof item.summary === "string" ? item.summary : undefined,
      why: typeof item.why === "string" ? item.why : undefined,
      meta: readMeta(item),
    });
  }
  if (hits.length > 0 || meta.reason) return { hits, meta };
  return undefined;
}

/** A task that names a chain of steps ("... and then ...", "for each ..."). */
const MULTI_STEP = /\b(then|after that|followed by|for each|for every|each of (their|those|the))\b|->|→|;/i;

interface PlanHit {
  id: string;
  method?: string;
  params: Record<string, string>;
  missing: string[];
  binds?: Record<string, string>;
  credits?: number | null;
}

/** `GET /v1/utility/plan` for a multi-step task; undefined when absent, uncertain or empty. */
async function apiPlan(ctx: ApiContext, task: string): Promise<PlanHit[] | undefined> {
  const data = await discoveryGet(ctx, "/v1/utility/plan", { query: task });
  if (!isObj(data) || data.uncertain === true || !Array.isArray(data.steps)) return undefined;
  const hits: PlanHit[] = [];
  for (const st of data.steps) {
    if (!isObj(st) || typeof st.path !== "string") continue;
    const strings = (v: unknown): Record<string, string> =>
      isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Record<string, string> : {};
    hits.push({
      id: normalizeEndpointId(st.path),
      method: typeof st.method === "string" ? st.method.toUpperCase() : undefined,
      params: strings(st.params),
      missing: Array.isArray(st.missing) ? st.missing.filter((m): m is string => typeof m === "string") : [],
      ...(isObj(st.binds) ? { binds: strings(st.binds) } : {}),
      credits: typeof st.credits === "number" ? st.credits : null,
    });
  }
  return hits.length > 0 ? hits : undefined;
}

function bundled(id: string, method?: string): Endpoint | undefined {
  const slash = id.indexOf("/");
  if (slash === -1) return undefined;
  return resolveEndpoint(id.slice(0, slash), id.slice(slash + 1), method)?.endpoint;
}

const paramNames = (e: Endpoint): string[] => [...e.params.map((p) => p.name), ...e.optionalParams.map((p) => p.name)];

/** Params this task already supplies for this endpoint. */
function fill(e: Endpoint, facts: TaskFacts, resolved: Resolved[]): Record<string, string> {
  const id = `${e.platform}/${e.resource}`;
  for (const r of resolved) {
    const lane = r.endpoints.find((x) => x.id === id);
    if (lane) {
      const value = r.canonical[lane.param] ?? (lane.param === "url" ? r.canonical.url ?? r.input : undefined) ?? r.input;
      return { [lane.param]: value };
    }
  }
  const names = new Set(paramNames(e));
  const out: Record<string, string> = {};
  const url = facts.urls.find((u) => {
    const p = platformFromUrl(u);
    return !p || p === e.platform || ANY_URL_PLATFORMS.has(e.platform);
  });
  if (url && names.has("url")) out.url = url;
  else if (facts.handles.length > 0) {
    const handleParam = HANDLE_PARAMS.find((n) => names.has(n));
    if (handleParam) out[handleParam] = facts.handles[0];
  }
  if (facts.subreddit && names.has("subreddit")) out.subreddit = facts.subreddit;
  if (facts.quoted) {
    const textParam = TEXT_PARAMS.find((n) => names.has(n));
    if (textParam) out[textParam] = facts.quoted;
  }
  return out;
}

function missing(e: Endpoint, filled: Record<string, string>): string[] {
  const out = e.params.filter((p) => p.required && filled[p.name] === undefined).map((p) => p.name);
  for (const group of e.oneOfGroups) {
    if (!group.some((n) => filled[n] !== undefined)) out.push(group.join("|"));
  }
  return out;
}

/** The tool call that runs this endpoint. */
function callFor(e: Endpoint, filled: Record<string, string>): Record<string, unknown> {
  if (e.platform === "web") {
    const action = WEB_ACTION_RESOURCES.find((a) => a.resource === e.resource && a.method === e.method)?.action;
    return { tool: "socialcrawl_manage", arguments: { area: "web", action: action ?? e.resource, input: filled } };
  }
  // Prism background jobs are run through socialcrawl_manage's jobs area.
  const job = e.platform === "prism" ? JOB_ACTION_RESOURCES.find((a) => a.resource === e.resource && a.method === e.method) : undefined;
  if (job) {
    const { job_id, ...input } = filled;
    return { tool: "socialcrawl_manage", arguments: { area: "jobs", action: job.action, ...(job_id ? { id: job_id } : {}), input } };
  }
  return {
    tool: "socialcrawl_request",
    arguments: {
      platform: e.platform,
      resource: e.resource,
      ...(e.method !== "GET" ? { method: e.method } : {}),
      params: filled,
    },
  };
}

/** Example values for the params still missing, so a quote prices a representative call. */
function withExamples(e: Endpoint, filled: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of e.params) if (p.example) out[p.name] = p.example;
  for (const group of e.oneOfGroups) {
    if (group.some((n) => filled[n] !== undefined)) continue;
    const opt = e.optionalParams.find((o) => group.includes(o.name) && o.example);
    if (opt?.example) out[opt.name] = opt.example;
  }
  return { ...out, ...filled };
}

async function credits(ctx: ApiContext, e: Endpoint, filled: Record<string, string>): Promise<Record<string, unknown>> {
  const local = {
    min: bestCaseCost(e.pricing),
    max: worstCaseCost(e.pricing),
    label: formatCost(e.pricing),
    hold: localQuote(e, filled),
    source: "local",
  };
  if (!ctx.apiKey || e.pricing.model !== "metered") return local;
  const est = await fetchEstimateData(ctx, {
    id: `${e.platform}/${e.resource}`,
    method: e.method,
    params: e.method === "GET" ? withExamples(e, filled) : undefined,
    body: e.method === "GET" ? undefined : withExamples(e, filled),
  });
  if (!est || est.valid === false || typeof est.hold !== "number") return local;
  return { ...local, estimate: est.hold, source: "api" };
}

function errorOutput(text: string): ToolOutput {
  return { text, structured: errorFromText(text) };
}

export async function findStructured(ctx: ApiContext, params: FindParams): Promise<ToolOutput> {
  const limit = params.limit ?? DEFAULT_LIMIT;
  if (params.platform && !findPlatform(params.platform)) {
    const near = suggestPlatforms(params.platform);
    return errorOutput(
      [`Error: Unknown platform "${params.platform}".`, ...(near.length > 0 ? ["", "Did you mean:", ...near.map((s) => `- \`${s}\``)] : [])].join("\n"),
    );
  }

  const task = params.task?.trim();
  if (!task) {
    if (params.platform) {
      const slug = params.platform;
      const pageHint = (next: number): string => `Call socialcrawl_endpoint with id "${slug}" and page ${next} for the rest.`;
      return { text: listEndpoints({ platform: slug, detail: "compact", pageHint }), structured: { ok: true, source: "local" } };
    }
    return { text: listPlatforms(), structured: { ok: true, source: "local" } };
  }

  const facts = readTask(task);
  const [api, resolved] = await Promise.all([
    apiFind(ctx, params, limit),
    resolveInputs(ctx, [...facts.urls, ...facts.handles.map((h) => `@${h}`)]),
  ]);
  const apiHits = api && api.hits.length > 0 ? api.hits : undefined;
  const topMeta = api?.meta ?? {};
  // The API answered with no endpoints and a reason (e.g. not_a_data_job): that is the answer.
  if (api && api.hits.length === 0) {
    return { text: render(task, "api", [], topMeta), structured: { ok: true, source: "api", results: [], ...metaFields(topMeta) } };
  }

  // A chain of steps: the planner's calls, in order, when it is deployed and sure.
  if (!api && MULTI_STEP.test(task)) {
    const steps = await apiPlan(ctx, task);
    if (steps) return planOutput(ctx, task, steps);
  }

  // Candidates in rank order: the API's, else the local ranker's.
  let pool: Array<{ id: string; endpoint?: Endpoint; manage?: ManageDoc; summary?: string; why?: string; meta?: MatchMeta }>;
  const source: "api" | "local" = apiHits ? "api" : "local";
  if (apiHits) {
    pool = apiHits.map((h) => ({ id: h.id, endpoint: bundled(h.id, h.method), summary: h.summary, why: h.why, meta: h.meta }));
  } else {
    const query = facts.rankQuery || task;
    pool = searchTasks(query, { platform: params.platform, limit: POOL }).map((h) =>
      "endpoint" in h ? { id: h.id, endpoint: h.endpoint } : { id: h.id, manage: h.manage },
    );
  }
  if (params.platform) pool = pool.filter((c) => c.id.startsWith(`${params.platform}/`));

  // Endpoints the task's URL / handle resolved to go first, keeping rank order.
  const resolvedIds = new Set(resolved.flatMap((r) => r.endpoints.map((e) => e.id)));
  if (resolvedIds.size > 0) {
    pool = [...pool.filter((c) => resolvedIds.has(c.id)), ...pool.filter((c) => !resolvedIds.has(c.id))];
  }
  const top = pool.slice(0, limit);

  const results = await Promise.all(
    top.map(async (c) => {
      if (c.manage) return manageResult(c.manage);
      const e = c.endpoint;
      if (!e) {
        return { id: c.id, summary: c.summary ?? c.why ?? "", params_filled: {}, params_missing: [] as string[], bundled: false, ...c.meta };
      }
      const filled = fill(e, facts, resolved);
      const miss = missing(e, filled);
      return {
        id: c.id,
        method: e.method,
        summary: e.purpose?.summary ?? e.summary,
        returns: e.purpose?.returns ?? undefined,
        credits: await credits(ctx, e, filled),
        params_filled: filled,
        params_missing: miss,
        call: callFor(e, filled),
        ...c.meta,
      };
    }),
  );

  const structured: Record<string, unknown> = { ok: true, source, results, ...metaFields(topMeta) };
  const unbundled = results.filter((r) => "bundled" in r && r.bundled === false).map((r) => r.id);
  if (unbundled.length > 0) structured.warnings = unbundled.map(unbundledWarning);
  if (resolved.length > 0) {
    structured.resolved = resolved.map((r) => ({ input: r.input, platform: r.platform, kind: r.kind, confidence: r.confidence, canonical: r.canonical }));
  }
  return { text: render(task, source, results, topMeta), structured };
}

/**
 * A stateful family as a result: not one call but an area of socialcrawl_manage,
 * started by its first action. Free of params until that action's input is known.
 */
function manageResult(m: ManageDoc) {
  const action = m.actions[0];
  return {
    id: m.area,
    kind: "manage" as const,
    area: m.area,
    action,
    actions: m.actions,
    summary: m.summary,
    params_filled: {},
    params_missing: [] as string[],
    call: { tool: "socialcrawl_manage", arguments: { area: m.area, action, input: {} } },
  };
}

/** Top-level match facts for structuredContent; the API's ranker `source` becomes `match_source` (ours says api/local/plan). */
function metaFields(m: MatchMeta): Record<string, unknown> {
  const { source, ...rest } = m;
  return { ...rest, ...(source !== undefined ? { match_source: source } : {}) };
}

const UNCERTAIN_LINE = "Uncertain match: confirm with socialcrawl_endpoint before calling.";

/** "reason no_match · source lexical · confidence n/a. note" for whatever is present. */
function metaLine(m: MatchMeta): string | undefined {
  const parts = [
    m.reason ? `reason ${m.reason}` : "",
    m.source ? `source ${m.source}` : "",
    "confidence" in m ? `confidence ${m.confidence === null || m.confidence === undefined ? "n/a" : m.confidence}` : "",
  ].filter(Boolean);
  if (parts.length === 0 && !m.note) return undefined;
  return `${parts.join(" · ")}${parts.length > 0 && m.note ? ". " : ""}${m.note ?? ""}`;
}

const unbundledWarning = (id: string): string =>
  `${id} is not in this server's bundled catalogue (it is newer than this socialcrawl-mcp); its params and price are unknown here. Read it live with socialcrawl_endpoint, or update socialcrawl-mcp.`;

/** Results for the planner's steps: each step's filled params, what is still missing, and its call. */
async function planOutput(ctx: ApiContext, task: string, steps: PlanHit[]): Promise<ToolOutput> {
  const results = await Promise.all(
    steps.map(async (st) => {
      const e = bundled(st.id, st.method);
      if (!e) return { id: st.id, params_filled: st.params, params_missing: st.missing, bundled: false };
      const local = await credits({ ...ctx, apiKey: "" }, e, st.params);
      return {
        id: `${e.platform}/${e.resource}`,
        method: e.method,
        summary: e.purpose?.summary ?? e.summary,
        credits: { ...local, ...(typeof st.credits === "number" ? { estimate: st.credits, source: "api" } : {}) },
        params_filled: st.params,
        params_missing: st.missing,
        ...(st.binds ? { binds: st.binds } : {}),
        call: callFor(e, st.params),
      };
    }),
  );
  const structured: Record<string, unknown> = { ok: true, source: "plan", results };
  const unbundled = results.filter((r) => "bundled" in r && r.bundled === false).map((r) => r.id);
  if (unbundled.length > 0) structured.warnings = unbundled.map(unbundledWarning);
  return { text: render(task, "plan", results), structured };
}

function render(
  task: string,
  source: "api" | "local" | "plan",
  results: Array<{ id: string; method?: string; summary?: string; returns?: string; credits?: Record<string, unknown>; params_missing: string[]; call?: Record<string, unknown>; bundled?: boolean; binds?: Record<string, string>; kind?: "manage"; area?: string; actions?: string[] } & MatchMeta>,
  meta: MatchMeta = {},
): string {
  const uncertain = meta.uncertain === true || results.some((r) => r.uncertain === true);
  const lines: string[] = uncertain ? [UNCERTAIN_LINE] : [];
  const top = metaLine(meta);
  if (results.length === 0) {
    lines.push(
      source === "api" && meta.reason
        ? `No endpoint for "${task}" (${top}).`
        : `No endpoint matches "${task}". Try other words, or socialcrawl_find with a platform and no task to list that platform's endpoints.`,
    );
    return lines.join("\n");
  }
  const how = source === "api" ? "ranked by the API" : source === "plan" ? "planned by the API, in order" : "ranked from the bundled catalogue";
  lines.push(`${source === "plan" ? "Steps" : "Best endpoints"} for "${task}" (${how}):`);
  if (top) lines.push(`Match: ${top}`);
  results.forEach((r, i) => {
    if (r.kind === "manage") {
      lines.push(`${i + 1}. ${r.id} (socialcrawl_manage area "${r.area}") - ${r.summary ?? ""}`);
      lines.push(`   Actions: ${(r.actions ?? []).join(", ")}. Read first: socialcrawl_endpoint with id "${r.id}".`);
      if (r.call) lines.push(`   Call: ${JSON.stringify(r.call)}`);
      return;
    }
    if (r.bundled === false) {
      lines.push(`${i + 1}. ${r.id} - ${r.summary ?? ""} ${unbundledWarning(r.id)}`);
      return;
    }
    const c = r.credits ?? {};
    const cost = typeof c.estimate === "number" ? `${c.estimate}cr quoted (${String(c.label)})` : String(c.label ?? "price unknown");
    const needs = r.params_missing.length > 0 ? `needs ${r.params_missing.join(", ")}` : "ready to call";
    lines.push(`${i + 1}. ${r.id}${r.method && r.method !== "GET" ? ` (${r.method})` : ""} - ${r.summary ?? ""} ${cost}; ${needs}.`);
    if (r.returns) lines.push(`   ${r.returns}`);
    if (r.binds) lines.push(`   Filled from earlier rows: ${Object.entries(r.binds).map(([k, v]) => `${k} <- ${v}`).join(", ")}`);
    if (r.call) lines.push(`   Call: ${JSON.stringify(r.call)}`);
    const rowMeta = metaLine({ uncertain: r.uncertain, reason: r.reason, source: r.source, ...("confidence" in r ? { confidence: r.confidence } : {}), note: r.note });
    if (r.uncertain === true || rowMeta) lines.push(`   ${r.uncertain === true ? "Uncertain" : "Match"}: ${rowMeta ?? "unconfirmed"}`);
  });
  lines.push("Next: socialcrawl_endpoint with an id for its params and response fields; socialcrawl_estimate for the exact cost of your params.");
  return lines.join("\n");
}
