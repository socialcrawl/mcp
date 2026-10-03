import { createHash } from "node:crypto";
import { ENDPOINTS } from "../data/endpoints.js";
import { PLATFORMS } from "../data/platforms.js";
import { findBanned } from "./supplier-tokens.js";

/**
 * Generator-side CHECK for the bundled sample responses (`generate-data.ts`,
 * T28). The codebase redactor (the corpus) is the only redactor: this module
 * never rewrites a personal value. `prepareSample` only shapes a sample (row
 * cap, string cap, no `meta`, no receipts, neutral source errors, supplier
 * samples dropped). `findSampleIssues` is an independent check that must come
 * back empty for everything that ships; when it does not, `generate:data`
 * fails with the sample, the path and the rule (never the value).
 *
 * What is private is decided from the registry, not from words in a name:
 * an endpoint whose rows are people (AuthorList, Audience) or user content
 * (comments, reviews, engagement threads) is default-deny: nothing may be
 * there but numbers, dates, placeholders and a few closed formats. Elsewhere
 * the checks are targeted: identity keys on person rows, profile handles in
 * URLs, source names, emails, phones, IP addresses, LinkedIn identifiers. The
 * queried subject (from the endpoint's own example params) and public
 * accounts (100k followers or an organisation page, as in the codebase
 * redactor) may keep their identity.
 */

export const MAX_SAMPLE_ROWS = 2;
export const MAX_SAMPLE_STRING = 600;
export const NEUTRAL_ERROR = "source unavailable";

const PLACEHOLDER_EMAIL = "redacted@example.com";
const PLACEHOLDER_PHONE = "+1-555-0100";
export const TEXT_PLACEHOLDER = "Sample comment text (redacted).";
const URL_PLACEHOLDER = "https://example.com/redacted";
const PLACEHOLDER_IPV4 = "192.0.2.1";
const PLACEHOLDER_IPV6 = "2001:db8::1";

// ── what an endpoint's rows are, from the registry ───────────────────────

type Kind = "ugc" | "people" | "public" | "none";

/** Public-office datasets: names in them are public by definition. */
const PUBLIC_DATASETS = ["us_congress_trades/"];
/** An AuthorList whose rows are organisations, per the registry's own description, is not people. */
const ORGANISATION_ROWS = /compan|advertiser|subreddit|school|organi[sz]ation|brand|stores?\b/i;

const endpointFor = (key: string): (typeof ENDPOINTS)[number] | undefined => ENDPOINTS.find((e) => `${e.platform}/${e.resource}` === key);

/** An endpoint the registry does not know: only its path words can say what its rows are. */
function kindFromWords(key: string): Kind {
  const words = key.split("/").flatMap(tokens);
  if (words.some((w) => /^(comment|review|repl(y|ies)|answer|question)s?$/.test(w))) return "ugc";
  if (words.some((w) => /^(follower|following|liker|member|people|profile|user|friend|subscriber)s?$/.test(w)) && words.some((w) => /^(search|list|similar|followers?|following|likers?|members?)$/.test(w))) return "people";
  return "none";
}

/** `ugc`: comments, reviews and threads. `people`: lists of accounts. `public`: public-office data. Else `none`. */
export function endpointKind(key: string): Kind {
  if (PUBLIC_DATASETS.some((p) => key.startsWith(p))) return "public";
  const e = endpointFor(key);
  if (!e) return kindFromWords(key);
  const family = e.taxonomy?.job_family;
  if (["CommentList", "Comment", "ReviewList"].includes(e.archetype) || family === "engagement_thread" || family === "reviews_and_ratings") return "ugc";
  if (["AuthorList", "Audience"].includes(e.archetype)) {
    return e.archetype === "AuthorList" && ORGANISATION_ROWS.test(`${e.purpose?.summary ?? ""} ${e.purpose?.returns ?? ""}`) ? "none" : "people";
  }
  return "none";
}

/** Ads, commerce, jobs and finance rows are organisations and listings: an `author` there is a page or a seller, not a private person. */
function organisationRows(key: string): boolean {
  const family = endpointFor(key)?.taxonomy?.job_family;
  return ["ads_intelligence", "commerce_catalog", "jobs_and_hiring", "finance_and_markets"].includes(family ?? "");
}

/** True when the whole response body is default-deny. */
export const isUgcEndpoint = (key: string): boolean => ["ugc", "people"].includes(endpointKind(key));

// ── words, keys and shapes ───────────────────────────────────────────────

