import { ENDPOINTS } from "./data/endpoints.js";
import type { Endpoint, HydrationLane, OptionalParam } from "./types.js";

/**
 * SocialCrawl judgments (`label=` / `relevance=`) and the other cross-cutting
 * levers that move a bill (`max_pages`, `seen`, `since`, `stop_at_id`, …).
 *
 * Judgments are ON by default and FREE: every row of a judged list already
 * carries `computed.labels` (and `computed.relevance` on a search) at no extra
 * credit. Three things add credits, all on the same unit price:
 *
 * - a `label=` preset outside the lane's free defaults (e.g. `mention`,
 *   `quality`, `injection` on posts; `spam`, `toxic` on comments; `reports`,
 *   `incentivized` on reviews),
 * - `label=intent` together with `offer=` (intent is free without it),
 * - `relevance=score|filter` with a caller-written topic in `relevant_to=`.
 *
 * Each holds `ceil(judgedRowCap / 25)` credits up front (4 on a 100-row page)
 * and settles to 1 credit per started 25 rows judged FRESH on this request.
 * Rows already judged, cached pages and pages where nothing could be judged
 * are free. This is a port of the backend's `labels/constants.ts`
 * (`labelHoldCredits`, `relevanceHoldCredits`, `paidLabelPresets`,
 * `judgedRowCap`) so a quote here is the hold the API actually takes.
 */

/** Rows per credit for every judgment (`LABEL_ROWS_PER_CREDIT`). */
export const ROWS_PER_JUDGMENT_CREDIT = 25;

/** Default judged rows per page (`LABEL_MAX_BILLABLE_ROWS`). */
export const DEFAULT_JUDGED_ROW_CAP = 100;

/**
 * Lanes whose one page can carry more than 100 judged rows
 * (`JUDGED_ROW_CAPS`). Mirrored by hand: the dump does not carry the cap, and
 * `judgments.test.ts` cross-checks it against every endpoint's authored
 * "holds N extra credits" wording so a backend change cannot drift silently.
 */
export const JUDGED_ROW_CAPS: Readonly<Record<string, number>> = {
  "tiktok/search": 120,
  "linkedin/search/posts": 200,
  "search/multi": 200,
};

/**
 * Presets that are free by default but metered when a context param is sent
 * (`METERED_WITH_PARAM`): `label=intent` is free, `label=intent&offer=…` is not.
 */
export const METERED_WITH_PARAM: Readonly<Record<string, string>> = {
  intent: "offer",
};

export function endpointId(e: Endpoint): string {
  return `${e.platform}/${e.resource}`;
}

export function judgedRowCap(e: Endpoint): number {
  return JUDGED_ROW_CAPS[endpointId(e)] ?? DEFAULT_JUDGED_ROW_CAP;
}

/** The largest hold one metered judgment (labels, or relevance) takes on this lane. */
export function judgmentHoldMax(e: Endpoint): number {
  const per = e.judgments?.labels?.rowsPerCredit ??
    e.judgments?.relevance?.rowsPerCredit ??
    ROWS_PER_JUDGMENT_CREDIT;
  return Math.ceil(judgedRowCap(e) / per);
}

/** Every endpoint that offers labels and/or relevance. */
export function judgedEndpoints(): Endpoint[] {
  return ENDPOINTS.filter((e) => e.judgments !== undefined);
}

/** `items[].comment` → `comment`. */
export function labelFamily(e: Endpoint): string | undefined {
  const path = e.judgments?.labels?.rowPath;
  if (!path) return undefined;
  const m = /items\[\]\.(\w+)/.exec(path);
  return m ? m[1] : path;
}

const csvOf = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export interface JudgmentQuote {
  /** Presets asked for that this lane offers and that are free. */
  freePresets: string[];
  /** Presets asked for that add credits on this call. */
  paidPresets: string[];
  /** Presets asked for that this lane does not offer (a free 400 at the API). */
  unknownPresets: string[];
  /** Credits held up front for labels (0 when every asked preset is free). */
  labelHold: number;
  /** Credits held up front for relevance (0 unless `relevant_to` is sent). */
  relevanceHold: number;
  /** labelHold + relevanceHold. */
  held: number;
  /** True when the caller turned the free default judgments off. */
  defaultsOff: boolean;
  /** Short notes worth showing the caller (missing brand, dry run, …). */
  notes: string[];
}

