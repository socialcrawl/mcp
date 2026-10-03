/**
 * Server-Sent Events, consumed server-side. The streaming endpoints (prism
 * composites, universal search) write `data: <json>\n\n` frames, each a chunk
 * with a `type`. `readSse` parses them as they arrive; `assembleSse` folds the
 * chunks into the one envelope the non-streaming path would have returned.
 */

export type SseEvent = Record<string, unknown>;

function parseFrame(frame: string): SseEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const raw of frame.split("\n")) {
    if (raw === "" || raw.startsWith(":")) continue;
    const colon = raw.indexOf(":");
    const field = colon < 0 ? raw : raw.slice(0, colon);
    const value = colon < 0 ? "" : raw.slice(colon + 1).replace(/^ /, "");
    if (field === "data") data.push(value);
    else if (field === "event") event = value;
  }
  const payload = data.join("\n");
  if (payload === "" || payload === "[DONE]") return undefined;
  try {
    const json: unknown = JSON.parse(payload);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const obj = json as SseEvent;
      return event && obj.type === undefined ? { type: event, ...obj } : obj;
    }
  } catch {
    // not JSON: kept as text below
  }
  return { type: event ?? "message", data: payload };
}

/** Most chunks one stream may deliver before the read is cut. */
export const MAX_SSE_EVENTS = 2000;
/** Most bytes one stream may deliver before the read is cut. */
export const MAX_SSE_BYTES = 8 * 1024 * 1024;
/** Largest unterminated frame held while waiting for its blank line. */
export const MAX_SSE_BUFFER_BYTES = 1024 * 1024;

export interface SseLimits {
  maxEvents?: number;
  maxBytes?: number;
  maxBufferBytes?: number;
  /** Aborting cancels the reader and rejects with an AbortError. */
  signal?: AbortSignal;
}

export type SseTruncation = "events" | "bytes" | "frame";

/**
 * Read a streaming Response to its end, calling `onEvent` once per frame as it
 * lands. Memory is bounded: past the event, byte or buffered-frame cap the
 * reader is cancelled and `truncated` names which cap was hit.
 */