/** Lowercase word tokens of a key or path segment: snake, kebab and camelCase (`IPAddress` -> ip, address). */
function tokens(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A path word that suggests user content; it only matters when the rows ALSO carry an identity key, or are bare strings. */
const UGC_TOKEN =
  /^(comment|commenter|repl(?:y|ies|ied)|review|reviewer|answer|answerer|question|follower|following|liker|like|liked|reaction|voter|fan|viewer|member|people|user|author|audience|participant|attendee|tagged|mention|chat|stargazer|contributor|similar|friend|subscriber|receipt)s?$/;
const segmentIsUgc = (seg: string): boolean => !/^\d+$/.test(seg) && tokens(seg).some((w) => UGC_TOKEN.test(w));

/** Keys whose value identifies a person or a machine: replaced on every endpoint, any depth. */
const DENY_KEY =
  /(^|_)(nick(name)?|nicknm|user_?name|screen_?name|handle|first_?name|last_?name|display_?name|full_?name|ip(_?address)?|email|phone|unique_?id|sec_?uid|login|blogger_?(name|link)|author_?handle)($|_)/;
/** A company's, page's or listing's username or name is not a person. */
const ORG_WORD = /^(company|brand|page|app|store|product|place|business|org|organi[sz]ation|merchant|shop|publisher|developer|advertiser|site|community|group|cafe|club|team)$/;
const orgKey = (key: string): boolean => tokens(key).some((w) => ORG_WORD.test(w));
const denyKind = (key: string): "ip" | "email" | "phone" | "identity" | null => {
  const m = DENY_KEY.exec(tokens(key).join("_"));
  if (!m) return null;
  if (orgKey(key) && !/^(ip|email|phone|handle|nick|nickname|nicknm)/.test(m[2]!)) return null;
  return /^ip/.test(m[2]!) ? "ip" : m[2] === "email" ? "email" : m[2] === "phone" ? "phone" : "identity";
};
/** Identity keys of a person row that the deny list does not cover on every endpoint. */
const PERSON_ROW_KEY = /^(name|title|account_?name|profile_?name|owner_?name|channel_?title|writer|byline|bio|headline)$/i;
const AUTHOR_CHILD = /^(author|user|owner|profile|creator|account|channel|commenter|reviewer|poster|from)$/i;

/** Keys that make a row a person on their own: a display or full name alone is also a label on categories, products and places. */
const STRONG_KEY = /(^|_)(nick(name)?|nicknm|user_?name|screen_?name|handle|first_?name|last_?name|unique_?id|sec_?uid|login|blogger_?(name|link)|author_?handle)($|_)/;
const strongIdentity = (k: string): boolean => STRONG_KEY.test(tokens(k).join("_")) && !orgKey(k);
const ownIdentity = (o: Record<string, unknown>): boolean => Object.keys(o).some(strongIdentity);
const ownAnyIdentity = (o: Record<string, unknown>): boolean => Object.keys(o).some((k) => denyKind(k) === "identity");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** The object carries an identity key, directly or one author-like object down. */
const identityBearing = (o: Record<string, unknown>): boolean =>
  ownIdentity(o) || Object.entries(o).some(([k, v]) => AUTHOR_CHILD.test(k) && isObj(v) && (ownAnyIdentity(v) || Object.keys(v).some((c) => /^(name|title)$/i.test(c))));
/** A list named comments, replies, reviews, answers or questions whose rows carry text: what people wrote, whatever the endpoint. */
const WRITTEN_WORD = /^(comment|repl(?:y|ies)|review)s?$/;
const WRITTEN_ROW_KEY = /^(text|body|content|message|comment|review|answer|extract)$/i;
const writtenRows = (arr: unknown[], path: string[]): boolean =>
  tokens(holder(path)).some((w) => WRITTEN_WORD.test(w)) && arr.some((el) => isObj(el) && Object.keys(el).some((k) => WRITTEN_ROW_KEY.test(k)));

/** Names the pipeline gives to arrays that quote what people wrote. */
const QUOTED_SEGMENT = /^(label_share|receipts|examples|quotes)$/i;
const rowsLookIdentity = (arr: unknown[]): boolean => arr.some((el) => isObj(el) && identityBearing(el));

// ── closed formats ───────────────────────────────────────────────────────

/** A date or timestamp in any ISO-like form (a space before the offset included). */
/** A date as a pipeline writes it: ISO, or `Fri Oct 02 03:44:38 +0000 2026`. */
const RFC_DATE = /^[A-Z][a-z]{2},? [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2}/;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?: ?(?:Z|[+-]\d{2}:?\d{2}))?)?$/;
const enumOf = (...v: string[]): RegExp => new RegExp(`^(${v.join("|")})$`);
/** Numeric ids, or opaque ones: mixed case with digits, or hex, long enough not to be a handle. */
const OPAQUE_ID_FORM = /^(?=.*\d)[A-Za-z0-9_=.-]{4,120}$/;
/** Looks like a name with digits (`janedoe1234`, `jane.doe92`): a handle, not an opaque id. */
const HANDLE_FORM = /^(?=.{8,}$)[A-Za-z]{3,}[._]?\d{2,}$|^[A-Za-z]+(?:[._][A-Za-z]+)+\d*$/;
/** Facebook profile ids start 1000 and run 15 digits; a comment id does not. */
const PROFILE_ID = /^1000\d{11}$/;
const OPAQUE_ID = { test: (s: string): boolean => OPAQUE_ID_FORM.test(s) && !HANDLE_FORM.test(s) && !PROFILE_ID.test(s) };
/** An id that is a handle with a number appended (`jane.doe92_123456`). */
/** A receipt id is the id of the comment it quotes: no spaces, no sentence. */
const RECEIPT_ID = /^[A-Za-z0-9_=.-]{4,120}$/;
const HANDLE_ID = /^(?:[A-Za-z]{3,}[._][A-Za-z]{2,}\d*|[A-Za-z]{4,}\d{1,4})_\d{3,}$/;
const CURSOR = /^[\s\S]{1,4000}$/;
const VERSION = /^[A-Za-z0-9_./-]{1,30}$/;
const TOKEN_LOOSE = /^[A-Za-z][A-Za-z0-9_-]{1,40}$/;
const PLATFORM_SLUGS = new Set(PLATFORMS.map((p) => p.slug));
const LANG = /^(und|[A-Za-z]{2,3}([-_][A-Za-z]{2,4})?)$/;
/** A reference to a thing: a number, a package name, a URL, an opaque code; not a bare word or a name with digits. */
const ID_ANY = { test: (s: string): boolean => /^[A-Za-z0-9_.:/=?&%#-]{1,300}$/.test(s) && !PROFILE_ID.test(s) && !/^(?=.{8,}$)[A-Za-z]{3,}\d{2,}$/.test(s) && (/\d/.test(s) || /[./:]/.test(s) || /^[a-z]{5,10}$/.test(s)) };
const REGION_NAMES = (() => {
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  const out = new Set<string>();
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) { const c = String.fromCharCode(a, b); const n = dn.of(c); if (n && n !== c) { out.add(n); out.add(n.replace(/ & /g, " and ")); } }
  for (const alias of ["Turkey", "Ivory Coast", "Democratic Republic of the Congo", "Congo", "Republic of the Congo", "Russia", "Vietnam", "Czech Republic", "Macedonia", "Swaziland", "Burma", "Hong Kong", "Macau", "Palestine", "Kosovo", "South Korea", "North Korea", "Laos", "Syria", "Iran", "Bolivia", "Venezuela", "Tanzania", "Moldova", "Brunei", "Cape Verde", "East Timor", "Vatican City"]) out.add(alias);
  return out;
})();
const COUNTRY = { test: (s: string): boolean => /^[A-Z]{2}$/.test(s) || REGION_NAMES.has(s) };
/** The only text strings kept in default-deny subtrees, each with the closed format it must have. */
const SAFE_KEYS: Record<string, { test: (s: string) => boolean }> = {
  type: TOKEN_LOOSE, position: TOKEN_LOOSE, methodology_version: VERSION, policy_version: VERSION, version: VERSION, next_cursor: CURSOR, cursor: CURSOR, page_token: CURSOR,
  media_type: enumOf("image", "video", "photo", "carousel", "audio", "text", "gif", "link", "none"),
  language: LANG, lang: LANG, original_language: LANG,
  sentiment: enumOf("positive", "negative", "neutral", "mixed"),
  label: enumOf("question", "complaint", "purchase_intent", "positive", "negative", "neutral", "injection", "spam", "toxic", "none", "other", "safe", "unknown"),
  status: enumOf("ok", "active", "inactive", "failed", "success", "pending", "deleted", "hidden", "published", "approved", "rejected", "open", "closed", "completed", "complete", "done", "running", "queued", "processing", "error", "partial", "none", "available", "unavailable"),
  platform: /^[a-z0-9_]{2,24}$/, country: COUNTRY, currency: /^[A-Z]{3}$/,
  id: ID_ANY, entity_id: ID_ANY, post_id: ID_ANY, parent_id: ID_ANY, comment_id: ID_ANY, video_id: ID_ANY, review_id: ID_ANY,
};
const IDENTITY_ANCESTOR = /^(author|authors|user|users|owner|profile|creator|commenter|commenters|member|members|reviewer|from|poster|account|channel)$/i;

/** Keys that hold what a person wrote, whatever the row: the check is on the key, not on a guess about the value. */
const TEXT_WORD = /^(text|body|content|extract|excerpt|snippet|summary|details?|description|caption|message|comment|quote|answer|bio|about|headline|title|review|tagline|signature)$/;
/** `post_title`, `product_description`: a thing's own title or description is not what a person wrote. */
const THING_PREFIX = /^(post|product|video|page|article|story|item|app|company|job|place|store|thread|issue|channel|playlist|show|episode|album|track|song|ad)$/;
const isTextKey = (leaf: string): boolean => {
  const w = tokens(leaf);
  if (w.some((x) => /^(language|locale|lang|type|id|ids|url|count|status|source|label|kind)$/.test(x))) return false;
  if (w.length > 1 && THING_PREFIX.test(w[0]!)) return false;
  return w.some((x) => TEXT_WORD.test(x));
};
/** The text sits on the thing that was reviewed or discussed (an app, a product, a video), not in what a person wrote about it. */
const THING_SEGMENT = /^(apps?|products?|posts?|videos?|stories|story|pages?|places?|business|thread|threads|items_by_source|entity_resolution)$/i;
function describesAThing(path: string[]): boolean {
  const thing = path.findIndex((p) => THING_SEGMENT.test(p));
  if (thing < 0) return false;
  let ugc = -1;
  path.forEach((p, i) => segmentIsUgc(p) && (ugc = i));
  return thing > ugc;
}

/** Keys that hold who a person is, on a person row. */
const IDENTITY_KEY =
  /(^|_)(name|nick(name)?|nicknm|handle|login|alias|slug|uid|unique_?id|sec_?uid|username|display_?name|full_?name|first_?name|last_?name|creator|poster|seller|host|customer|buyer|sender|writer|byline|blogger_?(name|link)|account_?name|profile_?name|owner_?name|channel_?title|author_?handle|author_?name)($|_)/;
/** A date key holds a date. */
const DATE_KEY = /(^|_)(date|time|timestamp)$|_at$/;
const isDateValue = (s: string): boolean => ISO_LIKE.test(s) || RFC_DATE.test(s) || /^\d{9,13}$/.test(s);
const isIdentityKey = (leaf: string): boolean => IDENTITY_KEY.test(tokens(leaf).join("_"));

/** Placeholder forms: the corpus pseudonym, an identity placeholder word, the exact placeholder URLs, placeholder text. */
const USER_PSEUDONYM = /^user_[0-9a-f]{6}$/;
const IDENT_WORDS = /^(redacted|sample|example|placeholder)([ _-](user|name|author|handle|account|profile|\d+))?$/i;
const TEXT_PLACEHOLDER_RE = /^(Sample comment text \(redacted\)\.\s?)+$/;
const URL_PLACEHOLDER_RE = /^https:\/\/example\.com\/(?:redacted|avatars\/user_[0-9a-f]{6}\.png|user_[0-9a-f]{6})$/;
/** The documented placeholder handle of the handle-audit example, exactly. */
const CREATOR_PLACEHOLDER = /^creator(?:-\d+)?$/;
let gateKey = "";
const isIdentPlaceholder = (s: string): boolean => USER_PSEUDONYM.test(s) || IDENT_WORDS.test(s) || (gateKey === "prism/handle-audit" && CREATOR_PLACEHOLDER.test(s));
const isPlaceholder = (s: string): boolean =>
  isIdentPlaceholder(s) || s === PLACEHOLDER_EMAIL || s === PLACEHOLDER_PHONE || s === PLACEHOLDER_IPV4 || s === PLACEHOLDER_IPV6 || TEXT_PLACEHOLDER_RE.test(s) || URL_PLACEHOLDER_RE.test(s);

/** A string that is nothing but a URL. */
const URL_ONLY = /^https?:\/\/\S+$/i;

const pseudonym = (value: string): string => `user_${createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 6)}`;
/** The last non-numeric path segment: the key that holds the value (or the array of values). */
const holder = (path: string[]): string => [...path].reverse().find((s) => !/^\d+$/.test(s)) ?? "";

// ── profile handles in URLs, every platform ──────────────────────────────

const NOT_HANDLE = {
  instagram: "p|reel|reels|tv|explore|stories|accounts|directory|about|web",
  x: "i|home|search|hashtag|intent|share|explore|notifications|settings|messages|login|tos|privacy|compose",
  facebook: "ads|business|l\\.php|sharer|dialog|plugins|groups|watch|photo|photos|reel|reels|events|marketplace|share|permalink|story\\.php|profile\\.php|pages|gaming|hashtag|policies|help|login",
};
/** Each pattern: group 1 = the prefix kept, group 2 = the handle. */
const HANDLE_URLS: RegExp[] = [
  new RegExp(`(\\b(?:www\\.|m\\.)?instagram\\.com/)(?!(?:${NOT_HANDLE.instagram})\\b)([A-Za-z0-9_.]{2,})`, "gi"),
  /(\btiktok\.com\/@)([A-Za-z0-9_.-]{2,})/gi,
  new RegExp(`(\\b(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/)(?!(?:${NOT_HANDLE.x})\\b)([A-Za-z0-9_]{2,})`, "gi"),
  /(\byoutube\.com\/(?:@|c\/|user\/))([A-Za-z0-9_.-]{2,})/gi,
  /(\bthreads\.(?:net|com)\/@)([A-Za-z0-9_.]{2,})/gi,
  new RegExp(`(\\b(?:www\\.|m\\.)?facebook\\.com/)(?!(?:${NOT_HANDLE.facebook})\\b)([A-Za-z0-9_.]{2,})`, "gi"),
  /(\b(?:m\.)?(?:blog|in)\.naver\.com\/)([A-Za-z0-9_]{2,})/gi,
  /([?&](?:blogId|memberId|userId)=)([A-Za-z0-9_]{2,})/gi,
  /(\breddit\.com\/(?:u|user)\/)([A-Za-z0-9_-]{2,})/gi,
  /(\btruthsocial\.com\/@)([A-Za-z0-9_.]{2,})/gi,
];

/** Handles of the queried subject, from the endpoint's own example params. */
const SUBJECT_PARAM = /(handle|username|user|url|id|slug)s?$/i;
const subjectCache = new Map<string, Set<string>>();

/** Exact identity values of a queried subject the examples do not carry in a param (LinkedIn profiles). */
const SUBJECT_IDENTITIES: Record<string, string[]> = {
  "linkedin/profile": ["williamhgates"],
  "linkedin/profile/all": ["williamhgates"],
  "linkedin/profile/contact": ["williamhgates"],
  "linkedin/profile/posts/archive": ["williamhgates"],
  "linkedin/post": ["williamhgates"],
  "linkedin/post/with-comments": ["williamhgates"],
  "linkedin/profile/complete": ["ryanroslansky"],
  "linkedin/profile/with-posts": ["adamselipsky"],
};

function subjectsFor(key: string): Set<string> {
  const hit = subjectCache.get(key);
  if (hit) return hit;
  const out = new Set<string>(SUBJECT_IDENTITIES[key] ?? []);
  const e = endpointFor(key);
  for (const p of [...(e?.params ?? []), ...(e?.optionalParams ?? [])]) {
    if (!SUBJECT_PARAM.test(p.name)) continue;
    for (const raw of String(p.example ?? "").split(",")) {
      const v = raw.trim().replace(/^@/, "");
      if (v.length < 3 || /^\d+$/.test(v)) continue;
      out.add(v.toLowerCase());
      for (const seg of v.split(/[/?#&=]/)) if (seg.length >= 3 && !/^\d+$/.test(seg) && !/^https?:?$/i.test(seg)) out.add(seg.replace(/^@/, "").toLowerCase());
    }
  }
  subjectCache.set(key, out);
  return out;
}

const isSubjectValue = (key: string, v: string): boolean => subjectsFor(key).has(v.trim().replace(/^@/, "").toLowerCase());
const handleOk = (key: string, handle: string): boolean => isIdentPlaceholder(handle) || isSubjectValue(key, handle);

/** Replace every profile handle in a URL or id (all platforms) that is not the subject or a placeholder. */
function rewriteHandles(key: string, s: string): string {
  let out = s;
  for (const re of HANDLE_URLS) out = out.replace(re, (m, pre: string, h: string) => (handleOk(key, h) ? m : `${pre}${pseudonym(h)}`));
  return out;
}

function foreignHandles(key: string, s: string): string[] {
  const bad: string[] = [];
  for (const re of HANDLE_URLS) for (const m of s.matchAll(re)) if (!handleOk(key, m[2]!)) bad.push(m[2]!);
  return bad;
}

/** Hosts a URL may keep in a default-deny subtree (after its handles are rewritten). */
const KNOWN_HOST = /^https?:\/\/(?:www\.|m\.|mobile\.)?(?:instagram\.com|tiktok\.com|(?:x|twitter)\.com|youtube\.com|youtu\.be|threads\.(?:net|com)|facebook\.com|(?:blog|cafe|in)\.naver\.com|reddit\.com|truthsocial\.com|linkedin\.com)\//i;

// ── public accounts and subject rows ─────────────────────────────────────

const AUDIENCE_KEY = /^(followers?(_?count)?|follower_?count|subscribers?(_?count)?)$/i;
const ORG_FLAG_KEY = /^is_(business|brand|organi[sz]ation|company)(_account)?$/i;
const PUBLIC_AUDIENCE = 100_000;

/** Public status comes only from structured fields: a numeric audience of 100k or more, or a brand/business flag. Never from free text. */
function publicOwn(o: Record<string, unknown>): boolean {
  return Object.entries(o).some(
    ([k, v]) =>
      (AUDIENCE_KEY.test(k) && typeof v === "number" && v >= PUBLIC_AUDIENCE) ||
      (ORG_FLAG_KEY.test(k) && v === true),
  );
}
const isPublicObj = (o: Record<string, unknown>): boolean => publicOwn(o) || Object.entries(o).some(([k, v]) => AUTHOR_CHILD.test(k) && isObj(v) && publicOwn(v));

const SUBJECT_LEAF = /^(username|user_?name|handle|screen_?name|unique_?id|login|public_?identifier|display_?name|full_?name|name)$/i;
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** The object is the queried subject's own row: one of its identity leaves holds the subject. */
function isSubjectObj(key: string, o: Record<string, unknown>): boolean {
  const own = (x: Record<string, unknown>): boolean => Object.entries(x).some(([k, v]) => SUBJECT_LEAF.test(k) && typeof v === "string" && (isSubjectValue(key, v) || [...subjectsFor(key)].some((s) => squash(s) === squash(v) && squash(v).length >= 4)));
  return own(o) || Object.entries(o).some(([k, v]) => AUTHOR_CHILD.test(k) && isObj(v) && own(v));
}

// ── outside default-deny ─────────────────────────────────────────────────

/** Keys whose strings are error or warning text. */
const MESSAGE_KEYS = new Set(["error", "errors", "message", "warning", "warnings", "_warnings", "reason", "detail"]);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PHONE = /\+\d[\d\s().-]{7,}\d|\(\d{2,4}\)\s?\d{3,4}[-.\s·•]\d{3,4}|\b\d{2,4}[-.\s·•]\d{3,4}[-.\s·•]\d{4}\b/g;
/** A bare ten-digit US number; only looked for in free text, where epoch timestamps and ids do not live. */
const BARE_PHONE = /(?<![\d.])[2-9]\d{2}[2-9]\d{6}(?!\d)/g;
const OBFUSCATED_EMAIL = /\b[\w.+-]+\s*(?:\(at\)|\[at\]|\bat\b)\s*[\w-]+\s*(?:\(dot\)|\[dot\]|\bdot\b)\s*[a-z]{2,}\b/gi;
/** A base64 string that decodes to an email address. */
function base64Email(s: string): boolean {
  if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(s)) return false;
  const text = Buffer.from(s, "base64").toString("utf8");
  return (text.match(EMAIL) ?? []).some((m) => !allowedEmail(m));
}
const SOURCE_TOKEN = /provider-|(^|[^a-z])gnews/i;
const UPSTREAM_WORDING = /\bupstream\b/i;
const TEXT_LEAF = /^(text|text_original|textDisplay|textOriginal|body|content|review_text|title|snippet|caption|message|comment|comment_text|description)$/;
const AT_HANDLE = /(^|[^A-Za-z0-9_.])@([A-Za-z0-9_.-]{2,})/g;
/** LinkedIn slugs (/in/ and /pub/) and the identifiers outside a profile URL. */
const LINKEDIN_SLUG = /linkedin\.com\/(?:in|pub)\/([^/?#\s"']+)/gi;
const LINKEDIN_URN = /ACoAA[\w-]{6,}/g;
const LINKEDIN_MEMBER = /urn:li:(?:member|person):(?!redacted)[\w-]+/g;
const SUBJECT_SLUGS = new Set(["williamhgates", "ryanroslansky", "adamselipsky"]);
const SUBJECT_URNS = new Set([
  "ACoAAA8BYqEBCGLg_vT_ca6mMEqkpp9nVffJ3hc",
  "ACoAAAAKXBwBikfbNJww68eYvcu2dqDYJhHbp4g",
  "ACoAAAC0y5YB1d3L356Yaf3g3Tb5PR4O7scFb5o",
]);

const IPV4 = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])/g;
const IPV6 = /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){1,7}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4})(?![\w:])/gi;
const docIp = (ip: string): boolean => /^(192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip) || /^2001:db8:/i.test(ip);
/** Versions and builds look like IPv4; they are not addresses. */
const versionLeaf = (leaf: string): boolean => /^(app_?|sdk_?|os_?|api_?|client_?)?(version|build|release)(_?(number|id|name|code))?$/i.test(leaf);

