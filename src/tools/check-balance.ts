import { makeRequest } from "../client.js";

/**
 * Calls the SEC-02 meta endpoint `GET /v1/credits/balance` (api-key auth, 0 credits).
 * Returns the wrapped envelope as a markdown-formatted string the agent can read.
 */
export async function checkBalance(): Promise<string> {
  const response = await makeRequest({ platform: "meta", resource: "credits/balance" });

  const header = [
    "## SocialCrawl Credit Balance",
    "**Endpoint:** `GET /v1/credits/balance`",
    "**Credit cost:** 0 credits (meta endpoint)",
    "",
  ].join("\n");

  if (response.startsWith("Error:")) {
    return `${header}${response}`;
  }

  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    return `${header}\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return `${header}${response}`;
  }
}
