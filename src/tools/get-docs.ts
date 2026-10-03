import { getDoc, getAvailableTopics, FIXED_TOPICS } from "../data/docs.js";
import { PLATFORMS } from "../data/platforms.js";
import { page } from "../paginate.js";

/**
 * Documentation reader. Long topics (`full` is ~300k characters, and the
 * biggest platforms exceed the response limit on their own) are PAGED rather
 * than truncated — see `src/paginate.ts` for why.
 */
export function getDocs(
  topic: string,
  pageNumber = 1,
  nextHint: (next: number) => string = (next) =>
    `Call socialcrawl_endpoint again with id "${topic}" and page ${next} for the next part.`,
): string {
  const content = getDoc(topic);

  if (!content) {
    const platformSlugs = PLATFORMS.map((p) => p.slug);
    return [
      `Error: Unknown topic "${topic}".`,
      "",
      "Guides:",
      ...FIXED_TOPICS.map((t) => `- \`${t}\``),
      "",
      `Platform topics (${platformSlugs.length}):`,
      platformSlugs.map((t) => `\`${t}\``).join(", "),
    ].join("\n");
  }

  return page(content, pageNumber, nextHint);
}

export { getAvailableTopics };