/** Business and support mailboxes that are public on purpose. */
function allowedEmail(email: string): boolean {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  if (/(^|\.)example\.(com|org|net)$/.test(domain)) return true;
  if (/^(support|help|info|contact|sales|press|hello|careers|privacy|legal|accommodations|no-?reply)$/.test(local)) return true;
  return /^inshot\.(android|ios)$/.test(local) && domain === "inshot.com";
}

function allowedPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return /^1?555\d?01\d\d$/.test(digits) || /^1?(800|833|844|855|866|877|888)\d{7}$/.test(digits);
}

/** Percent-decoded when it decodes, so an encoded profile URL is still seen. */
function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ── walking ──────────────────────────────────────────────────────────────

/**
 * The author, channel or owner of the item the request asked for (a post, a video,
 * a profile) is the subject's own: reached through objects only, never through a list
 * or a comment/reply/review subtree, and never on a comments or people endpoint.
 */
function ownerOfQueriedItem(path: string[], kind: Kind, orgRows: boolean): boolean {
  if (kind !== "none" && kind !== "public") return false;
  const last = path[path.length - 1] ?? "";
  if (!AUTHOR_CHILD.test(last) || orgRows) return false;
  // Not the author of a quoted, retweeted, shared or parent post: that is another person.
  return !path.slice(0, -1).some((p) => /^\d+$/.test(p) || segmentIsUgc(p) || /quot|retweet|repost|shared|original|parent|referenc|embed/i.test(p));
}

