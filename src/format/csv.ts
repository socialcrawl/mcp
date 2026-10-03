/**
 * Flatten rows to CSV with a canonical column order, so the header is stable
 * across calls: id, url, text, title, author.username, published_at,
 * engagement.* (alphabetical), then every other scalar leaf (alphabetical).
 * Canonical rows are rooted (`{ comment: {...} }`), so those columns are read
 * under the row's root (`comment.id`, `comment.engagement.likes`).
 * Nested objects become dotted columns; arrays of scalars are joined with `|`;
 * arrays of objects are not scalar leaves and are left out (the full body is
 * behind the result's resource link).
 */

type Json = Record<string, unknown>;
type Scalar = string | number | boolean | null;

const LEADING = ["id", "url", "text", "title", "author.username", "published_at"];

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function flattenInto(value: unknown, prefix: string, out: Map<string, Scalar>): void {
  if (isScalar(value)) {
    if (prefix) out.set(prefix, value);
  } else if (Array.isArray(value)) {
    if (value.every(isScalar)) out.set(prefix, value.map((v) => (v === null ? "" : String(v))).join("|"));
  } else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) flattenInto(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

export interface FlatTable {
  columns: string[];
  records: Array<Map<string, Scalar>>;
}

/**
 * The key canonical rows are rooted at (`post`, `comment`, `review`, ...): the
 * top-level object that carries an `id` in most rows, ignoring `computed`.
 * Undefined for flat rows.
 */
export function rowRoot(rows: unknown[]): string | undefined {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!isObject(row)) continue;
    for (const [k, v] of Object.entries(row)) {
      if (k !== "computed" && isObject(v) && "id" in v) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  for (const [k, n] of counts) if (best === undefined || n > (counts.get(best) ?? 0)) best = k;
  return best;
}

export function flattenRows(rows: unknown[]): FlatTable {
  const records = rows.map((row) => {
    const m = new Map<string, Scalar>();
    flattenInto(isObject(row) ? row : { value: row }, "", m);
    return m;
  });
  const seen = new Set<string>();
  for (const r of records) for (const k of r.keys()) seen.add(k);
  // Rooted rows (`comment.text`) lead with the same canonical columns under their root.
  const root = rowRoot(rows);
  const prefix = root ? `${root}.` : "";
  const columns: string[] = LEADING.map((c) => (seen.has(prefix + c) ? prefix + c : c)).filter((c) => seen.has(c));
  const used = new Set(columns);
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const engagement = [...seen]
    .filter((c) => (c.startsWith(`${prefix}engagement.`) || c.startsWith("engagement.")) && !used.has(c))
    .sort(byName);
  for (const c of engagement) used.add(c);
  const rest = [...seen].filter((c) => !used.has(c)).sort(byName);
  return { columns: [...columns, ...engagement, ...rest], records };
}

function cell(v: Scalar | undefined): string {
  if (v === undefined || v === null) return "";
  let s = String(v);
  // Spreadsheet formula injection: neutralise strings (never numbers) a sheet would execute.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvHeader(table: FlatTable): string {
  return table.columns.map(cell).join(",");
}

export function csvLines(table: FlatTable): string[] {
  return table.records.map((r) => table.columns.map((c) => cell(r.get(c))).join(","));
}

/** Header plus the first `maxRows` records (all when omitted); no trailing newline. */
export function toCsv(table: FlatTable, maxRows = table.records.length): string {
  return [csvHeader(table), ...csvLines(table).slice(0, maxRows)].join("\n");
}
