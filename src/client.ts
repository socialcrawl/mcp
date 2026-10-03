import { TIMEOUT_MS, CHARACTER_LIMIT } from "./constants.js";
import type { ApiContext } from "./context.js";
import { assembleSse, describeChunk, readSse } from "./sse.js";
import type { SseEvent } from "./sse.js";

/** One streamed chunk landed: `progress` counts chunks so far (the total is unknown). */
export interface ProgressTick {
  progress: number;
  message?: string;
}

/** Response facts the caller may want beyond the body text. */
export interface ResponseMeta {
  /** Seconds from a `Retry-After` header, when the server sent one. */
  retryAfterS?: number;
}

/** Options shared by `makeRequest` and `apiRequest` for slow calls. */
interface LongCallOptions {
  /** Client timeout for this call; defaults to the fixed 30 s. */
  timeoutMs?: number;
  /** Send `Accept: text/event-stream`. A stream is assembled whether or not this is set. */
  stream?: boolean;
  /** Called once per streamed chunk. */
  onProgress?: (tick: ProgressTick) => void;
  /** Filled in with response facts (Retry-After). */
  meta?: ResponseMeta;
}

/** `Retry-After` as whole seconds (delta-seconds or an HTTP date), capped at an hour. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  // Only the two forms the header allows: delta-seconds or an IMF-fixdate HTTP date.
  const secs = /^\d+$/.test(v)
    ? Number(v)
    : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(v)
      ? Math.ceil((Date.parse(v) - now) / 1000)
      : Number.NaN;
  if (!Number.isFinite(secs)) return undefined;
  return Math.min(3600, Math.max(0, secs));
}

function isEventStream(response: Response): boolean {
  return (response.headers?.get("content-type") ?? "").includes("text/event-stream");
}

/** What a call has read so far, so a timeout can report it. */
interface CallState {
  events: SseEvent[];
  requestId?: string;
}

/**
 * Body of a 2xx response as the text the JSON path would return. An SSE body is
 * consumed to its end (bounded by the SSE caps) and folded into one envelope; a
 * stream that failed without delivering anything comes back as an error string.
 */
async function readSuccessBody(
  response: Response,
  options: LongCallOptions,
  state: CallState,
  signal: AbortSignal,
): Promise<string> {
  if (!isEventStream(response)) return response.text();
  let n = 0;
  const { truncated } = await readSse(
    response,
    (e) => {
      state.events.push(e);
      n += 1;
      options.onProgress?.({ progress: n, message: describeChunk(e) });
    },
    { signal },
  );
  const assembled = assembleSse(state.events, { truncated });
  return assembled.error ?? JSON.stringify(assembled.envelope);
}

/** Longest stretch of partial stream data quoted in a timeout message. */
const PARTIAL_QUOTE_CHARS = 2000;

/**
 * The timeout text. The call is abandoned client-side only: the server may
 * still finish it and bill it, so say so, say where to check, and hand back
 * whatever the stream had already delivered.
 */
function timeoutMessage(options: LongCallOptions, state: CallState, suffix: string): string {
  const assembled = state.events.length > 0 ? assembleSse(state.events) : undefined;
  const requestId = state.requestId ?? (typeof assembled?.envelope.request_id === "string" ? assembled.envelope.request_id : undefined);
  let partial = "No partial data had been received.";
  if (assembled) {
    const json = JSON.stringify(assembled.envelope.data ?? {});
    const quoted = json.length > PARTIAL_QUOTE_CHARS ? `${json.slice(0, PARTIAL_QUOTE_CHARS)}... [cut]` : json;
    partial = `Partial data read from the stream before the timeout (${state.events.length} chunks): ${quoted}`;
  }
  const lines = [
    `Error: Request timed out after ${(options.timeoutMs ?? TIMEOUT_MS) / 1000} seconds.${suffix} The server may still complete this call and bill it; refunds follow the API's own rules. Before retrying, check what was charged with socialcrawl_account view=transactions${requestId ? ` (request_id ${requestId})` : ""}. ${partial}`,
  ];
  if (requestId) lines.push(`request_id: ${requestId}`);
  return lines.join("\n");
}

