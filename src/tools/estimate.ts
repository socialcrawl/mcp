import type { ApiContext } from "../context.js";
import { findPlatform } from "../data/platforms.js";
import { fetchEstimateData, fetchPlanEstimate, localQuote } from "../cost-guard.js";
import { errorFromText } from "../result.js";
import type { ToolOutput } from "../result.js";
import { suggestEndpoints, suggestPlatforms } from "../search/catalog.js";
import type { Endpoint } from "../types.js";
import { normalizeEndpointId } from "./discover.js";
import { pricingStructured, v2Wording } from "./pricing.js";
import { resolveEndpoint, stringifyParams } from "./request.js";
import { walkQuote } from "../walk-quote.js";

/**
 * `socialcrawl_estimate` (API-02 / MCP-04): what a call, or a plan of calls,
 * will hold before it runs. With a key it asks `GET /v1/utility/estimate`
 * (one call: `id` + `params=` JSON; a plan: `plan=` base64url JSON), which
 * prices exactly what the router would bill. Without a key, or while the
 * route is not deployed (404), it quotes from the bundled pricing: the band,
 * plus the hold for these params (`cost-guard.ts` `localQuote`). An id that is
 * a platform slug returns that platform's price table; no id, the overview.
 * Free either way.
 */

type Scalar = string | number | boolean;
type ParamValue = Scalar | Scalar[];

export interface PlanCall {
  id: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  repeat?: number;
}

