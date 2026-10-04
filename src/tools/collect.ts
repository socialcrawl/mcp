import { randomUUID } from "node:crypto";
import { findPlatform } from "../data/platforms.js";
import type { ApiContext } from "../context.js";
import { checkGuard, quoteCall } from "../cost-guard.js";
import { flattenRows, toCsv } from "../format/csv.js";
import { errorFromText, shortCursor, structureEnvelope } from "../result.js";
import { INLINE_MAX_BYTES, INLINE_MAX_ROWS } from "../constants.js";
import type { ToolOutput } from "../result.js";
import { RESULT_URI_PREFIX, resultsStore, resultUri, scopeOf } from "../results-store.js";
import { sessionTotal } from "../session-spend.js";
import { requestPage, resolveEndpoint, stringifyParams } from "./request.js";

export interface CollectParams {
  /** `platform/resource`, e.g. `tiktok/post/comments`. */
  id?: string;
  params?: Record<string, string | number | boolean | Array<string | number | boolean>>;
  items?: number;
  max_credits?: number;
  format?: "jsonl" | "json" | "csv";
  fields?: string;
  confirm?: boolean;
  /** Read a stored result (a walk's, or a request's full body) instead of walking. */
  result_id?: string;
  offset?: number;
  limit?: number;
}

type StopReason = "items" | "exhausted" | "budget" | "insufficient_credits" | "no_new_rows" | "page_limit" | "error";

/** Hard stop on pages per call, so a cursor that never ends cannot loop. */
const MAX_PAGES = 100;
const SAMPLE_ROWS = 3;
/** Page size assumed for the confirmation projection when the endpoint does not publish one. */
const DEFAULT_PAGE_SIZE = 20;

const MIME = { jsonl: "application/x-ndjson", json: "application/json", csv: "text/csv" } as const;

const fail = (text: string): ToolOutput => ({ text, structured: errorFromText(text) });

/** Rows a result_id read returns when no limit is given. */
const READ_DEFAULT_LIMIT = 200;
const READ_MAX_LIMIT = 1000;

/** The rows a walk collected, as JSON, kept beside the formatted body for result_id reads. */
const rowsKey = (id: string): string => `rows:${id}`;


/** Rows in `format`, for the text. */
function renderRows(rows: unknown[], format: "jsonl" | "json" | "csv"): string {
  if (format === "csv") return `\`\`\`csv\n${toCsv(flattenRows(rows))}\n\`\`\``;
  if (format === "jsonl") return `\`\`\`jsonl\n${rows.map((r) => JSON.stringify(r)).join("\n")}\n\`\`\``;
  return `\`\`\`json\n${JSON.stringify(rows)}\n\`\`\``;
}

/** The rows of a stored body: a JSON array, an API envelope, JSONL, or (last resort) one value. */
function rowsOf(body: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed;
    const s = structureEnvelope(parsed);
    if (Array.isArray(s.rows)) return s.rows;
    return s.data !== undefined ? [s.data] : [parsed];
  } catch {
    const lines = body.split("\n").filter((l) => l.trim() !== "");
    try {
      return lines.map((l) => JSON.parse(l) as unknown);
    } catch {
      return undefined;
    }
  }
}