export const NO_API_KEY_ERROR =
  "Error: No API key configured. Local (stdio): set SOCIALCRAWL_API_KEY in your MCP client's env config. " +
  "Remote (HTTP): send an 'Authorization: Bearer <key>' or 'x-api-key: <key>' header. " +
  "Get a free key at socialcrawl.dev (100 credits, no credit card required).";

interface RequestOptions extends LongCallOptions {
  platform: string;
  resource: string;
  params?: Record<string, string>;
  /**
   * Optional `Idempotency-Key` header value (BIL-02). Pass an opaque, client-generated
   * string (UUIDv4 recommended) to enable safe retries. The first response is stored
   * server-side for 24h; replays return the original body, status, and credits_used
   * (with a `X-Idempotent-Replay: true` header), and deduct 0 new credits.
   */
  idempotencyKey?: string;
  /**
   * Return the body whole. The caller shapes it at row boundaries itself
   * (`socialcrawl_request`); the default cut is a plain character slice and
   * can land mid-JSON.
   */
  raw?: boolean;
}

export async function makeRequest(ctx: ApiContext, options: RequestOptions): Promise<string> {
  if (!ctx.apiKey) {
    return NO_API_KEY_ERROR;
  }

  const url = buildUrl(ctx, options);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const state: CallState = { events: [] };

  const headers: Record<string, string> = { "x-api-key": ctx.apiKey };
  if (options.stream) headers.Accept = "text/event-stream";
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    state.requestId = response.headers?.get("x-request-id") ?? undefined;
    const retryAfterS = parseRetryAfter(response.headers?.get("retry-after"));
    if (options.meta && retryAfterS !== undefined) options.meta.retryAfterS = retryAfterS;

    if (!response.ok) {
      const body = await response.text();
      // `?.` so a fetch-like response without headers still reports the API
      // error rather than throwing into the "Unexpected error" branch below.
      return formatHttpError(response.status, body, options, response.headers?.get("x-request-id"), retryAfterS);
    }

    const body = await readSuccessBody(response, options, state, controller.signal);
    return options.raw ? body : truncateResponse(body);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return timeoutMessage(options, state, " The platform may be experiencing delays.");
    }
    if (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("network"))) {
      return `Error: Could not reach SocialCrawl API at ${ctx.baseUrl}. Check your network connection.`;
    }
    return `Error: Unexpected error — ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface ApiRequestOptions extends LongCallOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path under the base URL, starting with a slash (e.g. "/v1/monitors"). */
  path: string;
  query?: Record<string, string>;
  /** JSON body for POST/PUT/PATCH. Serialised with a Content-Type header. */
  body?: unknown;
  /** Optional `Idempotency-Key` header (BIL-02) — retry-safe writes. */
  idempotencyKey?: string;
  /**
   * Platform slug used only to label 404s in the error formatter. Defaults to
   * "monitors" for backward compatibility with the monitors caller.
   */
  errorPlatform?: string;
  /** Return the body whole (see `RequestOptions.raw`). */
  raw?: boolean;
  /**
   * Set for the handful of `/v1` routes that carry `security: []` — currently
   * only `GET /v1/status`. Those answer without a key, and discovery must not
   * hard-require auth. The key is still sent when one is configured.
   */
  anonymous?: boolean;
}

/**
 * General-purpose authed request for `/v1/*` resources the GET-only
 * `makeRequest` can't express — the stateful monitors, web, and cohorts
 * families (POST/PUT/GET/PATCH/DELETE with JSON bodies and `:id` path params)
 * and the registry's batch POST endpoints (youtube/videos, prism/*). Shares the
 * same x-api-key auth, timeout, error mapping, and truncation.
 */
