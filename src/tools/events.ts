import { randomUUID } from "node:crypto";
import type { ApiContext } from "../context.js";
import { CONSUMER_NAME_RE, EVENT_TYPE_PATTERN_RE, EVENT_TYPE_RE, WEBHOOK_ENDPOINT_ID_RE } from "../schemas/async.js";
import type { EventsInput } from "../schemas/async.js";
import { EVENTS_CURSOR_EXPIRED_HINT, LONG_READ_TIMEOUT_MS, dataOf, pruneQuery, render, sendRequest } from "./async-common.js";
import type { AsyncRequestOptions } from "./async-common.js";

/**
 * `socialcrawl_manage` area `events`: the account event log, pulled or pushed.
 *
 * - **Feed** (`GET /v1/events`): every event about this key's background work
 *   (discover runs and schedules, webhook endpoint health), retained 30 days.
 *   Read from a cursor the caller keeps (`oldest`, `now`, an `evt_` id or
 *   `pagination.next_cursor`), or as a named consumer whose position the
 *   server keeps and the caller commits with `ack`. `wait_s` long-polls up to
 *   25 s (5 long-polls per key; a sixth answers at once). A position older
 *   than retention is `410 CURSOR_EXPIRED`.
 * - **Webhook endpoints** (`/v1/webhook-endpoints`): the same events pushed,
 *   signed, to up to 20 receivers per key. The `whsec_` signing secret is
 *   shown once, on create and on rotate-secret; an Idempotency-Key replay
 *   never shows it again.
 *
 * Every call is free (`credits_used: 0`). No route here honours `dry_run`.
 */

export type EventsParams = EventsInput;

const ENDPOINT_ACTIONS = new Set<string>([
  "endpoint_get",
  "endpoint_update",
  "endpoint_delete",
  "endpoint_rotate_secret",
  "endpoint_test",
  "endpoint_attempts",
]);

const FREE = "0 credits";
const TITLE_FEED = "SocialCrawl Events";
const TITLE_WEBHOOKS = "SocialCrawl Webhook Endpoints";

const WEBHOOK_ERROR_HINTS: Record<string, string> = {
  limit_reached:
    "A key holds at most 20 webhook endpoints. Delete one you no longer use (endpoint_delete), or point one endpoint at several products with types ['*'].",
  invalid_webhook_url: "The receiver must be a public HTTPS URL (no private hosts, no chat-app incoming webhooks).",
  unknown_webhook_endpoint: "An endpoint answers only to the API key that created it. List this key's endpoints with endpoint_list.",
};

function secretNotes(parsed: Record<string, unknown>): string[] {
  const data = dataOf(parsed);
  if (typeof data.secret === "string") {
    return [
      "**Store `data.secret` now:** this `whsec_` signing secret is shown ONCE and never again. Verify every delivery with it over the raw body. If it is lost, rotate it (endpoint_rotate_secret) with a NEW Idempotency-Key.",
    ];
  }
  if ("secret" in data && data.secret === null) {
    return [
      "**Replay:** this Idempotency-Key was already answered, so the secret is withheld. If it was lost, call endpoint_rotate_secret with a new Idempotency-Key.",
    ];
  }
  return [];
}

function badTypes(types: string[] | undefined): string | null {
  if (!types) return null;
  if (types.length === 0 || types.length > 50) return "Error: Invalid parameter value(s): `types` takes 1 to 50 event types or patterns. Nothing was sent.";
  const bad = types.find((t) => !EVENT_TYPE_PATTERN_RE.test(t));
  return bad === undefined
    ? null
    : `Error: Invalid parameter value(s): \`${bad}\` is not an event type or pattern: a type is lower-case dot-separated words (discover.completed), a pattern is ns.* (discover.*) or *. Nothing was sent.`;
}

function badSubjects(ids: string[] | null | undefined): string | null {
  if (ids === undefined || ids === null) return null;
  if (ids.length === 0 || ids.length > 100 || ids.some((s) => s.length === 0 || s.length > 100)) {
    return "Error: Invalid parameter value(s): `subject_ids` takes 1 to 100 ids (run_… or dsch_…), each at most 100 characters. Nothing was sent.";
  }
  return null;
}

