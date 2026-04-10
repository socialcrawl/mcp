import { findPlatform } from "../data/platforms.js";
import { getEndpointsByPlatform } from "../data/endpoints.js";

export function listEndpoints(platform: string): string {
  const platformInfo = findPlatform(platform);
  if (!platformInfo) {
    return `Error: Unknown platform "${platform}". Use socialcrawl_list_platforms to see available platforms.`;
  }

  const endpoints = getEndpointsByPlatform(platform);
  if (endpoints.length === 0) {
    return `Error: No endpoints found for platform "${platform}".`;
  }

  const lines: string[] = [
    `# ${platformInfo.name} — ${endpoints.length} Endpoints`,
    "",
    `${platformInfo.description}`,
    "",
    "| Resource | Parameters | Credit Cost | Response Type | Description |",
    "|----------|------------|-------------|---------------|-------------|",
  ];

  for (const endpoint of endpoints) {
    const params = endpoint.params.length > 0
      ? endpoint.params.map((p) => `\`${p.name}\` (${p.example})`).join(", ")
      : "*(none)*";
    const cost = `${endpoint.creditCost}cr (${endpoint.creditTier})`;
    lines.push(`| \`${endpoint.resource}\` | ${params} | ${cost} | ${endpoint.archetype} | ${endpoint.summary} |`);
  }

  lines.push(
    "",
    "## Parameter Details",
    "",
  );

  for (const endpoint of endpoints) {
    if (endpoint.params.length === 0) continue;
    lines.push(`### \`${endpoint.resource}\``);
    for (const param of endpoint.params) {
      lines.push(`- **\`${param.name}\`** (${param.required ? "required" : "optional"}): ${param.description}. Example: \`${param.example}\``);
    }
    lines.push("");
  }

  lines.push(
    "Use `socialcrawl_request` with the platform, resource, and required parameters to make an API call.",
  );

  return lines.join("\n");
}