/** `socialcrawl_collect` with `result_id`: read a stored result back, a slice at a time. Free. */
function readStored(ctx: ApiContext, input: CollectParams): ToolOutput {
  const id = String(input.result_id).trim().replace(RESULT_URI_PREFIX, "");
  const scope = scopeOf(ctx.apiKey);
  const kept = resultsStore.get(scope, rowsKey(id));
  const body = kept ?? resultsStore.get(scope, id);
  if (body === undefined) {
    return fail(`Error: No stored result for "${id}". Stored results expire after 30 minutes; repeat the request or walk (a cached repeat is free).`);
  }
  const rows = rowsOf(body);
  if (!rows) {
    // Not rows (e.g. a CSV body from an older walk): hand back the text as stored.
    return { text: body, structured: { ok: true, result_id: id } };
  }
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  const limit = Math.min(READ_MAX_LIMIT, Math.max(1, Math.floor(input.limit ?? READ_DEFAULT_LIMIT)));
  const slice = rows.slice(offset, offset + limit);
  const format = input.format ?? "json";
  const end = offset + slice.length;
  const structured: Record<string, unknown> = {
    ok: true,
    result_id: id,
    format,
    offset,
    total: rows.length,
    resource: resultUri(id),
  };
  // A CSV read keeps the table once, in the text.
  if (format !== "csv") structured.rows = slice;
  const more = end < rows.length ? ` Next: offset ${end}.` : "";
  const text = [
    `## SocialCrawl Stored Result`,
    `**Result:** ${id} · rows ${slice.length === 0 ? "none" : `${offset + 1}-${end}`} of ${rows.length} (${format}).${more}`,
    "",
    renderRows(slice, format),
  ].join("\n");
  return { text, structured };
}
/** Stable identity for dedupe: the row's `id`, else its `url`, else its whole JSON. */
function rowKey(row: unknown): string {
  if (typeof row === "object" && row !== null) {
    const r = row as Record<string, unknown>;
    if (typeof r.id === "string" || typeof r.id === "number") return `id:${r.id}`;
    if (typeof r.url === "string") return `url:${r.url}`;
  }
  return `json:${JSON.stringify(row)}`;
}

/**
 * Walk a paged endpoint (cursor) until `items` unique rows, the last page, or
 * the credit budget (`max_credits`). Quotes first and refuses, free, when one
 * page's hold already exceeds the budget; asks once for the whole walk when it
 * could spend past the confirmation threshold; stops cleanly on a 402. The
 * rows are stored (JSONL by default) behind a resource link.
 */
