/**
 * Ranked lexical search over the endpoint catalogue (MCP-04). Dependency-free
 * on purpose: the codebase's router-nl ranker (T15) ports this file and reuses
 * `__fixtures__/rank-cases.json` and `__fixtures__/rank-heldout.json`, so keep
 * every rule here and documented.
 *
 * Algorithm (BM25F-lite, deterministic):
 *
 * 1. Tokenize. Lowercase; drop apostrophes; split on anything that is not a
 *    letter or digit (so `/ _ -`, whitespace and punctuation all split); drop
 *    STOPWORDS; fold with `stem`: plurals (ies→y; ches/shes/sses/xes/zes lose
 *    "es"; a trailing s goes unless the word ends in ss, us or is), then -ing
 *    (words over 5 letters) and -ed (over 4, not -eed): a doubled final
 *    consonant is undoubled (shopping→shop), and a short consonant-vowel-
 *    consonant stem of up to 4 letters gets its e back (liked→like).
 * 2. Detect platforms. PATTERNS run first on the raw query (`r/<name>` names
 *    reddit and leaves the word "subreddit"). Then, on the raw tokens, longest
 *    phrase first (up to 3 tokens), each platform's slug (split on _), display
 *    name (split on "/" into alternatives, e.g. "Twitter/X") and aliases.
 *    Matched tokens leave the query. Soft aliases (tweet, tweets, stock) name
 *    the platform but stay in the query as words. A `generic` platform (its
 *    name is an everyday word: threads, target, kick, ...) is named by its bare
 *    word only as the query's first token, and never for NEVER_PLATFORM_WORDS
 *    (search, utility); otherwise only by a multi-word name or an alias.
 *    Typos: a token of 4+ letters that the corpus does not know (no document
 *    has it) names the platform whose one-word name or alias starts with the
 *    same letter and is within edit distance 1 (4-5 letters) or 2 (6+), when
 *    exactly one platform is that close ("tiktk", "instagarm"); a word the
 *    corpus knows, or one with another first letter ("help"), is never a typo.
 *    Which platforms count as named: every hard match; a soft match only when
 *    nothing was named outright, or when it belongs to the family of a named
 *    platform. Family: a platform whose slug extends another's (`google_trends`
 *    of `google`) or whose name extends another's ("TikTok Shop" of "TikTok");
 *    when a family member is named, its parent is not. A family member's
 *    qualifier word (its name or slug minus the parent's: "trends", "news",
 *    "shopping"), in any stemmed form ("trending"), names that member when its
 *    parent is named; the word stays a search word.
 * 3. Score. For each remaining unique term t, idf(t) = ln(1 + (N - df + 0.5) /
 *    (df + 0.5)), df counted over whole documents. Each field f contributes
 *    FIELD_WEIGHTS[f] * w(t) * idf(t) * tf*(K1+1) / (tf + K1*(1 - B + B*len/avglen)),
 *    with per-field average lengths. Fields: id (the leaf: the id's last
 *    literal segment, what the endpoint returns), path (the platform and the
 *    containers before the leaf, lower weight: `video` in
 *    `video/comment/replies` names where the replies sit, not what they are),
 *    id_exact (the id's unstemmed tokens against the unstemmed query, so
 *    "comments" prefers `post/comments` over `comment`), summary, returns,
 *    intent (use_when's first clause: past the "Use it to / for / when"
 *    opening, up to the first , ; : . or hand-off word such as then, instead,
 *    before, after; empty for "Use it after ...", a follow-up step), use_when
 *    (the rest, low weight), tags, extra (archetype, param names; lowest).
 *    Other endpoints named in prose (`post/comments`) are dropped from
 *    summary, returns and use_when first: their words describe those.
 *    Term weights w(t): 1; the head noun (the last non-verb word before the
 *    first PREPOSITION, else the last non-verb word) HEAD_BOOST; SYNONYMS of a
 *    term SYNONYM_WEIGHT; after "who" with no noun before it ("who
 *    retweeted"), each term's agent noun (retweet→retweeter, share→sharer) at
 *    full weight; a generic VERB (search, find, ...) VERB_DAMPEN in every field
 *    but the id and path, since almost every summary starts with one. A clause
 *    after the object (a MODIFIER_MARKER: with, who, that, ... after a noun:
 *    "creators with over 100k followers") filters it: words found only there
 *    weigh MODIFIER_WEIGHT and do not count toward resource coverage. Cue
 *    expansions (query-side, at full weight unless noted): a recurring run
 *    (a RECURRENCE_WORD, or "every / each <TIME_UNIT>") or a watching verb
 *    (VERB_CLASSES monitor: track, watch, alert, ...) adds RECURRENCE_TERMS
 *    (cadence, schedule, monitor); "my / our" before a plural noun (a set the
 *    user holds) adds OWNED_TERMS (panel); a topical query (below) adds
 *    TOPIC_TERMS (topic, keyword) at SYNONYM_WEIGHT.
 * 4. Boosts (multiply a score above 0). Resource coverage: 1 + COVERAGE_BOOST
 *    × `resourceCoverage` (each resource word counts 1 when the query has it
 *    verbatim and 0.5 when only its singular/plural form matches, over the
 *    number of resource words: "tiktok profile" prefers `profile` over
 *    `profile/region`, "comments" `post/comments` over `comment`). Head match:
 *    LEAF_HEAD_BOOST when the resource's last word is the head noun or one of
 *    its synonyms (`tripadvisor/reviews` for "hotel reviews"). Search intent:
 *    a query using one of SEARCH_INTENT_WORDS (search, mentioning, keyword)
 *    multiplies documents whose resource has a `search` segment by
 *    SEARCH_INTENT_BOOST, and the head-match boost then applies only to them
 *    ("youtube search videos" is a search, not the videos-by-id batch). List
 *    intent: a plural content word (not one of SINGLE_PLURALS such as
 *    "details"), a COLLECTION_WORD (feed, history, ...) or "who" ("who liked")
 *    multiplies list documents (`list: true`) by LIST_BOOST and divides the
 *    others by it; the word "list" uses LIST_WORD_BOOST. Detail intent (a
 *    DETAIL_WORD: details, info, ...) does the opposite: single-object
 *    documents up, lists down. Both cues together cancel out. A LIST_VERB
 *    (find, list, discover, lookup) with a plural object asks for a search:
 *    list documents get LIST_WORD_BOOST and `.../search` documents
 *    LIST_VERB_SEARCH_BOOST; so does a topical query (a plural noun, then a
 *    TOPIC_PREP: "creators about cooking"). With either, the head-match boost
 *    goes only to search documents. A collection inside another object
 *    ("videos in a playlist", "items from a playlist": a plural word, then an
 *    INNER_PREP, then a noun phrase whose last word is the inner noun)
 *    multiplies list documents that name that inner noun in their resource,
 *    returns or intent ("comments on one TikTok video" holds a video's
 *    comments) by INNER_BOOST, and the head-match boost then goes only to
 *    them. SYNONYMS also map locations / nearby / branches to stores. Batch
 *    documents (`batch: true`, many ids in one POST) are multiplied by
 *    BATCH_DAMPEN unless the query asks for a batch (batch, bulk, many, ids,
 *    urls, or a count — a number of 2+ or a QUANTITY_WORD — with a
 *    BATCH_INPUTS word: "500 post URLs", "hundreds of handles"), then by
 *    BATCH_BOOST; a counted list of inputs also divides one-input documents
 *    by BATCH_BOOST. Cross-platform documents (`cross: true`) are multiplied
 *    by the number of platforms named when two or more are, or by 2 for "on
 *    every platform", "across platforms", "everywhere". A document whose
 *    use_when opens with "Use it to <verb>" in the same VERB_CLASSES class as
 *    a query verb gets INTENT_VERB_BOOST. Stateful families (`anyPlatform`)
 *    take no list or detail multiplier. A query equal to a document id
 *    (`tiktok/post/comments`, optional leading `/v1/`) puts that document
 *    first.
 * 5. Order. Documents on a named platform come first (precedence, not a
 *    boost), then score descending, then corpus order; score > 0 only. Also
 *    named: cross-platform documents when the query names two or more
 *    platforms or every platform; stateful families (`anyPlatform`) when it
 *    names any platform, or when a recurring or owned-set cue fires and the
 *    family's text has that cue's terms.
 *    `platform` filters to one platform. A query that names only a platform,
 *    or a platform none of whose documents match the other words, lists that
 *    platform's documents in corpus order after its scored hits.
 */

