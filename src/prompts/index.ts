import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";
import { RECIPES_DATA } from "../data/recipes.js";
import { PLATFORMS } from "../data/platforms.js";
import type { RecipeData } from "../resources/recipe-types.js";
import { PROMPT_ALIASES, promptName, renderRecipePrompt } from "./recipe-prompt.js";

/** Prompts take at most this many inputs; bigger recipes are read from `socialcrawl://recipes`. */
const MAX_PROMPT_INPUTS = 3;

function register(server: McpServer, name: string, recipe: RecipeData): void {
  const argsSchema: Record<string, z.ZodTypeAny> = {};
  for (const input of recipe.inputs) {
    const base = z.string().describe(`${input.description} (e.g. ${input.example})`);
    argsSchema[input.name] =
      input.name === "platform"
        ? completable(base, (v) => PLATFORMS.map((p) => p.slug).filter((s) => s.startsWith(String(v ?? "").toLowerCase())))
        : base;
  }
  server.registerPrompt(
    name,
    { title: recipe.title, description: `${recipe.title}. Starts the recipe: the exact calls, the cost and the pitfalls.`, argsSchema },
    (args) => ({
      description: recipe.title,
      messages: [{ role: "user", content: { type: "text", text: renderRecipePrompt(recipe, args as Record<string, string>) } }],
    }),
  );
}

/** MCP-05: one prompt per recipe with up to three inputs, plus the named aliases. */
export function registerPrompts(server: McpServer): void {
  const byId = new Map(RECIPES_DATA.map((r) => [r.id, r]));
  for (const recipe of RECIPES_DATA) {
    if (recipe.inputs.length <= MAX_PROMPT_INPUTS) register(server, promptName(recipe.id), recipe);
  }
  for (const [alias, id] of Object.entries(PROMPT_ALIASES)) {
    const recipe = byId.get(id);
    if (recipe) register(server, alias, recipe);
  }
}
