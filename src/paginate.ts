import { CHARACTER_LIMIT } from "./constants.js";

/**
 * Page long tool output instead of truncating it.
 *
 * Truncation silently drops content with no way to reach it: LinkedIn's 44
 * endpoints and the `full` docs reference both run well past the response
 * character limit, and the old "try a narrower topic" advice had no answer when
 * the topic WAS already the narrowest one. Paging keeps every endpoint and every
 * parameter reachable, at the cost of one extra call.
 */

/** Split at line boundaries so a page never ends mid-row or mid-code-fence. */
export function paginate(content: string, limit = CHARACTER_LIMIT): string[] {
  if (content.length <= limit) return [content];

  const pages: string[] = [];
  let current = "";
  for (const line of content.split("\n")) {
    // +1 for the newline we are about to add.
    if (current.length + line.length + 1 > limit && current.length > 0) {
      pages.push(current);
      current = "";
    }
    current += (current.length > 0 ? "\n" : "") + line;
    // A single line longer than the limit (never expected, but possible for a
    // pathological description) still has to be emitted rather than looping.
    if (current.length > limit) {
      pages.push(current);
      current = "";
    }
  }
  if (current.length > 0) pages.push(current);
  return pages;
}

/**
 * Return one page of `content` with a footer telling the caller how to reach
 * the rest. `hint` describes the call that fetches the next page.
 */
export function page(content: string, requested: number, hint: (next: number) => string): string {
  const pages = paginate(content);
  const total = pages.length;
  const index = Math.min(Math.max(Math.floor(requested), 1), total);
  const body = pages[index - 1];

  if (total === 1) return body;

  return index < total
    ? `${body}\n\n[Page ${index} of ${total}. ${hint(index + 1)}]`
    : `${body}\n\n[Page ${index} of ${total} — end.]`;
}