/** Where a string sits: default-deny (`strict`) or exempt (the subject's or a public account's own subtree). */
interface Ctx {
  strict: boolean;
  /** The row is a person (an account in a people list, an author object): identity keys, ids and avatar URLs are checked. */
  person: boolean;
  exempt: boolean;
}
type Visit = (value: string, path: string[], inMessage: boolean, ctx: Ctx) => string | void;

/** Walk every string leaf of the response; `visit` may return a replacement. */
function walkRoot(root: Record<string, unknown>, visit: Visit, key: string, kind: Kind): Record<string, unknown> {
  const publicOk = kind !== "ugc";
  const orgRows = organisationRows(key);
  const walk = (node: unknown, path: string[], inMessage: boolean, ctx: Ctx): unknown => {
    if (typeof node === "string") return visit(node, path, inMessage, ctx) ?? node;
    if (Array.isArray(node)) {
      const bare = node.length > 0 && node.every((v) => typeof v === "string") && segmentIsUgc(holder(path));
      const rows = rowsLookIdentity(node);
      const strict = ctx.strict || bare || rows || path.some((p) => QUOTED_SEGMENT.test(p)) || writtenRows(node, path);
      // An exemption covers the object it was earned by, never the people or user content listed under it.
      const personRows = rows || bare || writtenRows(node, path) || path.some((p) => QUOTED_SEGMENT.test(p)) || segmentIsUgc(holder(path)) || ((kind === "ugc" || kind === "people") && path.length <= 2);
      const exempt = kind === "public" ? ctx.exempt : ctx.exempt && !personRows;
      return node.map((v, i) => walk(v, [...path, String(i)], inMessage, { ...ctx, strict, exempt, person: ctx.person || (rows && !orgRows) }));
    }
    if (isObj(node)) {
      const exempt = ctx.exempt || (kind !== "public" && (isSubjectObj(key, node) || (publicOk && isPublicObj(node)) || ownerOfQueriedItem(path, kind, orgRows)));
      const ugcHere = segmentIsUgc(holder(path)) && identityBearing(node);
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [
          k,
          walk(v, [...path, k], inMessage || MESSAGE_KEYS.has(k), {
            strict: ctx.strict || (ugcHere && !exempt),
            exempt,
            person: ctx.person || (!orgRows && (AUTHOR_CHILD.test(k) || IDENTITY_ANCESTOR.test(k)) && isObj(v)),
          }),
        ]),
      );
    }
    return node;
  };
  return Object.fromEntries(
    Object.entries(root).map(([k, v]) => [
      k,
      walk(v, [k], MESSAGE_KEYS.has(k), { strict: (k === "data" || k === "meta") && (kind === "ugc" || kind === "people"), person: (k === "data" || k === "meta") && kind === "people", exempt: kind === "public" }),
    ]),
  );
}