export interface RankDoc {
  /** `platform/resource`. */
  id: string;
  platform: string;
  /** HTTP method, when one id is served by several. */
  method?: string;
  summary?: string | null;
  returns?: string | null;
  use_when?: string | null;
  tags?: readonly string[];
  /** Low-weight extra text: archetype, param names, label presets. */
  extra?: string | null;
  /** Returns a list of rows (a list archetype, or it pages), not one item. */
  list?: boolean;
  /** Takes many ids in one call (a POST batch); only wanted when asked for. */
  batch?: boolean;
  /** Fans out across platforms (a cross-platform composite): eligible when the query names two or more platforms. */
  cross?: boolean;
  /** Works with any platform (a stateful family such as monitors): competes with the platforms a query names. */
  anyPlatform?: boolean;
}

export interface RankPlatform {
  slug: string;
  name: string;
  /** Other names; matched tokens leave the query. */
  aliases?: readonly string[];
  /** Words that name the platform but stay in the query as search words (tweet, stock). */
  softAliases?: readonly string[];
  /** The slug / one-word name is an everyday word: named by it only as the first token. */
  generic?: boolean;
}

/** A raw-query pattern that names a platform and leaves a word behind (`r/python` → reddit + "subreddit"). */
export interface RankPattern {
  re: RegExp;
  platform: string;
  term: string;
}

export interface RankHit {
  id: string;
  method?: string;
  platform: string;
  score: number;
  /** Position in the corpus (stable tie-break). */
  index: number;
  /** Takes precedence: on a platform the query named, or a cross-platform or stateful document the query calls for. */
  named: boolean;
}

export interface RankOptions {
  /** Only documents on this platform. */
  platform?: string;
  /** Maximum hits (default: all). */
  limit?: number;
}

export const K1 = 1.2;
export const B = 0.75;
export const HEAD_BOOST = 1.5;
export const COVERAGE_BOOST = 0.5;
export const SYNONYM_WEIGHT = 0.5;
export const VERB_DAMPEN = 0.3;
export const SEARCH_INTENT_BOOST = 2;
export const LIST_BOOST = 1.3;
export const LIST_WORD_BOOST = 1.6;
export const LEAF_HEAD_BOOST = 1.5;
export const BATCH_DAMPEN = 0.6;
export const LIST_VERB_SEARCH_BOOST = 1.5;
export const INNER_BOOST = 2;

/** Verbs (stemmed) that, with a plural object, ask for a search or list endpoint. */
export const LIST_VERBS: ReadonlySet<string> = new Set(["find", "list", "discover", "lookup"]);

