import type { ZodError, ZodTypeAny } from "zod";
import { apiRequest } from "../client.js";
import type { ApiContext } from "../context.js";
import { errorFromText, isErrorText } from "../result.js";
import type { ToolOutput } from "../result.js";
import { CohortsInputSchema, MonitorsInputSchema, WebInputSchema } from "../schemas/tools.js";
import { cohorts } from "./cohorts.js";
import type { CohortsParams } from "./cohorts.js";
import { monitors } from "./monitors.js";
import type { MonitorsParams } from "./monitors.js";
import { requestStructured } from "./request.js";
import { web } from "./web.js";
import type { WebParams } from "./web.js";

/**
 * `socialcrawl_manage` (MCP-04): one action-dispatched tool for everything
 * that persists or runs in the background: monitors, cohorts, the web surface
 * (scrape/search/map/extract, crawl/batch/agent jobs, change monitors,
 * browser sessions) and Prism background jobs. The arguments are rebuilt into
 * each area's own strict schema and validated before anything is sent, so a
 * wrong field is a free, local error that states the rules.
 */

export type ManageArea = "monitors" | "cohorts" | "web" | "jobs";

export interface ManageParams {
  area: ManageArea;
  action: string;
  id?: string;
  input?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Validate and quote a create/update without creating it (`?dry_run=1`). */
  dry_run?: boolean;
}

/** The actions a dry run can stand in for, per area. */
export const DRY_RUN_ACTIONS: Record<ManageArea, string[]> = {
  monitors: ["create"],
  web: ["monitor_create", "monitor_update"],
  cohorts: ["create", "add_members", "query"],
  jobs: [],
};

/**
 * Routes whose dry_run support is checked before the dry run is sent, with a
 * probe that cannot create anything: an empty body and an invalid dry_run
 * value. A route that reads dry_run refuses the value (a 400 naming dry_run);
 * one that ignores it refuses the empty body. Web and cohort routes always
 * answer dry_run, so they need no probe.
 */
const PROBED: Partial<Record<string, string>> = { "monitors/create": "/v1/monitors" };
/** Asked on every dry run (free, one round trip), so an API change is picked up at once. */
async function supportsDryRun(ctx: ApiContext, path: string): Promise<boolean> {
  const answer = await apiRequest(ctx, { method: "POST", path, query: { dry_run: "probe" }, body: {}, errorPlatform: "monitors" });
  return /^Error/.test(answer) && /dry_run/i.test(answer);
}

