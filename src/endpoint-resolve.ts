import { ENDPOINTS, findEndpoint } from "./data/endpoints.js";
import { FEED_PATH_ALIASES, PLATFORM_ALIASES } from "./param-aliases.js";
import type { Endpoint } from "./types.js";

/**
 * Resolve a resource to its registered endpoint, accepting both the template
 * (`jobs/{job_id}` with `job_id` in params) and a concrete path
 * (`jobs/job_abc123`). Returns the path-param values a concrete path carried.
 */
export function resolveEndpoint(
  platform: string,
  resource: string,
  method: string | undefined,
): { endpoint: Endpoint; pathValues: Record<string, string>; aliasOf?: string } | undefined {
  const sent = `${platform}/${resource}`;
  const plain = resolveDirect(platform, resource, method);
  if (plain) return plain;
  // The API's own aliases (API-051): `x` is `twitter`, and a guessed feed path
  // such as tiktok/profile/posts is served as that platform's posts feed.
  const canonicalPlatform = PLATFORM_ALIASES[platform] ?? platform;
  const target = FEED_PATH_ALIASES[`${canonicalPlatform}/${resource}`];
  if (target) {
    const slash = target.indexOf("/");
    const hit = resolveDirect(target.slice(0, slash), target.slice(slash + 1), method);
    if (hit) return { ...hit, aliasOf: sent };
  }
  if (canonicalPlatform !== platform) {
    const hit = resolveDirect(canonicalPlatform, resource, method);
    if (hit) return { ...hit, aliasOf: sent };
  }
  return undefined;
}

function resolveDirect(
  platform: string,
  resource: string,
  method: string | undefined,
): { endpoint: Endpoint; pathValues: Record<string, string> } | undefined {
  const direct = findEndpoint(platform, resource, method);
  if (direct) return { endpoint: direct, pathValues: {} };
  const parts = resource.split("/");
  for (const e of ENDPOINTS) {
    if (e.platform !== platform || !e.resource.includes("{")) continue;
    if (method && e.method !== method) continue;
    const tpl = e.resource.split("/");
    if (tpl.length !== parts.length) continue;
    const values: Record<string, string> = {};
    const ok = tpl.every((seg, i) => {
      const m = /^\{(\w+)\}$/.exec(seg);
      if (m) {
        values[m[1]] = decodeURIComponent(parts[i]);
        return parts[i].length > 0;
      }
      return seg === parts[i];
    });
    if (ok) return { endpoint: e, pathValues: values };
  }
  return undefined;
}
