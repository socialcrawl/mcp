/**
 * A task recipe as exported by the codebase (`scripts/export-recipes.ts`):
 * the registry's recipe plus its computed cost. Data only; no prices typed here.
 */
export interface RecipeInputData {
  name: string;
  description: string;
  example: string;
  type?: "string" | "json";
}

export interface RecipeStepData {
  id: string;
  endpoint: string;
  method?: "GET" | "POST";
  params: Record<string, string>;
  bind?: Record<string, string>;
  repeat?: string;
  note?: string;
}

export interface RecipeSetupData {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  note?: string;
}

export interface RecipeCostData {
  rows: Array<{ ref: string; id: string; runs: number; hold_total: number }>;
  total?: { hold: number; expected_min: number; expected_max: number; exact: boolean; floor: boolean };
  scaled: boolean;
  per_run?: { hold: number; expected_min: number; recipe: string };
  recurring?: { kind: string; per: number; perDay: number; cadence: string; unit: string };
}

export interface RecipeData {
  id: string;
  title: string;
  when: string[];
  inputs: RecipeInputData[];
  steps: RecipeStepData[];
  setup?: RecipeSetupData[];
  size: { description: string; items: number };
  cheaper?: Array<{ endpoint: string; why: string }>;
  deeper?: Array<{ endpoint: string; why: string }>;
  pitfalls: string[];
  decision_table?: Array<{ option: string; endpoint: string; best_for: string; cost: string }>;
  cost: RecipeCostData;
}
