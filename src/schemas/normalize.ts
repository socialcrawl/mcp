import { z } from "zod";
import type { AnyZodObject, ZodEffects } from "zod";
import { MOVED_PARAMS_KEY } from "../constants.js";
import { resolveEndpoint } from "../endpoint-resolve.js";

/**
 * One input preprocessor for every tool, so an agent that learned one tool's
 * argument shape can use it on the others. It runs before the tool's own
 * strict schema (which stays the compact shape the tool advertises):
 *
 *   - An endpoint is named any of three ways: `id: "platform/resource"`,
 *     `platform` + `resource`, or `path: "/v1/platform/resource"` (a full URL
 *     works too). Each tool receives its own form: `socialcrawl_request` gets
 *     platform + resource, the others get `id`. `estimate.plan[]` entries too.
 *   - `fields` takes a comma string or an array of strings.
 *   - `estimate.calls` given an array is the plan.
 *   - `collect` given `limit` and no `items` (and no `result_id`) walks to that many.
 *   - An unknown key is refused with the key to use instead, not a bare
 *     `unrecognized_keys`.
 */

export type ToolKind = "find" | "endpoint" | "estimate" | "request" | "collect" | "account" | "manage";

/** How a tool wants the endpoint named, or none for tools that do not name one. */
const NAMING: Partial<Record<ToolKind, "id" | "platform+resource">> = {
  endpoint: "id",
  estimate: "id",
  request: "platform+resource",
  collect: "id",
};

