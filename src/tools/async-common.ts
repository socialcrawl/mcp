import { apiRequest } from "../client.js";
import { TIMEOUT_MS } from "../constants.js";
import type { ApiContext } from "../context.js";

/**
 * Shared plumbing for the background-work areas of `socialcrawl_manage`
 * (`discover`, `review_history`, `events`): the long-read timeout, the
 * markdown answer every action renders (operation, credit cost, then the
 * body), and the `follow` URL guard.
 */

/**
 * Client timeout for reads the server may hold: a discover run read and the
 * events feed long-poll up to 25 s, every discover/events read is bounded by
 * the server at 48 s (it answers a retryable 503 then), and the JSONL export
 * streams for up to 45 s. Never below the client's default.
 */
export const LONG_READ_TIMEOUT_MS = Math.max(55_000, TIMEOUT_MS);

export type AsyncRequestOptions = Parameters<typeof apiRequest>[1];

export function sendRequest(ctx: ApiContext, options: AsyncRequestOptions): Promise<string> {
  return apiRequest(ctx, options);
}

export function pruneQuery(q: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

export interface RenderInput {
  title: string;
  label: string;
  cost: string;
  idempotencyKey?: string;
  idempotencyGenerated?: boolean;
  idempotencyNote?: string;
  notes?: string[];
  response: string;
  /** "jsonl" renders a non-JSON body in a jsonl fence. */
  format?: "json" | "jsonl";
  /** Extra guidance appended to an error, keyed by a substring of it. */
  errorHints?: Record<string, string>;
  /** Built from the parsed success body. */
  successNotes?: (parsed: Record<string, unknown>) => string[];
}

/**
 * The registry error formatter labels every unmapped 404 "Endpoint … not
 * found. Use socialcrawl_find …", which reads wrong for a missing run,
 * schedule or webhook endpoint id. Keep the server's own message and drop the
 * misleading advice.
 */
function cleanNotFound(response: string): string {
  const m = /^Error: Endpoint \S+ not found\. ([\s\S]*?)Use socialcrawl_find[^\n]*/.exec(response);
  if (!m) return response;
  const said = (m[1] ?? "").trim();
  return response.replace(m[0], `Error: Not found (404). ${said || "No such resource for this API key."}`);
}

export function render(input: RenderInput): string {
  const lines = [`## ${input.title}`, `**Operation:** \`${input.label}\``, `**Credit cost:** ${input.cost}`];
  if (input.idempotencyKey) {
    lines.push(
      `**Idempotency-Key:** \`${input.idempotencyKey}\`${input.idempotencyGenerated ? " (generated)" : ""}${input.idempotencyNote ? ` — ${input.idempotencyNote}` : ""}`,
    );
  }

  let response = input.response;
  if (/^Error(?::| \(\d+\):)/.test(response)) {
    response = cleanNotFound(response);
    const hints = Object.entries(input.errorHints ?? {})
      .filter(([needle]) => response.includes(needle))
      .map(([, hint]) => hint);
    return `${lines.join("\n")}\n\n${response}${hints.length > 0 ? `\n\n${hints.join("\n")}` : ""}`;
  }

  for (const note of input.notes ?? []) lines.push(note);
  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    const extra = input.successNotes ? input.successNotes(parsed) : [];
    return `${[...lines, ...extra].join("\n")}\n\n\`\`\`json\n${JSON.stringify(parsed)}\n\`\`\``;
  } catch {
    const fence = input.format === "jsonl" ? "jsonl" : "";
    return `${lines.join("\n")}\n\n\`\`\`${fence}\n${response.replace(/\n+$/, "")}\n\`\`\``;
  }
}

/** `data` of a success envelope, or the body itself. */
export function dataOf(parsed: Record<string, unknown>): Record<string, unknown> {
  const data = parsed.data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : parsed;
}

/** What to do on a 410 from the events feed. */
export const EVENTS_CURSOR_EXPIRED_HINT =
  '**Events were missed:** the position is older than the 30-day retention. Restart with cursor "oldest" (or read the consumer again: it restarts at the oldest retained event) and tell the user that events before the retained window were missed.';