export async function collectStructured(ctx: ApiContext, raw: CollectParams): Promise<ToolOutput> {
  if (raw.result_id !== undefined) return readStored(ctx, raw);
  if (!raw.id) {
    return fail('Error: Missing required parameter(s): `id` (e.g. "tiktok/post/comments"), or `result_id` to read a stored result. No credits were charged.');
  }
  if (raw.items === undefined) {
    return fail("Error: Missing required parameter(s): `items` (unique rows to collect). No credits were charged.");
  }
  const input = { ...raw, id: raw.id, items: raw.items };
  const slash = input.id.indexOf("/");
  const platformSlug = slash > 0 ? input.id.slice(0, slash) : "";
  const resource = slash > 0 ? input.id.slice(slash + 1) : "";
  if (!platformSlug || !resource) {
    return fail(`Error: Invalid parameter value — \`id\` must be platform/resource, e.g. "tiktok/post/comments"; got "${input.id}". No credits were charged.`);
  }
  if (!findPlatform(platformSlug)) {
    return fail(`Error: Unknown platform "${platformSlug}". Use socialcrawl_find to see the platforms.`);
  }
  const resolved = resolveEndpoint(platformSlug, resource, "GET");
  if (!resolved) {
    return fail(`Error: Unknown resource "${resource}" for platform "${platformSlug}". Use socialcrawl_find with platform "${platformSlug}" to see its endpoints.`);
  }
  const { endpoint } = resolved;
  if (!endpoint.pagination) {
    return fail(`Error: \`${input.id}\` does not paginate, so it cannot be walked by socialcrawl_collect. Use socialcrawl_request for a single call. No credits were charged.`);
  }

  const pageParams: Record<string, string> = { ...resolved.pathValues, ...stringifyParams(input.params) };
  delete pageParams.cursor;
  const endpointName = `${platformSlug}/${endpoint.resource}`;

  // Quote one page, then the whole walk: pages = items / page size, capped by the budget.
  const quote = await quoteCall(ctx, endpoint, pageParams, input.max_credits);
  const limit = Number(pageParams.limit);
  const pageSize = endpoint.pricing.pageSize ?? (Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_PAGE_SIZE);
  const projectedPages = Math.min(MAX_PAGES, Math.ceil(input.items / pageSize));
  const projected = quote.hold * projectedPages;
  const exposure = input.max_credits === undefined ? projected : Math.min(projected, input.max_credits);
  const stop = await checkGuard(ctx, {
    hold: quote.hold,
    exposure,
    maxCredits: input.max_credits,
    confirm: input.confirm,
    subject: `Collecting ${input.items} rows from ${endpointName} (about ${projectedPages} page${projectedPages === 1 ? "" : "s"} at up to ${quote.hold} credits each)`,
  });
  if (stop) return { text: stop.text, structured: stop.structured };

  const rows: unknown[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let pages = 0;
  let used = 0;
  let estimated = false;
  // Without max_credits the walk may spend what was projected (and, above the
  // threshold, confirmed), no more.
  const budget = input.max_credits ?? projected;
  let remaining: number | undefined;
  let cursor: string | null = null;
  let hasMore = false;
  let reason: StopReason = "exhausted";
  const warnings: string[] = [];

  for (;;) {
    if (rows.length >= input.items) {
      reason = "items";
      break;
    }
    if (pages >= MAX_PAGES) {
      reason = "page_limit";
      break;
    }
    if (used + quote.hold > budget) {
      reason = "budget";
      warnings.push(
        input.max_credits !== undefined
          ? `Stopped at max_credits (${budget}): another page could hold ${quote.hold} more. Pass a larger max_credits to continue.`
          : `Stopped at the projected budget of ${budget} credits (pages returned fewer rows than the page size). Pass max_credits, or confirm a larger amount, to continue.`,
      );
      break;
    }

    const call = await requestPage(
      ctx,
      {
        platform: platformSlug,
        resource,
        params: cursor ? { ...pageParams, cursor } : pageParams,
        fields: input.fields,
      },
      { skipGuard: true, walk: true, hold: quote.hold },
    );

    if (call.output.structured.ok !== false && !call.envelope) {
      // Billed, but the body is not an envelope: count the hold, keep what we have.
      pages++;
      used += quote.hold;
      estimated = true;
      reason = "error";
      warnings.push(`Page ${pages} returned a body that is not JSON; counted at its quoted hold (${quote.hold}cr). Rows collected so far are kept.`);
      break;
    }
    if (call.output.structured.ok === false) {
      if (pages === 0) return call.output;
      const s = call.output.structured;
      reason = s.code === "INSUFFICIENT_CREDITS" || s.code === "KEY_BUDGET_EXCEEDED" ? "insufficient_credits" : "error";
      warnings.push(`Stopped on page ${pages + 1}: ${String(s.reason ?? "request failed")}${s.code ? ` (${String(s.code)})` : ""}. Rows collected so far are kept.`);
      break;
    }

    pages++;
    const env = structureEnvelope(call.envelope);
    const credits = (env.credits ?? {}) as { used?: number; remaining?: number };
    if (typeof credits.used === "number" && Number.isFinite(credits.used)) used += credits.used;
    else {
      used += quote.hold;
      estimated = true;
    }
    if (credits.remaining !== undefined) remaining = credits.remaining;
    if (Array.isArray(env.warnings)) for (const w of env.warnings) if (!warnings.includes(w as string)) warnings.push(w as string);

    let added = 0;
    for (const row of (env.rows as unknown[] | undefined) ?? []) {
      const key = rowKey(row);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      rows.push(row);
      added++;
    }
    const paging = env.paging as { has_more: boolean; next_cursor: string | null } | undefined;
    hasMore = paging?.has_more === true;
    cursor = paging?.next_cursor ?? null;

    if (rows.length >= input.items) {
      reason = "items";
      break;
    }
    if (!hasMore || !cursor) {
      reason = "exhausted";
      break;
    }
    if (added === 0) {
      reason = "no_new_rows";
      break;
    }
  }

  const kept = rows.slice(0, input.items);
  const format = input.format ?? "jsonl";
  const body =
    format === "jsonl"
      ? kept.map((r) => JSON.stringify(r)).join("\n")
      : format === "json"
        ? JSON.stringify(kept)
        : toCsv(flattenRows(kept));
  let uri: string | undefined;
  let resultId: string | undefined;
  if (kept.length > 0) {
    const id = randomUUID();
    if (resultsStore.put(scopeOf(ctx.apiKey), id, body)) {
      uri = resultUri(id);
      resultId = id;
      // The rows as JSON too, so a result_id read can slice and re-format them.
      if (format !== "json") resultsStore.put(scopeOf(ctx.apiKey), rowsKey(id), JSON.stringify(kept));
    } else warnings.push(`collected rows (${Buffer.byteLength(body).toLocaleString()} bytes) are too large to store; collect fewer items.`);
  }
  // Whole in the text when the rows, in the format asked for, fit; whole in structuredContent when their JSON does.
  const fewRows = kept.length > 0 && kept.length <= INLINE_MAX_ROWS;
  const rendered = fewRows ? renderRows(kept, format) : "";
  const inline = fewRows && Buffer.byteLength(rendered) <= INLINE_MAX_BYTES;
  const rowsInline = fewRows && Buffer.byteLength(JSON.stringify(kept)) <= INLINE_MAX_BYTES;

  const total = sessionTotal(ctx.apiKey);
  const structured: Record<string, unknown> = {
    ok: true,
    endpoint: endpointName,
    format,
    items: { collected: kept.length, requested: input.items, duplicates },
    pages,
    stop_reason: reason,
    credits: {
      used,
      ...(remaining !== undefined ? { remaining } : {}),
      quoted_max: quote.hold,
      ...(estimated ? { estimated: true } : {}),
      session_total: total,
    },
    paging: { has_more: hasMore && cursor !== null, next_cursor: hasMore ? cursor : null },
    ...(rowsInline ? { rows: kept } : { sample: kept.slice(0, SAMPLE_ROWS) }),
  };
  if (uri) structured.resource = uri;
  if (resultId) structured.result_id = resultId;
  if (warnings.length > 0) structured.warnings = warnings;

  const where = cursor && cursor.length > 64 ? " (full value: structuredContent paging.next_cursor)" : "";
  const resume =
    hasMore && cursor && reason !== "items" && reason !== "exhausted"
      ? ` Resume with params.cursor="${shortCursor(cursor)}"${where}.`
      : hasMore && cursor && reason === "items"
        ? ` More rows remain; next cursor "${shortCursor(cursor)}"${where}.`
        : "";
  const text = [
    `## SocialCrawl Collect`,
    `**Endpoint:** \`GET /v1/${endpointName}\` walked ${pages} page${pages === 1 ? "" : "s"} (${quote.source} quote: up to ${quote.hold}cr per page)`,
    `**Result:** ok ${endpointName} · ${kept.length} of ${input.items} items (${duplicates} duplicate${duplicates === 1 ? "" : "s"} dropped) · credits used ${used}${remaining !== undefined ? `, ${remaining} remaining` : ""} · session total ${total} · stopped: ${reason}.${resume}`,
    resultId
      ? inline
        ? `All ${kept.length} rows below (${format}). To re-read or re-format them, read it in this session with result_id ${resultId} (socialcrawl_collect).`
        : `All ${kept.length} rows (${format}) are stored; first ${Math.min(SAMPLE_ROWS, kept.length)} below. Read them in this session with result_id ${resultId}: socialcrawl_collect { result_id, offset, limit, format }.`
      : "",
    kept.length > 0 ? `\n${inline ? rendered : `\`\`\`json\n${JSON.stringify(kept.slice(0, SAMPLE_ROWS))}\n\`\`\``}` : "",
    ...warnings.map((w) => `Note: ${w}`),
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    text,
    structured,
    links: uri
      ? [{ uri, name: `collected ${endpointName}`, description: `${kept.length} rows as ${format}`, mimeType: MIME[format] }]
      : undefined,
  };
}
