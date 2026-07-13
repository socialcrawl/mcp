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

  const isWeb = platform === "web";
  const lines: string[] = [
    `# ${platformInfo.name} — ${endpoints.length} Endpoints`,
    "",
    `${platformInfo.description}`,
    "",
    ...(isWeb
      ? [
          "> Call these through the **`socialcrawl_web`** tool (not `socialcrawl_request`). Each row's method + path maps to a `socialcrawl_web` action — e.g. `GET /scrape` → `action: \"scrape\"`, `GET /jobs/{job_id}` → `action: \"job_get\"` with `id`.",
          "",
        ]
      : []),
    "| Method | Resource | Parameters | Credit Cost | Response Type | Description |",
    "|--------|----------|------------|-------------|---------------|-------------|",
  ];

  for (const endpoint of endpoints) {
    let paramsCell: string;
    if (endpoint.params.length > 0) {
      paramsCell = endpoint.params.map((p) => `\`${p.name}\` (${p.example})`).join(", ");
    } else if (endpoint.oneOfGroups.length > 0) {
      paramsCell = endpoint.oneOfGroups
        .map((g) => `one of ${g.map((n) => `\`${n}\``).join(", ")}`)
        .join("; ");
    } else {
      paramsCell = "*(none)*";
    }
    const cost = `${endpoint.creditCost}cr (${endpoint.creditTier})`;
    lines.push(`| ${endpoint.method} | \`${endpoint.resource}\` | ${paramsCell} | ${cost} | ${endpoint.archetype} | ${endpoint.summary} |`);
  }

  lines.push("", "## Parameter Details", "");

  for (const endpoint of endpoints) {
    const hasAnything =
      endpoint.params.length > 0 ||
      endpoint.optionalParams.length > 0 ||
      endpoint.oneOfGroups.length > 0;
    if (!hasAnything) continue;

    lines.push(`### \`${endpoint.method} ${endpoint.resource}\``);

    if (endpoint.params.length > 0) {
      const label = endpoint.method === "POST" ? "Required (JSON body unless noted):" : "Required:";
      lines.push(label);
      for (const param of endpoint.params) {
        lines.push(`- **\`${param.name}\`**: ${param.description}. Example: \`${param.example}\``);
      }
    }

    if (endpoint.oneOfGroups.length > 0) {
      for (const group of endpoint.oneOfGroups) {
        const list = group.map((n) => `\`${n}\``).join(", ");
        lines.push(`- Constraint: one of ${list} (at least one required)`);
      }
    }

    if (endpoint.optionalParams.length > 0) {
      lines.push("Optional:");
      for (const opt of endpoint.optionalParams) {
        const typeLabel =
          opt.type === "enum" && opt.enumValues
            ? `enum: ${opt.enumValues.join("|")}`
            : opt.type;
        const where = opt.in === "query" && endpoint.method !== "GET" ? " [query param]" : "";
        const desc = opt.description ? `: ${opt.description}` : "";
        lines.push(`- \`${opt.name}\` (${typeLabel})${where}${desc}`);
      }
    }

    lines.push("");
  }

  lines.push(
    isWeb
      ? "Call these through `socialcrawl_web` — pick the `action` matching the method + resource, pass parameters in `input`, and the path id (job/monitor/session) in `id`."
      : "Use `socialcrawl_request` with the platform, resource, and required parameters (POST batch endpoints take their array/object body in `body`) to make an API call.",
  );

  return lines.join("\n");
}