/** Prepositions that put a collection inside another object ("videos in a playlist"). */
export const INNER_PREPS: ReadonlySet<string> = new Set(["in", "inside", "of", "from", "within", "on"]);

/** Words that make a run recurring on their own, and the time units "every / each <unit>" repeats on. */
export const RECURRENCE_WORDS: ReadonlySet<string> = new Set([
  "daily", "weekly", "hourly", "nightly", "monthly", "recurring", "repeatedly", "periodically", "scheduled", "schedule", "cron", "cadence",
]);
export const TIME_UNITS: ReadonlySet<string> = new Set(["minute", "hour", "day", "night", "morning", "evening", "week", "month", "monday", "weekday"]);

/** How the registry words a recurring run; a recurring query looks for them (stemmed). */
export const RECURRENCE_TERMS: readonly string[] = ["cadence", "schedule", "scheduled", "monitor"].map(stem);

/** Possessives that make the object a set the user already holds ("my 200 accounts"). */
export const OWNED_WORDS: ReadonlySet<string> = new Set(["my", "our"]);

/** How the registry words a set the user supplies. */
export const OWNED_TERMS: readonly string[] = ["panel"];

/** True for "every day", "each week", "daily", "on a schedule". */
function recurring(rest: readonly string[]): boolean {
  return rest.some((t, i) => RECURRENCE_WORDS.has(t) || ((t === "every" || t === "each") && TIME_UNITS.has(stem(rest[i + 1] ?? ""))));
}

/** True for "my / our" followed within four words by a plural noun ("my list of customer accounts"). */
function owned(rest: readonly string[]): boolean {
  return rest.some((t, i) => OWNED_WORDS.has(t) && rest.slice(i + 1, i + 5).some(isPluralNoun));
}

/**
 * Verbs (stemmed) by what they ask for. A query verb in the same class as the
 * verb a document's use_when opens with ("Use it to track ...") is the same job.
 * Plain reading and finding verbs (read, get, find, search) are left out: nearly
 * every endpoint reads, and search intent has its own cue.
 */
export const VERB_CLASSES: Readonly<Record<string, string>> = {
  track: "monitor", monitor: "monitor", watch: "monitor", alert: "monitor", poll: "monitor",
  compare: "compare", benchmark: "compare", versus: "compare", vs: "compare",
  check: "vet", vet: "vet", audit: "vet", verify: "vet", confirm: "vet", judge: "vet",
};

/** A document whose intent verb is in the class of a query verb. */
export const INTENT_VERB_BOOST = 1.5;

/** How the registry words a topic search; a topical query looks for them. */
export const TOPIC_TERMS: readonly string[] = ["topic", "keyword"];

/** Words that open a clause qualifying the object ("with over 100k followers", "who post about cooking"). */
export const MODIFIER_MARKERS: ReadonlySet<string> = new Set(["with", "who", "that", "whose", "having"]);

/** Weight of a word found only in such a clause. */
export const MODIFIER_WEIGHT = 0.5;

/** Words that put a topic after a plural object ("creators about cooking"): the user is discovering, so a search. */
export const TOPIC_PREPS: ReadonlySet<string> = new Set(["about", "regarding", "discussing"]);

/** Plural in form, but asking for one item's facts: no list intent. */
export const SINGLE_PLURALS: ReadonlySet<string> = new Set([
  "details", "stats", "statistics", "analytics", "metrics", "demographics", "insights", "news", "trends", "odds", "contacts", "settings",
]);

/** Singular nouns that still ask for many rows. */
export const COLLECTION_WORDS: ReadonlySet<string> = new Set([
  "feed", "timeline", "history", "archive", "catalog", "catalogue", "inventory", "leaderboard", "ranking", "chart",
]);

/** Words that ask for one item's facts rather than a list. */
export const DETAIL_WORDS: ReadonlySet<string> = new Set(["detail", "details", "info", "information", "overview", "metadata"]);

/** Words that ask for a batch endpoint. */
export const BATCH_WORDS: ReadonlySet<string> = new Set(["batch", "bulk", "many", "ids", "urls", "multiple"]);

/** Plural inputs a batch takes (its array params name them): with a count, many of them in one call. */
export const BATCH_INPUTS: ReadonlySet<string> = new Set(["urls", "links", "ids", "handles", "usernames", "accounts", "profiles"]);

/** "every / all / each platform": the query wants every platform at once. */
export const ALL_WORDS: ReadonlySet<string> = new Set(["every", "all", "each", "any", "across", "multiple", "many", "several"]);

/** Words that say "many" without a number. */
export const QUANTITY_WORDS: ReadonlySet<string> = new Set(["dozens", "hundreds", "thousands", "several", "multiple", "many"]);

/** A batch is multiplied by this when the query asks for many inputs at once. */
export const BATCH_BOOST = 1.5;

/** Stemmed words that mean "search for it" (the user wants a search endpoint). */
export const SEARCH_INTENT_WORDS: ReadonlySet<string> = new Set(["search", "mention", "keyword"]);
export const EXACT_ID_SCORE = 1_000_000;

/** Words that end a noun phrase: the head noun is the last term before the first of these. */
export const PREPOSITIONS: ReadonlySet<string> = new Set([
  "about", "across", "at", "by", "for", "from", "in", "inside", "into", "of", "on", "over", "per", "to", "with", "within",
]);

