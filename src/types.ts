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
  description?: string;
  example?: string;
  /**
   * On non-GET endpoints, distinguishes a query-string param from a JSON-body
   * param (e.g. the YouTube batch `hl` param must ride the query, not the
   * body). Absent on GET endpoints, where every param is a query param.
   */
  in?: "query" | "body";
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface Platform {
  slug: string;
  name: string;
  endpointCount: number;
  description: string;
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
  creditTier: "standard" | "advanced" | "premium";
  creditCost: number;
  archetype: string;
  summary: string;
  description: string;
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
