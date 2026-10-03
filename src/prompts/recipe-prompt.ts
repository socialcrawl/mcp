import type { RecipeData, RecipeInputData, RecipeSetupData, RecipeStepData } from "../resources/recipe-types.js";

/**
 * Turn a task recipe into the message an agent runs: inputs, the exact calls
 * with the user's values filled in, the quoted cost, cheaper and deeper
 * alternatives and the pitfalls. Everything comes from the recipe data (the
 * registry's recipes plus their computed cost); nothing is typed per recipe.
 */

const PLACEHOLDER = /\{([a-z_]+)\}/g;
const WHOLE = /^\{([a-z_]+)\}$/;

/** `brand-listening` -> `brand_listening` (prompt names are snake_case). */
export const promptName = (recipeId: string): string => recipeId.replace(/-/g, "_");

/** The 1.x-era names MCP-05 asked for, each an alias of one recipe. */
export const PROMPT_ALIASES: Record<string, string> = {
  creator_discovery: "find-creators-in-a-niche",
  competitor_monitor: "youtube-competitor-monitor",
  compare_reviews: "compare-reviews-across-retailers",
  comment_export: "export-tiktok-comments",
};

function fill(value: unknown, args: Record<string, string>, inputs: Map<string, RecipeInputData>): unknown {
  if (typeof value === "string") {
    const whole = WHOLE.exec(value);
    const input = whole ? inputs.get(whole[1]!) : undefined;
    if (input?.type === "json" && whole && args[whole[1]!] !== undefined) {
      try {
        return JSON.parse(args[whole[1]!]!);
      } catch {
        return args[whole[1]!];
      }
    }
    return value.replace(PLACEHOLDER, (m, k: string) => args[k] ?? `<${k}>`);
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, args, inputs));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, args, inputs)]));
  }
  return value;
}

const credits = (n: number): string => `${n} credit${n === 1 ? "" : "s"}`;

function costLine(r: RecipeData): string {
  const t = r.cost.total;
  if (!t) return "Cost: setup only; creating is free, runs and queries bill as listed in the setup notes.";
  const single = t.exact || t.expected_min === t.expected_max;
  const amount = single ? credits(t.hold) : `${t.expected_min}-${t.expected_max} credits`;
  const qualifier = t.floor ? "at least " : "";
  return `Cost for ${r.size.description}: ${qualifier}${amount}${t.exact ? " (exact)" : ""}. Quote the exact params with socialcrawl_estimate before spending.`;
}

function manageArea(path: string): string {
  if (path.startsWith("/v1/monitors")) return "monitors";
  if (path.startsWith("/v1/cohorts")) return "cohorts";
  return "web";
}

function setupLine(i: number, s: RecipeSetupData, args: Record<string, string>, inputs: Map<string, RecipeInputData>): string {
  const body = s.body ? ` with ${JSON.stringify(fill(s.body, args, inputs))}` : "";
  return `${i}. ${s.method} ${s.path}${body} (socialcrawl_manage, area ${manageArea(s.path)}).${s.note ? ` ${s.note}` : ""}`;
}

function stepLines(i: number, s: RecipeStepData, args: Record<string, string>, inputs: Map<string, RecipeInputData>): string[] {
  // A path id (`{monitor_id}`) is filled from an earlier step: show it as <monitor_id>.
  const endpoint = s.endpoint.replace(PLACEHOLDER, "<$1>");
  const [platform, ...rest] = endpoint.split("/");
  const resource = rest.join("/");
  const filled = fill(s.params, args, inputs);
  const post = s.method === "POST";
  const call =
    platform === "web"
      ? `socialcrawl_manage (area web) for ${endpoint}, ${post ? "body" : "params"} ${JSON.stringify(filled)}`
      : `socialcrawl_request ${JSON.stringify({ platform, resource, ...(post ? { method: "POST", body: filled } : { params: filled }) })}`;
  const lines = [`${i}. [${s.id}] ${call}`];
  if (s.bind && Object.keys(s.bind).length > 0) {
    lines.push(`   Take from earlier steps: ${Object.entries(s.bind).map(([p, from]) => `${p} <- ${from}`).join("; ")}`);
  }
  if (s.repeat === "until_n_items") lines.push(`   Repeat on paging.next_cursor until you have the wanted number of rows (socialcrawl_collect walks it for you).`);
  else if (s.repeat) lines.push(`   Repeat once per row of step "${s.repeat.replace("per_item_of:", "")}".`);
  if (s.note) lines.push(`   ${s.note}`);
  return lines;
}

export function renderRecipePrompt(recipe: RecipeData, args: Record<string, string>): string {
  const inputs = new Map(recipe.inputs.map((i) => [i.name, i]));
  const lines: string[] = [
    `Task: ${recipe.title}.`,
    `Use when the user says: ${recipe.when.map((w) => `"${w}"`).join("; ")}.`,
    "",
    "Inputs:",
    ...recipe.inputs.map((i) => `- ${i.name} = ${args[i.name] ?? `<${i.name}>`} (${i.description})`),
    "",
    "Work through the steps below with the SocialCrawl tools. Confirm the price with socialcrawl_estimate before the first paid call, read credits.used after each call, and stop and report if a call fails with a 402.",
  ];
  if (recipe.setup && recipe.setup.length > 0) {
    lines.push("", "Setup (once):", ...recipe.setup.map((s, i) => setupLine(i + 1, s, args, inputs)));
  }
  if (recipe.steps.length > 0) {
    lines.push("", "Steps:", ...recipe.steps.flatMap((s, i) => stepLines(i + 1, s, args, inputs)));
  }
  lines.push("", costLine(recipe));
  for (const r of recipe.cost.rows) lines.push(`- ${r.id.replace(PLACEHOLDER, "<$1>")}${r.runs > 1 ? ` x${r.runs}` : ""}: ${credits(r.hold_total)}`);
  const rec = recipe.cost.recurring;
  if (rec) lines.push(`Recurring: ${credits(rec.per)} per run, ${rec.cadence}.`);
  if (recipe.cheaper?.length) lines.push("", "Cheaper:", ...recipe.cheaper.map((a) => `- ${a.endpoint}: ${a.why}`));
  if (recipe.deeper?.length) lines.push("", "Deeper:", ...recipe.deeper.map((a) => `- ${a.endpoint}: ${a.why}`));
  if (recipe.pitfalls.length > 0) lines.push("", "Pitfalls:", ...recipe.pitfalls.map((p) => `- ${p}`));
  return lines.join("\n");
}
