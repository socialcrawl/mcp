import { findPlatform } from "../data/platforms.js";
import { findEndpoint } from "../data/endpoints.js";
import { makeRequest, apiRequest } from "../client.js";
import type { ApiContext } from "../context.js";
import type { Endpoint } from "../types.js";

interface RequestParams {
  platform: string;
  resource: string;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
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

export async function request(ctx: ApiContext, input: RequestParams): Promise<string> {
  const platform = findPlatform(input.platform);
  if (!platform) {
    return `Error: Unknown platform "${input.platform}". Use socialcrawl_list_platforms to see available platforms.`;
  }

  // The stateful web-scraping platform (jobs, monitors, sessions, async
  // crawl/batch/agent — POST/PATCH/DELETE with path params) is served by the
  // dedicated socialcrawl_web tool, not this registry-driven request tool.
  if (input.platform === "web") {
    return `Error: The "web" platform is served by the \`socialcrawl_web\` tool (scrape, search, map, extract, crawl, batch_scrape, agent, jobs, monitors, sessions), not \`socialcrawl_request\`. Call socialcrawl_web with the matching action.`;
  }

  const endpoint = findEndpoint(input.platform, input.resource);
  if (!endpoint) {
    return `Error: Unknown resource "${input.resource}" for platform "${input.platform}". Use socialcrawl_list_endpoints with platform "${input.platform}" to see available endpoints.`;
  }

  const isPost = endpoint.method === "POST";
  const providedParams = input.params ?? {};
  const providedBody = input.body ?? {};
  // A required param may arrive via `params` or `body`; POST batch params
  // (ids/urls/items) conventionally live in `body`.
  const providedNames = new Set([
    ...Object.keys(providedParams),
    ...Object.keys(providedBody),
  ]);

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
    return `Error: Missing required parameter(s): ${missingParts.join(", ")}. Use socialcrawl_list_endpoints with platform "${input.platform}" for full parameter details.`;
  }

  let response: string;

  if (!isPost) {
    // GET (and the rare non-POST) — everything is a query param.
    response = await makeRequest(ctx, {
      platform: input.platform,
      resource: input.resource,
      params: input.params,
      idempotencyKey: input.idempotencyKey,
    });
  } else {
    // POST batch endpoint — split provided values into a JSON body and a
    // query string, routing `in: "query"` params (e.g. YouTube `hl`) to the
    // query and everything else to the body.
    const query: Record<string, string> = {};
    const bodyOut: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(providedParams)) {
      if (isQueryParam(endpoint, k)) query[k] = v;
      else bodyOut[k] = coerceJson(v);
    }
    for (const [k, v] of Object.entries(providedBody)) {
      if (isQueryParam(endpoint, k)) query[k] = String(v);
      else bodyOut[k] = coerceJson(v);
    }
    response = await apiRequest(ctx, {
      method: "POST",
      path: `/v1/${input.platform}/${input.resource}`,
      query,
      body: bodyOut,
      idempotencyKey: input.idempotencyKey,
      errorPlatform: input.platform,
    });
  }

  const header = [
    `## SocialCrawl API Response`,
    `**Endpoint:** \`${endpoint.method} /v1/${input.platform}/${input.resource}\``,
    `**Credit cost:** ${endpoint.creditCost} (${endpoint.creditTier})`,
    "",
  ].join("\n");

  if (response.startsWith("Error:")) {
    return `${header}${response}`;
  }

  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    const formatted = JSON.stringify(parsed, null, 2);
    return `${header}\`\`\`json\n${formatted}\n\`\`\``;
  } catch {
    return `${header}${response}`;
  }
}
