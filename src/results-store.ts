import { createHash } from "node:crypto";

/**
 * Full response bodies, kept so a truncated result can link to the rest. An
 * in-process LRU with a byte cap and a short TTL. Entries are scoped by a hash
 * of the API key, so the stateless HTTP transport (one server per request,
 * one shared process) never lets one caller read another's body.
 */

const MAX_ENTRIES = 50;
const MAX_BYTES = 32 * 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;

interface Entry {
  body: string;
  at: number;
  size: number;
}

export class ResultsStore {
  private map = new Map<string, Entry>();
  private bytes = 0;

  constructor(private now: () => number = Date.now) {}

  private key(scope: string, id: string): string {
    return `${scope}\u0000${id}`;
  }

  /** False when the body alone exceeds the byte cap (it is not stored). */
  put(scope: string, id: string, body: string): boolean {
    const k = this.key(scope, id);
    this.drop(k);
    const size = Buffer.byteLength(body);
    if (size > MAX_BYTES) return false;
    this.map.set(k, { body, at: this.now(), size });
    this.bytes += size;
    while (this.map.size > MAX_ENTRIES || this.bytes > MAX_BYTES) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined || oldest === k) break;
      this.drop(oldest);
    }
    return true;
  }

  get(scope: string, id: string): string | undefined {
    const k = this.key(scope, id);
    const e = this.map.get(k);
    if (!e) return undefined;
    if (this.now() - e.at > TTL_MS) {
      this.drop(k);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(k);
    this.map.set(k, e);
    return e.body;
  }

  private drop(k: string): void {
    const e = this.map.get(k);
    if (e) this.bytes -= e.size;
    this.map.delete(k);
  }
}

export const resultsStore = new ResultsStore();

/** Stable, non-reversible scope for a key (empty key shares one scope). */
export function scopeOf(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

export const RESULT_URI_PREFIX = "socialcrawl://results/";
export const resultUri = (id: string): string => `${RESULT_URI_PREFIX}${id}`;
