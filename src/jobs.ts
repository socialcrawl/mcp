/**
 * Async job handles. An endpoint whose `execution` is `async` answers a submit
 * with a job id and returns before the work is done. SDK 1.29 has no tasks
 * extension (spec 2026-07-28), so the result carries the handle plus a
 * structured `poll` hint: the exact call that reads the job (one the same
 * OAuth scopes can make) and how long to wait first (the server's Retry-After).
 */

export const DEFAULT_POLL_AFTER_S = 5;

const TERMINAL = new Set(["completed", "succeeded", "success", "failed", "canceled", "cancelled", "expired", "done", "error"]);

export interface PollHint {
  tool: string;
  arguments: Record<string, unknown>;
  after_s: number;
}

export interface JobHandle {
  id: string;
  status?: string;
  poll: PollHint;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `{ job_id, status }` from a submit envelope (at the root or under `data`), or undefined. */
export function findJob(envelope: unknown): { id: string; status?: string } | undefined {
  if (!isObj(envelope)) return undefined;
  for (const src of [isObj(envelope.data) ? envelope.data : undefined, envelope]) {
    if (!src) continue;
    const id = [src.job_id, src.jobId].find((v): v is string => typeof v === "string" && v !== "");
    if (id) return { id, status: typeof src.status === "string" ? src.status : undefined };
  }
  return undefined;
}

/** True once the status says the job will not change (no point polling). */
export function isTerminalStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL.has(status.toLowerCase());
}

/**
 * The handle for a job submitted through `socialcrawl_request` or
 * `socialcrawl_manage` (prism/jobs), or undefined when finished/absent.
 */
export function requestJobHandle(platform: string, envelope: unknown, retryAfterS?: number): JobHandle | undefined {
  const job = findJob(envelope);
  if (!job || isTerminalStatus(job.status)) return undefined;
  return {
    id: job.id,
    ...(job.status ? { status: job.status } : {}),
    // socialcrawl_request, not manage: a spend-scoped OAuth token can always call it.
    poll: {
      tool: "socialcrawl_request",
      arguments: { platform, resource: "jobs/{job_id}", method: "GET", params: { job_id: job.id } },
      after_s: retryAfterS ?? DEFAULT_POLL_AFTER_S,
    },
  };
}

/** The handle for a web job (crawl, batch_scrape, agent), polled through `socialcrawl_manage` area web. */
export function webJobHandle(envelope: unknown, retryAfterS?: number): JobHandle | undefined {
  const job = findJob(envelope);
  if (!job || isTerminalStatus(job.status)) return undefined;
  return {
    id: job.id,
    ...(job.status ? { status: job.status } : {}),
    poll: {
      tool: "socialcrawl_manage",
      arguments: { area: "web", action: "job_get", id: job.id },
      after_s: retryAfterS ?? DEFAULT_POLL_AFTER_S,
    },
  };
}

/** The line an agent reads in the text content. */
export function pollLine(h: JobHandle): string {
  return `**Async job:** \`${h.id}\`${h.status ? ` (${h.status})` : ""}. Poll after ${h.poll.after_s}s: ${JSON.stringify(h.poll)}. Repeat until the status is completed, failed or canceled; the hold settles when it finishes.`;
}
