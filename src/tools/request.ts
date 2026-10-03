import { findPlatform } from "../data/platforms.js";
import { ENDPOINTS, findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { makeRequest, apiRequest } from "../client.js";
import type { ProgressTick, ResponseMeta } from "../client.js";
import { timeoutSecondsFor, wantsStream } from "../timeouts.js";
import { pollLine, requestJobHandle } from "../jobs.js";
import { formatCost, worstCaseCost } from "../pricing.js";
import type { ApiContext } from "../context.js";
import { quoteHydration } from "../hydration.js";
import { quoteJudgments } from "../judgments.js";
import type { Endpoint } from "../types.js";
import { errorFromText, structureEnvelope, summaryLine } from "../result.js";
import type { ToolOutput } from "../result.js";
import { RESULT_CHAR_BUDGET } from "../constants.js";
import { shapeEnvelope } from "../format/shape.js";
import { resultsStore, resultUri, scopeOf } from "../results-store.js";
import { randomUUID } from "node:crypto";
import { checkGuard, quoteCall } from "../cost-guard.js";
import { recordSpend } from "../session-spend.js";
import { suggestEndpoints, suggestPlatforms } from "../search/catalog.js";

interface RequestParams {
  platform: string;
  resource: string;
  /**
   * HTTP method, for the few resources served by more than one (e.g.
   * `prism/jobs`: GET lists jobs, POST submits one). Inferred when omitted:
   * a `body` selects the POST variant when one exists, otherwise GET.
   */
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  params?: Record<string, ParamValue>;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Comma-separated field paths; sent as `fields=` and applied locally if unprojected. */
  fields?: string;
  max_items?: number;
  format?: "json" | "csv" | "summary";
  /** Refuse locally when the quoted hold exceeds this many credits. */
  max_credits?: number;
  /** Proceed past the confirmation threshold (SOCIALCRAWL_CONFIRM_ABOVE) without asking. */
  confirm?: boolean;
  /** Called once per streamed chunk (the server wires it to MCP progress notifications). */
  onProgress?: (tick: ProgressTick) => void;
}

/** Internal switches for a caller that walks pages itself (`socialcrawl_collect`). */
export interface PageOptions {
  /** The caller already ran the cost guard for the whole walk. */
  skipGuard?: boolean;
  /** Do not shape, truncate or store the body; hand back the whole envelope. */
  walk?: boolean;
  /** Quoted hold of this page, counted as the charge when the response does not report one. */
  hold?: number;
}
type ParamScalar = string | number | boolean;
type ParamValue = ParamScalar | ParamScalar[];

/** Query values travel as strings; arrays become CSV (`label=a,b`). */
export function stringifyParams(params: Record<string, ParamValue> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    out[k] = Array.isArray(v) ? v.map(String).join(",") : String(v);
  }
  return out;
}

/**
 * Resolve a resource to its registered endpoint, accepting both the template
 * (`jobs/{job_id}` with `job_id` in params) and a concrete path
 * (`jobs/job_abc123`). Returns the path-param values a concrete path carried.
 */
export function resolveEndpoint(
  platform: string,
  resource: string,
  method: string | undefined,
): { endpoint: Endpoint; pathValues: Record<string, string> } | undefined {
  const direct = findEndpoint(platform, resource, method);
  if (direct) return { endpoint: direct, pathValues: {} };
  const parts = resource.split("/");
  for (const e of ENDPOINTS) {
    if (e.platform !== platform || !e.resource.includes("{")) continue;
    if (method && e.method !== method) continue;
    const tpl = e.resource.split("/");
    if (tpl.length !== parts.length) continue;
    const values: Record<string, string> = {};
    const ok = tpl.every((seg, i) => {
      const m = /^\{(\w+)\}$/.exec(seg);
      if (m) {
        values[m[1]] = decodeURIComponent(parts[i]);
        return parts[i].length > 0;
      }
      return seg === parts[i];
    });
    if (ok) return { endpoint: e, pathValues: values };
  }
  return undefined;
}

