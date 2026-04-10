# socialcrawl-mcp

[![npm version](https://img.shields.io/npm/v/socialcrawl-mcp.svg)](https://www.npmjs.com/package/socialcrawl-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for SocialCrawl — access 21+ social media platforms through one unified API.

## What it does

SocialCrawl MCP gives AI agents instant access to 21 social media platforms and 105 endpoints through a single, unified API. Retrieve profiles, posts, comments, search results, trending content, and analytics from TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Reddit, and more — no per-platform authentication required. Agents discover available endpoints dynamically, so they always work with the latest capabilities without any hardcoded platform logic.

## Quick Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "socialcrawl": {
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "socialcrawl": {
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### VS Code (Claude Code)

Add to `.vscode/mcp.json` in your project or your user settings:

```json
{
  "servers": {
    "socialcrawl": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## Get Your API Key

1. Sign up at [socialcrawl.com](https://socialcrawl.com) — no credit card required
2. Receive 100 free credits instantly upon registration
3. Copy your API key from the dashboard and paste it into your config

## Available Tools

| Tool | Description |
|------|-------------|
| `socialcrawl_list_platforms` | Discover all 21 supported platforms with their slugs and endpoint counts |
| `socialcrawl_list_endpoints` | See all endpoints, required parameters, and credit costs for a specific platform |
| `socialcrawl_request` | Make any SocialCrawl API call — fetch profiles, posts, comments, search results, and more |
| `socialcrawl_get_docs` | Access detailed API documentation for a platform or specific endpoint |

## Example

**User prompt:** "Get the TikTok profile for charlidamelio"

**Agent flow:**

1. Calls `socialcrawl_list_endpoints` with `platform: "tiktok"` to discover available endpoints
2. Finds `user/info` endpoint — takes a `username` parameter, costs 1 credit
3. Calls `socialcrawl_request` with `platform: "tiktok"`, `endpoint: "user/info"`, `params: { username: "charlidamelio" }`
4. Returns profile data: follower count, bio, video count, verification status, and more

## Supported Platforms

| Platform | Endpoints |
|----------|-----------|
| TikTok | 24 |
| Instagram | 12 |
| YouTube | 11 |
| Facebook | 12 |
| X (Twitter) | 6 |
| LinkedIn | 6 |
| Reddit | 7 |
| Threads | 5 |
| Pinterest | 4 |
| Google | 4 |
| Truth Social | 3 |
| Twitch | 2 |
| Snapchat | 1 |
| Kick | 1 |
| Amazon | 1 |
| Linktree | 1 |
| Linkbio | 1 |
| Linkme | 1 |
| Komi | 1 |
| Pillar | 1 |
| Utility | 1 |

**Total: 105 endpoints across 21 platforms**

## Credit System

| Tier | Cost | Share of Endpoints |
|------|------|--------------------|
| Standard | 1 credit | ~90% |
| Advanced | 5 credits | ~8% |
| Premium | 10 credits | ~2% |

New accounts receive 100 free credits — enough to make 100 standard requests or explore multiple platforms before committing to a paid plan.

## License

MIT — see [LICENSE](LICENSE) for details.