/** Generic verbs (stemmed): they say what to do, not what to get. */
export const VERBS: ReadonlySet<string> = new Set([
  "search", "find", "lookup", "look", "fetch", "retrieve", "pull", "scrap", "scrape", "read", "export", "download", "track", "monitor", "check",
  "discover",
]);

/** Bare platform words never taken as a platform name (too common as plain words). */
export const NEVER_PLATFORM_WORDS: ReadonlySet<string> = new Set(["search", "utility"]);

/** Query-side expansions (stemmed). Small on purpose: only words the registry phrases differently. */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  user: ["profile", "account"],
  account: ["profile", "user"],
  employee: ["people", "staff"],
  staff: ["people", "employee"],
  follow: ["follower"],
  tweet: ["post"],
  stock: ["ticker", "quote"],
  watch: ["monitor"],
  alert: ["monitor"],
  notify: ["monitor"],
  creator: ["account", "user", "profile"],
  influencer: ["creator"],
  price: ["offer", "pricing"],
  reply: ["comment"],
  thread: ["post"],
  sound: ["music", "song"],
  odd: ["market", "prediction"],
  map: ["business", "place"],
  location: ["store"],
  nearby: ["store"],
  branch: ["store"],
};

export const FIELD_WEIGHTS = {
  id: 3,
  path: 2,
  id_exact: 1,
  summary: 2,
  returns: 1,
  intent: 2,
  use_when: 0.5,
  tags: 1,
  extra: 0.3,
} as const;

/** Another endpoint named in prose (`post/comments`, `instagram/search/profiles`): its words describe that endpoint, not this one. */
const ENDPOINT_REF = /\b[a-z][a-z0-9_]*(?:\/[a-z0-9_{}.-]+)+/gi;

/** Prose with the other endpoints it names taken out. */
export function stripRefs(text: string | null | undefined): string {
  return text ? text.replace(ENDPOINT_REF, " ") : "";
}

/**
 * A `use_when` line split into its intent (the first clause: what the
 * endpoint is used to do) and the rest (hand-offs, caveats, alternatives).
 */
export function splitUseWhen(text: string | null | undefined): { intent: string; rest: string } {
  const clean = stripRefs(text);
  // Past the opening ("Use it to", "Use it after"), the first clause break or hand-off word ends the intent.
  const open = /^\s*use it\s+(\S+)/i.exec(clean);
  // "Use it after <another endpoint>": a follow-up step, not an entry point; it states no intent of its own.
  if (open && /^after$/i.test(open[1])) return { intent: "", rest: clean };
  const start = open?.[0].length ?? 0;
  const at = clean.slice(start).search(/[;:,]|\.(\s|$)|\s(?:then|instead|rather|so|since|before|after|unless|because|while)\b/i);
  if (at === -1) return { intent: clean, rest: "" };
  return { intent: clean.slice(0, start + at), rest: clean.slice(start + at) };
}

type Field = keyof typeof FIELD_WEIGHTS;
const FIELDS = Object.keys(FIELD_WEIGHTS) as Field[];

export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "by", "can", "do", "does", "each",
  "for", "from", "get", "give", "how", "i", "in", "into", "is", "it", "its", "list", "me", "my", "of",
  "on", "one", "or", "our", "please", "show", "that", "the", "their", "them", "these", "this", "those",
  "to", "via", "want", "we", "what", "which", "who", "whose", "with", "you", "your",
]);

const VOWEL = "aeiou";
const isCons = (c: string | undefined): boolean => c !== undefined && /[a-z]/.test(c) && !VOWEL.includes(c);

/** After -ing / -ed: undouble a final consonant (shopp→shop), or restore a short CVC stem's e (lik→like). */
function afterSuffix(w: string): string {
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) return w.slice(0, -1);
  const [a, b, c] = [w[w.length - 3], w[w.length - 2], w[w.length - 1]];
  if (w.length <= 4 && isCons(a) && b !== undefined && VOWEL.includes(b) && isCons(c) && !"wxy".includes(c)) return `${w}e`;
  return w;
}

/**
 * Light folding: replies→reply, searches→search, comments→comment, ads→ad,
 * searching→search, posted→post, shopping→shop, liked→like, sharing→share;
 * status and address unchanged.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length >= 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = afterSuffix(w.slice(0, -3));
  else if (w.length > 4 && w.endsWith("ed") && !w.endsWith("eed")) w = afterSuffix(w.slice(0, -2));
  return w;
}

/** Lowercased alphanumeric runs, apostrophes removed. No stopword removal, no stemming. */
export function rawTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The ranker's terms for a piece of text. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return rawTokens(text)
    .filter((t) => !STOPWORDS.has(t))
    .map(stem);
}

interface FieldStats {
  tf: Map<string, number>;
  len: number;
}

interface Phrase {
  slug: string;
  /** Keep the tokens as query words too. */
  soft: boolean;
  /** Only as the query's first token. */
  startOnly: boolean;
}

export interface RankIndex {
  docs: readonly RankDoc[];
  fields: Record<Field, FieldStats>[];
  avgLen: Record<Field, number>;
  df: Map<string, number>;
  /** Phrase (space-joined raw tokens) → platform. */
  phrases: Map<string, Phrase>;
  maxPhrase: number;
  /** One-word names and aliases (4+ letters) for typo matching → platform slug. */
  fuzzy: Map<string, string>;
  /** Platform slug → its family parent's slug. */
  parent: Map<string, string>;
  /** Stemmed qualifier word → the family members it names (with their parent). */
  qualifiers: Map<string, Array<{ child: string; parent: string }>>;
  patterns: readonly RankPattern[];
  byId: Map<string, number>;
  /** Unstemmed tokens of each document's resource (the id minus its platform segment). */
  resourceTokens: string[][];
  /** The verb class of each document's intent ("Use it to track ..." → monitor), when it has one. */
  intentVerbs: Array<string | undefined>;
}

