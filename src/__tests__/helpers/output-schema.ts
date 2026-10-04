import { expect } from "vitest";
import { z } from "zod";
import type { ZodRawShape } from "zod";
import {
  AccountOutputShape,
  CollectOutputShape,
  EndpointOutputShape,
  EstimateOutputShape,
  FindOutputShape,
  RequestOutputShape,
} from "../../schemas/outputs.js";

/**
 * The outputSchema each tool declares. MCP clients (and the SDK server itself)
 * reject a result whose structuredContent does not validate, so every test
 * that touches a tool's structured output checks it here.
 */
export const OUTPUT_SHAPES: Record<string, ZodRawShape> = {
  socialcrawl_find: FindOutputShape,
  socialcrawl_endpoint: EndpointOutputShape,
  socialcrawl_estimate: EstimateOutputShape,
  socialcrawl_request: RequestOutputShape,
  socialcrawl_collect: CollectOutputShape,
  socialcrawl_account: AccountOutputShape,
};

/** Fails the test with zod's issues when `structured` does not match the tool's declared outputSchema. */
export function expectValidOutput(tool: string, structured: unknown): void {
  const shape = OUTPUT_SHAPES[tool];
  if (!shape) throw new Error(`${tool} declares no outputSchema`);
  const parsed = z.object(shape).safeParse(structured);
  expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
}

/** Every value at `key`, anywhere in a JSON value. */
export function valuesAt(value: unknown, key: string): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === key) out.push(x);
        walk(x);
      }
    }
  };
  walk(value);
  return out;
}
