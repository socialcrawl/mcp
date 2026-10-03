/**
 * Offline `socialcrawl_find` scorer: runs the bundled ranker (no API key, no
 * network) over a find gold file (`{ rows: [{ id, kind, text, endpoint,
 * also_ok }] }`) and prints top-1 / top-3 / none-handling, by the gold's rules:
 *
 * - route / ambiguous: right when the labelled endpoint or one of `also_ok`
 *   (`METHOD platform/resource`) is first (top-1) or among the first three.
 * - none: right only when find returns no endpoint. A pointer to a stateful
 *   `socialcrawl_manage` area (cohorts, monitors) is not an endpoint, so it
 *   does not count as an answer there; for route rows it still takes a slot.
 *
 *   npx tsx scripts/score-find.ts <gold.json> [--misses]
 *
 * `--misses` lists the rows wrong at top-3 and `--rows` every row's answer
 * (only use either on a tuning set).
 */
import { readFileSync } from "node:fs";
import { findStructured } from "../src/tools/find.js";

/** A gold row (`text`, `endpoint`) or a blind row (`task`, `expected`, ids without a GET prefix). */
interface Row {
  id: string;
  kind?: "route" | "ambiguous" | "none";
  text?: string;
  task?: string;
  endpoint?: string | null;
  expected?: string | null;
  also_ok: string[];
}

/** `METHOD platform/resource`, GET when no method is given. */
const norm = (key: string): string => (/^[A-Z]+ /.test(key) ? key : `GET ${key}`);

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  process.stderr.write("usage: score-find.ts <gold.json> [--misses]\n");
  process.exit(2);
}
const rows = (JSON.parse(readFileSync(file, "utf8")) as { rows: Row[] }).rows;
const ctx = { apiKey: "", baseUrl: "https://www.socialcrawl.dev" };

type R = { id: string; method?: string; kind?: string; area?: string; action?: string };
const keyOf = (r: R): string => (r.kind === "manage" ? `MANAGE ${r.area}/${r.action}` : `${r.method ?? "GET"} ${r.id}`);

const tally = { all: { n: 0, t1: 0, t3: 0 }, route: { n: 0, t1: 0, t3: 0 }, none: { n: 0, t1: 0, t3: 0 } };
const misses: string[] = [];
const lenientNone = { n: 0, ok: 0 };
for (const row of rows) {
  const text = row.text ?? row.task ?? "";
  const expected = row.endpoint !== undefined ? row.endpoint : (row.expected ?? null);
  const out = await findStructured(ctx, { task: text, limit: 3 });
  const results = ((out.structured.results as R[] | undefined) ?? []);
  const keys = results.map(keyOf);
  let t1: boolean;
  let t3: boolean;
  if (expected === null) {
    const endpoints = results.filter((r) => r.kind !== "manage");
    t1 = t3 = endpoints.length === 0;
    // The blind set's reading: nearest reads listed in also_ok may be offered on a null row.
    const near = new Set(row.also_ok.map(norm));
    lenientNone.n++;
    if (endpoints.every((r) => near.has(keyOf(r)))) lenientNone.ok++;
  } else {
    const ok = new Set([expected, ...row.also_ok].map(norm));
    t1 = keys.length > 0 && ok.has(keys[0]);
    t3 = keys.slice(0, 3).some((k) => ok.has(k));
  }
  const bucket = expected === null ? tally.none : tally.route;
  for (const b of [tally.all, bucket]) {
    b.n++;
    if (t1) b.t1++;
    if (t3) b.t3++;
  }
  if (flags.includes("--rows")) console.log(`${row.id} ${t1 ? 1 : 0}${t3 ? 1 : 0} ${keys.join(", ")}`);
  if (!t3) misses.push(`${row.id} ${row.kind ?? ""} | ${text.slice(0, 90)} | want ${expected} | got ${keys.join(", ") || "(none)"}`);
}
const pct = (a: number, n: number): string => (n === 0 ? "n/a" : `${((100 * a) / n).toFixed(1)}% (${a}/${n})`);
console.log(`rows ${tally.all.n}`);
console.log(`all    top-1 ${pct(tally.all.t1, tally.all.n)}  top-3 ${pct(tally.all.t3, tally.all.n)}`);
console.log(`route+ambiguous  top-1 ${pct(tally.route.t1, tally.route.n)}  top-3 ${pct(tally.route.t3, tally.route.n)}`);
console.log(`none   correct ${pct(tally.none.t1, tally.none.n)}  (also_ok offers allowed: ${pct(lenientNone.ok, lenientNone.n)})`);
if (flags.includes("--misses")) for (const m of misses) console.log(m);
