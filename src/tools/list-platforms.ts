import { PLATFORMS } from "../data/platforms.js";

export function listPlatforms(): string {
  const lines: string[] = [
    "# SocialCrawl — Supported Platforms",
    "",
    `${PLATFORMS.length} platforms, ${PLATFORMS.reduce((sum, p) => sum + p.endpointCount, 0)} total endpoints.`,
    "",
    "| Platform | Slug | Endpoints | Data Available |",
    "|----------|------|-----------|----------------|",
  ];

  for (const platform of PLATFORMS) {
    lines.push(`| ${platform.name} | \`${platform.slug}\` | ${platform.endpointCount} | ${platform.description} |`);
  }

  lines.push(
    "",
    "Use `socialcrawl_list_endpoints` with a platform slug to see available endpoints and required parameters.",
  );

  return lines.join("\n");
}
