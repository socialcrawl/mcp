export interface ParamDef {
  name: string;
  required: boolean;
  description: string;
  example: string;
}

export type OptionalParamType = "string" | "boolean" | "integer" | "enum";

export interface OptionalParam {
  name: string;
  type: OptionalParamType;
  enumValues?: string[];
  /** Inclusive lower bound for an integer param. */
  minimum?: number;
  /** Inclusive upper bound for an integer param. */
  maximum?: number;
  /**
   * Presence coupling — this param is a silent no-op upstream unless the named
   * sibling is also supplied, so the API rejects it pre-billing with a 400
   * (e.g. GitHub honours `order` only alongside `sort`).
   */
  requires?: string;
  /**
   * Value coupling — when this param is present the named companion must equal
   * `value`. An absent companion is auto-injected with it (a documented
   * default); a conflicting one is a pre-billing 400 (e.g. Reddit `timeframe`
   * only applies with `sort=top`).
   */
  couplesWith?: { param: string; value: string };
  description?: string;
  example?: string;
  /**
   * On non-GET endpoints, distinguishes a query-string param from a JSON-body
   * param (e.g. the YouTube batch `hl` param must ride the query, not the
   * body). Absent on GET endpoints, where every param is a query param.
   */
  in?: "query" | "body";
}

/**
 * Per-entry constraint on a comma-separated LIST param. Applies to required
 * params too, which `OptionalParam` cannot describe. `max` caps the number of
 * entries; `enumValues` restricts each individual entry.
 */
export interface CsvConstraint {
  max?: number;
  enumValues?: string[];
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type CreditTier = "standard" | "advanced" | "premium";

/**
 * How an endpoint is billed.
 * - `ladder`  — the flat 1/5/10 tier rate, charged per request.
 * - `flat`    — a per-endpoint override off the ladder (e.g. `search/everywhere`
 *   at 20cr, the 0cr management + discovery endpoints).
 * - `metered` — query-dependent. An upfront ceiling is deducted and refunded
 *   down to the work actually done; `minCost`/`maxCost` bound the real charge
 *   and `description` states the exact rule.
 */
export type PricingModel = "ladder" | "flat" | "metered";

export interface Pricing {
  /** Static (query-independent) cost — the base for a metered endpoint. */
  cost: number;
  tier: CreditTier;
  /** What this endpoint's tier would cost on the plain 1/5/10 ladder. */
  ladderCost: number;
  model: PricingModel;
  /** Metered floor — the least this endpoint can ever charge. */
  minCost?: number;
  /** Metered ceiling — the most this endpoint can ever charge. */
  maxCost?: number;
  /** Items per billed page, when the meter bills per page at a fixed size. */
  pageSize?: number;
  /** Exact customer-facing wording for a dynamic price, from the registry. */
  description?: string;
}

/**
 * How an endpoint paginates. `style` names the cursor family; `nativeParam` is
 * the upstream's own param name (the universal `cursor` alias maps onto it, and
 * both are accepted).
 */
export interface PaginationInfo {
  style: "cursor" | "offset" | "page";
  nativeParam: string;
  /** Native page-size param the universal `limit` maps to, when supported. */
  limitParam?: string;
  /** Upper bound applied to `limit` before it is forwarded, when known. */
  limitMax?: number;
}

export interface CacheInfo {
  category: "profile" | "post" | "comments" | "search" | "analytics" | "immutable";
  /** Resolved TTL in seconds. `0` means this endpoint is never cached. */
  ttlSeconds: number;
}

export interface UpstreamInfo {
  /** Dispatch strategy (`scrapecreators` is the default proxy). */
  kind: string;
  /** Ordered fallback sources tried when the primary fails or returns empty. */
  fallbackKinds?: string[];
}

export interface Platform {
  slug: string;
  name: string;
  endpointCount: number;
  description: string;
  /** false for research / commerce / dev-ecosystem sources. */
  social: boolean;
  /** Manifest grouping: major, additional, commerce, linkPages, adLibraries, utility. */
  category?: string;
}

export interface Endpoint {
  platform: string;
  resource: string;
  /**
   * HTTP method the backend serves this endpoint with. Most endpoints are GET
   * (query params); batch endpoints (e.g. youtube/videos, prism/profiles) and
   * the stateful `web` platform use POST/PATCH/DELETE with a JSON body and/or
   * `{path}` params. The resource string embeds any path params as `{name}`.
   */
  method: HttpMethod;
  /** Required params (query, path, or JSON-body depending on `method`). */
  params: ParamDef[];
  /** Optional params forwarded to upstream when provided. */
  optionalParams: OptionalParam[];
  /**
   * Groups of mutually-substitutable params. Each inner array is a set
   * where at least ONE member must be provided at request time.
   * Members always live in `optionalParams`, never in `params`.
   */
  oneOfGroups: string[][];
  /** Per-entry constraints on comma-separated list params, keyed by param name. */
  csvConstraints?: Record<string, CsvConstraint>;
  creditTier: CreditTier;
  /** Static per-request cost. For a metered endpoint this is only the base. */
  creditCost: number;
  /** Full billing model — tier, flat override, or metered band. */
  pricing: Pricing;
  archetype: string;
  summary: string;
  description: string;
  /** `sync` (default), `sse` (streamed), or `async` (submit + poll). */
  execution?: "sync" | "sse" | "async";
  /**
   * When this endpoint streams instead of returning a JSON envelope:
   * `accept-header`, `always`, or `"<param>=<value>"` for a query trigger.
   */
  streaming?: string;
  pagination?: PaginationInfo;
  /** Walks every page server-side (composites that harvest to completion). */
  paginatable?: boolean;
  /** A list endpoint that genuinely does not paginate — why. */
  singlePage?: string;
  /**
   * `limit` is collect-until-N (walk pages until N unique items) rather than a
   * page size — why.
   */
  collectUntilN?: string;
  /** Upstream 404 means "zero items": coerced to 200 `{items:[]}` + refund. */
  emptyOn404?: boolean;
  cache: CacheInfo;
  upstream: UpstreamInfo;
  /** `prism` marks a server-side composite that fans out across many legs. */
  family?: string;
  /** Human action name for UI surfaces (e.g. "Cancel Job"). */
  actionLabel?: string;
  /** Chip-row group label (e.g. "Crawl Jobs", "Monitors"). */
  group?: string;
  tags?: string[];
  /** Extra contract facts a caller must know (limits, evidence states, …). */
  contractDetails?: string[];
  /** Descriptions for notable response fields. */
  responseFields?: Record<string, string>;
}

export interface SocialCrawlSuccessResponse {
  success: true;
  platform: string;
  endpoint: string;
  data: unknown;
  credits_used: number;
  credits_remaining: number;
  request_id: string;
  cached: boolean;
}

export interface SocialCrawlErrorResponse {
  success: false;
  error: {
    type: string;
    message: string;
    status: number;
    doc_url?: string;
  };
  credits_remaining?: number;
  request_id?: string;
}

export type SocialCrawlResponse = SocialCrawlSuccessResponse | SocialCrawlErrorResponse;
