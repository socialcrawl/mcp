import { TIMEOUT_MS, CHARACTER_LIMIT } from "./constants.js";

function getBaseUrl(): string {
  return process.env.SOCIALCRAWL_BASE_URL ?? "https://www.socialcrawl.dev";
}

function getApiKey(): string {
  return process.env.SOCIALCRAWL_API_KEY ?? "";
}

interface RequestOptions {
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
}

export async function makeRequest(options: RequestOptions): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return "Error: No API key configured. Set SOCIALCRAWL_API_KEY in your MCP server environment. Get a free key at socialcrawl.dev (100 credits, no credit card required).";
  }

  const url = buildUrl(options);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = { "x-api-key": apiKey };
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    const body = await response.text();

    if (!response.ok) {
      return formatHttpError(response.status, body, options);
    }

    return truncateResponse(body);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return `Error: Request timed out after ${TIMEOUT_MS / 1000} seconds. The platform may be experiencing delays.`;
    }
    if (error instanceof TypeError && (error.message.includes("fetch") || error.message.includes("network"))) {
      return `Error: Could not reach SocialCrawl API at ${getBaseUrl()}. Check your network connection.`;
    }
    return `Error: Unexpected error — ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildUrl(options: RequestOptions): string {
  const path =
    options.platform === "meta"
      ? `/v1/${options.resource}`
      : `/v1/${options.platform}/${options.resource}`;
  const base = `${getBaseUrl()}${path}`;
  if (!options.params || Object.keys(options.params).length === 0) {
    return base;
  }
  const searchParams = new URLSearchParams(options.params);
  return `${base}?${searchParams.toString()}`;
}

interface ParsedError {
  error?: { type?: string; message?: string; doc_url?: string };
  credits_remaining?: number;
}

function formatHttpError(status: number, body: string, options: RequestOptions): string {
  let parsed: ParsedError | null = null;
  try {
    parsed = JSON.parse(body) as ParsedError;
  } catch {
    // body is not JSON, use raw text
  }

  const errorType = parsed?.error?.type ?? "UNKNOWN_ERROR";
  const errorMessage = parsed?.error?.message ?? body;
  const docUrl = parsed?.error?.doc_url;

  switch (status) {
    case 401:
      return "Error: Invalid API key. Check your SOCIALCRAWL_API_KEY configuration.";
    case 402:
      return `Error: Insufficient credits (${parsed?.credits_remaining ?? 0} remaining). Top up at socialcrawl.dev/dashboard/billing.`;
    case 400:
      return `Error: ${errorMessage}`;
    case 404:
      if (errorType === "RESOURCE_NOT_FOUND") {
        return `Error: Resource not found upstream. The requested ${options.platform} resource doesn't exist. Credits have been refunded automatically.`;
      }
      return `Error: Endpoint /v1/${options.platform}/${options.resource} not found. Use socialcrawl_list_endpoints to see available endpoints for ${options.platform}.`;
    case 405:
      return "Error: Method not allowed. SocialCrawl /v1/* endpoints accept GET requests only.";
    case 409:
      return "Error: Idempotency-Key conflict. The key you supplied was already used by another account. Generate a fresh key (UUIDv4 recommended).";
    case 422:
      return "Error: Idempotency-Key payload mismatch. You reused the same key with different parameters. Either use a different key, or repeat the original request exactly.";
    case 429:
      return "Error: Too many concurrent requests on this API key (50 max). Wait a moment and try again.";
    case 502:
      return "Error: Upstream error fetching data. Credits have been auto-refunded.";
    case 503:
      return `Error: Platform ${options.platform} is temporarily unavailable. Credits have been auto-refunded — retry in 30 seconds.`;
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