/** Wrong keys agents reach for, and what to use instead. */
const ENDPOINT_HINT = 'use id, or platform+resource (or path: "/v1/platform/resource")';
const ENDPOINT_ALIASES = new Set(["endpoint", "endpoint_id", "route", "name", "slug"]);
const ALIASES: Record<string, string> = {
  url: "put the URL in params, e.g. params: { url }",
  query: "put query params in params",
  parameters: "use params",
  param: "use params",
  args: "use params",
  arguments: "use params",
  query_params: "use params",
  payload: "use body",
  data: "use body",
  json: "use body",
};
const PER_TOOL: Partial<Record<ToolKind, Record<string, string>>> = {
  find: { query: "use task", q: "use task", prompt: "use task", search: "use task", text: "use task", description: "use task" },
  collect: { max_items: "use items (rows to collect)", count: "use items", n: "use items", rows: "use items", total: "use items", max_rows: "use items" },
  request: { limit: "put limit in params", items: "use socialcrawl_collect to walk pages to N items", count: "use max_items" },
  estimate: { count: "use calls", repeat: "use calls", n: "use calls" },
  manage: { body: "use input", params: "use input", data: "use input" },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `"/v1/tiktok/profile"`, a full URL, or `"tiktok/profile"` -> `"tiktok/profile"`. */
export function endpointKey(raw: string): string {
  let s = raw.trim().replace(/^https?:\/\/[^/]*/i, "");
  const cut = s.search(/[?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  s = s.replace(/^\/+/, "").replace(/\/+$/, "");
  if (s.startsWith("v1/")) s = s.slice(3);
  return s;
}

/**
 * The endpoint an argument object names, as a key ("platform/resource", or a
 * bare platform), or undefined when it names none. Precedence: id, path, platform + resource.
 */
function namedEndpoint(a: Record<string, unknown>): string | undefined {
  if (typeof a.id === "string" && a.id.trim()) return endpointKey(a.id);
  if (typeof a.path === "string" && a.path.trim()) return endpointKey(a.path);
  if (typeof a.platform === "string" && a.platform.trim()) {
    const resource = typeof a.resource === "string" ? endpointKey(a.resource) : "";
    return resource ? `${a.platform.trim()}/${resource}` : a.platform.trim();
  }
  return undefined;
}

/** Rewrite one endpoint-naming argument object into `form`. */
function renameEndpoint(a: Record<string, unknown>, form: "id" | "platform+resource"): Record<string, unknown> {
  const key = namedEndpoint(a);
  const out = { ...a };
  delete out.path;
  if (key === undefined) return out;
  delete out.id;
  delete out.platform;
  delete out.resource;
  if (form === "id") return { ...out, id: key };
  const slash = key.indexOf("/");
  return slash === -1 ? { ...out, platform: key } : { ...out, platform: key.slice(0, slash), resource: key.slice(slash + 1) };
}

const fieldsString = (v: unknown): unknown =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? v.map((s) => s.trim()).filter(Boolean).join(",") : v;

/** The argument object normalised for `kind` (without the unknown-key check). */
export function normalizeArgs(kind: ToolKind, raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  let a: Record<string, unknown> = { ...raw };
  if (kind === "estimate" && Array.isArray(a.calls)) {
    if (a.plan === undefined) a.plan = a.calls;
    delete a.calls;
  }
  if (kind === "estimate" && Array.isArray(a.plan)) {
    a.plan = a.plan.map((c) => (isObj(c) ? renameEndpoint(c, "id") : c));
  }
  if (kind === "collect" && a.result_id === undefined && a.items === undefined && typeof a.limit === "number") {
    a.items = a.limit;
    delete a.limit;
  }
  if (kind === "account") {
    if (a.view === undefined && a.action !== undefined) {
      a.view = a.action;
      delete a.action;
    }
    if (typeof a.view === "string") a.view = VIEW_ALIASES[a.view.toLowerCase()] ?? a.view;
  }
  // find's `platform` is a filter, not an endpoint name.
  const form = NAMING[kind];
  if (form) a = renameEndpoint(a, form);
  if ("fields" in a) a.fields = fieldsString(a.fields);
  return a;
}

const VIEW_ALIASES: Record<string, string> = { ledger: "transactions", history: "transactions", transaction: "transactions", credits: "balance" };

/**
 * socialcrawl_request: top-level keys that are params the named endpoint
 * declares (`limit`, `url`, `handle`, ...) move into params, and their names
 * ride along under MOVED_PARAMS_KEY so the tool can say so.
 */
function liftEndpointParams(a: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  if (typeof a.platform !== "string" || typeof a.resource !== "string") return a;
  const e = resolveEndpoint(a.platform, a.resource, typeof a.method === "string" ? a.method : undefined)?.endpoint;
  if (!e) return a;
  const declared = new Set([...e.params.map((p) => p.name), ...e.optionalParams.map((p) => p.name), "cursor", "limit"]);
  const moved = Object.keys(a).filter((k) => !known.has(k) && declared.has(k));
  if (moved.length === 0) return a;
  const out = { ...a };
  const params: Record<string, unknown> = isObj(a.params) ? { ...a.params } : {};
  for (const k of moved) {
    if (params[k] === undefined) params[k] = out[k];
    delete out[k];
  }
  params[MOVED_PARAMS_KEY] = moved.join(",");
  out.params = params;
  return out;
}

function hintFor(kind: ToolKind, key: string): string | undefined {
  if (NAMING[kind] && ENDPOINT_ALIASES.has(key)) return ENDPOINT_HINT;
  return PER_TOOL[kind]?.[key] ?? ALIASES[key];
}

/** True when a call to `kind` must name an endpoint and this one does not. */
function needsEndpoint(kind: ToolKind, a: Record<string, unknown>): boolean {
  if (namedEndpoint(a) !== undefined) return false;
  if (kind === "request" || kind === "endpoint") return true;
  return kind === "collect" && a.result_id === undefined;
}

/**
 * `schema` with the preprocessor in front. The result still advertises the
 * object's own JSON Schema (the SDK lists `shape`, and the converter reads a
 * preprocess as its inner schema), so the tool's listed schema does not grow.
 */
export function withNormalizedArgs<T extends AnyZodObject>(schema: T, kind: ToolKind): ZodEffects<T> {
  const known = new Set(Object.keys(schema.shape));
  const effects = z.preprocess((raw, ctx) => {
    const n = normalizeArgs(kind, raw);
    if (!isObj(n)) return n;
    const a = kind === "request" ? liftEndpointParams(n, known) : n;
    const unknown = Object.keys(a).filter((k) => !known.has(k));
    if (unknown.length > 0) {
      for (const k of unknown) {
        const hint = hintFor(kind, k);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [k],
          message: `Unknown key "${k}"${hint ? `: ${hint}` : ""}. Allowed keys: ${[...known].join(", ")}.`,
          fatal: true,
        });
      }
      return z.NEVER;
    }
    if (needsEndpoint(kind, a)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [NAMING[kind] === "id" ? "id" : "platform"],
        message: `Name the endpoint: ${ENDPOINT_HINT.replace(/^use /, "")}${kind === "collect" ? "; or result_id to read a stored result" : ""}.`,
        fatal: true,
      });
      return z.NEVER;
    }
    return a;
  }, schema) as ZodEffects<T>;
  // The SDK lists (and validates against) an object schema when it finds `shape`.
  Object.defineProperty(effects, "shape", { get: () => schema.shape });
  return effects;
}