const isHttps = (url: string): boolean => /^https:\/\//i.test(url);

export async function events(ctx: ApiContext, input: EventsParams): Promise<string> {
  const { action } = input;

  // SECURITY: both values below are interpolated into a URL path. Checked
  // against their exact shapes so a crafted value can never point a request
  // (a DELETE included) at another /v1 resource. Mirrors the zod schema.
  if (input.endpoint_id !== undefined && !WEBHOOK_ENDPOINT_ID_RE.test(input.endpoint_id)) {
    return `Error: Invalid parameter value(s): endpoint id "${input.endpoint_id}". It is we_ followed by letters and digits; list this key's endpoints with endpoint_list. Nothing was sent.`;
  }
  if (input.consumer !== undefined && !CONSUMER_NAME_RE.test(input.consumer)) {
    return `Error: Invalid parameter value(s): consumer "${input.consumer}". A consumer name is 1 to 64 characters of a-z, 0-9, _ and -. Nothing was sent.`;
  }
  if (ENDPOINT_ACTIONS.has(action) && !input.endpoint_id) {
    return `Error: Missing required parameter(s): \`id\` (the webhook endpoint id, we_…; data.endpoint.id of endpoint_create, or endpoint_list). Nothing was sent.`;
  }
  const endpointPath = input.endpoint_id ? `/v1/webhook-endpoints/${encodeURIComponent(input.endpoint_id)}` : "";

  switch (action) {
    case "feed": {
      if (input.cursor !== undefined && input.consumer !== undefined) {
        return "Error: Invalid parameter value(s): send `cursor` or a consumer (`id`), not both: with cursor you keep the position, with a consumer the server keeps it. Nothing was sent.";
      }
      if (input.start !== undefined && input.consumer === undefined) {
        return `Error: Invalid parameter value(s): \`start\` sets where a new named consumer begins. Without a consumer, send cursor "${input.start}" instead. Nothing was sent.`;
      }
      const typeError = badTypes(input.types);
      if (typeError) return typeError;
      const subjectError = badSubjects(input.subject_ids);
      if (subjectError) return subjectError;
      const response = await sendRequest(ctx, {
        method: "GET",
        path: "/v1/events",
        query: pruneQuery({
          cursor: input.cursor,
          consumer: input.consumer,
          start: input.start,
          limit: input.limit?.toString(),
          wait_s: input.wait_s?.toString(),
          types: input.types?.join(","),
          subject_id: input.subject_ids ? input.subject_ids.join(",") : undefined,
        }),
        errorPlatform: "events",
        timeoutMs: LONG_READ_TIMEOUT_MS,
      });
      return render({
        title: TITLE_FEED,
        label: `GET /v1/events${input.consumer ? ` (consumer ${input.consumer})` : ""}${input.wait_s ? ` (wait_s=${input.wait_s})` : ""}`,
        cost: FREE,
        response,
        errorHints: {
          CURSOR_EXPIRED: EVENTS_CURSOR_EXPIRED_HINT,
          event_not_found:
            "Resume from the pagination.next_cursor (c_…) you stored; an evt_ id that aged out cannot be told from a mistyped one.",
        },
        successNotes: (parsed) => {
          const pagination = parsed.pagination as { next_cursor?: unknown; has_more?: unknown } | undefined;
          const next = typeof pagination?.next_cursor === "string" ? pagination.next_cursor : undefined;
          if (input.consumer) {
            return [
              next
                ? `**Next:** process these events, then call action "ack" with id \`${input.consumer}\` and cursor \`${next}\`. Until you ack, this read returns the same page.`
                : "**Next:** ack the page you processed, then read again.",
            ];
          }
          return [
            next
              ? `**Next:** save cursor \`${next}\` and call "feed" again with it${pagination?.has_more === true ? " for the next page" : " (add wait_s: 25 to wait for new events)"}, or pass data.next.poll_url to area "discover" action "follow".`
              : "**Next:** call feed again with pagination.next_cursor.",
          ];
        },
      });
    }

    case "ack": {
      if (!input.consumer || !input.cursor) {
        return "Error: Missing required parameter(s): ack needs the consumer as `id` and `cursor` in input (the pagination.next_cursor of the page the consumer processed, or an event id). Nothing was sent.";
      }
      if (input.cursor === "oldest" || input.cursor === "now") {
        return "Error: Invalid parameter value(s): an ack takes the pagination.next_cursor of a page this consumer was served (or an event id), not oldest/now. Nothing was sent.";
      }
      const response = await sendRequest(ctx, {
        method: "POST",
        path: `/v1/events/consumers/${encodeURIComponent(input.consumer)}/ack`,
        body: { cursor: input.cursor },
        errorPlatform: "events",
      });
      return render({
        title: TITLE_FEED,
        label: `POST /v1/events/consumers/${input.consumer}/ack`,
        cost: FREE,
        response,
        errorHints: {
          unknown_consumer: `A consumer is created by its first read: call "feed" with id "${input.consumer}" first.`,
          "beyond the last page": "Ack only the pagination.next_cursor of a page this consumer was actually served.",
        },
      });
    }

    case "endpoint_create": {
      if (!input.url) {
        return "Error: Missing required parameter(s): `url`, the public HTTPS URL of your receiver. Nothing was sent.";
      }
      if (!isHttps(input.url)) return "Error: Invalid parameter value(s): `url` must be an https URL. Nothing was sent.";
      const typeError = badTypes(input.types);
      if (typeError) return typeError;
      const subjectError = badSubjects(input.subject_ids);
      if (subjectError) return subjectError;
      const body: Record<string, unknown> = { url: input.url };
      if (input.types !== undefined) body.types = input.types;
      if (input.description !== undefined) body.description = input.description;
      if (input.subject_ids !== undefined) body.subject_ids = input.subject_ids;
      const idempotencyKey = input.idempotencyKey ?? randomUUID();
      const response = await sendRequest(ctx, {
        method: "POST",
        path: "/v1/webhook-endpoints",
        body,
        idempotencyKey,
        errorPlatform: "webhooks",
      });
      return render({
        title: TITLE_WEBHOOKS,
        label: "POST /v1/webhook-endpoints",
        cost: FREE,
        idempotencyKey,
        idempotencyGenerated: input.idempotencyKey === undefined,
        idempotencyNote: "resend this key to replay the create without making a second endpoint (a replay withholds the secret).",
        notes: ["Defaults to every event type (['*']). Then call endpoint_test to receive a signed sample."],
        response,
        errorHints: WEBHOOK_ERROR_HINTS,
        successNotes: secretNotes,
      });
    }

    case "endpoint_list": {
      if (input.limit !== undefined && input.limit > 100) {
        return "Error: Invalid parameter value(s): `limit` on endpoint_list is 1 to 100 (default 50). Nothing was sent.";
      }
      const response = await sendRequest(ctx, {
        method: "GET",
        path: "/v1/webhook-endpoints",
        query: pruneQuery({ limit: input.limit?.toString(), cursor: input.cursor, status: input.status }),
        errorPlatform: "webhooks",
      });
      return render({
        title: TITLE_WEBHOOKS,
        label: "GET /v1/webhook-endpoints",
        cost: FREE,
        notes: ["This key's endpoints, newest first (at most 20 per key). Page with pagination.next_cursor."],
        response,
      });
    }

    case "endpoint_get": {
      const response = await sendRequest(ctx, { method: "GET", path: endpointPath, errorPlatform: "webhooks" });
      return render({
        title: TITLE_WEBHOOKS,
        label: `GET /v1/webhook-endpoints/${input.endpoint_id}`,
        cost: FREE,
        response,
        errorHints: WEBHOOK_ERROR_HINTS,
      });
    }

    case "endpoint_update": {
      const body: Record<string, unknown> = {};
      if (input.url !== undefined) {
        if (!isHttps(input.url)) return "Error: Invalid parameter value(s): `url` must be an https URL. Nothing was sent.";
        body.url = input.url;
      }
      if (input.types !== undefined) {
        const typeError = badTypes(input.types);
        if (typeError) return typeError;
        body.types = input.types;
      }
      if (input.description !== undefined) body.description = input.description;
      if (input.subject_ids !== undefined) {
        const subjectError = badSubjects(input.subject_ids);
        if (subjectError) return subjectError;
        body.subject_ids = input.subject_ids;
      }
      if (input.status !== undefined) body.status = input.status;
      if (Object.keys(body).length === 0) {
        return "Error: Missing required parameter(s): endpoint_update needs at least one of url, types, description, subject_ids, status. Nothing was sent.";
      }
      const response = await sendRequest(ctx, { method: "PATCH", path: endpointPath, body, errorPlatform: "webhooks" });
      return render({
        title: TITLE_WEBHOOKS,
        label: `PATCH /v1/webhook-endpoints/${input.endpoint_id}`,
        cost: FREE,
        notes: input.status === "enabled" ? ["Re-enabling resumes parked deliveries at once."] : [],
        response,
        errorHints: WEBHOOK_ERROR_HINTS,
      });
    }

    case "endpoint_delete": {
      const response = await sendRequest(ctx, { method: "DELETE", path: endpointPath, errorPlatform: "webhooks" });
      return render({
        title: TITLE_WEBHOOKS,
        label: `DELETE /v1/webhook-endpoints/${input.endpoint_id}`,
        cost: `${FREE} — its pending deliveries and attempt log are deleted too`,
        response,
        errorHints: WEBHOOK_ERROR_HINTS,
      });
    }

    case "endpoint_rotate_secret": {
      const idempotencyKey = input.idempotencyKey ?? randomUUID();
      const response = await sendRequest(ctx, {
        method: "POST",
        path: `${endpointPath}/rotate-secret`,
        idempotencyKey,
        errorPlatform: "webhooks",
      });
      return render({
        title: TITLE_WEBHOOKS,
        label: `POST /v1/webhook-endpoints/${input.endpoint_id}/rotate-secret`,
        cost: FREE,
        idempotencyKey,
        idempotencyGenerated: input.idempotencyKey === undefined,
        idempotencyNote: "a replay with this key does not rotate again and withholds the secret.",
        notes: [
          "For 24 hours every delivery carries a signature from the old secret AND the new one: deploy the new secret to your receiver before then.",
        ],
        response,
        errorHints: WEBHOOK_ERROR_HINTS,
        successNotes: secretNotes,
      });
    }

    case "endpoint_test": {
      if (input.type !== undefined && !EVENT_TYPE_RE.test(input.type)) {
        return `Error: Invalid parameter value(s): \`type\` "${input.type}" is not an event type (e.g. discover.completed). Nothing was sent.`;
      }
      const opts: AsyncRequestOptions = { method: "POST", path: `${endpointPath}/test`, errorPlatform: "webhooks" };
      if (input.type !== undefined) opts.body = { type: input.type };
      const response = await sendRequest(ctx, opts);
      return render({
        title: TITLE_WEBHOOKS,
        label: `POST /v1/webhook-endpoints/${input.endpoint_id}/test`,
        cost: FREE,
        notes: ["Sends one signed sample event now; data.attempt.outcome says how your receiver answered (it has 15 s to answer 2xx)."],
        response,
        errorHints: WEBHOOK_ERROR_HINTS,
      });
    }

    case "endpoint_attempts": {
      if (input.limit !== undefined && input.limit > 100) {
        return "Error: Invalid parameter value(s): `limit` on endpoint_attempts is 1 to 100 (default 50). Nothing was sent.";
      }
      const response = await sendRequest(ctx, {
        method: "GET",
        path: `${endpointPath}/attempts`,
        query: pruneQuery({ limit: input.limit?.toString(), cursor: input.cursor }),
        errorPlatform: "webhooks",
      });
      return render({
        title: TITLE_WEBHOOKS,
        label: `GET /v1/webhook-endpoints/${input.endpoint_id}/attempts`,
        cost: FREE,
        notes: ["Delivery attempts, newest first. A failing delivery gets 8 attempts in all, backing off over roughly 41 hours."],
        response,
        errorHints: WEBHOOK_ERROR_HINTS,
      });
    }

    default:
      return `Error: Unknown action "${action as string}".`;
  }
}
