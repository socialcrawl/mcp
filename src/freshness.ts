import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ApiContext } from "./context.js";
import { REGISTRY_FINGERPRINT, REGISTRY_STATS } from "./data/registry-meta.js";

/**
 * Is the bundled catalogue behind the live registry? Checked per base URL at
 * most once every FRESHNESS_TTL_MS (stdio: at startup; HTTP: on a request), never blocking
 * a tool call, and silent when offline, keyless or on any error.
 *
 * Preferred probe: `GET /v1/utility/endpoints?fingerprint=1` -> `{fingerprint}`,
 * compared with the bundled SHA-256 (it catches a changed parameter, not just a
 * new endpoint). That route is not deployed everywhere yet, so on 404 or any
 * other failure we fall back to comparing platform and endpoint counts.
 * `socialcrawl_account` view freshness renders the same check.
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

/** What one freshness check found: the verdict, what it rests on, and the live numbers it saw. */
export interface FreshnessReport {
  state: Freshness;
  /** `fingerprint` when the live registry fingerprint was compared; `counts` on the fallback. */
  basis?: "fingerprint" | "counts";
  live?: { fingerprint?: string; platforms?: number; endpoints?: number };
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * THE freshness check, shared by `socialcrawl_account` view freshness and the
 * one-line stale note on tool results, so the two can never disagree. The
 * live registry fingerprint decides when the API publishes one; the platform
 * and endpoint counts decide otherwise.
 */
export async function checkFreshness(ctx: ApiContext, opts: ProbeOptions = {}): Promise<FreshnessReport> {
  if (!ctx.apiKey) return { state: "unknown" };
  const endpoint = `${ctx.baseUrl}/v1/utility/endpoints`;

  const fp = await getJson(`${endpoint}?fingerprint=1`, ctx, opts);
  const fpData = isObject(fp?.data) ? fp.data : fp;
  const live = fpData?.fingerprint;
  if (typeof live === "string" && live) {
    return {
      state: live === REGISTRY_FINGERPRINT ? "fresh" : "stale",
      basis: "fingerprint",
      live: { fingerprint: live, platforms: num(fpData?.platforms), endpoints: num(fpData?.endpoints) },
    };
  }

  const counts = await getJson(`${endpoint}?search=${encodeURIComponent(" freshness-probe")}`, ctx, opts);
  const data = isObject(counts?.data) ? counts.data : undefined;
  const stats = isObject(data?.stats) ? data.stats : undefined;
  const platforms = num(stats?.platforms);
  const endpoints = num(stats?.endpoints);
  if (platforms === undefined || endpoints === undefined) return { state: "unknown" };
  const same = endpoints === REGISTRY_STATS.totalEndpoints && platforms === REGISTRY_STATS.totalPlatforms;
  return { state: same ? "fresh" : "stale", basis: "counts", live: { platforms, endpoints } };
}

export async function probeFreshness(ctx: ApiContext, opts: ProbeOptions = {}): Promise<Freshness> {
  return (await checkFreshness(ctx, opts)).state;
}

/**
 * How long one answer stands. A long-running server (the hosted HTTP one)
 * must notice when the API it talks to is redeployed, so an answer expires.
 */
export const FRESHNESS_TTL_MS = 10 * 60 * 1000;

const checks = new Map<string, { at: number; check: Promise<boolean> }>();
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
  const now = Date.now();
  const cached = checks.get(ctx.baseUrl);
  if (cached && now - cached.at < FRESHNESS_TTL_MS) return cached.check;
  const check = probeFreshness(ctx).then((r) => r === "stale", () => false);
  checks.set(ctx.baseUrl, { at: now, check });
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
