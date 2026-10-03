import { csvHeader, csvLines, flattenRows, toCsv } from "./csv.js";
import { emptyProjectionWarning, isEmptyProjection, looksProjected, parseFields, pathMatches, projectValue, rowRoots, withIdentity } from "./fields.js";

type Json = Record<string, unknown>;
export type Format = "json" | "csv" | "summary";

export interface ShapeOptions {
  fields?: string | string[];
  maxItems?: number;
  format?: Format;
  /** Characters available for the payload (page body / csv), after header and notes. */
  budget: number;
}

export interface Shaped {
  /** Envelope to render and structure (rows cut to what fits). */
  envelope: Json;
  /** Rows in the full (pre-cut, post-projection) page; undefined for a single object. */
  total?: number;
  shown?: number;
  /** True when anything was cut, so the full body is worth linking. */
  cut: boolean;
  /** True when the local projection changed the rows. */
  projected: boolean;
  csv?: string;
  summary?: Json;
  /** Top-level keys a single object lost to the budget. */
  omittedKeys?: string[];
  /** Local notes for the caller (e.g. a projection that kept nothing). */
  warnings?: string[];
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const size = (v: unknown): number => JSON.stringify(v).length;

/** Where an envelope keeps its rows: `data.items` or a bare `data` array. */
function getRows(env: Json): unknown[] | undefined {
  const d = env.data;
  if (Array.isArray(d)) return d;
  if (isObject(d) && Array.isArray(d.items)) return d.items;
  return undefined;
}

function withRows(env: Json, rows: unknown[]): Json {
  const d = env.data;
  if (Array.isArray(d)) return { ...env, data: rows };
  return { ...env, data: { ...(d as Json), items: rows } };
}

/** The envelope without its rows, keeping pagination and page-level blocks. */
function withoutRows(env: Json): Json {
  const d = env.data;
  if (Array.isArray(d)) {
    const rest: Json = { ...env };
    delete rest.data;
    return rest;
  }
  return { ...env, data: { ...(d as Json), items: [] } };
}

/** Last resort for an envelope whose non-row part alone blows the budget. */
function shrinkBase(env: Json, budget: number): { envelope: Json; omitted: string[] } {
  const out: Json = {};
  const omitted: string[] = [];
  let used = 2;
  for (const [k, v] of Object.entries(env)) {
    if (k === "data") continue;
    const c = size(k) + size(v) + 2;
    if (used + c <= budget - 200) {
      out[k] = v;
      used += c;
    } else omitted.push(k);
  }
  const d = env.data;
  const data: Json = {};
  if (isObject(d)) {
    for (const [k, v] of Object.entries(d)) {
      const c = size(k) + size(v) + 2;
      if (k !== "items" && used + c <= budget - 200) {
        data[k] = v;
        used += c;
      } else omitted.push(`data.${k}`);
    }
    if (Array.isArray(d.items)) data.items = [];
  } else if (typeof d === "string") {
    const room = Math.max(0, budget - used - 200);
    data.value = `${d.slice(0, room)}…[cut]`;
    omitted.push("data (string cut)");
  } else if (d !== undefined) {
    omitted.push("data");
  }
  out.data = data;
  return { envelope: out, omitted };
}

/** Longest prefix of `costs` whose running total (plus one separator each) fits. */
function fit(costs: number[], budget: number): number {
  let used = 0;
  let n = 0;
  for (const c of costs) {
    if (used + c + 1 > budget) break;
    used += c + 1;
    n++;
  }
  return n;
}

function sample(row: unknown): unknown {
  if (!isObject(row)) return row;
  const out: Json = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === "string" && v.length > 160 ? `${v.slice(0, 160)}…` : v;
  return out;
}

function summarise(rows: unknown[]): Json {
  const table = flattenRows(rows);
  const stats: Record<string, { sum: number; min: number; max: number; n: number }> = {};
  for (const col of table.columns.filter((c) => /(^|\.)engagement\./.test(c))) {
    for (const rec of table.records) {
      const v = rec.get(col);
      if (typeof v !== "number") continue;
      const s = (stats[col] ??= { sum: 0, min: v, max: v, n: 0 });
      s.sum += v;
      s.min = Math.min(s.min, v);
      s.max = Math.max(s.max, v);
      s.n++;
    }
  }
  return {
    rows: rows.length,
    columns: table.columns.slice(0, 60),
    ...(Object.keys(stats).length > 0 ? { engagement: stats } : {}),
    sample: rows.slice(0, 3).map(sample),
  };
}

/**
 * Apply `fields`, `max_items`, `format` and the character budget to a parsed
 * API envelope. Cuts only ever fall on a row (or, for a single object, a
 * top-level key) boundary, so the result is always valid JSON.
 */
export function shapeEnvelope(parsed: Json, opts: ShapeOptions): Shaped {
  let env = parsed;
  let projected = false;
  const paths = parseFields(opts.fields);
  let rows = getRows(env);

  const warnings: string[] = [];
  if (paths.length > 0) {
    // Identity (`id`, `url`, and under every requested root and row root) always survives, as it does server-side.
    const original = rows ?? (isObject(env.data) ? [env.data] : []);
    const keep = withIdentity(paths, rowRoots(original));
    if (rows) {
      if (!looksProjected(rows, paths)) {
        rows = rows.map((r) => projectValue(r, keep));
        env = withRows(env, rows);
        projected = true;
      }
    } else if (isObject(env.data) && !looksProjected([env.data], paths)) {
      env = { ...env, data: projectValue(env.data, keep) };
      projected = true;
    }
    if (projected && original.length > 0) {
      const after = rows ?? [env.data];
      const unknown = paths.filter((p) => !original.some((r) => pathMatches(r, p)));
      if (after.every(isEmptyProjection)) warnings.push(emptyProjectionWarning(original[0], paths));
      else if (unknown.length > 0) {
        warnings.push(`fields path${unknown.length === 1 ? "" : "s"} "${unknown.join(",")}" matched nothing on these rows; use paths exactly as socialcrawl_endpoint lists them.`);
      }
    }
  }
  const extra = warnings.length > 0 ? { warnings } : {};

  const format = opts.format ?? "json";
  const listRows = rows ?? (isObject(env.data) ? [env.data] : undefined);

  if (format === "summary" && listRows) {
    return { envelope: withoutRows(env), total: rows?.length, cut: false, projected, summary: summarise(listRows), ...extra };
  }

  if (rows) {
    const total = rows.length;
    let keep = rows;
    let cut = false;
    if (opts.maxItems !== undefined && opts.maxItems < total) {
      keep = rows.slice(0, Math.max(0, opts.maxItems));
      cut = true;
    }

    if (format === "csv") {
      const table = flattenRows(keep);
      const rest = withoutRows(env);
      const n = fit(csvLines(table).map((l) => l.length), opts.budget - csvHeader(table).length - 1);
      if (n < keep.length) cut = true;
      return { envelope: rest, total, shown: n, cut, projected, csv: toCsv(table, n), ...extra };
    }

    const base = size(withRows(env, []));
    const n = fit(keep.map(size), opts.budget - base);
    if (n < keep.length) cut = true;
    const shownEnv = withRows(env, keep.slice(0, n));
    if (size(shownEnv) > opts.budget) {
      const { envelope, omitted } = shrinkBase(env, opts.budget);
      return { envelope, total, shown: 0, cut: true, projected, omittedKeys: omitted, ...extra };
    }
    return { envelope: shownEnv, total, shown: n, cut, projected, ...extra };
  }

  // A single object (or scalar): cut at top-level keys of `data` when it is too big.
  if (isObject(env.data) && size(env) > opts.budget) {
    const kept: Json = {};
    const omitted: string[] = [];
    const base = size({ ...env, data: {} });
    let used = base;
    for (const [k, v] of Object.entries(env.data)) {
      const c = size(k) + size(v) + 2;
      if (used + c <= opts.budget) {
        kept[k] = v;
        used += c;
      } else omitted.push(k);
    }
    if (size({ ...env, data: kept }) > opts.budget) {
      const shrunk = shrinkBase(env, opts.budget);
      return { envelope: shrunk.envelope, cut: true, projected, omittedKeys: shrunk.omitted, ...extra };
    }
    return { envelope: { ...env, data: kept }, cut: true, projected, omittedKeys: omitted, ...extra };
  }
  if (size(env) > opts.budget) {
    const { envelope, omitted } = shrinkBase(env, opts.budget);
    return { envelope, cut: true, projected, omittedKeys: omitted, ...extra };
  }
  return { envelope: env, cut: false, projected, ...extra };
}
