import { findPlatform } from "../data/platforms.js";
import { findEndpoint } from "../data/endpoints.js";
import { makeRequest } from "../client.js";

interface RequestParams {
  platform: string;
  resource: string;
  params?: Record<string, string>;
}

export async function request(input: RequestParams): Promise<string> {
  const platform = findPlatform(input.platform);
  if (!platform) {
    return `Error: Unknown platform "${input.platform}". Use socialcrawl_list_platforms to see available platforms.`;
  }

  const endpoint = findEndpoint(input.platform, input.resource);
  if (!endpoint) {
    return `Error: Unknown resource "${input.resource}" for platform "${input.platform}". Use socialcrawl_list_endpoints with platform "${input.platform}" to see available endpoints.`;
  }

  const providedParams = input.params ?? {};
  const missingParams = endpoint.params
    .filter((p) => p.required && !providedParams[p.name])
    .map((p) => `\`${p.name}\` (e.g., "${p.example}")`);

  if (missingParams.length > 0) {
    return `Error: Missing required parameter(s): ${missingParams.join(", ")}. Use socialcrawl_list_endpoints with platform "${input.platform}" for full parameter details.`;
  }

  const response = await makeRequest({
    platform: input.platform,
    resource: input.resource,
    params: input.params,
  });

  const header = [
    `## SocialCrawl API Response`,
    `**Endpoint:** \`GET /v1/${input.platform}/${input.resource}\``,
    `**Credit cost:** ${endpoint.creditCost} (${endpoint.creditTier})`,
    "",
  ].join("\n");

  if (response.startsWith("Error:")) {
    return `${header}${response}`;
  }

  try {
    const parsed = JSON.parse(response) as Record<string, unknown>;
    const formatted = JSON.stringify(parsed, null, 2);
    return `${header}\`\`\`json\n${formatted}\n\`\`\``;
  } catch {
    return `${header}${response}`;
  }
}