export async function readSse(
  response: Response,
  onEvent: (event: SseEvent) => void,
  limits: SseLimits = {},
): Promise<{ truncated?: SseTruncation }> {
  if (!response.body) return {};
  const maxEvents = limits.maxEvents ?? MAX_SSE_EVENTS;
  const maxBytes = limits.maxBytes ?? MAX_SSE_BYTES;
  const maxBuffer = limits.maxBufferBytes ?? MAX_SSE_BUFFER_BYTES;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const onAbort = (): void => void reader.cancel().catch(() => undefined);
  limits.signal?.addEventListener("abort", onAbort, { once: true });
  let buffer = "";
  let events = 0;
  let bytes = 0;
  let truncated: SseTruncation | undefined;
  let clean = false;
  const emit = (event: SseEvent): boolean => {
    if (events >= maxEvents) {
      truncated = "events";
      return false;
    }
    events += 1;
    onEvent(event);
    return true;
  };
  const drain = (final: boolean): void => {
    // A lone trailing CR may be half of a CRLF split across chunks: hold it back.
    const held = !final && buffer.endsWith("\r") ? "\r" : "";
    buffer = buffer.slice(0, buffer.length - held.length).replace(/\r\n?/g, "\n") + held;
    let at = buffer.indexOf("\n\n");
    while (at >= 0 && !truncated) {
      const event = parseFrame(buffer.slice(0, at));
      buffer = buffer.slice(at + 2);
      if (event && !emit(event)) return;
      at = buffer.indexOf("\n\n");
    }
    if (truncated) return;
    if (final && buffer.trim() !== "") {
      const event = parseFrame(buffer);
      buffer = "";
      if (event) emit(event);
    } else if (buffer.length > maxBuffer) {
      truncated = "frame";
    }
  };
  try {
    while (!truncated) {
      const { done, value } = await reader.read();
      if (limits.signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        truncated = "bytes";
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      drain(false);
    }
    if (!truncated) {
      buffer += decoder.decode();
      drain(true);
    }
    clean = !truncated;
    return truncated ? { truncated } : {};
  } finally {
    limits.signal?.removeEventListener("abort", onAbort);
    // Anything but a clean end leaves the stream open: cancel it before letting go.
    if (!clean) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** One-line description of a chunk, for a progress notification. */
export function describeChunk(event: SseEvent): string {
  const type = typeof event.type === "string" ? event.type : "chunk";
  const leg = event.leg as { endpoint?: unknown } | undefined;
  const detail = [event.source, event.key, event.candidate_id, leg?.endpoint].find(
    (v): v is string => typeof v === "string" && v !== "",
  );
  return detail ? `${type}: ${detail}` : type;
}

export interface Assembled {
  /** The envelope shape of a JSON response: `{ success, data, credits_used, request_id, warnings }`. */
  envelope: Record<string, unknown>;
  /** Set when the stream failed and delivered nothing: the caller reports this as an error. */
  error?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Fold a finished stream into one envelope. Prism chunks (`result` {key,value},
 * `leg`) land under `data[key]` / `data.legs`; search chunks land as
 * `data.items` (the final ranking, else the per-source rows merged),
 * `data.clusters`, `data.enrichment`, `data.sources_failed`. The terminal
 * `done.summary` becomes `data.summary` and supplies `credits_used`.
 */
export function assembleSse(events: SseEvent[], opts: { truncated?: SseTruncation } = {}): Assembled {
  const data: Record<string, unknown> = {};
  const legs: unknown[] = [];
  const perSource: unknown[] = [];
  const warnings: string[] = [];
  const failed: Record<string, unknown> = {};
  const comments: Record<string, unknown> = {};
  const transcripts: Record<string, unknown> = {};
  const errors: { code: string; message: string }[] = [];
  let ranked: unknown[] | undefined;
  let summary: Record<string, unknown> | undefined;
  let requestId: string | undefined;

  for (const e of events) {
    switch (e.type) {
      case "meta":
        if (typeof e.request_id === "string") requestId = e.request_id;
        if (e.plan !== undefined) data.plan = e.plan;
        break;
      case "plan_refined":
        if (e.plan !== undefined) data.plan = e.plan;
        if (e.legs !== undefined) data.plan_legs = e.legs;
        break;
      case "leg":
        legs.push(e.leg);
        break;
      case "result":
        if (typeof e.key === "string") data[e.key] = e.value;
        break;
      case "items":
        if (Array.isArray(e.items)) perSource.push(...e.items);
        break;
      case "ranked_final":
        if (Array.isArray(e.items)) ranked = e.items;
        break;
      case "clusters":
        data.clusters = e.clusters;
        break;
      case "comments_enriched":
        if (typeof e.candidate_id === "string") comments[e.candidate_id] = e.comments;
        break;
      case "transcript_enriched":
        if (typeof e.candidate_id === "string") transcripts[e.candidate_id] = e.transcript;
        break;
      case "source_failed":
        if (typeof e.source === "string") failed[e.source] = e.error;
        break;
      case "warning":
        if (typeof e.message === "string") warnings.push(e.message);
        break;
      case "error":
        errors.push({ code: String(e.code ?? "STREAM_ERROR"), message: String(e.message ?? e.data ?? "") });
        break;
      case "done":
        if (isObj(e.summary)) summary = e.summary;
        break;
      default:
        break;
    }
  }

  if (legs.length > 0 && data.legs === undefined) data.legs = legs;
  const items = ranked ?? (perSource.length > 0 ? perSource : undefined);
  if (items) data.items = items;
  if (Object.keys(failed).length > 0) data.sources_failed = failed;
  if (Object.keys(comments).length > 0 || Object.keys(transcripts).length > 0) {
    data.enrichment = {
      ...(Object.keys(comments).length > 0 ? { comments } : {}),
      ...(Object.keys(transcripts).length > 0 ? { transcripts } : {}),
    };
  }
  if (summary) data.summary = summary;

  const delivered = Object.keys(data).filter((k) => k !== "summary").length > 0;
  if (errors.length > 0 && !delivered) {
    const first = errors[0];
    const refunded = summary?.refunded === true ? " Credits were refunded." : "";
    return {
      envelope: {},
      error: `Error: The stream failed before returning any data (${first.code}). ${first.message}${refunded}\nerror_code: ${first.code}`,
    };
  }
  for (const err of errors) warnings.push(`stream error ${err.code}: ${err.message}`);
  if (opts.truncated) {
    warnings.push(`The stream exceeded the ${opts.truncated} cap and was cut; this result holds only what was read before that.`);
  } else if (!summary) {
    warnings.push("The stream ended without a terminal done chunk; the result may be partial.");
  }

  const used = [summary?.credits_used, summary?.credits_charged].find(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const envelope: Record<string, unknown> = { success: true, streamed: true, data };
  if (used !== undefined) envelope.credits_used = used;
  if (requestId) envelope.request_id = requestId;
  if (warnings.length > 0) envelope.warnings = warnings;
  if (opts.truncated) envelope.stream_truncated = opts.truncated;
  if (errors.length > 0) {
    // Data arrived, then the stream failed: the caller must surface this as a failure that carries the data.
    envelope.partial = true;
    envelope.stream_error = errors[0];
  }
  return { envelope };
}
