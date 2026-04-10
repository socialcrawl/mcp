export const CHARACTER_LIMIT = 25_000;
export const TIMEOUT_MS = 30_000;

export const CREDIT_COSTS: Record<string, number> = {
  standard: 1,
  advanced: 5,
  premium: 10,
} as const;

export const SERVER_NAME = "socialcrawl-mcp";
export const SERVER_VERSION = "1.0.0";