/** How to remove what a create made, when the API ran it for real despite dry_run. */
const UNDO: Partial<Record<string, (id: string) => string>> = {
  "monitors/create": (id) => `/v1/monitors/${encodeURIComponent(id)}`,
  "web/monitor_create": (id) => `/v1/web/monitors/${encodeURIComponent(id)}`,
  "cohorts/create": (id) => `/v1/cohorts/${encodeURIComponent(id)}`,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The JSON body an area's text carries (its first json block), or undefined. */
function bodyOf(text: string): Record<string, unknown> | undefined {
  const m = /```json\n([\s\S]*?)\n```/.exec(text);
  if (!m) return undefined;
  try {
    const v = JSON.parse(m[1]) as unknown;
    return isObj(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** True when the answer is a dry run's (validation + quote), not a created or changed resource. */
function isDryRunAnswer(body: Record<string, unknown>): boolean {
  const layers = [body, isObj(body.data) ? body.data : {}];
  return layers.some((l) => l.dry_run === true || typeof l.valid === "boolean" || isObj(l.estimate) || isObj(l.quote) || isObj(l.normalized_params));
}

/** The id of whatever the call created, if it created something. */
function createdId(body: Record<string, unknown>): string | undefined {
  const data = isObj(body.data) ? body.data : {};
  const candidates = [
    isObj(body.monitor) ? body.monitor.id : undefined,
    isObj(data.monitor) ? data.monitor.id : undefined,
    data.id, data.monitor_id, data.cohort_id, body.id, body.monitor_id, body.cohort_id,
  ];
  const id = candidates.find((c) => typeof c === "string" && c.length > 0);
  return typeof id === "string" ? id : undefined;
}

/**
 * A dry run's answer checked: an error (a free validation refusal) or a dry-run
 * answer passes through; anything the API created anyway is deleted at once
 * and the call is refused, so dry_run never leaves a resource behind.
 */
async function checkDryRun(ctx: ApiContext, area: ManageArea, action: string, text: string): Promise<ToolOutput> {
  if (isErrorText(text)) return done(text);
  const body = bodyOf(text);
  if (body && isDryRunAnswer(body)) {
    return done(`Dry run: validated and quoted; nothing was created or changed.\n${text}`, { ok: true, dry_run: true });
  }
  const id = body ? createdId(body) : undefined;
  const undo = id ? UNDO[`${area}/${action}`] : undefined;
  let cleanup = "";
  if (id && undo) {
    const del = await apiRequest(ctx, { method: "DELETE", path: undo(id), errorPlatform: area });
    cleanup = /^Error/.test(del)
      ? ` It created ${id}, and deleting it failed (${del.split("\n")[0]}): delete it with action "${area === "web" ? "monitor_delete" : "delete"}" and id "${id}".`
      : ` It created ${id}, which was deleted at once.`;
  } else if (id || !body) {
    cleanup = ` The API applied the call${id ? ` (${id})` : ""}; check it with the matching get action.`;
  }
  return done(
    `Error: dry_run is not supported by the API for ${area} ${action} yet, so this was refused rather than run.${cleanup} Nothing was kept. Check the fields against socialcrawl_endpoint id "${area}", or repeat without dry_run to create it for real.`,
  );
}

const optionsOf = (schema: { shape: { action: ZodTypeAny } }): string[] =>
  (schema.shape.action as unknown as { options: string[] }).options;

/** The `jobs` area's actions and the prism endpoints they call. */
export const JOB_ACTION_RESOURCES: { action: "submit" | "list" | "get"; method: "GET" | "POST"; resource: string }[] = [
  { action: "submit", method: "POST", resource: "jobs" },
  { action: "list", method: "GET", resource: "jobs" },
  { action: "get", method: "GET", resource: "jobs/{job_id}" },
];

const jobResource = (action: string): string => JOB_ACTION_RESOURCES.find((a) => a.action === action)!.resource;

export const MANAGE_ACTIONS: Record<ManageArea, string[]> = {
  monitors: optionsOf(MonitorsInputSchema),
  cohorts: optionsOf(CohortsInputSchema),
  web: optionsOf(WebInputSchema),
  jobs: JOB_ACTION_RESOURCES.map((a) => a.action),
};

function done(text: string, structured?: Record<string, unknown>): ToolOutput {
  return { text, structured: isErrorText(text) ? errorFromText(text) : (structured ?? { ok: true }) };
}

function invalid(area: ManageArea, err: ZodError): ToolOutput {
  const issues = err.issues.map((i) => `- ${i.path.join(".") || "(arguments)"}: ${i.message}`);
  return done(
    [
      `Error: Invalid parameter value(s) for socialcrawl_manage area "${area}". Nothing was sent or charged.`,
      ...issues,
      "",
      `Actions: ${MANAGE_ACTIONS[area].join(", ")}. Put the action's fields in \`input\` and the resource id in \`id\`.`,
    ].join("\n"),
  );
}

const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true";

export async function manage(ctx: ApiContext, p: ManageParams): Promise<ToolOutput> {
  const actions = MANAGE_ACTIONS[p.area];
  if (!actions.includes(p.action)) {
    return done(`Error: Unknown action "${p.action}" for area "${p.area}". Actions: ${actions.join(", ")}.`);
  }
  // dry_run is a top-level flag; one inside input counts too, and never reaches the body.
  const { dry_run: inputDryRun, ...rest } = p.input ?? {};
  const dryRun = p.dry_run === true || truthy(inputDryRun);
  const input: Record<string, unknown> = rest;
  if (dryRun && !DRY_RUN_ACTIONS[p.area].includes(p.action)) {
    const ok = (Object.entries(DRY_RUN_ACTIONS) as [ManageArea, string[]][]).flatMap(([a, list]) => list.map((x) => `${a} ${x}`));
    return done(`Error: dry_run is only for ${ok.join(", ")}; "${p.area} ${p.action}" was not sent.`);
  }
  if (!dryRun) return dispatch(ctx, p, input, false);
  const probePath = PROBED[`${p.area}/${p.action}`];
  if (probePath && ctx.apiKey && !(await supportsDryRun(ctx, probePath))) {
    return done(
      `Error: dry_run is not supported by the API for ${p.area} ${p.action} yet, so nothing was sent and nothing was created. Check the fields against socialcrawl_endpoint id "${p.area}", or repeat without dry_run to create it for real.`,
    );
  }
  const out = await dispatch(ctx, p, input, true);
  return out.structured.ok === false ? out : checkDryRun(ctx, p.area, p.action, out.text);
}

/** Run one validated action; `sendDry` adds `?dry_run=1` to the API call. */
async function dispatch(ctx: ApiContext, p: ManageParams, input: Record<string, unknown>, sendDry: boolean): Promise<ToolOutput> {
  if (p.area === "monitors") {
    const parsed = MonitorsInputSchema.safeParse({ ...input, action: p.action, ...(p.id ? { id: p.id } : {}) });
    if (!parsed.success) return invalid(p.area, parsed.error);
    return done(await monitors(ctx, parsed.data as MonitorsParams, { dryRun: sendDry }));
  }

  if (p.area === "web") {
    const parsed = WebInputSchema.safeParse({
      action: p.action,
      ...(p.id ? { id: p.id } : {}),
      ...(p.input ? { input } : {}),
      ...(p.idempotencyKey ? { idempotencyKey: p.idempotencyKey } : {}),
    });
    if (!parsed.success) return invalid(p.area, parsed.error);
    return done(await web(ctx, parsed.data as WebParams, { dryRun: sendDry }));
  }

  if (p.area === "cohorts") {
    // A query's own id for the query_* actions; the cohort's for the rest.
    const idKey = p.action.startsWith("query_") ? "query_id" : "cohort_id";
    const parsed = CohortsInputSchema.safeParse({
      ...input,
      action: p.action,
      ...(p.id ? { [idKey]: p.id } : {}),
      ...(p.idempotencyKey ? { idempotencyKey: p.idempotencyKey } : {}),
    });
    if (!parsed.success) return invalid(p.area, parsed.error);
    return done(await cohorts(ctx, parsed.data as CohortsParams, { dryRun: sendDry }));
  }

  // Prism background jobs: submit (POST prism/jobs), list, get one.
  if (p.action === "get") {
    if (!p.id) return done('Error: Missing required parameter(s): `id` (the job_id from submit). No credits were charged.');
    return requestStructured(ctx, { platform: "prism", resource: jobResource("get"), method: "GET", params: { job_id: p.id } });
  }
  if (p.action === "list") {
    return requestStructured(ctx, {
      platform: "prism",
      resource: jobResource("list"),
      method: "GET",
      params: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)])),
    });
  }
  const { max_credits, confirm, ...body } = input;
  return requestStructured(ctx, {
    platform: "prism",
    resource: jobResource("submit"),
    method: "POST",
    body,
    idempotencyKey: p.idempotencyKey,
    max_credits: typeof max_credits === "number" ? max_credits : undefined,
    confirm: confirm === true,
  });
}
