import { findPlatform } from "../data/platforms.js";
import { findEndpoint, getEndpointsByPlatform } from "../data/endpoints.js";
import { makeRequest, apiRequest } from "../client.js";
import { formatCost, worstCaseCost } from "../pricing.js";
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
    const near = getEndpointsByPlatform(input.platform)
      .filter(
        (e) =>
          e.resource.includes(input.resource) || input.resource.includes(e.resource),
      )
      .slice(0, 5);
    return [
      `Error: Unknown resource "${input.resource}" for platform "${input.platform}".`,
      ...(near.length > 0
        ? [`Closest matches: ${near.map((e) => `\`${e.resource}\``).join(", ")}.`]
        : []),
      `Use socialcrawl_list_endpoints with platform "${input.platform}" to see available endpoints.`,
    ].join(" ");
  }

  const isPost = endpoint.method === "POST";
  const providedParams = input.params ?? {};
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
    return `Error: Missing required parameter(s): ${missingParts.join(", ")}. Use socialcrawl_list_endpoints with platform "${input.platform}" for full parameter details. No credits were charged.`;
  }

  const valueErrors = validateValues(endpoint, merged);
  if (valueErrors.length > 0) {
    return [
      "Error: Invalid parameter value(s) — the API would reject this with a 400 before billing:",
      ...valueErrors.map((e) => `- ${e}`),
      "",
      `Use socialcrawl_list_endpoints with platform "${input.platform}" for the full parameter contract. No credits were charged.`,
    ].join("\n");
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

  const headerLines = [
    `## SocialCrawl API Response`,
    `**Endpoint:** \`${endpoint.method} /v1/${input.platform}/${input.resource}\``,
    `**Price:** ${formatCost(endpoint.pricing)}${
      endpoint.pricing.model === "metered"
        ? ` — up to ${worstCaseCost(endpoint.pricing)}cr held, refunded to the actual charge. Read \`credits_used\` below for what you really paid.`
        : ""
    }`,
  ];
  if (endpoint.pricing.model === "metered" && endpoint.pricing.description) {
    headerLines.push(`**Metered rule:** ${endpoint.pricing.description}`);
  }
  const unknown = unknownParams(endpoint, merged);
  if (unknown.length > 0) {
    headerLines.push(
      `**Note:** ${unknown.map((u) => `\`${u}\``).join(", ")} ${unknown.length === 1 ? "is" : "are"} not declared on this endpoint and ${unknown.length === 1 ? "was" : "were"} ignored (unknown params never bypass the cache).`,
    );
  }
  if (endpoint.pagination && !endpoint.paginatable) {
    headerLines.push(
      `**Paging:** pass \`cursor\` from \`pagination.next_cursor\` for the next page; stop when \`pagination.has_more\` is false. Each page is billed separately.`,
    );
  }
  const header = `${headerLines.join("\n")}\n\n`;

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