/**
 * Exactly what a set of request params holds for judgments on this endpoint.
 * The hold settles down to 1 credit per started 25 rows judged fresh.
 */
export function quoteJudgments(
  e: Endpoint,
  params: Record<string, unknown>,
): JudgmentQuote {
  const get = (k: string): string | undefined => {
    const v = params[k];
    return v === undefined || v === null ? undefined : String(v);
  };
  const out: JudgmentQuote = {
    freePresets: [],
    paidPresets: [],
    unknownPresets: [],
    labelHold: 0,
    relevanceHold: 0,
    held: 0,
    defaultsOff: false,
    notes: [],
  };
  const j = e.judgments;
  if (!j) return out;

  const asked = csvOf(get(j.labels?.param ?? "label"));
  out.defaultsOff = get(j.offParam) === "off" || asked.includes("none");

  if (j.labels) {
    const offered = new Set(j.labels.presets);
    const free = new Set(j.labels.free);
    for (const name of asked) {
      if (name === "none") continue;
      if (!offered.has(name)) {
        out.unknownPresets.push(name);
        continue;
      }
      const ctxParam = METERED_WITH_PARAM[name];
      const meteredByContext =
        ctxParam !== undefined && (get(ctxParam) ?? "").trim().length > 0;
      if (free.has(name) && !meteredByContext) out.freePresets.push(name);
      else out.paidPresets.push(name);
    }
    if (out.paidPresets.length > 0) out.labelHold = judgmentHoldMax(e);
    if (asked.includes("mention") && !(get("brand") ?? "").trim()) {
      out.notes.push(
        "`label=mention` needs `brand=` — without it the preset is skipped (warning `label_mention_needs_brand`) and not billed.",
      );
    }
  }

  if (j.relevance) {
    const mode = get(j.relevance.param);
    const topic = (get(j.relevance.meteredTopicParam) ?? "").trim();
    if ((mode === "score" || mode === "filter") && topic.length > 0) {
      out.relevanceHold = judgmentHoldMax(e);
    } else if (topic.length > 0) {
      out.notes.push(
        `\`${j.relevance.meteredTopicParam}\` only applies with \`${j.relevance.param}=score\` or \`${j.relevance.param}=filter\` — the API rejects it alone (a free 400).`,
      );
    }
  }

  out.held = out.labelHold + out.relevanceHold;
  if (get("dry_run") === "1") {
    out.notes.push(
      "`dry_run=1` returns a cost preview (`data.estimate`: rows_expected, rows_cached, label_credits_min/max, base_credits) without fetching or judging anything — 0 credits.",
    );
  }
  return out;
}

/** Multi-line explanation of the judgments an endpoint offers and their prices. */
export function explainJudgments(e: Endpoint): string[] {
  const j = e.judgments;
  if (!j) return [];
  const lines: string[] = [];
  const hold = judgmentHoldMax(e);
  const cap = judgedRowCap(e);
  if (j.labels) {
    const family = labelFamily(e) ?? "row";
    const paidCtx = Object.entries(METERED_WITH_PARAM)
      .filter(([preset]) => j.labels!.free.includes(preset))
      .map(([preset, param]) => `\`${preset}\` with \`${param}=\``);
    lines.push(
      `**Labels (\`${j.labels.param}=\`, ${family} rows):** every page already carries the free default labels ${j.labels.free.map((p) => `\`${p}\``).join(", ") || "(none)"} under \`computed.labels\` at no extra credit.` +
        (j.labels.metered.length > 0 || paidCtx.length > 0
          ? ` Metered presets: ${[...j.labels.metered.map((p) => `\`${p}\``), ...paidCtx].join(", ")} — each call that asks for one holds **${hold}cr** (1 credit per started ${j.labels.rowsPerCredit} rows of a ${cap}-row page) and keeps 1 credit per started ${j.labels.rowsPerCredit} rows judged fresh; rows already labelled, cached pages and pages where nothing could be judged are free.`
          : ""),
    );
  }
  if (j.relevance) {
    lines.push(
      `**Relevance (\`${j.relevance.param}=${j.relevance.values.join("|")}\`):** free against your \`${j.relevance.topicParam}\` — every row already carries \`computed.relevance\`; \`filter\` also drops off-topic rows (ids in \`data.relevance.dropped_ids\`). A topic of your own in \`${j.relevance.meteredTopicParam}=\` holds **${hold}cr** and keeps 1 credit per started ${j.relevance.rowsPerCredit} rows judged fresh.`,
    );
  }
  lines.push(
    `**Judgment controls:** \`${j.offParam}=off\` (or \`label=none\`) returns the page unjudged; \`dry_run=1\` previews the judgment cost for 0 credits; \`label_evidence=1\` adds the verbatim sentence behind each label.`,
  );
  return lines;
}

