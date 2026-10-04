import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Every tool error in this server is rendered as text that starts a line with
 * `Error:` (or `Error (<status>):` for an unmapped HTTP status). Tools that
 * call the API put a markdown header first, so the marker can sit a few lines
 * down — but always before the first code fence, which is where a successful
 * payload begins.
 */
const ERROR_LINE = /^Error(?::| \(\d+\):)/;
const HEADER_SCAN_LINES = 20;

export function isErrorText(text: string): boolean {
  if (ERROR_LINE.test(text)) return true;
  // Only API-calling tools prefix a header, and it is always a SocialCrawl one.
  if (!/^#{1,2} SocialCrawl/.test(text)) return false;
  for (const line of text.split("\n", HEADER_SCAN_LINES)) {
    if (line.startsWith("```")) return false;
    if (ERROR_LINE.test(line)) return true;
  }
  return false;
}

/** What a tool hands back: the text for older clients plus the structured twin. */
export interface ToolOutput {
  text: string;
  structured: Record<string, unknown>;
  /** `resource_link` blocks appended after the text (e.g. the full body of a cut page). */
  links?: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The one place a tool's text becomes an MCP result. A failure is flagged
 * `isError` so a client can branch on it instead of parsing prose; the text is
 * unchanged. Tools that declare an `outputSchema` pass their structured twin:
 * a success carries it as `structuredContent`, and a failure always carries the
 * error shape (the SDK does not validate output on `isError` results).
 */
export function toResult(text: string, structured?: Json, links?: ToolOutput["links"]): CallToolResult {
  const result: CallToolResult = { content: [{ type: "text", text }] };
  // A stream that failed after delivering data: a failure that still carries the data.
  const partial = structured?.ok === false && structured.partial === true;
  const failed = isErrorText(text);
  if (failed || partial) result.isError = true;
  if (!failed && links) for (const l of links) result.content.push({ type: "resource_link", ...l });
  if (structured) result.structuredContent = failed && !partial ? errorFromText(text) : structured;
  return result;
}

const FIXES: Record<string, string> = {
  NO_API_KEY: "Set SOCIALCRAWL_API_KEY (stdio) or send an Authorization: Bearer header (HTTP). A free key has 100 credits.",
  UNAUTHORIZED: "Check the API key; do not retry with the same key.",
  INSUFFICIENT_CREDITS: "Top up at socialcrawl.dev/dashboard/billing. Do not retry.",
  KEY_BUDGET_EXCEEDED: "Raise this key's credit limit in the dashboard. Do not retry.",
  OVER_MAX_CREDITS: "Raise max_credits or narrow the call (lower limit, drop include/label); nothing was charged.",
  CONFIRMATION_REQUIRED: "Ask the user, then repeat the call with confirm: true; nothing was billed.",
  NOT_PAGINATED: "Use socialcrawl_request for this endpoint; only endpoints with a cursor can be walked.",
  MISSING_PARAMETER: "Add the missing parameter(s) named in reason; no credits were charged.",
  INVALID_PARAMETER: "Correct the value(s) named in reason; no credits were charged.",
  UNKNOWN_PLATFORM: "Use did_you_mean, or socialcrawl_find with no task for valid slugs.",
  ENDPOINT_NOT_FOUND: "Use did_you_mean, or socialcrawl_find with the task for valid endpoints.",
  RESOURCE_NOT_FOUND: "The target does not exist or is private; check the id or URL. Not charged.",
  RATE_LIMITED: "Wait a few seconds, then retry once; keep concurrency under 50.",
  UPSTREAM_ERROR: "Credits were refunded; retry in about 30 seconds.",
  SERVICE_UNAVAILABLE: "Credits were refunded; retry in about 30 seconds.",
  TIMEOUT: "Retry once; narrow the request (limit, fewer params) if it repeats.",
  NETWORK_ERROR: "Check connectivity to the API, then retry.",
  WRONG_TOOL: "Use socialcrawl_manage with area web for the web platform.",
  VALIDATION_ERROR: "Apply did_you_mean or the correction in reason; a 400 is not charged.",
  RESULT_EXPIRED: "Repeat the request or walk; a cached repeat is free.",
  DRY_RUN_UNSUPPORTED: "Nothing was kept. Check the fields yourself, or create it for real without dry_run.",
};

const STATUS_CODES: Record<number, string> = {
  400: "BAD_REQUEST", 401: "UNAUTHORIZED", 402: "INSUFFICIENT_CREDITS", 404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED", 409: "CONFLICT", 422: "UNPROCESSABLE", 429: "RATE_LIMITED",
  502: "UPSTREAM_ERROR", 503: "SERVICE_UNAVAILABLE", 504: "UPSTREAM_TIMEOUT",
};

const LOCAL_CODES: Array<[RegExp, string, boolean]> = [
  [/^Error: No API key configured/, "NO_API_KEY", false],
  [/^Error: Missing required parameter/, "MISSING_PARAMETER", false],
  [/^Error: Invalid parameter value/, "INVALID_PARAMETER", false],
  [/^Error: Quoted hold of/, "OVER_MAX_CREDITS", false],
  [/^Error: `[^`]+` does not paginate/, "NOT_PAGINATED", false],
  [/^Error: Unknown platform/, "UNKNOWN_PLATFORM", false],
  [/^Error: Unknown resource|^Error: No endpoint/, "ENDPOINT_NOT_FOUND", false],
  [/^Error: The "web" platform/, "WRONG_TOOL", false],
  [/^Error: Request timed out/, "TIMEOUT", true],
  [/^Error: Could not reach/, "NETWORK_ERROR", true],
  [/^Error: No stored result/, "RESULT_EXPIRED", false],
  [/^Error: dry_run/, "DRY_RUN_UNSUPPORTED", false],
];

/**
 * Turn the error text every tool produces into the structured error shape.
 * HTTP errors end with `status:` / `error_code:` lines (see `formatHttpError`);
 * local errors (validation, unknown platform, no key) are recognised by their
 * fixed leading sentence.
 */
export function errorFromText(text: string): Json {
  const lines = text.split("\n");
  const start = Math.max(0, lines.findIndex((l) => ERROR_LINE.test(l)));
  const body = lines.slice(start);
  const meta = (key: string): string | undefined => {
    const line = body.find((l) => l.startsWith(`${key}: `));
    return line ? line.slice(key.length + 2).trim() : undefined;
  };
  const isMeta = (l: string): boolean => /^(reason|did_you_mean|request_id|status|error_code|retry_after_s): /.test(l);
  const messageLines: string[] = [];
  for (const l of body) {
    if (isMeta(l) || l.trim() === "") break;
    messageLines.push(l);
  }
  const first = messageLines.join(" ").replace(/^Error(?: \(\d+\))?:\s*/, "").trim();

  const status = Number(meta("status"));
  const local = LOCAL_CODES.find(([re]) => re.test(body[0]));
  let code = meta("error_code") ?? local?.[1] ?? STATUS_CODES[status] ?? "ERROR";
  const retryable =
    local?.[2] ?? (status === 429 || status >= 500 || code === "RATE_LIMITED" || code === "UPSTREAM_ERROR");
  // A bad-key 401 can be an unmapped type; the status is the stronger signal.
  if (status === 401 && code === "ERROR") code = "UNAUTHORIZED";

  const suggestions: string[] = [];
  const dym = meta("did_you_mean");
  if (dym) suggestions.push(dym);
  const platformOf = /(?:for|on) platform "([^"]+)"/.exec(first)?.[1];
  const closest = /Closest matches: ([^]*?)\.(?:\s|$)/.exec(text)?.[1];
  if (closest) {
    for (const m of closest.matchAll(/`([^`]+)`/g)) suggestions.push(platformOf ? `${platformOf}/${m[1]}` : m[1]);
  }
  const listIdx = body.indexOf("Did you mean:");
  if (listIdx >= 0) {
    for (const l of body.slice(listIdx + 1)) {
      const m = /^- `([^`]+)`/.exec(l);
      if (m) {
        const resource = m[1].replace(/^(?:GET|POST|PATCH|DELETE) /, "");
        suggestions.push(platformOf ? `${platformOf}/${resource}` : resource);
      }
    }
  }

  const out: Json = {
    ok: false,
    code,
    retryable,
    reason: meta("reason") ?? first,
  };
  const fix = FIXES[code];
  if (fix) out.fix = fix;
  if (suggestions.length > 0) out.did_you_mean = suggestions;
  const requestId = meta("request_id");
  if (requestId) out.request_id = requestId;
  const retryAfter = Number(meta("retry_after_s"));
  if (meta("retry_after_s") !== undefined && Number.isFinite(retryAfter)) out.retry_after_s = retryAfter;
  return out;
}

/**
 * Lift the API envelope (`{ success, data, credits_used, credits_remaining,
 * request_id, cached, pagination }`) into the structured fields. `data.items`
 * (or a bare array) becomes `rows`; any other keys beside the rows become
 * `page`; a non-list `data` is passed through whole.
 */
export function structureEnvelope(env: unknown, quotedMax?: number): Json {
  const out: Json = {};
  const e = isObject(env) ? env : {};
  const credits: Json = {};
  const used = num(e.credits_used);
  const remaining = num(e.credits_remaining);
  if (used !== undefined) credits.used = used;
  if (remaining !== undefined) credits.remaining = remaining;
  if (typeof e.cached === "boolean") credits.cached = e.cached;
  if (quotedMax !== undefined) credits.quoted_max = quotedMax;
  out.credits = credits;
  if (typeof e.request_id === "string" && e.request_id) out.request_id = e.request_id;

  const data = e.data;
  const pag = isObject(e.pagination) ? e.pagination : isObject(data) && isObject(data.pagination) ? data.pagination : undefined;
  if (pag && typeof pag.has_more === "boolean") {
    out.paging = {
      has_more: pag.has_more,
      next_cursor: typeof pag.next_cursor === "string" ? pag.next_cursor : null,
    };
  }

  const warnings: string[] = [];
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) for (const w of v) warnings.push(typeof w === "string" ? w : JSON.stringify(w));
  };
  collect(e.warnings);
  if (isObject(data)) collect(data._warnings);
  if (warnings.length > 0) out.warnings = warnings;
  if (e.hint !== undefined && e.hint !== null) out.hint = e.hint;

  if (Array.isArray(data)) {
    out.rows = data;
  } else if (isObject(data) && Array.isArray(data.items)) {
    out.rows = data.items;
    const page: Json = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== "items" && k !== "_warnings" && k !== "pagination") page[k] = v;
    }
    if (Object.keys(page).length > 0) out.page = page;
  } else if (data !== undefined) {
    out.data = data;
  }
  return out;
}

/** A cursor short enough to print, or its head with "…" (the full value stays in structuredContent). */
export function shortCursor(cursor: string, max = 64): string {
  return cursor.length <= max ? cursor : `${cursor.slice(0, max)}…`;
}

/** The 2-4 line human summary that heads the compact JSON in `content`. */
export function summaryLine(s: Json): string {
  const credits = (s.credits ?? {}) as Json;
  const parts: string[] = [`${s.ok === false ? "failed" : "ok"}${s.endpoint ? ` ${String(s.endpoint)}` : ""}`];
  const spent = [
    credits.used !== undefined ? `credits used ${credits.used}` : undefined,
    credits.remaining !== undefined ? `${credits.remaining} remaining` : undefined,
  ].filter(Boolean);
  if (spent.length > 0) parts.push(spent.join(", ") + (credits.cached === true ? " (cached)" : ""));
  if (Array.isArray(s.rows)) parts.push(`${s.rows.length} rows`);
  const paging = s.paging as Json | undefined;
  if (paging) parts.push(`has_more ${String(paging.has_more)}`);
  return parts.join(" · ");
}
