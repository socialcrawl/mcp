/**
 * Field projection (`fields=id,author.username,engagement.*`). The API applies
 * it server-side where deployed; this is the local twin, used when the
 * response shows no projection happened.
 */

type Json = Record<string, unknown>;
interface Node {
  all: boolean;
  children: Map<string, Node>;
}

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** `"id, author.username"` or an array → clean path list. */
export function parseFields(input: string | string[] | undefined): string[] {
  if (input === undefined) return [];
  const parts = Array.isArray(input) ? input : input.split(",");
  return parts.map((p) => p.trim()).filter(Boolean);
}

function buildTree(paths: string[]): Node {
  const root: Node = { all: false, children: new Map() };
  for (const path of paths) {
    let node = root;
    let star = false;
    for (const seg of path.split(".")) {
      if (seg === "*") {
        node.all = true;
        star = true;
        break;
      }
      let next = node.children.get(seg);
      if (!next) {
        next = { all: false, children: new Map() };
        node.children.set(seg, next);
      }
      node = next;
    }
    // A path ending on a named key keeps that whole subtree, whatever else names its children.
    if (node !== root && !star) node.all = true;
  }
  return root;
}

/** Identity keys never projected away: at the row's top level and inside each requested root. */
export const IDENTITY_KEYS = ["id", "url"] as const;

/**
 * The paths plus the identity keys a projection must keep: `id`, `url`, and
 * `<root>.id` / `<root>.url` for each requested root and each row root
 * (`rowRoots`, e.g. `comment`), as the API's own projection does.
 */
export function withIdentity(paths: string[], rowRoots: readonly string[] = []): string[] {
  const roots = [...new Set([...paths.map((p) => p.split(".")[0]).filter((r) => r !== "*"), ...rowRoots])];
  const extra = [...IDENTITY_KEYS, ...roots.flatMap((r) => IDENTITY_KEYS.map((k) => `${r}.${k}`))];
  return [...paths, ...extra.filter((e) => !paths.includes(e))];
}

function project(value: unknown, node: Node): unknown {
  if (node.all) return value;
  if (Array.isArray(value)) return value.map((v) => project(v, node));
  if (!isObject(value)) return value;
  const out: Json = {};
  for (const [key, child] of node.children) {
    if (key in value) out[key] = project(value[key], child);
  }
  return out;
}

/** Keep only the listed dotted paths (arrays are traversed element-wise). */
export function projectValue(value: unknown, paths: string[]): unknown {
  return project(value, buildTree(paths));
}

/**
 * True when every row's top-level keys are already among the requested roots
 * (identity keys `id` / `url` allowed beside them), i.e. the API projected and
 * a local projection could only take things away.
 */
export function looksProjected(rows: unknown[], paths: string[]): boolean {
  const roots = new Set<string>([...paths.map((p) => p.split(".")[0]), ...IDENTITY_KEYS]);
  return rows.every((r) => !isObject(r) || Object.keys(r).every((k) => roots.has(k)));
}

/** The row's root keys: top-level objects that carry an `id` or `url` (`comment`, `post`), never `computed`. */
export function rowRoots(rows: unknown[]): string[] {
  const out = new Set<string>();
  for (const r of rows.slice(0, 20)) {
    if (!isObject(r)) continue;
    for (const [k, v] of Object.entries(r)) if (k !== "computed" && isObject(v) && ("id" in v || "url" in v)) out.add(k);
  }
  return [...out];
}

/** True when the dotted path (with `*`, walking arrays) reaches a value on this row. */
export function pathMatches(value: unknown, path: string): boolean {
  const segs = path.split(".");
  const walk = (v: unknown, i: number): boolean => {
    if (i === segs.length) return v !== undefined;
    if (Array.isArray(v)) return v.some((x) => walk(x, i));
    if (!isObject(v)) return false;
    if (segs[i] === "*") return Object.values(v).some((x) => walk(x, i + 1));
    return segs[i] in v && walk(v[segs[i]], i + 1);
  };
  return walk(value, 0);
}

/** True when a projected value kept nothing but identity keys (or nothing at all). */
export function isEmptyProjection(value: unknown): boolean {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([k, v]) => (IDENTITY_KEYS as readonly string[]).includes(k) || (isObject(v) && isEmptyProjection(v)));
}

/**
 * The warning for a projection that kept nothing: names the row's root keys
 * and rewrites the requested paths under the main one (`text` → `comment.text`).
 */
export function emptyProjectionWarning(sampleRow: unknown, paths: string[]): string {
  const roots = isObject(sampleRow) ? Object.keys(sampleRow).filter((k) => isObject(sampleRow[k])) : [];
  const main = roots.find((r) => r !== "computed") ?? roots[0];
  const hint = main ? ` Rows are rooted at ${roots.map((r) => `"${r}"`).join(", ")}; try ${paths.map((p) => (p.startsWith(`${main}.`) ? p : `${main}.${p}`)).join(",")}.` : "";
  return `fields "${paths.join(",")}" matched nothing on these rows.${hint} Use paths exactly as socialcrawl_endpoint lists them.`;
}