/** One cross-cutting lever an endpoint declares, with how it moves the bill. */
export interface Lever {
  param: string;
  what: string;
  cost: string;
}

/**
 * Cross-cutting params and what each does to the bill. Wording follows the
 * backend's `utility/capabilities` index (`platforms/registry-meta/capabilities.ts`),
 * extended with the walk levers whose price effect is stated per endpoint.
 */
export const LEVERS: readonly Lever[] = [
  {
    param: "max_pages",
    what: "Walks up to N pages in one call and returns the rows from all of them; `data.walk.stopped` says why it stopped and `data.next_cursor` continues.",
    cost: "Each page walked is billed exactly as one call (a cached page is free), so the worst case is N × the page price.",
  },
  {
    param: "seen",
    what: "An id you choose; rows this account already received under it are dropped (24h memory).",
    cost: "The page price falls with the share of repeats (page credits × new rows / rows, rounded up) — a page of repeats is free. `include=` join credits are never discounted.",
  },
  {
    param: "since",
    what: "Returns only rows after this date and ends the walk at the first older row (`pagination.stopped_at`).",
    cost: "Free; fewer pages are billed.",
  },
  {
    param: "stop_at_id",
    what: "Stops the walk at a post id/url you already hold (pinned rows never count as the boundary).",
    cost: "Free; fewer pages are billed.",
  },
  {
    param: "scan_pages",
    what: "Walks 1-3 comment pages in one call, drops repeats and returns the kept rows sorted.",
    cost: "Each page that added comments is billed at the lane's page price; a page of only repeats is free.",
  },
  {
    param: "min_views",
    what: "Drops rows below a view floor (unknown views are dropped).",
    cost: "Free, but every page walked is still billed.",
  },
  {
    param: "max_age_days",
    what: "Drops rows older than N days.",
    cost: "Free, but every page walked is still billed.",
  },
  {
    param: "recent_days",
    what: "Keeps only posts from the last N days.",
    cost: "Free.",
  },
  {
    param: "sort_rows",
    what: "Orders the kept rows across every page walked (e.g. by views).",
    cost: "Free.",
  },
  {
    param: "trim",
    what: "Drops the bulky raw fields from the response.",
    cost: "Same price, lighter payload.",
  },
  {
    param: "fit",
    what: "`fit=goal` with `goal=` keeps the rows and fields your goal needs and stubs the rest (`data.held_back` + a free recall id).",
    cost: "Free.",
  },
  {
    param: "download_media",
    what: "Also downloads the post's media and returns durable hosted URLs.",
    cost: "See the endpoint's rule; adds a few seconds of latency.",
  },
  {
    param: "dry_run",
    what: "Cost preview for a labelled or relevance-filtered request — nothing is fetched or judged.",
    cost: "0 credits.",
  },
];

function declaresParam(e: Endpoint, name: string): OptionalParam | { name: string } | undefined {
  return e.optionalParams.find((p) => p.name === name) ?? e.params.find((p) => p.name === name);
}

/** The cross-cutting levers this endpoint declares. */
export function leversOf(e: Endpoint): Lever[] {
  return LEVERS.filter((l) => declaresParam(e, l.param) !== undefined);
}

