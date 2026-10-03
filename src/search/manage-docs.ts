import type { ZodTypeAny } from "zod";
import { DOCS } from "../data/docs.js";
import { CohortsInputSchema, MonitorsInputSchema } from "../schemas/tools.js";

/**
 * The stateful families `socialcrawl_manage` runs that are not registry
 * endpoints (monitors, cohorts), as documents the ranker can return. Nothing
 * here is written per family: each document is read from the family's own
 * data, the intro of its docs topic (the paragraphs before the first
 * heading, minus the ones about routes and tools) and the action list and
 * action description of its manage schema. The other manage areas (web,
 * jobs) are registry endpoints and are ranked as such.
 */

export interface ManageDoc {
  /** The `socialcrawl_manage` area, also the docs topic. */
  area: "monitors" | "cohorts";
  /** The area's actions, in schema order; the first one starts it. */
  actions: string[];
  /** The topic's first paragraph. */
  summary: string;
  /** The rest of the topic's intro. */
  detail: string;
  /** The schema's action description. */
  usage: string;
}

const SCHEMAS: Record<ManageDoc["area"], { shape: { action: ZodTypeAny } }> = {
  monitors: MonitorsInputSchema,
  cohorts: CohortsInputSchema,
};

/** Markdown emphasis dropped, whitespace collapsed. */
const plain = (md: string): string => md.replace(/[*_]+/g, "").replace(/\s+/g, " ").trim();

/** A docs topic's intro paragraphs: before the first `##` heading, without the title or paragraphs naming routes or tools. */
export function introParagraphs(topic: string): string[] {
  const body = topic.split(/\n## /)[0];
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("#") && !p.includes("`"))
    .map(plain);
}

let cached: ManageDoc[] | undefined;

export function manageDocs(): ManageDoc[] {
  if (cached) return cached;
  cached = (Object.keys(SCHEMAS) as ManageDoc["area"][]).flatMap((area) => {
    const action = SCHEMAS[area].shape.action as unknown as { options: string[]; description?: string };
    const intro = introParagraphs(DOCS[area] ?? "");
    if (intro.length === 0) return [];
    return [{ area, actions: [...action.options], summary: intro[0], detail: intro.slice(1).join(" "), usage: action.description ?? "" }];
  });
  return cached;
}
