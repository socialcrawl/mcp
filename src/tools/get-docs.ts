import { getDoc, getAvailableTopics } from "../data/docs.js";
import { CHARACTER_LIMIT } from "../constants.js";

export function getDocs(topic: string): string {
  const content = getDoc(topic);

  if (!content) {
    const topics = getAvailableTopics();
    return [
      `Error: Unknown topic "${topic}".`,
      "",
      "Available topics:",
      ...topics.map((t) => `- \`${t}\``),
    ].join("\n");
  }

  if (content.length <= CHARACTER_LIMIT) {
    return content;
  }

  return `${content.slice(0, CHARACTER_LIMIT)}\n\n[Documentation truncated at ${CHARACTER_LIMIT.toLocaleString()} characters. Full content is ${content.length.toLocaleString()} characters. Try a platform-specific topic for shorter docs.]`;
}