/** Lines for the levers an endpoint declares. */
export function explainLevers(e: Endpoint): string[] {
  const levers = leversOf(e).filter((l) => l.param !== "dry_run" || !e.judgments);
  if (levers.length === 0) return [];
  return [
    "**Cost levers on this endpoint:**",
    ...levers.map((l) => `- \`${l.param}\` — ${l.what} ${l.cost}`),
  ];
}

/** Lines for joins the API runs on every call without being asked. */
export function explainAutomaticJoins(e: Endpoint): string[] {
  const lanes: HydrationLane[] = e.automaticJoins ?? [];
  return lanes.map(
    (l) =>
      `**Automatic join (free):** every call fills ${l.fills.map((f) => `\`${f}\``).join(", ")} from \`${l.siblingMethod ?? "GET"} /v1/${l.sibling}\` at ${l.creditsPerItem === 0 ? "no extra credit" : `${l.creditsPerItem}cr per row`}${l.defaultOn ? `; send \`${l.defaultOn.unlessParam}=${l.defaultOn.unlessValue}\` to skip it (faster, but the leaf stays approximate)` : ""}. \`_warnings\` carries \`${l.warnings.partial}\` / \`${l.warnings.unavailable}\` when it could not fill every row.`,
  );
}

/**
 * The local equivalent of `GET /v1/utility/capabilities`: each cross-cutting
 * parameter once, with what it does, what it costs and every endpoint that
 * declares it. Label presets are split by row family.
 */
export interface CapabilityEntry {
  param: string;
  family?: string;
  what: string;
  cost: string;
  freeValues?: string[];
  meteredValues?: string[];
  endpoints: string[];
}

export function capabilityIndex(): CapabilityEntry[] {
  const out: CapabilityEntry[] = [];
  const families = new Map<string, Endpoint[]>();
  for (const e of judgedEndpoints()) {
    const fam = labelFamily(e);
    if (!fam || !e.judgments?.labels) continue;
    families.set(fam, [...(families.get(fam) ?? []), e]);
  }
  for (const [family, eps] of families) {
    const presets = [...new Set(eps.flatMap((e) => e.judgments!.labels!.presets))];
    const free = [...new Set(eps.flatMap((e) => e.judgments!.labels!.free))];
    out.push({
      param: "label",
      family,
      what: `Judges each ${family} row and reports it under \`computed.labels\`. The free presets run on every page by default; \`label=\` asks for presets by name.`,
      cost: `Free for ${free.join(", ")}; the other presets${family === "post" ? " (and intent with offer=)" : ""} cost 1 credit per started ${ROWS_PER_JUDGMENT_CREDIT} rows judged fresh.`,
      freeValues: free,
      meteredValues: presets.filter((p) => !free.includes(p)),
      endpoints: eps.map(endpointId),
    });
  }
  const rel = judgedEndpoints().filter((e) => e.judgments?.relevance);
  if (rel.length > 0) {
    out.push({
      param: "relevance",
      what: "Scores each row for how well it matches the search (`relevance=score`), or drops the rows that do not (`relevance=filter`).",
      cost: `Free against the search query; a topic of your own through \`relevant_to=\` costs 1 credit per started ${ROWS_PER_JUDGMENT_CREDIT} rows judged fresh.`,
      endpoints: rel.map(endpointId),
    });
  }
  const judged = judgedEndpoints().filter((e) => declaresParam(e, "judgments"));
  if (judged.length > 0) {
    out.push({
      param: "judgments",
      what: "`judgments=off` returns the page exactly as it was before default judgments: no `computed.labels`, no `computed.relevance`.",
      cost: "Free.",
      endpoints: judged.map(endpointId),
    });
  }
  const include = ENDPOINTS.filter((e) => declaresParam(e, "include"));
  out.push({
    param: "include",
    what: "Adds optional sections or row joins; each endpoint lists its own tokens.",
    cost: "Per endpoint — row joins hold per row and keep only rows filled fresh (see `socialcrawl_pricing` action `hydration`).",
    endpoints: include.map(endpointId),
  });
  for (const lever of LEVERS) {
    const eps = ENDPOINTS.filter((e) => declaresParam(e, lever.param));
    if (eps.length === 0) continue;
    out.push({ param: lever.param, what: lever.what, cost: lever.cost, endpoints: eps.map(endpointId) });
  }
  return out;
}