// ── follow: free reads of data.next.* URLs ──────────────────────────────────

const ID = "[0-9A-Za-z]{8,64}";
/** GET routes that are free reads. Anything else is refused. */
const FOLLOWABLE: RegExp[] = [
  /^\/v1\/prism\/jobs$/,
  new RegExp(`^/v1/prism/jobs/bj_${ID}$`),
  /^\/v1\/prism\/discover\/runs$/,
  new RegExp(`^/v1/prism/discover/runs/run_${ID}(/legs|/results\\.jsonl)?$`),
  /^\/v1\/prism\/discover\/schedules$/,
  new RegExp(`^/v1/prism/discover/schedules/dsch_${ID}$`),
  new RegExp(`^/v1/(trustpilot|tripadvisor)/reviews/history/job_${ID}$`),
  /^\/v1\/events$/,
  /^\/v1\/webhook-endpoints$/,
  new RegExp(`^/v1/webhook-endpoints/we_${ID}(/attempts)?$`),
];

/** URLs that look like next-step links but are not free GETs. */
const REFUSED: [RegExp, string][] = [
  [
    /^\/v1\/prism\/discover$/,
    "This is a continue_url: following it STARTS a billable prism/discover continuation, so it is not followed. Check data.next.continue_estimate with the user, then call socialcrawl_request with platform prism, resource discover and this URL's parameters (including `continue`).",
  ],
  [/^\/v1\/prism\/discover\/runs\/[^/]+\/resume$/, 'This is a resume_url (a POST). Use area "discover" action "run_resume" with the run id.'],
  [/^\/v1\/prism\/discover\/runs\/[^/]+\/more$/, 'This is a more_url (a POST that bills new searches). Use area "discover" action "run_more" with the run id.'],
  [/^\/v1\/events\/consumers\/[^/]+\/ack$/, 'This is an ack_url (a POST). Use area "events" action "ack".'],
  [
    /^\/v1\/webhook-endpoints\/[^/]+\/(rotate-secret|test)$/,
    'This is a POST. Use area "events" action "endpoint_rotate_secret" or "endpoint_test".',
  ],
];

export function resolveFollowUrl(ctx: ApiContext, raw: string): { path: string; longRead: boolean } | { error: string } {
  let base: URL;
  let url: URL;
  try {
    base = new URL(ctx.baseUrl);
    url = new URL(raw, `${base.origin}/`);
  } catch {
    return { error: `Error: Invalid parameter value(s): \`url\` "${raw}" is not a valid URL. Nothing was sent.` };
  }
  if (url.origin !== base.origin || url.username || url.password) {
    return {
      error: `Error: Refusing to follow "${raw}": it is not on the configured SocialCrawl API (${base.origin}). Only next-step URLs on that API are followed; use the matching action instead. Nothing was sent.`,
    };
  }
  const prefix = base.pathname.replace(/\/+$/, "");
  if (prefix && !url.pathname.startsWith(`${prefix}/`)) {
    return { error: `Error: Refusing to follow "${raw}": it is outside the configured API path ${prefix}. Nothing was sent.` };
  }
  const path = url.pathname.slice(prefix.length);
  for (const [re, why] of REFUSED) {
    if (re.test(path)) return { error: `Error: ${why} Nothing was sent.` };
  }
  if (!FOLLOWABLE.some((re) => re.test(path))) {
    return {
      error: `Error: Refusing to follow "${raw}": ${path} is not one of the free read routes follow takes (batch jobs, discover runs and schedules, review history, the events feed, webhook endpoints). Nothing was sent.`,
    };
  }
  const wait = Number(url.searchParams.get("wait_s") ?? "0");
  const longRead = path.startsWith("/v1/prism/discover/") || path === "/v1/events" || (Number.isFinite(wait) && wait > 0);
  return { path: `${path}${url.search}`, longRead };
}