function cap(s: string): string {
  return s.length > MAX_SAMPLE_STRING ? `${s.slice(0, MAX_SAMPLE_STRING)}…` : s;
}

/** Is this string safe to keep inside a default-deny subtree? */
function safeInStrict(key: string, path: string[], value: string): boolean {
  if (isPlaceholder(value) || ISO_LIKE.test(value)) return true;
  const leaf = path[path.length - 1] ?? "";
  if (URL_ONLY.test(value) && !SAFE_KEYS[leaf]) return KNOWN_HOST.test(value) && foreignHandles(key, value).length === 0;
  // Classifier output (labels, sense, issue) is the pipeline's vocabulary, not what a person wrote.
  if (path.some((p) => /^(computed|labels|label_share)$/.test(p)) && !TEXT_LEAF.test(leaf) && /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(value)) return true;
  const re = SAFE_KEYS[leaf];
  if (!re || !re.test(value)) return false;
  if (leaf === "platform") return PLATFORM_SLUGS.has(value);
  // An id of a person: under an author or user, or in a list of people.
  return !(/(^|_)id$/.test(leaf) && (endpointKind(key) === "people" || path.slice(0, -1).some((p) => IDENTITY_ANCESTOR.test(p))));
}

const endpointKey = (raw: Record<string, unknown>): string => (typeof raw.endpoint === "string" ? raw.endpoint.replace(/^\/v1\//, "") : "");

/** Remove every key called `name` from the whole tree. */
function dropKey(node: unknown, name: string): void {
  if (Array.isArray(node)) for (const v of node) dropKey(v, name);
  else if (isObj(node)) {
    delete node[name];
    for (const v of Object.values(node)) dropKey(v, name);
  }
}

/**
 * Shapes a sample, nothing more: two rows (`data.items[]` or a bare array),
 * long strings capped, `meta` and receipts removed, error and warning text that
 * names a source made neutral. `sample` is null when a supplier name sits
 * outside an error field (the sample is dropped). No personal value is ever
 * rewritten here; the gate checks them and the build fails on a hit.
 */
export function prepareSample(raw: Record<string, unknown>): { sample: Record<string, unknown> | null; notes: string[] } {
  const notes: string[] = [];
  const copy = structuredClone(raw) as Record<string, unknown>;
  delete copy.meta;
  dropKey(copy, "receipts");
  const data = copy.data as { items?: unknown[] } | unknown[] | undefined;
  if (Array.isArray(data)) copy.data = data.slice(0, MAX_SAMPLE_ROWS);
  else if (data && Array.isArray(data.items)) data.items = data.items.slice(0, MAX_SAMPLE_ROWS);

  let excluded = false;
  const out = walkRoot(
    copy,
    (value, _path, inMessage) => {
      const s = cap(value);
      if (inMessage && (findBanned(s) || SOURCE_TOKEN.test(s) || UPSTREAM_WORDING.test(s))) {
        notes.push("neutralised message");
        return NEUTRAL_ERROR;
      }
      if (findBanned(s) || SOURCE_TOKEN.test(s)) excluded = true;
      return s;
    },
    "",
    "none",
  ) as Record<string, unknown>;
  return { sample: excluded ? null : out, notes };
}

/**
 * Everything wrong with a sample, as short strings; empty means safe to ship.
 * `keyArg` is `platform/resource`; it defaults to the sample's own endpoint.
 */
export function findSampleIssues(json: string, keyArg = ""): string[] {
  const issues: string[] = [];
  const add = (s: string): void => void (issues.length < 8 && issues.push(s));
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const key = keyArg || endpointKey(parsed);
  gateKey = key;
  walkRoot(
    parsed,
    (raw, path, inMessage, ctx) => {
      const at = path.join(".");
      const s = decoded(raw);
      const leaf = path[path.length - 1] ?? "";
      const banned = findBanned(s);
      if (banned) add(`supplier name "${banned}" at ${at}`);
      if (SOURCE_TOKEN.test(s)) add(`source token at ${at}`);
      if (inMessage && UPSTREAM_WORDING.test(s)) add(`upstream wording in message at ${at}`);
      // A listing's own contact fields (a place, a developer) are public business info, as in the codebase redactor.
      const businessContact = /(^|_)(phone|email|website)($|_)/.test(tokens(holder(path)).join("_")) && !ctx.person && !ctx.strict;
      const isDate = ISO_LIKE.test(s) || RFC_DATE.test(s);
      if (!businessContact) {
        for (const m of s.match(EMAIL) ?? []) if (!allowedEmail(m)) add(`email at ${at}`);
        if (!isDate) for (const m of s.match(PHONE) ?? []) if (!allowedPhone(m)) add(`phone number at ${at}`);
      }
      if (TEXT_LEAF.test(leaf) && BARE_PHONE.test(s)) add(`phone number at ${at}`);
      BARE_PHONE.lastIndex = 0;
      if (OBFUSCATED_EMAIL.test(s)) add(`spelled-out email at ${at}`);
      OBFUSCATED_EMAIL.lastIndex = 0;
      if (base64Email(raw)) add(`base64 email at ${at}`);
      if (/(^|_)id$/.test(tokens(holder(path)).join("_")) && HANDLE_ID.test(raw)) add(`handle in an id at ${at}`);
      if (!versionLeaf(holder(path))) {
        for (const m of s.match(IPV4) ?? []) if (!docIp(m)) add(`IPv4 address at ${at}`);
        for (const m of s.match(IPV6) ?? []) if (!docIp(m)) add(`IPv6 address at ${at}`);
      }
      for (const m of s.match(LINKEDIN_URN) ?? []) if (!SUBJECT_URNS.has(m)) add(`LinkedIn URN at ${at}`);
      for (const m of s.match(LINKEDIN_MEMBER) ?? []) add(`LinkedIn member id at ${at}`);
      for (const m of s.matchAll(LINKEDIN_SLUG)) {
        const slug = m[1]!;
        if (!SUBJECT_SLUGS.has(slug.toLowerCase()) && !isIdentPlaceholder(slug) && !isSubjectValue(key, slug) && !ctx.exempt) add(`LinkedIn profile URL at ${at}`);
      }
      if (path.includes("receipts")) {
        const ok = leaf === "text" ? TEXT_PLACEHOLDER_RE.test(s) : leaf === "id" && (RECEIPT_ID.test(raw) || isPlaceholder(raw));
        if (!ok) add(`verbatim receipt content at ${at}`);
      }
      if (ctx.exempt) return;
      if (!organisationRows(key) && (ctx.strict || s.length <= 400)) for (const _h of foreignHandles(key, s)) add(`profile handle in a URL or id at ${at}`);
      const leafKey = holder(path);
      const kind = denyKind(leafKey);
      if (kind && !businessContact && (kind !== "identity" || ctx.person) && !isPlaceholder(raw)) {
        const ok = kind === "ip" ? docIp(raw) : kind === "email" ? allowedEmail(raw) : kind === "phone" ? allowedPhone(raw) : false;
        if (!ok) add(`${kind} value under key "${leafKey}" at ${at}`);
      }
      if (ctx.strict && !isPlaceholder(raw) && !ISO_LIKE.test(raw)) {
        const bareItem = /^\d+$/.test(leaf);
        const safeRe = SAFE_KEYS[leaf];
        if (bareItem && segmentIsUgc(leafKey) && !tokens(leafKey).some((w) => /^ids?$/.test(w))) add(`unredacted person string in a list at ${at}`);
        else if (safeRe && !(leaf === "label" && path.some((p) => /^(topics|themes|clusters|categories)$/.test(p))) && !safeInStrict(key, path, raw)) add(`value outside the closed format for "${leaf}" at ${at}`);
        else if (isTextKey(leafKey) && !/^[\d\s.,:-]*$/.test(raw) && !describesAThing(path)) add(`free text not redacted at ${at}`);
        else if (DATE_KEY.test(tokens(leafKey).join("_")) && !isDateValue(raw)) add(`value outside a date format for "${leafKey}" at ${at}`);
        else if ((AUTHOR_CHILD.test(leafKey) || isIdentityKey(leafKey) && /author/i.test(leafKey)) && !/^\d+$/.test(leaf)) add(`author not redacted at ${at}`);
        else if (ctx.person && isIdentityKey(leafKey)) add(`identity key "${leafKey}" not redacted at ${at}`);
        else if (/(^|_)id$/.test(tokens(leafKey).join("_")) && (ctx.person && (endpointKind(key) === "people" || path.slice(0, -1).some((p) => IDENTITY_ANCESTOR.test(p))) ? true : /^(?=.{8,}$)[A-Za-z]{3,}[._]?\d{2,}$/.test(raw) || PROFILE_ID.test(raw)) && !tokens(leafKey).includes("entity")) add(`person id not redacted at ${at}`);
        else if (ctx.person && URL_ONLY.test(raw) && !(KNOWN_HOST.test(raw) && foreignHandles(key, raw).length === 0)) add(`person URL not redacted at ${at}`);
      } else if (!ctx.strict && TEXT_LEAF.test(leaf) && path.some((p) => /comment|review|repl/i.test(p))) {
        for (const m of s.matchAll(AT_HANDLE)) if (m[2] !== "user") add(`@handle in free text at ${at}`);
      }
    },
    key,
    endpointKind(key),
  );
  return issues;
}