export interface EstimateParams {
  id?: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  params?: Record<string, ParamValue>;
  body?: Record<string, unknown>;
  calls?: number;
  items?: number;
  plan?: PlanCall[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function errorOutput(text: string): ToolOutput {
  return { text, structured: errorFromText(text) };
}

/** The bundled endpoint for an id, or the error text that explains why there is none. */
function lookup(rawId: string, method?: string): { endpoint: Endpoint } | { error: string } {
  const key = normalizeEndpointId(rawId);
  const slash = key.indexOf("/");
  const platform = slash === -1 ? key : key.slice(0, slash);
  if (!findPlatform(platform)) {
    const near = suggestPlatforms(platform);
    return { error: [`Error: Unknown platform "${platform}".`, ...(near.length ? ["", "Did you mean:", ...near.map((s) => `- \`${s}\``)] : [])].join("\n") };
  }
  const resource = key.slice(slash + 1);
  const resolved = resolveEndpoint(platform, resource, method);
  if (!resolved) {
    const near = suggestEndpoints(platform, resource).map((id) => id.slice(platform.length + 1));
    return {
      error: [`Error: Unknown resource "${resource}" for platform "${platform}".`, ...(near.length ? ["", "Did you mean:", ...near.map((s) => `- \`${s}\``)] : [])].join("\n"),
    };
  }
  return { endpoint: resolved.endpoint };
}

async function single(ctx: ApiContext, input: EstimateParams, e: Endpoint): Promise<ToolOutput> {
  const id = `${e.platform}/${e.resource}`;
  const calls = input.calls ?? 1;
  const params = (input.params ?? {}) as Record<string, unknown>;

  if (ctx.apiKey) {
    const data = await fetchEstimateData(ctx, { id, method: e.method, params, body: input.body, items: input.items });
    const hold = num(data?.hold);
    if (data && hold !== undefined) {
      const quote: Record<string, unknown> = {
        endpoint: id,
        method: e.method,
        valid: data.valid !== false,
        hold,
        ...(num(data.expected_min) !== undefined ? { expected_min: data.expected_min } : {}),
        ...(num(data.expected_max) !== undefined ? { expected_max: data.expected_max } : {}),
        ...(typeof data.unit === "string" ? { unit: data.unit } : {}),
        ...(typeof data.formula === "string" ? { formula: data.formula } : {}),
        ...(Array.isArray(data.levers) && data.levers.length > 0 ? { levers: data.levers } : {}),
        ...(isObj(data.rejection) ? { rejection: data.rejection } : {}),
        calls,
        total_hold: hold * calls,
      };
      // The API's own walk block can carry a null max; the walk below replaces it.
      const warnings = (Array.isArray(data.warnings) ? data.warnings.map(String) : []).filter((w) => !UNPROVEN.test(w));
      // The API ignores `items`: apply the same items -> pages walk, priced per page by the API's own quote.
      let source = "api";
      if (input.items !== undefined) {
        const walk = walkQuote(e, input.items);
        const w = walk.quote;
        if (w) {
          const perMin = num(data.expected_min) ?? hold;
          const perMax = num(data.expected_max) ?? hold;
          const lo = w.pages * perMin;
          const hi = w.pages * perMax;
          const perPageHold = hold;
          const total = w.pages * perPageHold;
          Object.assign(quote, {
            hold: total,
            pages: w.pages,
            page_size: w.page_size,
            price_basis: w.price_basis,
            expected_min: lo,
            expected_max: hi,
            formula: `${input.items} items: ${w.pages} pages x ${perMin === perMax ? perMax : `${perMin}-${perMax}`} = ${lo === hi ? hi : `${lo}-${hi}`} credits.`,
            walk: { pages: w.pages, page_size: w.page_size, per_page_hold: perPageHold, per_page_min: perMin, per_page_max: perMax },
            items: { n: input.items, pages: w.pages, page_size: w.page_size, credits_min: lo, credits_max: hi },
            total_hold: total * calls,
          });
          source = "api+walk";
        }
        warnings.push(...walkWarnings(walk.warnings, w ? { pages: w.pages, per: perPageRange(num(data.expected_min) ?? hold, num(data.expected_max) ?? hold) } : undefined));
      }
      return { text: renderApi(quote, warnings), structured: { ok: true, source, quote, ...(warnings.length ? { warnings } : {}) } };
    }
  }

  const priced = pricingStructured({
    action: "endpoint",
    platform: e.platform,
    resource: e.resource,
    method: e.method,
    params: stringifyParams(input.params as Record<string, ParamValue> | undefined),
    calls: input.calls,
  });
  const hold = localQuote(e, { ...params, ...(input.body ?? {}) });
  // items -> pages -> credits from the contract's paging block (the skill's
  // estimate.py arithmetic); without items, or when it cannot page, one call.
  const walk = input.items !== undefined ? walkQuote(e, input.items) : { quote: null, warnings: [] };
  const w = walk.quote;
  const perCall = w ? w.expected_max : hold;
  const quote = {
    ...((priced.structured.quote as Record<string, unknown>) ?? { endpoint: id, method: e.method }),
    hold: perCall,
    ...(w
      ? {
          pages: w.pages,
          page_size: w.page_size,
          price_basis: w.price_basis,
          expected_min: w.expected_min,
          expected_max: w.expected_max,
          formula: w.formula,
        }
      : {}),
    calls,
    total_hold: perCall * calls,
  };
  const warnings = walkWarnings(walk.warnings, w ? { pages: w.pages, per: perPageRange(w.expected_min / w.pages, w.expected_max / w.pages) } : undefined);
  const head = `Local quote for ${id}: holds up to ${perCall} credits per call${w ? ` (${w.pages} pages)` : ""}${calls > 1 ? `, ${perCall * calls} for ${calls} calls` : ""}. The settled charge is refunded down to the work done.`;
  return {
    text: [head, ...(w ? [`Walk: ${w.formula}`] : []), ...warnings, "", v2Wording(priced.text)].join("\n"),
    structured: { ok: true, source: "local", quote, ...(warnings.length ? { warnings } : {}) },
  };
}

/** The registry's "per-page price is not proven" notes (the API's and ours). */
const UNPROVEN = /^price_basis_unknown\b/;

const perPageRange = (min: number, max: number): string => (min === max ? `${max}` : `${min}-${max}`);

/**
 * A walk's warnings with the "per-page price is not proven" notes (which also
 * say the max is null) folded into one caveat: the quote stands on the
 * one-call price, and the caveat says how far to trust it.
 */
function walkWarnings(warnings: string[], walk?: { pages: number; per: string }): string[] {
  const unproven = warnings.some((w) => UNPROVEN.test(w));
  const rest = warnings.filter((w) => !UNPROVEN.test(w));
  if (unproven && walk) {
    rest.push(`walk: priced as ${walk.pages} pages x the one-call quote (${walk.per} credits each); a page's price is not proven, so check credits_used as pages arrive.`);
  }
  return rest;
}

function renderApi(q: Record<string, unknown>, warnings: string[]): string {
  const lines = [
    `Quote for ${String(q.endpoint)} (API): holds ${String(q.hold)} credits${q.pages !== undefined ? ` (${String(q.pages)} pages)` : ""}${q.expected_min !== undefined ? `; expect ${String(q.expected_min)}-${String(q.expected_max)} after refunds` : ""}.`,
  ];
  if (q.valid === false) {
    const r = q.rejection as Record<string, unknown> | undefined;
    lines.push(`The API would refuse this call${r?.message ? `: ${String(r.message)}` : ""}. Nothing would be billed.`);
  }
  if (q.formula) lines.push(`Formula: ${String(q.formula)}`);
  if (Array.isArray(q.levers)) {
    for (const l of q.levers as Array<Record<string, unknown>>) lines.push(`Lever: ${String(l.param)} -> ${String(l.hold)} credits (${String(l.effect ?? "")})`);
  }
  if (Number(q.calls) > 1) lines.push(`${String(q.calls)} calls: ${String(q.total_hold)} credits held in total.`);
  for (const w of warnings) lines.push(`Warning: ${w}`);
  return lines.join("\n");
}

async function plan(ctx: ApiContext, calls: PlanCall[]): Promise<ToolOutput> {
  const resolved: Array<{ call: PlanCall; endpoint: Endpoint }> = [];
  for (const [i, call] of calls.entries()) {
    const hit = lookup(call.id, call.method);
    if ("error" in hit) return errorOutput(`${hit.error}\n(plan call ${i + 1})`);
    resolved.push({ call, endpoint: hit.endpoint });
  }

  if (ctx.apiKey) {
    const data = await fetchPlanEstimate(
      ctx,
      resolved.map(({ call, endpoint: e }) => ({
        id: `${e.platform}/${e.resource}`,
        ...(e.method !== "GET" ? { method: e.method } : {}),
        ...(call.params ? { params: stringifyParams(call.params as Record<string, ParamValue>) } : {}),
        ...(call.body ? { body: call.body } : {}),
        ...(call.repeat ? { repeat: call.repeat } : {}),
      })),
    );
    if (data) {
      const rows = [data.calls, data.runs].find(Array.isArray) as unknown[] | undefined;
      const totals = isObj(data.totals) ? data.totals : isObj(data.total) ? data.total : {};
      const total = num(data.hold_total) ?? num(totals.hold) ?? num(totals.hold_total);
      if (rows || total !== undefined) {
        const valid = data.valid !== false;
        const rejection = isObj(data.rejection) ? data.rejection : undefined;
        const p = {
          calls: (rows ?? []).filter(isObj),
          ...(total !== undefined ? { total_hold: total } : {}),
          valid,
          ...(rejection ? { rejection } : {}),
        };
        const warnings = Array.isArray(data.warnings) ? data.warnings.map(String) : [];
        const text = [
          `Plan quote (API): ${total !== undefined ? `${total} credits held in total` : "see calls"}.`,
          ...(valid ? [] : [`The API would refuse this plan${rejection?.message ? `: ${String(rejection.message)}` : ""}. Nothing would be billed.`]),
          // A call's hold_total is its hold times its repeat; show that, not the one-call hold.
          ...p.calls.map((c) => `- ${String(c.id ?? c.ref ?? "call")}: ${String(c.hold_total ?? c.hold ?? "?")}${num(c.repeat) && Number(c.repeat) > 1 ? ` (${String(c.hold)} x ${String(c.repeat)})` : ""}`),
          ...warnings.map((w) => `Warning: ${w}`),
        ].join("\n");
        return { text, structured: { ok: true, source: "api", plan: p, ...(warnings.length ? { warnings } : {}) } };
      }
    }
  }

  const rows = resolved.map(({ call, endpoint: e }) => {
    const per = localQuote(e, { ...(call.params ?? {}), ...(call.body ?? {}) });
    const repeat = call.repeat ?? 1;
    return { id: `${e.platform}/${e.resource}`, method: e.method, hold_per_call: per, repeat, hold: per * repeat };
  });
  const total = rows.reduce((s, r) => s + r.hold, 0);
  const text = [
    `Plan quote (bundled pricing): up to ${total} credits held in total. Holds are ceilings; metered calls refund down to the work done.`,
    ...rows.map((r) => `- ${r.id}: ${r.hold_per_call} x ${r.repeat} = ${r.hold}`),
  ].join("\n");
  return { text, structured: { ok: true, source: "local", plan: { calls: rows, total_hold: total } } };
}

export async function estimateStructured(ctx: ApiContext, input: EstimateParams): Promise<ToolOutput> {
  if (input.plan && input.plan.length > 0) return plan(ctx, input.plan);
  if (!input.id) {
    const o = pricingStructured({ action: "overview" });
    return { text: v2Wording(o.text), structured: { ok: true, source: "local" } };
  }
  const key = normalizeEndpointId(input.id);
  if (!key.includes("/")) {
    if (!findPlatform(key)) {
      const hit = lookup(key);
      return errorOutput("error" in hit ? hit.error : `Error: Unknown platform "${key}".`);
    }
    const t = pricingStructured({ action: "platform", platform: key });
    return { text: v2Wording(t.text), structured: { ok: true, source: "local" } };
  }
  const hit = lookup(key, input.method);
  if ("error" in hit) return errorOutput(hit.error);
  return single(ctx, input, hit.endpoint);
}
