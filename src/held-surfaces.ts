/**
 * Registry surfaces that are live but HELD from publication.
 *
 * The bundled data is generated from the backend registry, so a regeneration
 * would publish everything the registry declares — held work included (the
 * first trap in the backend's UPGRADE-LOG "API contract changes" section).
 * scripts/generate-data.ts runs the dump through `stripHeldSurfaces` before it
 * renders anything; src/__tests__/held-surfaces.test.ts guards the output.
 *
 * When a hold lifts, delete its entry here and regenerate.
 *
 * - API-074 `include=contacts` (the contact walk with `roles`,
 *   `min_confidence`, `max_duration`): legal gate open, not announced.
 */

/** "platform/resource" ids that carry the held contact walk (API-074). */
export const HELD_CONTACT_WALK_ENDPOINTS: ReadonlySet<string> = new Set([
  "tiktok/profile",
  "instagram/profile",
  "instagram/profile/about",
  "youtube/channel/about",
  "twitter/profile",
  "facebook/profile",
  "linkbio/page",
  "pillar/page",
]);

const HELD_PARAMS = new Set(["roles", "min_confidence", "max_duration"]);
const HELD_TOKEN = "contacts";
/** A sentence that describes the contact walk. */
const CONTACT_WALK = /include=contacts|`contacts`|contact walk|contact_lookup|contact_status|contact_items|contact_retry/;

/** Drop every sentence that describes the contact walk. */
function dropHeldSentences(text: string): string {
  return text
    .split(/(?<=\.)\s+(?=[`A-Z])/)
    .filter((s) => !CONTACT_WALK.test(s))
    .join(" ");
}

interface StrippableParam {
  name: string;
  description?: string;
}

interface StrippableEndpoint {
  platform: string;
  resource: string;
  description: string;
  pricing: { description?: string };
  optionalParams?: StrippableParam[];
  csvConstraints?: Record<string, { max?: number; enumValues?: string[] }>;
  contractDetails?: string[];
}

function stripContactWalk<T extends StrippableEndpoint>(e: T): T {
  const csv = { ...(e.csvConstraints ?? {}) };
  delete csv.roles;
  let dropInclude = false;
  if (csv.include?.enumValues?.includes(HELD_TOKEN)) {
    const values = csv.include.enumValues.filter((v) => v !== HELD_TOKEN);
    if (values.length === 0) {
      delete csv.include;
      dropInclude = true;
    } else {
      csv.include = { ...csv.include, enumValues: values, ...(csv.include.max !== undefined ? { max: Math.min(csv.include.max, values.length) } : {}) };
    }
  }
  const optionalParams = (e.optionalParams ?? [])
    .filter((p) => !HELD_PARAMS.has(p.name) && !(dropInclude && p.name === "include"))
    .map((p) => (p.description ? { ...p, description: dropHeldSentences(p.description) } : p));
  const out: T = {
    ...e,
    description: dropHeldSentences(e.description),
    pricing: e.pricing.description ? { ...e.pricing, description: dropHeldSentences(e.pricing.description) } : e.pricing,
    optionalParams,
  };
  if (Object.keys(csv).length > 0) out.csvConstraints = csv;
  else delete out.csvConstraints;
  return out;
}

/** prism/jobs copy describes what a job item that asked include=contacts carries. */
function stripJobCopy<T extends StrippableEndpoint>(e: T): T {
  return {
    ...e,
    description: dropHeldSentences(e.description),
    ...(e.contractDetails ? { contractDetails: e.contractDetails.filter((d) => !CONTACT_WALK.test(d)) } : {}),
  };
}

/** Held copy in the guide: the contact walk (API-074) and Listening (API-063). */
const HELD_GUIDE = /include=contacts|contact_lookup|\/v1\/listening|listening\.md|listener|\(Listening\)/;

/**
 * The bundled guide (the in-repo skill's SKILL.md) with the held surfaces cut
 * out: a line that is about one goes; inside a long `; `-joined paragraph only
 * the clauses about it go.
 */
export function stripHeldGuide(markdown: string): string {
  return markdown
    .split("\n")
    .flatMap((line) => {
      if (!HELD_GUIDE.test(line)) return [line];
      const clauses = line.split("; ");
      if (clauses.length < 3 || HELD_GUIDE.test(clauses[0]!)) return [];
      return [clauses.filter((c) => !HELD_GUIDE.test(c)).join("; ")];
    })
    .join("\n");
}

/** Recipes from the codebase, without the ones built on a held surface. */
export function stripHeldRecipes<T>(recipes: T[]): T[] {
  return recipes.filter((r) => !/include=contacts|"include":"contacts"|\/v1\/listening/.test(JSON.stringify(r)));
}

/** Remove every held surface from a list of dump endpoints. Pure. */
export function stripHeldSurfaces<T extends StrippableEndpoint>(endpoints: T[]): T[] {
  return endpoints.map((e) => {
    const id = `${e.platform}/${e.resource}`;
    if (HELD_CONTACT_WALK_ENDPOINTS.has(id)) return stripContactWalk(e);
    if (e.platform === "prism" && e.resource.startsWith("jobs")) return stripJobCopy(e);
    return e;
  });
}
