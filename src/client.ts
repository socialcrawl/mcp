import { TIMEOUT_MS, CHARACTER_LIMIT } from "./constants.js";

function getBaseUrl(): string {
  return process.env.SOCIALCRAWL_BASE_URL ?? "https://api.socialcrawl.com";
}

function getApiKey(): string {
  return process.env.SOCIALCRAWL_API_KEY ?? "";
}

interface RequestOptions {
  platform: string;
  resource: string;
  params?: Record<string, string>;
}

export async function makeRequest(options: RequestOptions): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return "Error: No API key configured. Set SOCIALCRAWL_API_KEY in your MCP server environment. Get a free key at socialcrawl.com (100 credits, no credit card required).";
  }

  const url = buildUrl(options);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
      },
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
  const base = `${getBaseUrl()}/v1/${options.platform}/${options.resource}`;
  if (!options.params || Object.keys(options.params).length === 0) {
    return base;
  }
  const searchParams = new URLSearchParams(options.params);
  return `${base}?${searchParams.toString()}`;
}

interface ParsedError {
  error?: { type?: string; message?: string };
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

  switch (status) {
    case 401:
      return "Error: Invalid API key. Check your SOCIALCRAWL_API_KEY configuration.";
    case 402:
      return `Error: Insufficient credits (${parsed?.credits_remaining ?? 0} remaining). Top up at socialcrawl.com/billing.`;
    case 400:
      return `Error: ${errorMessage}`;
    case 404:
      return `Error: Endpoint /v1/${options.platform}/${options.resource} not found. Use socialcrawl_list_endpoints to see available endpoints for ${options.platform}.`;
    case 503:
      return `Error: Platform ${options.platform} is temporarily unavailable. Try again shortly.`;
    case 502:
      return "Error: Upstream error fetching data. Credits have been auto-refunded.";
    case 429:
      return "Error: Too many concurrent requests. Wait a moment and try again.";
    default:
      return `Error (${status}): ${errorType} — ${errorMessage}`;
  }
}

function truncateResponse(body: string): string {
  if (body.length <= CHARACTER_LIMIT) {
    return body;
  }
  return `${body.slice(0, CHARACTER_LIMIT)}\n\n[Response truncated at ${CHARACTER_LIMIT.toLocaleString()} characters. Full response was ${body.length.toLocaleString()} characters.]`;
}