/** `jobs/{job_id}` + `{ job_id: "abc" }` → `jobs/abc`. */
function fillPath(resource: string, values: Record<string, unknown>): string {
  return resource.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(String(values[name] ?? `{${name}}`)),
  );
}

/** Names of the `{path}` params in a resource template. */
function pathParamNames(resource: string): Set<string> {
  return new Set([...resource.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

/**
 * Parse a string that looks like a JSON array/object so an agent can pass a
 * batch param (ids/urls/items) either as a real array or as a JSON string.
 * Non-JSON strings and non-strings pass through untouched.
 */
function coerceJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/** True when this optional param must ride the query string on a POST endpoint. */
function isQueryParam(endpoint: Endpoint, name: string): boolean {
  return endpoint.optionalParams.find((p) => p.name === name)?.in === "query";
}

/**
 * Mirror of the backend's pre-billing validator (`validation/request-params.ts`
 * rules 1-5) against the registry data this server ships. Catching these here
 * turns a round-trip 400 into an instant local error — no latency, and no risk
 * of an agent looping on a malformed call. Format/encoding rules (6-7) stay
 * server-side; they need regexes this data layer does not carry.
 */
function validateValues(
  endpoint: Endpoint,
  provided: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const present = (name: string): boolean =>
    provided[name] !== undefined && provided[name] !== "";

  for (const [name, rawValue] of Object.entries(provided)) {
    if (rawValue === undefined || rawValue === "") continue;
    const spec = endpoint.optionalParams.find((p) => p.name === name);
    const value = String(rawValue);

    if (spec) {
      // Rule 3 — enum values are rejected at the edge.
      if (spec.type === "enum" && spec.enumValues && !spec.enumValues.includes(value)) {
        errors.push(
          `\`${name}\`: "${value}" is not allowed. Allowed values: ${spec.enumValues.join(", ")}.`,
        );
      }

      if (spec.type === "integer") {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          errors.push(`\`${name}\`: "${value}" is not an integer.`);
        } else {
          if (spec.minimum !== undefined && n < spec.minimum) {
            errors.push(`\`${name}\`: ${n} is below the minimum of ${spec.minimum}.`);
          }
          if (spec.maximum !== undefined && n > spec.maximum) {
            errors.push(`\`${name}\`: ${n} is above the maximum of ${spec.maximum}.`);
          }
        }
      }

      // Rule 4 — presence and value coupling.
      if (spec.requires && !present(spec.requires)) {
        errors.push(
          `\`${name}\` is a no-op without \`${spec.requires}\` — the API rejects it with a 400. Supply \`${spec.requires}\` too.`,
        );
      }
      if (spec.couplesWith) {
        const companion = provided[spec.couplesWith.param];
        if (companion !== undefined && String(companion) !== spec.couplesWith.value) {
          errors.push(
            `\`${name}\` requires \`${spec.couplesWith.param}=${spec.couplesWith.value}\`, but \`${spec.couplesWith.param}=${String(companion)}\` was supplied.`,
          );
        }
      }
    }

    // Rule 5 — CSV list constraints apply to required and optional params alike.
    const csv = endpoint.csvConstraints?.[name];
    if (csv) {
      const entries = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (csv.max !== undefined && entries.length > csv.max) {
        errors.push(
          `\`${name}\` accepts at most ${csv.max} comma-separated value(s); received ${entries.length}.`,
        );
      }
      if (csv.enumValues) {
        for (const entry of entries) {
          if (!csv.enumValues.includes(entry)) {
            errors.push(
              `\`${name}\`: "${entry}" is not allowed. Allowed values: ${csv.enumValues.join(", ")}.`,
            );
          }
        }
      }
    }
  }

  return errors;
}

/** Params the endpoint does not declare. Not fatal — the API ignores them. */
function unknownParams(
  endpoint: Endpoint,
  provided: Record<string, unknown>,
): string[] {
  const known = new Set([
    ...endpoint.params.map((p) => p.name),
    ...endpoint.optionalParams.map((p) => p.name),
    // Universal aliases the router accepts on every endpoint.
    "cursor",
    "limit",
  ]);
  return Object.keys(provided).filter((name) => !known.has(name));
}

/** What the success path learned, for the structured twin of the text. */
interface Captured {
  structured?: Record<string, unknown>;
  links?: ToolOutput["links"];
  /** The parsed API envelope, whole (set on a JSON success). */
  envelope?: Record<string, unknown>;
}

export async function request(ctx: ApiContext, input: RequestParams): Promise<string> {
  return (await requestStructured(ctx, input)).text;
}

/** Text for older clients plus the `structuredContent` object (success or error shape). */
export async function requestStructured(ctx: ApiContext, input: RequestParams): Promise<ToolOutput> {
  return (await requestPage(ctx, input)).output;
}

/** One call, plus the whole parsed envelope for a caller that walks pages. */
export async function requestPage(
  ctx: ApiContext,
  input: RequestParams,
  opts: PageOptions = {},
): Promise<{ output: ToolOutput; envelope?: Record<string, unknown> }> {
  const captured: Captured = {};
  const text = await runRequest(ctx, input, captured, opts);
  return {
    output: { text, structured: captured.structured ?? errorFromText(text), links: captured.links },
    envelope: captured.envelope,
  };
}

async function runRequest(
  ctx: ApiContext,
  input: RequestParams,
  captured: Captured,
  opts: PageOptions,
): Promise<string> {
  const platform = findPlatform(input.platform);
  if (!platform) {
    const near = suggestPlatforms(input.platform);
    return [
      `Error: Unknown platform "${input.platform}". Use socialcrawl_find to see the platforms.`,
      ...(near.length > 0 ? ["", "Did you mean:", ...near.map((p) => `- \`${p}\``)] : []),
    ].join("\n");
  }

  // The stateful web-scraping platform (jobs, monitors, sessions, async
  // crawl/batch/agent — POST/PATCH/DELETE with path params) is served by
  // socialcrawl_manage (area web), not this registry-driven request tool.
  if (input.platform === "web") {
    return `Error: The "web" platform is served by \`socialcrawl_manage\` with area "web" (scrape, search, map, extract, crawl, batch_scrape, agent, jobs, monitors, sessions), not \`socialcrawl_request\`. Call socialcrawl_manage with area "web" and the matching action.`;
  }

  // A resource served by several methods (prism/jobs: GET lists, POST
  // submits) is disambiguated by `method`, or by the presence of a body.
  let method = input.method;
  if (!method && input.body && Object.keys(input.body).length > 0) {
    if (findEndpoint(input.platform, input.resource, "POST")) method = "POST";
  }
  const resolved = resolveEndpoint(input.platform, input.resource, method);
  const endpoint = resolved?.endpoint;
  if (!endpoint || !resolved) {
    // Substring neighbours first (the old behaviour), then the ranker's picks.
    const near = [
      ...getEndpointsByPlatform(input.platform)
        .filter((e) => e.resource.includes(input.resource) || input.resource.includes(e.resource))
        .map((e) => e.resource),
      ...suggestEndpoints(input.platform, input.resource).map((id) => id.slice(input.platform.length + 1)),
    ].filter((r, i, all) => all.indexOf(r) === i).slice(0, 5);
    return [
      `Error: Unknown resource "${input.resource}" for platform "${input.platform}".`,
      ...(near.length > 0
        ? [`Closest matches: ${near.map((r) => `\`${r}\``).join(", ")}.`]
        : []),
      `Use socialcrawl_find with platform "${input.platform}" to see its endpoints.`,
    ].join(" ");
  }

  const isPost = endpoint.method === "POST";
  const providedParams: Record<string, string> = {
    ...resolved.pathValues,
    ...stringifyParams(input.params),
  };
  const providedBody = input.body ?? {};
  // A required param may arrive via `params` or `body`; POST batch params
  // (ids/urls/items) conventionally live in `body`.
  const merged: Record<string, unknown> = { ...providedParams, ...providedBody };
  const providedNames = new Set(Object.keys(merged));

  const missingParts: string[] = [];
  for (const p of endpoint.params) {
    if (p.required && !providedNames.has(p.name)) {
      missingParts.push(`\`${p.name}\` (e.g., "${p.example}")`);
    }
  }
  for (const group of endpoint.oneOfGroups) {
    const satisfied = group.some(
      (name) =>
        (providedParams[name] !== undefined && providedParams[name] !== "") ||
        providedBody[name] !== undefined,
    );
    if (!satisfied) {
      const list = group.map((name) => `\`${name}\``).join(", ");
      missingParts.push(`one of ${list}`);
    }
  }
  if (missingParts.length > 0) {
    return `Error: Missing required parameter(s): ${missingParts.join(", ")}. Use socialcrawl_endpoint with id "${input.platform}/${endpoint.resource}" for full parameter details. No credits were charged.`;
  }

  const valueErrors = validateValues(endpoint, merged);
  if (valueErrors.length > 0) {
    return [
      "Error: Invalid parameter value(s) — the API would reject this with a 400 before billing:",
      ...valueErrors.map((e) => `- ${e}`),
      "",
      `Use socialcrawl_endpoint with id "${input.platform}/${endpoint.resource}" for the full parameter contract. No credits were charged.`,
    ].join("\n");
  }

  // What to count as spent when a success does not say (the quoted hold).
  let holdCharge = opts.hold;
  // Cost guard: quote the call, refuse over max_credits, ask above the threshold.
  if (!opts.skipGuard) {
    const quote = await quoteCall(ctx, endpoint, merged, input.max_credits);
    holdCharge = quote.hold;
    const stop = await checkGuard(ctx, {
      hold: quote.hold,
      exposure: quote.hold,
      maxCredits: input.max_credits,
      confirm: input.confirm,
      subject: "This call",
    });
    if (stop) {
      captured.structured = stop.structured;
      return stop.text;
    }
  }

  let response: string;
  const callMeta: ResponseMeta = {};
  const longCall = {
    timeoutMs: timeoutSecondsFor(endpoint) * 1000,
    stream: wantsStream(endpoint, merged),
    onProgress: input.onProgress,
    meta: callMeta,
  };

  const pathNames = pathParamNames(endpoint.resource);
  const resourcePath = fillPath(endpoint.resource, merged);

  if (!isPost) {
    // GET (and the rare non-POST) — everything is a query param, except the
    // `{path}` params, which are substituted into the resource.
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(providedParams)) {
      if (!pathNames.has(k)) query[k] = v;
    }
    if (input.fields) query.fields = input.fields;
    response = await makeRequest(ctx, {
      raw: true,
      platform: input.platform,
      resource: resourcePath,
      params: Object.keys(query).length > 0 ? query : undefined,
      idempotencyKey: input.idempotencyKey,
      ...longCall,
    });
  } else {
    // POST batch endpoint — split provided values into a JSON body and a
    // query string, routing `in: "query"` params (e.g. YouTube `hl`) to the
    // query and everything else to the body.
    const query: Record<string, string> = {};
    const bodyOut: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(providedParams)) {
      if (pathNames.has(k)) continue;
      if (isQueryParam(endpoint, k)) query[k] = v;
      else bodyOut[k] = coerceJson(v);
    }
    for (const [k, v] of Object.entries(providedBody)) {
      if (pathNames.has(k)) continue;
      if (isQueryParam(endpoint, k)) query[k] = String(v);
      else bodyOut[k] = coerceJson(v);
    }
    if (input.fields) query.fields = input.fields;
    response = await apiRequest(ctx, {
      raw: true,
      method: "POST",
      path: `/v1/${input.platform}/${resourcePath}`,
      query,
      body: bodyOut,
      idempotencyKey: input.idempotencyKey,
      errorPlatform: input.platform,
      ...longCall,
    });
  }

  const headerLines = [
    `## SocialCrawl API Response`,
    `**Endpoint:** \`${endpoint.method} /v1/${input.platform}/${resourcePath}\``,
    `**Price:** ${formatCost(endpoint.pricing)}${
      endpoint.pricing.model === "metered"
        ? ` — up to ${worstCaseCost(endpoint.pricing)}cr held, refunded to the actual charge. Read \`credits_used\` below for what you really paid.`
        : ""
    }`,
  ];
  if (endpoint.pricing.model === "metered" && endpoint.pricing.description) {
    headerLines.push(`**Metered rule:** ${endpoint.pricing.description}`);
  }

  // Row joins, on the surface that actually spends the credits.
  //
  // Two different callers need two different things here. The one who sent a
  // token wants the band replaced by the number this call actually held; the
  // one who did not send a token usually does not know the option exists, and
  // is the caller who files "engagement is null" after paying for a page and
  // then paying again per row to fill it in.
  if (endpoint.hydration && endpoint.hydration.length > 0) {
    const sentInclude = merged.include;
    const includeValue =
      typeof sentInclude === "string" && sentInclude.trim() !== ""
        ? sentInclude
        : undefined;
    const rowCap = Number(merged.limit);
    const quote = quoteHydration(
      endpoint,
      includeValue,
      Number.isFinite(rowCap) ? rowCap : undefined,
    );
    if (quote.lanes.length > 0) {
      headerLines.push(
        `**Row join:** \`include=${includeValue}\` held ${quote.held}cr (${quote.base}cr page + ${quote.lanes
          .map((l) => `${l.held}cr for ${l.rows} rows of \`${l.lane.token}\``)
          .join(" + ")}). Only rows a fresh lookup filled were kept — see \`data.hydration\` for rows, cache hits, credits held vs kept, and \`credits_used\` for the settled charge.`,
      );
    } else if (includeValue === undefined) {
      headerLines.push(
        `**Row join available:** this endpoint can fill its own rows in the same call. Add \`include=${endpoint.hydration
          .map((l) => l.token)
          .join(",")}\` to join each row to ${endpoint.hydration
          .map((l) => `\`/v1/${l.sibling}\``)
          .join(" and ")} — ${endpoint.hydration
          .map((l) => `${l.creditsPerItem}cr per row filled, at most ${l.maxItems} rows`)
          .join("; ")}. Cached and unfillable rows are free.`,
      );
    }
  }
  // Judgments: free by default; a metered preset or a caller-written
  // relevance topic holds credits. Quote the exact hold on the call that
  // spends it, and say what the free defaults already put on every row.
  if (endpoint.judgments) {
    const jq = quoteJudgments(endpoint, merged);
    if (jq.held > 0) {
      const parts: string[] = [];
      if (jq.labelHold > 0) {
        parts.push(`${jq.labelHold}cr for \`label=${jq.paidPresets.join(",")}\``);
      }
      if (jq.relevanceHold > 0) parts.push(`${jq.relevanceHold}cr for \`relevant_to\``);
      headerLines.push(
        `**Judgments:** held ${parts.join(" + ")} on top of the page, settling to 1 credit per started 25 rows judged fresh (already-judged rows and cached pages are free). \`data.labels\` / \`data.relevance\` report status and what was judged.`,
      );
    } else if (!jq.defaultsOff) {
      const free = [
        ...(endpoint.judgments.labels ? [`labels (${endpoint.judgments.labels.free.join(", ")})`] : []),
        ...(endpoint.judgments.relevance ? ["relevance to your query"] : []),
      ];
      if (free.length > 0) {
        headerLines.push(
          `**Free judgments on every row:** ${free.join(" and ")} under \`computed.*\` at no extra credit. \`judgments=off\` returns the page unjudged.`,
        );
      }
    }
    for (const note of jq.notes) headerLines.push(`**Note:** ${note}`);
  }

  const unknown = unknownParams(endpoint, merged);
  if (unknown.length > 0) {
    headerLines.push(
      `**Note:** ${unknown.map((u) => `\`${u}\``).join(", ")} ${unknown.length === 1 ? "is" : "are"} not declared on this endpoint and ${unknown.length === 1 ? "was" : "were"} dropped — the API names each dropped param in \`data._warnings\` (with the closest declared name when there is one). Unknown params never bypass the cache.`,
    );
  }
  if (endpoint.pagination && !endpoint.paginatable) {
    const declaredNames = new Set(endpoint.optionalParams.map((p) => p.name));
    const extras: string[] = [];
    if (declaredNames.has("max_pages")) {
      extras.push("`max_pages` walks several pages in one call (each billed as a page)");
    }
    if (declaredNames.has("since") || declaredNames.has("stop_at_id")) {
      extras.push("`since` / `stop_at_id` stop the walk at rows you already have");
    }
    if (declaredNames.has("seen")) {
      extras.push("`seen=<id>` drops rows you already received and discounts the page by the share of repeats");
    }
    headerLines.push(
      `**Paging:** pass \`cursor\` from \`pagination.next_cursor\` for the next page; stop when \`pagination.has_more\` is false. Each page is billed separately.${extras.length > 0 ? ` Also: ${extras.join("; ")}.` : ""}`,
    );
  }
  const header = `${headerLines.join("\n")}\n\n`;

  if (/^Error(?::| \(\d+\):)/.test(response)) {
    return `${header}${response}`;
  }

  const quotedMax = worstCaseCost(endpoint.pricing);
  const endpointName = `${input.platform}/${endpoint.resource}`;
  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    // Cut only at row boundaries so the result is always valid JSON; the full
    // body goes to the results store behind a resource link.
    const format = input.format ?? "json";
    const budget = RESULT_CHAR_BUDGET - header.length - 1500;
    const shaped = shapeEnvelope(parsed, {
      fields: input.fields,
      maxItems: input.max_items,
      format,
      budget,
    });
    const structured: Record<string, unknown> = {
      ok: true,
      endpoint: endpointName,
      ...structureEnvelope(shaped.envelope, quotedMax),
    };
    const credits = (structured.credits ?? {}) as Record<string, unknown>;
    if (typeof credits.used !== "number" || !Number.isFinite(credits.used)) {
      credits.estimated = true;
      credits.used = holdCharge ?? quotedMax;
    }
    credits.session_total = recordSpend(ctx.apiKey, credits.used);
    structured.credits = credits;
    captured.envelope = parsed;
    const notes: string[] = [];
    if (shaped.warnings && shaped.warnings.length > 0) {
      structured.warnings = [...((structured.warnings as string[] | undefined) ?? []), ...shaped.warnings];
      notes.push(...shaped.warnings);
    }
    const linkWorthy = !opts.walk && (shaped.cut || shaped.projected || format !== "json");
    let uri: string | undefined;
    if (linkWorthy) {
      const id = typeof parsed.request_id === "string" && parsed.request_id ? parsed.request_id : randomUUID();
      if (resultsStore.put(scopeOf(ctx.apiKey), id, response)) uri = resultUri(id);
      else notes.push(`full body (${Buffer.byteLength(response).toLocaleString()} bytes) is too large to store; narrow the request (limit, fields) instead`);
    }
    if (shaped.cut && uri) {
      const trunc: Record<string, unknown> = { resource: uri };
      if (shaped.total !== undefined) {
        trunc.shown = shaped.shown;
        trunc.total = shaped.total;
        notes.push(
          shaped.shown
            ? `rows 1–${shaped.shown} of ${shaped.total} shown; full page stored as resource ${uri}`
            : `no row fit; ${shaped.total} rows stored as resource ${uri}`,
        );
      } else {
        trunc.omitted_keys = shaped.omittedKeys;
        notes.push(
          `${shaped.omittedKeys?.length ?? 0} large field(s) omitted (${(shaped.omittedKeys ?? []).join(", ")}); full body stored as resource ${uri}`,
        );
      }
      structured.truncated = trunc;
    } else if (uri) {
      notes.push(`full body stored as resource ${uri}`);
    }
    // The table lives once, in the text; structuredContent carries only its row count
    // (a client reading both would otherwise pay for the CSV twice).
    if (shaped.csv !== undefined) structured.csv_rows = Math.max(0, shaped.csv.split("\n").length - 1);
    if (shaped.csv !== undefined || shaped.summary !== undefined) delete structured.rows;
    if (shaped.summary !== undefined) structured.summary = shaped.summary;
    // A stream that broke after delivering data: a failure, with the data attached.
    if (parsed.partial === true) {
      const se = (parsed.stream_error ?? {}) as { code?: string; message?: string };
      const code = se.code ?? "STREAM_ERROR";
      structured.ok = false;
      structured.partial = true;
      structured.code = code;
      structured.reason = se.message || "The stream failed after returning some data.";
      structured.retryable = /UPSTREAM|TIMEOUT|UNAVAILABLE|INTERNAL/.test(code);
      notes.push(
        `Partial result: the stream failed (${code}${se.message ? `: ${se.message}` : ""}) after delivering the data below. credits.used is what was charged; do not assume the missing parts exist.`,
      );
    }
    // A submit that returned a job handle: say how to poll it, structurally.
    const job = endpoint.execution === "async" && endpoint.method === "POST"
      ? requestJobHandle(input.platform, parsed, callMeta.retryAfterS)
      : undefined;
    if (job) {
      structured.job = job;
      notes.push(pollLine(job));
    }
    captured.structured = structured;
    captured.links = uri
      ? [{ uri, name: `result ${uri.slice(uri.lastIndexOf("/") + 1)}`, description: "Full response body", mimeType: "application/json" }]
      : undefined;

    // Summary line, then the envelope as compact JSON (no indent: indentation is
    // a quarter of a pretty-printed page and carries nothing an agent reads).
    let line = summaryLine(structured);
    if (shaped.csv !== undefined || shaped.summary !== undefined) {
      line += ` · ${shaped.total ?? (shaped.summary?.rows as number | undefined) ?? 1} rows total`;
    }
    const noteBlock = notes.length > 0 ? `\n${notes.join("\n")}` : "";
    let payload: string;
    if (shaped.csv !== undefined) payload = `\`\`\`csv\n${shaped.csv}\n\`\`\``;
    else if (shaped.summary !== undefined) {
      const env: Record<string, unknown> = { ...shaped.envelope };
      const d = env.data as Record<string, unknown> | undefined;
      if (d && typeof d === "object") {
        const { items: _items, ...restData } = d;
        env.data = restData;
      }
      payload = `\`\`\`json\n${JSON.stringify({ ...env, summary: shaped.summary })}\n\`\`\``;
    }
    else payload = `\`\`\`json\n${JSON.stringify(shaped.envelope)}\n\`\`\``;
    return `${header}**Result:** ${line}${noteBlock}\n\n${payload}`;
  } catch {
    // A body cut at the character limit is not JSON: report it, do not fail it.
    captured.structured = {
      ok: true,
      endpoint: endpointName,
      credits: {
        used: holdCharge ?? quotedMax,
        estimated: true,
        quoted_max: quotedMax,
        session_total: recordSpend(ctx.apiKey, holdCharge ?? quotedMax),
      },
      warnings: ["Response text was truncated or not JSON; credits.used is unknown and counted at the quoted hold. Check the ledger by request_id."],
    };
    // Not JSON, so there is no row boundary: slice to the budget, keep the rest behind a link.
    const room = RESULT_CHAR_BUDGET - header.length - 400;
    if (response.length <= room) return `${header}${response}`;
    const id = randomUUID();
    const stored = resultsStore.put(scopeOf(ctx.apiKey), id, response);
    const uri = resultUri(id);
    const note = stored
      ? `[Body is not JSON; first ${room.toLocaleString()} of ${response.length.toLocaleString()} characters shown. Full body stored as resource ${uri}]`
      : `[Body is not JSON; first ${room.toLocaleString()} of ${response.length.toLocaleString()} characters shown. Too large to store.]`;
    if (stored) {
      (captured.structured as Record<string, unknown>).truncated = { resource: uri };
      captured.links = [{ uri, name: `result ${id}`, description: "Full response body", mimeType: "text/plain" }];
    }
    return `${header}${response.slice(0, room)}\n\n${note}`;
  }
}
