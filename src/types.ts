export interface ParamDef {
  name: string;
  required: boolean;
  description: string;
  example: string;
}

export interface Platform {
  slug: string;
  name: string;
  endpointCount: number;
  description: string;
}

export interface Endpoint {
  platform: string;
  resource: string;
  method: "GET";
  params: ParamDef[];
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
