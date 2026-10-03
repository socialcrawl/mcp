import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiContext } from "./context.js";
import { REGISTRY_FINGERPRINT, REGISTRY_STATS } from "./data/registry-meta.js";

/**
 * Is the bundled catalogue behind the live registry? Checked once per process
 * and base URL (stdio: at startup; HTTP: on the first request), never blocking
 * a tool call, and silent when offline, keyless or on any error.
 *
 * Preferred probe: `GET /v1/utility/endpoints?fingerprint=1` -> `{fingerprint}`,
 * compared with the bundled SHA-256 (it catches a changed parameter, not just a
 * new endpoint). That route is not deployed everywhere yet, so on 404 or any
 * other failure we fall back to the count comparison `socialcrawl_discover`
 * `action: "freshness"` uses.
 */

export const STALE_LINE =
  "Note: this server's bundled endpoint catalogue is behind the live registry; calls use the live registry. For current endpoints use socialcrawl_endpoint (live with a key) and update socialcrawl-mcp.";

export type Freshness = "fresh" | "stale" | "unknown";

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2500;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

async function getJson(url: string, ctx: ApiContext, opts: ProbeOptions): Promise<Json | undefined> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { method: "GET", headers: { "x-api-key": ctx.apiKey }, signal: controller.signal });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    return isObject(body) ? body : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeFreshness(ctx: ApiContext, opts: ProbeOptions = {}): Promise<Freshness> {
  if (!ctx.apiKey) return "unknown";
  const endpoint = `${ctx.baseUrl}/v1/utility/endpoints`;

  const fp = await getJson(`${endpoint}?fingerprint=1`, ctx, opts);
  const live = isObject(fp?.data) ? fp.data.fingerprint : fp?.fingerprint;
  if (typeof live === "string" && live) return live === REGISTRY_FINGERPRINT ? "fresh" : "stale";

  const counts = await getJson(`${endpoint}?search=${encodeURIComponent(" freshness-probe")}`, ctx, opts);
  const data = isObject(counts?.data) ? counts.data : undefined;
  const stats = isObject(data?.stats) ? data.stats : undefined;
  if (typeof stats?.endpoints !== "number" || typeof stats.platforms !== "number") return "unknown";
  return stats.endpoints === REGISTRY_STATS.totalEndpoints && stats.platforms === REGISTRY_STATS.totalPlatforms
    ? "fresh"
    : "stale";
}

const checks = new Map<string, Promise<boolean>>();
const NO = Promise.resolve(false);

/** Test hook: forget every completed check. */
export function resetFreshness(): void {
  checks.clear();
}

/**
 * Start (once per base URL) the background check; resolves true when stale.
 * A keyless caller does not use up the check, and `SOCIALCRAWL_FRESHNESS_CHECK=off`
 * disables it.
 */
export function startFreshnessCheck(ctx: ApiContext): Promise<boolean> {
  const flag = (process.env.SOCIALCRAWL_FRESHNESS_CHECK ?? "").toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return NO;
  if (!ctx.apiKey) return NO;
  let check = checks.get(ctx.baseUrl);
  if (!check) {
    check = probeFreshness(ctx).then((r) => r === "stale", () => false);
    checks.set(ctx.baseUrl, check);
  }
  return check;
}

/** Append the stale line to a result's text and, when it has structured output, to `warnings`. */
export function addStaleNotice(result: CallToolResult): CallToolResult {
  const first = result.content[0];
  if (first && first.type === "text") first.text = `${first.text}\n\n${STALE_LINE}`;
  const sc = result.structuredContent;
  if (sc && !result.isError) {
    const warnings = Array.isArray(sc.warnings) ? (sc.warnings as unknown[]) : [];
    sc.warnings = [...warnings, STALE_LINE];
  }
  return result;
}