/**
 * An id's leaf (its last literal path segment: what the endpoint returns,
 * `replies` in `tiktok/video/comment/replies`) and the path before it (the
 * platform and the containers it sits under).
 */
export function splitId(id: string): { leaf: string; path: string } {
  const segs = id.split("/");
  let i = segs.length - 1;
  while (i > 1 && /^\{.*\}$/.test(segs[i])) i--;
  if (i < 1) return { leaf: id, path: "" };
  return { leaf: segs[i], path: [...segs.slice(0, i), ...segs.slice(i + 1)].join("/") };
}

function stats(tokens: string[]): FieldStats {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return { tf, len: tokens.length };
}

function phrasesFor(p: RankPlatform): Array<[string, Phrase]> {
  const out = new Map<string, Phrase>();
  const add = (text: string, kind: "name" | "alias" | "soft"): void => {
    const toks = rawTokens(text);
    if (toks.length === 0) return;
    const phrase = toks.join(" ");
    if (out.has(phrase)) return;
    if (kind === "name" && toks.length === 1 && p.generic) {
      if (!NEVER_PLATFORM_WORDS.has(phrase)) out.set(phrase, { slug: p.slug, soft: false, startOnly: true });
      return;
    }
    out.set(phrase, { slug: p.slug, soft: kind === "soft", startOnly: false });
  };
  add(p.slug.replace(/_/g, " "), "name");
  add(p.slug.replace(/_/g, ""), "name");
  for (const alt of p.name.split("/")) add(alt, "name");
  for (const alias of p.aliases ?? []) add(alias, "alias");
  for (const alias of p.softAliases ?? []) add(alias, "soft");
  return [...out];
}

export function buildIndex(
  docs: readonly RankDoc[],
  platforms: readonly RankPlatform[] = [],
  patterns: readonly RankPattern[] = [],
): RankIndex {
  const fields = docs.map((d) => {
    const use = splitUseWhen(d.use_when);
    const { leaf, path } = splitId(d.id);
    return {
    id: stats(tokenize(leaf)),
    path: stats(tokenize(path)),
    id_exact: stats(rawTokens(d.id).filter((t) => !STOPWORDS.has(t))),
    summary: stats(tokenize(stripRefs(d.summary))),
    returns: stats(tokenize(stripRefs(d.returns))),
    intent: stats(tokenize(use.intent)),
    use_when: stats(tokenize(use.rest)),
    tags: stats(tokenize((d.tags ?? []).join(" "))),
    extra: stats(tokenize(d.extra)),
    };
  });
  const avgLen = {} as Record<Field, number>;
  for (const f of FIELDS) {
    const total = fields.reduce((s, x) => s + x[f].len, 0);
    avgLen[f] = docs.length > 0 ? Math.max(total / docs.length, 1e-9) : 1;
  }
  const df = new Map<string, number>();
  for (const x of fields) {
    const seen = new Set<string>();
    for (const f of FIELDS) for (const t of x[f].tf.keys()) seen.add(t);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const phrases = new Map<string, Phrase>();
  const fuzzy = new Map<string, string>();
  let maxPhrase = 1;
  for (const p of platforms) {
    for (const [ph, info] of phrasesFor(p)) {
      if (!phrases.has(ph)) phrases.set(ph, info);
      maxPhrase = Math.max(maxPhrase, ph.split(" ").length);
      if (!info.startOnly && !info.soft && !ph.includes(" ") && ph.length >= 4 && !fuzzy.has(ph)) fuzzy.set(ph, info.slug);
    }
  }
  const parent = new Map<string, string>();
  for (const p of platforms) {
    const name = rawTokens(p.name);
    for (const q of platforms) {
      if (q === p) continue;
      const qName = rawTokens(q.name);
      const bySlug = p.slug.startsWith(`${q.slug}_`);
      const byName = qName.length > 0 && qName.length < name.length && qName.every((t, i) => name[i] === t);
      if (bySlug || byName) parent.set(p.slug, q.slug);
    }
  }
  const qualifiers = new Map<string, Array<{ child: string; parent: string }>>();
  for (const p of platforms) {
    const par = parent.get(p.slug);
    const q = platforms.find((x) => x.slug === par);
    if (!par || !q) continue;
    const own = new Set([...rawTokens(q.name), ...rawTokens(q.slug.replace(/_/g, " "))]);
    const words = [...rawTokens(p.name), ...rawTokens(p.slug.replace(/_/g, " "))].filter((w) => !own.has(w) && !STOPWORDS.has(w));
    for (const w of new Set(words.map(stem))) {
      const list = qualifiers.get(w) ?? [];
      if (!list.some((x) => x.child === p.slug)) list.push({ child: p.slug, parent: par });
      qualifiers.set(w, list);
    }
  }
  const byId = new Map<string, number>();
  docs.forEach((d, i) => {
    if (!byId.has(d.id)) byId.set(d.id, i);
  });
  const resourceTokens = docs.map((d) => rawTokens(d.id.slice(d.id.indexOf("/") + 1)).filter((t) => !STOPWORDS.has(t)));
  const intentVerbs = docs.map((d) => {
    const verb = /^\s*use it to (\p{L}+)/iu.exec(stripRefs(d.use_when))?.[1];
    return verb ? VERB_CLASSES[stem(verb.toLowerCase())] : undefined;
  });
  return { docs, fields, avgLen, df, phrases, maxPhrase, fuzzy, parent, qualifiers, patterns, byId, resourceTokens, intentVerbs };
}

/** The platform a mistyped token most likely names, or undefined (a known word, or no single close name). */
function typoPlatform(index: RankIndex, token: string): string | undefined {
  if (token.length < 4 || STOPWORDS.has(token) || index.df.has(token) || index.df.has(stem(token))) return undefined;
  const limit = token.length >= 6 ? 2 : 1;
  let best: { slug: string; d: number } | undefined;
  let tie = false;
  for (const [name, slug] of index.fuzzy) {
    if (name[0] !== token[0] || Math.abs(name.length - token.length) > limit) continue;
    const d = levenshtein(token, name);
    if (d > limit) continue;
    if (!best || d < best.d) {
      best = { slug, d };
      tie = false;
    } else if (d === best.d && slug !== best.slug) tie = true;
  }
  return best && !tie ? best.slug : undefined;
}

/** Platforms the query names, and the raw tokens left once their phrases are removed. */
export function detectPlatforms(index: RankIndex, query: string): { platforms: Set<string>; rest: string[] } {
  const hard = new Set<string>();
  const soft = new Set<string>();
  let q = query;
  for (const p of index.patterns) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : `${p.re.flags}g`);
    if (re.test(q)) {
      hard.add(p.platform);
      q = q.replace(re, ` ${p.term} `);
    }
  }
  const toks = rawTokens(q);
  const rest: string[] = [];
  for (let i = 0; i < toks.length; ) {
    let matched = 0;
    for (let n = Math.min(index.maxPhrase, toks.length - i); n >= 1; n--) {
      const ph = index.phrases.get(toks.slice(i, i + n).join(" "));
      if (ph && (!ph.startOnly || i === 0)) {
        (ph.soft ? soft : hard).add(ph.slug);
        if (ph.soft) rest.push(...toks.slice(i, i + n));
        matched = n;
        break;
      }
    }
    if (matched === 0) {
      const typo = typoPlatform(index, toks[i]);
      if (typo) {
        hard.add(typo);
        matched = 1;
      }
    }
    if (matched > 0) i += matched;
    else rest.push(toks[i++]);
  }
  // Soft names count when nothing was named outright, or when they are family of a named platform.
  const platforms = new Set(hard);
  for (const s of soft) {
    if (hard.size === 0 || (index.parent.get(s) !== undefined && hard.has(index.parent.get(s)!))) platforms.add(s);
  }
  // A family member's qualifier word next to its named parent ("google trending") names the member.
  for (const t of rest) {
    for (const q of index.qualifiers.get(stem(t)) ?? []) if (platforms.has(q.parent)) platforms.add(q.child);
  }
  // A named family member outranks its parent.
  for (const slug of [...platforms]) {
    const parent = index.parent.get(slug);
    if (parent !== undefined) platforms.delete(parent);
  }
  return { platforms, rest };
}