export async function apiRequest(ctx: ApiContext, options: ApiRequestOptions): Promise<string> {
  if (!ctx.apiKey && !options.anonymous) {
    return NO_API_KEY_ERROR;
  }

  let url = `${ctx.baseUrl}${options.path}`;
  if (options.query && Object.keys(options.query).length > 0) {
    url += `?${new URLSearchParams(options.query).toString()}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

  const state: CallState = { events: [] };

  const headers: Record<string, string> = {};
  if (ctx.apiKey) headers["x-api-key"] = ctx.apiKey;
  if (options.stream) headers.Accept = "text/event-stream";
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  let bodyInit: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyInit = JSON.stringify(options.body);
  }

  // Reuse the registry error formatter by mapping path → a pseudo endpoint.
  const errCtx: RequestOptions = {
    platform: options.errorPlatform ?? "monitors",
    resource: options.path,
  };

  try {
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: bodyInit,
      signal: controller.signal,
    });

    // 204 No Content (DELETE) has an empty body — report success explicitly.
    if (response.status === 204) {
      return JSON.stringify({ success: true, status: 204 });
    }

    state.requestId = response.headers?.get("x-request-id") ?? undefined;
    const retryAfterS = parseRetryAfter(response.headers?.get("retry-after"));
    if (options.meta && retryAfterS !== undefined) options.meta.retryAfterS = retryAfterS;
    if (!response.ok) {
      const body = await response.text();
      return formatHttpError(response.status, body, errCtx, response.headers?.get("x-request-id"), retryAfterS);
    }
    const body = await readSuccessBody(response, options, state, controller.signal);
    return options.raw ? body : truncateResponse(body);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return timeoutMessage(options, state, "");
    }
    if (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("network"))) {
      return `Error: Could not reach SocialCrawl API at ${ctx.baseUrl}. Check your network connection.`;
    }
    return `Error: Unexpected error — ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildUrl(ctx: ApiContext, options: RequestOptions): string {
  const path =
    options.platform === "meta"
      ? `/v1/${options.resource}`
      : `/v1/${options.platform}/${options.resource}`;
  const base = `${ctx.baseUrl}${path}`;
  if (!options.params || Object.keys(options.params).length === 0) {
    return base;
  }
  const searchParams = new URLSearchParams(options.params);
  return `${base}?${searchParams.toString()}`;
}

interface ParsedError {
  error?: {
    type?: string;
    message?: string;
    doc_url?: string;
    details?: { reason?: unknown; did_you_mean?: unknown };
  };
  credits_remaining?: number;
  request_id?: unknown;
}

/**
 * Maps a non-2xx response to the text the agent sees. The server's own
 * `error.message` is always passed through (a fixed lead-in only names the
 * category), and `details.reason` plus the `request_id` (from the body, else the
 * `X-Request-Id` header) are appended on their own lines: the request id is what
 * support needs to find the call, and dropping it left customers with nothing
 * to quote. The "Error:" prefix is what the tools key on to treat it as a failure.
 */
export function formatHttpError(
  status: number,
  body: string,
  options: RequestOptions,
  headerRequestId?: string | null,
  retryAfterS?: number,
): string {
  let parsed: ParsedError | null = null;
  try {
    const json: unknown = JSON.parse(body);
    if (json && typeof json === "object") parsed = json as ParsedError;
  } catch {
    // body is not JSON, use raw text
  }

  const bodyRequestId = nonEmptyString(parsed?.request_id);
  const requestId = bodyRequestId ?? nonEmptyString(headerRequestId);
  const reason = nonEmptyString(parsed?.error?.details?.reason);

  const lines = [describeHttpError(status, body, parsed, options)];
  if (reason) lines.push(`reason: ${reason}`);
  const suggestion = nonEmptyString(parsed?.error?.details?.did_you_mean);
  if (suggestion) lines.push(`did_you_mean: ${suggestion}`);
  if (requestId) lines.push(`request_id: ${requestId}`);
  // Machine-readable tail: the structured error result reads these lines.
  if (retryAfterS !== undefined) lines.push(`retry_after_s: ${retryAfterS}`);
  lines.push(`status: ${status}`);
  if (parsed?.error?.type) lines.push(`error_code: ${parsed.error.type}`);
  return lines.join("\n");
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Ends a server message with punctuation so a following sentence reads cleanly. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function describeHttpError(
  status: number,
  body: string,
  parsed: ParsedError | null,
  options: RequestOptions,
): string {
  const errorType = parsed?.error?.type ?? "UNKNOWN_ERROR";
  const serverMessage = nonEmptyString(parsed?.error?.message);
  const errorMessage = serverMessage ?? body;
  const docUrl = parsed?.error?.doc_url;
  // The server's message as a leading sentence, or nothing when it sent none.
  const said = serverMessage ? `${sentence(serverMessage)} ` : "";

  switch (status) {
    case 401:
      return `Error: Invalid API key. ${said}Check your SOCIALCRAWL_API_KEY configuration.`;
    case 402:
      // A spent per-key cap needs the cap raised; topping up the account would
      // not clear it, so this one must not point at billing.
      if (errorType === "KEY_BUDGET_EXCEEDED") {
        return `Error: ${serverMessage ?? "This API key has spent its per-key credit limit. Raise the key's limit in the dashboard; topping up will not clear it."}`;
      }
      return `Error: Insufficient credits (${parsed?.credits_remaining ?? 0} remaining). ${said}Top up at socialcrawl.dev/dashboard/billing.`;
    case 400:
      return `Error: ${errorMessage}`;
    case 404:
      if (errorType === "RESOURCE_NOT_FOUND") {
        return serverMessage
          ? `Error: Resource not found (${options.platform}). ${serverMessage}`
          : `Error: Resource not found upstream. The requested ${options.platform} resource doesn't exist. Credits have been refunded automatically.`;
      }
      return `Error: Endpoint /v1/${options.platform}/${options.resource} not found. ${said}Use socialcrawl_find with platform "${options.platform}" to see its endpoints.`;
    case 405:
      return `Error: Method not allowed. ${serverMessage ?? "SocialCrawl /v1/* endpoints accept GET requests only."}`;
    // 409 and 422 are the idempotency codes on the registry surface, but the
    // stateful families reuse them for their own conflicts (a cohort identity
    // already claimed by another external_id, a query that has not succeeded
    // yet). Only claim it is an idempotency problem when the envelope says so;
    // otherwise pass the server's own message through.
    case 409:
      if (errorType === "IDEMPOTENCY_KEY_CONFLICT" || errorType === "UNKNOWN_ERROR") {
        return serverMessage
          ? `Error: Idempotency-Key conflict. ${said}Generate a fresh key (UUIDv4 recommended).`
          : "Error: Idempotency-Key conflict. The key you supplied was already used by another account. Generate a fresh key (UUIDv4 recommended).";
      }
      return `Error: ${errorType} — ${errorMessage}`;
    case 413:
      return `Error: ${errorType} — ${errorMessage}`;
    case 422:
      if (
        errorType === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" ||
        errorType === "UNKNOWN_ERROR"
      ) {
        return serverMessage
          ? `Error: Idempotency-Key payload mismatch. ${said}Either use a different key, or repeat the original request exactly.`
          : "Error: Idempotency-Key payload mismatch. You reused the same key with different parameters. Either use a different key, or repeat the original request exactly.";
      }
      return `Error: ${errorType} — ${errorMessage}`;
    // 429 covers two limits (600 requests/minute and 50 in flight), and 502/503
    // carry a platform-specific cause and retry hint. Only the server knows
    // which, so its message leads and the fixed line is the no-body fallback.
    case 429:
      return `Error: ${serverMessage ?? "Too many concurrent requests on this API key (50 max). Wait a moment and try again."}`;
    case 502:
      return serverMessage
        ? `Error: Upstream error. ${serverMessage}`
        : "Error: Upstream error fetching data. Credits have been auto-refunded.";
    case 503:
      return serverMessage
        ? `Error: Service unavailable. ${serverMessage}`
        : `Error: Platform ${options.platform} is temporarily unavailable. Credits have been auto-refunded. Retry in 30 seconds.`;
    default: {
      const docHint = docUrl ? ` See ${docUrl}` : "";
      return `Error (${status}): ${errorType} — ${errorMessage}${docHint}`;
    }
  }
}

function truncateResponse(body: string): string {
  if (body.length <= CHARACTER_LIMIT) {
    return body;
  }
  return `${body.slice(0, CHARACTER_LIMIT)}\n\n[Response truncated at ${CHARACTER_LIMIT.toLocaleString()} characters. Full response was ${body.length.toLocaleString()} characters.]`;
}
