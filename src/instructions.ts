import { readFileSync } from "node:fs";
import { ENDPOINTS } from "./data/endpoints.js";
import { PLATFORMS } from "./data/platforms.js";
import { REGISTRY_FINGERPRINT } from "./data/registry-meta.js";

/**
 * Connect-time server instructions. The prose lives in `instructions.md` (copied
 * next to this file by `npm run build`); the counts and catalogue fingerprint
 * are filled from the generated registry data so they cannot go stale. Keep the
 * rendered text under 2,000 characters — clients put it in every session.
 */
function render(): string {
  const raw = readFileSync(new URL("./instructions.md", import.meta.url), "utf8").trim();
  return raw
    .replace("{{ENDPOINTS}}", String(ENDPOINTS.length))
    .replace("{{PLATFORMS}}", String(PLATFORMS.length))
    .replace("{{FINGERPRINT}}", REGISTRY_FINGERPRINT.slice(0, 12));
}

export const INSTRUCTIONS = render();