function bm25(tf: number, len: number, avg: number): number {
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / avg));
}

/** The head noun's stemmed form: the last non-verb content word before the first preposition. */
export function headTerm(rest: readonly string[]): string | undefined {
  const cut = rest.findIndex((t, i) => i > 0 && PREPOSITIONS.has(t));
  const phrase = (cut === -1 ? rest : rest.slice(0, cut)).filter((t) => !STOPWORDS.has(t) && !VERBS.has(stem(t)));
  const last = phrase[phrase.length - 1];
  return last === undefined ? undefined : stem(last);
}

/** A content word that can be the object (not a stopword, verb or number). */
function isContentNoun(t: string): boolean {
  return !STOPWORDS.has(t) && !VERBS.has(stem(t)) && !/^\d/.test(t);
}

/** A plural content word that names things (not a verb, not "details"-like). */
function isPluralNoun(t: string): boolean {
  return !STOPWORDS.has(t) && !SINGLE_PLURALS.has(t) && t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t) && !VERBS.has(stem(t));
}

/** True when the query asks for many rows: "list", "who", a collection word, or a plural noun. */
function wantsList(rest: readonly string[]): boolean {
  return rest.some((t) => t === "list" || t === "who" || COLLECTION_WORDS.has(t) || isPluralNoun(t));
}

/** The stemmed inner object of "<plural> <prep> [a|the] [adjective] <noun>" ("videos in a playlist" → playlist). */
function innerNoun(rest: readonly string[]): string | undefined {
  for (let i = 1; i < rest.length - 1; i++) {
    if (!INNER_PREPS.has(rest[i]) || !(isPluralNoun(rest[i - 1]) || COLLECTION_WORDS.has(rest[i - 1]))) continue;
    // The inner noun phrase's head: its last word before the next preposition ("a public group" → group).
    const after = rest.slice(i + 1);
    const end = after.findIndex((t) => PREPOSITIONS.has(t));
    const phrase = (end === -1 ? after : after.slice(0, end)).filter((t) => !STOPWORDS.has(t));
    if (phrase.length > 0) return stem(phrase[phrase.length - 1]);
  }
  return undefined;
}

/**
 * Share of a resource's words the query names: 1 per word found verbatim,
 * 0.5 per word that only matches in its other singular/plural form.
 */
export function resourceCoverage(resourceWords: readonly string[], queryWords: readonly string[]): number {
  if (resourceWords.length === 0) return 0;
  const raw = new Set(queryWords);
  const stems = new Set(queryWords.map(stem));
  let covered = 0;
  for (const w of resourceWords) covered += raw.has(w) ? 1 : stems.has(stem(w)) ? 0.5 : 0;
  return covered / resourceWords.length;
}

