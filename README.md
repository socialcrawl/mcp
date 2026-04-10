<div align="center">

# socialcrawl-mcp

**Give your AI agent access to 21 social media platforms through a single API**

[![npm](https://img.shields.io/npm/v/socialcrawl-mcp?style=flat-square&color=blue)](https://www.npmjs.com/package/socialcrawl-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-green?style=flat-square)](https://registry.modelcontextprotocol.io)
[![Platforms](https://img.shields.io/badge/Platforms-21-blue?style=flat-square)](https://socialcrawl.dev)
[![Endpoints](https://img.shields.io/badge/Endpoints-105-green?style=flat-square)](https://socialcrawl.dev/docs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Overview](#overview) | [Installation](#installation) | [Setup](#setup) | [Usage](#usage) | [Tools](#available-tools) | [Platforms](#supported-platforms)

</div>

---

## Overview

`socialcrawl-mcp` is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that connects AI agents to the [SocialCrawl API](https://socialcrawl.dev) — a unified social media data API covering 21 platforms and 105 endpoints.

Retrieve profiles, posts, comments, search results, trending content, and analytics from TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Reddit, and 15 more platforms. One API key, one consistent response format, every platform.

**What the MCP server does:**
- Discovers available platforms and endpoints dynamically
- Fetches live social media data on your behalf
- Validates requests locally before making API calls (saves credits)
- Provides built-in API documentation the agent can query on demand

## Installation

Add the SocialCrawl MCP server to your AI client's configuration. Pick the one you use:

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "socialcrawl": {
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "sc_your_key_here"
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
        "SOCIALCRAWL_API_KEY": "sc_your_key_here"
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
        "SOCIALCRAWL_API_KEY": "sc_your_key_here"
      }
    }
  }
}
```

### Windsurf

Add to your Windsurf MCP configuration:

```json
{
  "mcpServers": {
    "socialcrawl": {
      "command": "npx",
      "args": ["-y", "socialcrawl-mcp"],
      "env": {
        "SOCIALCRAWL_API_KEY": "sc_your_key_here"
      }
    }
  }
}
```

### Other MCP-compatible clients

Any MCP client that supports stdio transport can use this server. The general pattern is:

- **Command:** `npx`
- **Args:** `["-y", "socialcrawl-mcp"]`
- **Environment:** `SOCIALCRAWL_API_KEY` set to your API key

Restart your AI client after saving the configuration.

## Setup

### 1. Get your API key

Sign up at [socialcrawl.dev](https://socialcrawl.dev) and grab your API key from the dashboard. Every account starts with **100 free credits** — no credit card required.

### 2. Add the key to your config

Replace `sc_your_key_here` in the installation config above with your actual API key (starts with `sc_`).

> [!TIP]
> You can also set `SOCIALCRAWL_API_KEY` as a system environment variable instead of putting it in the MCP config. The discovery and documentation tools work even without a key — only actual API requests need one.

## Usage

Ask your AI agent in natural language. The MCP server handles the rest.

### Fetch a profile

```
Get the TikTok profile for @charlidamelio
```

The agent calls `socialcrawl_request` with `platform: "tiktok"`, `resource: "profile"`, `params: { handle: "charlidamelio" }` and returns structured profile data including followers, bio, verification status, and engagement metrics.

### Search across platforms

```
Search YouTube for "machine learning tutorials"
```

### Get post comments

```
Get the comments on this Instagram post: https://instagram.com/p/CwA1234abcd
```

### Cross-platform research

```
Compare the follower counts of @mkbhd on TikTok, Instagram, YouTube, and Twitter
```

The agent makes 4 sequential API calls — one per platform — and compiles the results into a comparison.

### Explore available endpoints

```
What social media platforms can you access?
```

```
Show me all the TikTok endpoints
```

### Access documentation

```
How does the SocialCrawl credit system work?
```

### Example response

Every response follows a unified envelope format:

```json
{
  "success": true,
  "platform": "tiktok",
  "endpoint": "/v1/tiktok/profile",
  "data": {
    "content": { "text": "...", "media_urls": ["..."] },
    "author": { "username": "charlidamelio", "followers": 156000000 },
    "engagement": { "likes": 5200, "engagement_rate": 0.045 },
    "metadata": { "language": "en", "content_category": "entertainment" }
  },
  "credits_used": 1,
  "credits_remaining": 99
}
```

> [!NOTE]
> The same response structure is returned for every platform — no per-platform parsing logic needed.

## Available Tools

The MCP server exposes 4 tools:

| Tool | Description | Needs API key? |
|------|-------------|----------------|
| `socialcrawl_list_platforms` | Discover all 21 platforms with their endpoints and capabilities | No |
| `socialcrawl_list_endpoints` | See all endpoints, required parameters, and credit costs for a platform | No |
| `socialcrawl_request` | Make any SocialCrawl API call — profiles, posts, comments, search, analytics | Yes |
| `socialcrawl_get_docs` | Access detailed API documentation by topic or platform | No |

Three of the four tools work without an API key — they query local bundled data. Only `socialcrawl_request` (which makes actual API calls) requires a key.

### Smart validation

Before making any API call, `socialcrawl_request` validates locally that the platform exists, the endpoint exists, and all required parameters are present. If something is wrong, it tells the agent exactly how to fix it — without consuming any credits.

## Supported Platforms

| Platform | Endpoints | Data Available |
|----------|-----------|----------------|
| **TikTok** | 24 | Profiles, videos, comments, followers, search, trending, live, Shop |
| **Instagram** | 12 | Profiles, posts, reels, comments, highlights, search |
| **YouTube** | 11 | Channels, videos, shorts, playlists, comments, trending |
| **Facebook** | 12 | Profiles, posts, reels, photos, groups, Ad Library |
| **Twitter/X** | 6 | Profiles, tweets, communities |
| **LinkedIn** | 6 | Profiles, company pages, posts, Ad Library |
| **Reddit** | 7 | Subreddits, posts, comments, search, ads |
| **Threads** | 5 | Profiles, posts, search |
| **Pinterest** | 4 | Search, pins, boards |
| **Google** | 4 | Search, Ad Library |
| **Truth Social** | 3 | Profiles, posts |
| **Twitch** | 2 | Profiles, clips |
| **Snapchat** | 1 | Profiles |
| **Kick** | 1 | Clips |
| **Amazon** | 1 | Shop pages |
| **Linktree** | 1 | Link pages |
| **Linkbio** | 1 | Link pages |
| **Linkme** | 1 | Link pages |
| **Komi** | 1 | Link pages |
| **Pillar** | 1 | Link pages |
| **Utility** | 1 | Age & gender detection |

**Total: 105 endpoints across 21 platforms.**

## Error Handling

The MCP server handles errors gracefully and gives the agent actionable guidance:

| Error | What the agent sees |
|-------|---------------------|
| Missing API key | Prompts to set `SOCIALCRAWL_API_KEY` with link to sign up |
| Invalid API key | Asks to check the key configuration |
| Insufficient credits | Shows balance and links to billing page |
| Bad platform/resource | Suggests using discovery tools to find the right endpoint |
| Missing parameters | Lists exactly what's missing with examples |
| Platform unavailable | Reports the outage; credits are refunded automatically |

## Links

- [Get Your API Key](https://socialcrawl.dev/dashboard) — 100 free credits, no credit card required
- [API Documentation](https://socialcrawl.dev/docs) — full endpoint reference, credits, and error codes
- [SocialCrawl Website](https://socialcrawl.dev)
- [npm Package](https://www.npmjs.com/package/socialcrawl-mcp)
- [MCP Registry](https://registry.modelcontextprotocol.io)
- [Getting Started Guide](docs/GETTING-STARTED.md)
- [How It Works](docs/HOW-IT-WORKS.md)
