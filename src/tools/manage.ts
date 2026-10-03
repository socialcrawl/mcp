import type { ZodError, ZodTypeAny } from "zod";
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

export async function manage(ctx: ApiContext, p: ManageParams): Promise<ToolOutput> {
  const actions = MANAGE_ACTIONS[p.area];
  if (!actions.includes(p.action)) {
    return done(`Error: Unknown action "${p.action}" for area "${p.area}". Actions: ${actions.join(", ")}.`);
  }
  const input = p.input ?? {};

  if (p.area === "monitors") {
    const parsed = MonitorsInputSchema.safeParse({ ...input, action: p.action, ...(p.id ? { id: p.id } : {}) });
    if (!parsed.success) return invalid(p.area, parsed.error);
    return done(await monitors(ctx, parsed.data as MonitorsParams));
  }

  if (p.area === "web") {
    const parsed = WebInputSchema.safeParse({
      action: p.action,
      ...(p.id ? { id: p.id } : {}),
      ...(p.input ? { input } : {}),
      ...(p.idempotencyKey ? { idempotencyKey: p.idempotencyKey } : {}),
    });
    if (!parsed.success) return invalid(p.area, parsed.error);
    return done(await web(ctx, parsed.data as WebParams));
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
    return done(await cohorts(ctx, parsed.data as CohortsParams));
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