/** True when the query asks for one item's facts ("details", "info"). */
function wantsDetail(rest: readonly string[]): boolean {
  return rest.some((t) => DETAIL_WORDS.has(t));
}

export function rank(index: RankIndex, query: string, opts: RankOptions = {}): RankHit[] {
  const { platforms, rest } = detectPlatforms(index, query);
  const rawTerms = [...new Set(rest.filter((t) => !STOPWORDS.has(t)))];
  const terms = [...new Set(rawTerms.map(stem))];
  const head = headTerm(rest);
  const searchIntent = terms.some((t) => SEARCH_INTENT_WORDS.has(t));
  // A list verb with a plural object ("find creators") asks for a search / list endpoint.
  // ... and so does a plural object with a topic ("creators about cooking", "posts about the election").
  const topical = rest.some((t, i) => TOPIC_PREPS.has(t) && rest.slice(0, i).some(isPluralNoun));
  const listVerb = (rest.some((t) => LIST_VERBS.has(stem(t))) && rest.some(isPluralNoun)) || topical;
  const listCue = rest.includes("list") || listVerb ? LIST_WORD_BOOST : wantsList(rest) ? LIST_BOOST : 1;
  const inner = innerNoun(rest);
  // A detail cue pulls the other way; with both, they cancel.
  const listBoost = wantsDetail(rest) ? (listCue > 1 ? 1 : 1 / LIST_BOOST) : listCue;
  const headWords = new Set(head ? [head, ...(SYNONYMS[head] ?? [])] : []);
  // "500 post URLs", "hundreds of handles": a count of inputs asks for a batch.
  const counted = rest.some((t) => QUANTITY_WORDS.has(t) || (/^\d+$/.test(t) && Number(t) >= 2));
  const countedInputs = counted && rest.some((t) => BATCH_INPUTS.has(t));
  const wantsBatch = countedInputs || rest.some((t) => BATCH_WORDS.has(t));
  // Two or more platforms named: a cross-platform composite answers for all of them, so it competes with them.
  // So does "on every platform", "across platforms", "everywhere".
  const allPlatforms =
    rest.includes("everywhere") ||
    rest.some((t, i) => t === "platforms" || (stem(t) === "platform" && i > 0 && ALL_WORDS.has(rest[i - 1])));
  const multiPlatform = platforms.size >= 2 || allPlatforms;
  const crossFactor = Math.max(platforms.size, allPlatforms ? 2 : 1);
  // What the query asks to do, by verb class ("watch ... and alert me" → monitor).
  const queryVerbs = new Set(rest.map((t) => VERB_CLASSES[stem(t)]).filter((c): c is string => c !== undefined));
  // Term → weight: the query's own terms (head boosted), then synonyms not already present.
  const weights = new Map<string, number>();
  // A clause after the object ("creators with over 100k followers", "creators who post about cooking")
  // filters it: words only found there weigh less than the object.
  const modAt = rest.findIndex((t, i) => MODIFIER_MARKERS.has(t) && rest.slice(0, i).some(isContentNoun));
  const objectTerms = new Set((modAt === -1 ? rest : rest.slice(0, modAt)).filter((t) => !STOPWORDS.has(t)).map(stem));
  for (const t of terms) {
    const w = t === head && terms.length > 1 ? HEAD_BOOST : 1;
    weights.set(t, modAt !== -1 && !objectTerms.has(t) ? w * MODIFIER_WEIGHT : w);
  }
  for (const t of terms) {
    for (const syn of SYNONYMS[t] ?? []) if (!weights.has(syn)) weights.set(syn, SYNONYM_WEIGHT);
  }
  // "every day", "weekly", "on a schedule", or a watching verb ("watch ... and alert me"): a recurring run,
  // what the registry calls a cadence or a monitor.
  const isRecurring = recurring(rest);
  if (isRecurring || queryVerbs.has("monitor")) for (const t of RECURRENCE_TERMS) weights.set(t, Math.max(weights.get(t) ?? 0, 1));
  // "my / our <accounts>": a set the user supplies, what the registry calls a panel.
  const isOwned = owned(rest);
  if (isOwned) for (const t of OWNED_TERMS) weights.set(t, Math.max(weights.get(t) ?? 0, 1));
  // An explicit cadence or a set of the user's own names the stateful family whose words those cues are.
  const cueTerms = [...(isRecurring ? RECURRENCE_TERMS : []), ...(isOwned ? OWNED_TERMS : [])];
  // "about <topic>" is what the registry calls a topic or keyword search.
  if (topical) for (const t of TOPIC_TERMS) if (!weights.has(t)) weights.set(t, SYNONYM_WEIGHT);
  // "who liked / retweeted / follows": the people who did it are the agent noun.
  if (rest.includes("who") && !rest.slice(0, rest.indexOf("who")).some(isContentNoun)) {
    for (const t of terms) {
      const agent = t.endsWith("e") ? `${t}r` : `${t}er`;
      if (!VERBS.has(t)) weights.set(agent, Math.max(weights.get(agent) ?? 0, 1));
    }
  }
  // A resource named only by a qualifying clause's words is not the object.
  const coverTerms = modAt === -1 ? rawTerms : rawTerms.filter((t) => objectTerms.has(stem(t)));
  const n = index.docs.length;
  const idf = (t: string): number => {
    const d = index.df.get(t) ?? 0;
    return Math.log(1 + (n - d + 0.5) / (d + 0.5));
  };
  const fieldWeight = (field: Field, t: string): number =>
    FIELD_WEIGHTS[field] * (VERBS.has(t) && field !== "id" && field !== "path" && field !== "id_exact" ? VERB_DAMPEN : 1);
  const exactKey = query.trim().toLowerCase().replace(/^\/?v1\//, "").replace(/^\/+|\/+$/g, "");
  const exactAt = index.byId.get(exactKey);

  const hits: RankHit[] = [];
  index.docs.forEach((doc, i) => {
    if (opts.platform && doc.platform !== opts.platform) return;
    let score = 0;
    if (terms.length === 0) {
      if (platforms.has(doc.platform)) score = 1;
    } else {
      const f = index.fields[i];
      for (const field of FIELDS) {
        const st = f[field];
        if (st.len === 0) continue;
        if (field === "id_exact") {
          for (const t of rawTerms) {
            const tf = st.tf.get(t);
            if (tf) score += fieldWeight(field, stem(t)) * (weights.get(stem(t)) ?? 1) * idf(stem(t)) * bm25(tf, st.len, index.avgLen[field]);
          }
          continue;
        }
        for (const [t, w] of weights) {
          const tf = st.tf.get(t);
          if (tf) score += fieldWeight(field, t) * w * idf(t) * bm25(tf, st.len, index.avgLen[field]);
        }
      }
      if (score > 0) {
        const res = index.resourceTokens[i];
        score *= 1 + COVERAGE_BOOST * resourceCoverage(res, coverTerms);
        const isSearch = res.some((t) => stem(t) === "search");
        // The container is named in the path, or in what the endpoint says it returns or is used for
        // ("comments on one TikTok video" holds a video's comments though its path says `post`).
        const holdsInner =
          inner !== undefined &&
          doc.list === true &&
          (res.some((t) => stem(t) === inner) || f.returns.tf.has(inner) || f.intent.tf.has(inner));
        if (
          res.length > 0 &&
          headWords.has(stem(res[res.length - 1])) &&
          (!(searchIntent || listVerb) || isSearch) &&
          (inner === undefined || holdsInner)
        ) {
          score *= LEAF_HEAD_BOOST;
        }
        if (searchIntent && isSearch) score *= SEARCH_INTENT_BOOST;
        if (listVerb && isSearch) score *= LIST_VERB_SEARCH_BOOST;
        if (holdsInner) score *= INNER_BOOST;
        const verb = index.intentVerbs[i];
        if (verb !== undefined && queryVerbs.has(verb)) score *= INTENT_VERB_BOOST;
        // A stateful family is an area, not one call: neither a list nor a single object.
        if (doc.anyPlatform !== true) score = doc.list ? score * listBoost : score / listBoost;
        if (doc.batch) score *= wantsBatch ? BATCH_BOOST : BATCH_DAMPEN;
        // A counted list of inputs ("300 post URLs") is more than a one-input endpoint takes per call.
        else if (countedInputs) score /= BATCH_BOOST;
        // A cross-platform composite answers for every platform named; one platform's endpoint for one of them.
        if (multiPlatform && doc.cross === true) score *= crossFactor;
      }
    }
    if (i === exactAt) score += EXACT_ID_SCORE;
    if (score > 0)
      hits.push({
        id: doc.id,
        method: doc.method,
        platform: doc.platform,
        score,
        index: i,
        named:
          platforms.has(doc.platform) ||
          (multiPlatform && doc.cross === true) ||
          (doc.anyPlatform === true && (platforms.size > 0 || cueTerms.some((t) => FIELDS.some((f) => index.fields[i][f].tf.has(t))))),
      });
  });
  // A named platform none of whose endpoints matched the words: list it anyway, after its scored hits.
  for (const slug of platforms) {
    if (hits.some((h) => h.platform === slug)) continue;
    index.docs.forEach((doc, i) => {
      if (doc.platform === slug && (!opts.platform || opts.platform === slug)) {
        hits.push({ id: doc.id, method: doc.method, platform: doc.platform, score: Number.MIN_VALUE, index: i, named: true });
      }
    });
  }
  // An exact id always leads; then a named platform's documents (precedence); then score; then corpus order.
  hits.sort(
    (a, b) =>
      Number(b.index === exactAt) - Number(a.index === exactAt) ||
      Number(b.named) - Number(a.named) ||
      b.score - a.score ||
      a.index - b.index,
  );
  return opts.limit !== undefined ? hits.slice(0, opts.limit) : hits;
}

/** Edit distance (insert, delete, substitute; all cost 1). */
function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Nearest candidates for a mistyped value, best first: equal once lowercased
 * and stripped to letters and digits, then a prefix either way (3+ chars),
 * then edit distance within max(2, length/3).
 */
export function didYouMean(input: string, candidates: readonly string[], max = 3): string[] {
  const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const q = norm(input);
  if (!q) return [];
  const scored: { c: string; d: number; i: number }[] = [];
  candidates.forEach((c, i) => {
    const n = norm(c);
    let d: number;
    if (n === q) d = 0;
    else if (q.length >= 3 && (n.startsWith(q) || q.startsWith(n))) d = 0.5;
    else {
      d = levenshtein(q, n);
      if (d > Math.max(2, Math.floor(q.length / 3))) return;
    }
    scored.push({ c, d, i });
  });
  scored.sort((a, b) => a.d - b.d || a.i - b.i);
  return scored.slice(0, max).map((s) => s.c);
}
