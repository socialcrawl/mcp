<div align="center">

# socialcrawl-mcp

**Give your AI agent access to 42 platforms — social media, commerce & product reviews, app stores, places & travel, business reputation, web research, prediction markets, cross-platform Prism composites, and a universal cross-platform meta-search — through a single API**

[![npm](https://img.shields.io/npm/v/socialcrawl-mcp?style=flat-square&color=blue)](https://www.npmjs.com/package/socialcrawl-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-green?style=flat-square)](https://registry.modelcontextprotocol.io)
[![Platforms](https://img.shields.io/badge/Platforms-42-blue?style=flat-square)](https://socialcrawl.dev)
[![Endpoints](https://img.shields.io/badge/Endpoints-264-green?style=flat-square)](https://socialcrawl.dev/docs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![mcp MCP server](https://glama.ai/mcp/servers/socialcrawl/mcp/badges/score.svg)](https://glama.ai/mcp/servers/socialcrawl/mcp)

<a href="https://glama.ai/mcp/servers/socialcrawl/mcp">
  <img width="380" src="https://glama.ai/mcp/servers/socialcrawl/mcp/badges/card.svg" alt="Socialcrawl MCP server" />
</a>

[Overview](#overview) | [Installation](#installation) | [Setup](#setup) | [Usage](#usage) | [Tools](#available-tools) | [Platforms](#supported-platforms)

</div>

---

## Overview

`socialcrawl-mcp` is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that connects AI agents to the [SocialCrawl API](https://socialcrawl.dev) — a unified data API covering 42 platforms and 264 endpoints.

Retrieve profiles, posts, comments, search results, trending content, and analytics from TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Reddit, GitHub, Hacker News, Polymarket, and 30 more platforms. Pull products, reviews, and sellers from Amazon and Google Shopping; apps, charts, and reviews from Google Play and the Apple App Store; places, hotels, and traveler reviews from Tripadvisor and Google Business; brand reputation from Trustpilot; Korean search across 11 Naver corpora; cross-web brand mentions with sentiment via Content Analysis; Google News headlines and Google Finance quotes — plus web research via Tavily and Perplexity, AI-powered X search via Grok, and a single `/search/everywhere` endpoint that fans out across 12+ sources in one call.

New in this release: the **Prism** family — 30 server-side composite endpoints that fan out across many platforms and fold the results into one report (universal URL `lookup`, full `comments` harvesting, cross-source `reputation`, `share-of-voice`, brand-mention and consumer-demand nowcasts, AI consensus `answers`, crisis radar, creator vetting, and video/app/product intelligence). One API key, one consistent response format, every platform.

**What the MCP server does:**
- Discovers available platforms and endpoints dynamically
- Fetches live social media data on your behalf
- Validates requests locally before making API calls (saves credits)
- Provides built-in API documentation the agent can query on demand

## Installation

### npm

```bash
npm install -g socialcrawl-mcp
```

Available on [npm](https://www.npmjs.com/package/socialcrawl-mcp). Most users don't need this — the MCP client configs below use `npx` and auto-install on first run.

### Claude Code (quickest)

```bash
claude mcp add --scope user socialcrawl -- npx -y socialcrawl-mcp
```

Then set your API key:

```bash
claude mcp add-env socialcrawl SOCIALCRAWL_API_KEY sc_your_key_here
```

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

The MCP server exposes 6 tools:

| Tool | Description | Needs API key? |
|------|-------------|----------------|
| `socialcrawl_list_platforms` | Discover all 42 platforms with their endpoints and capabilities | No |
| `socialcrawl_list_endpoints` | See all endpoints, required parameters, and credit costs for a platform | No |
| `socialcrawl_request` | Make any SocialCrawl API call — profiles, posts, comments, search, analytics, Prism composites. Supports an optional `idempotencyKey` for retry-safe calls. | Yes |
| `socialcrawl_check_balance` | Check remaining credits and recent deduction summary. Calls `/v1/credits/balance` — costs 0 credits. | Yes |
| `socialcrawl_monitors` | Create and manage stateful monitors that re-run any recipe on a cadence, deliver results to a signed webhook, and accumulate a time-series. Actions: create, list, get, runs, timeseries, pause, resume, delete. | Yes |
| `socialcrawl_get_docs` | Access detailed API documentation by topic or platform | No |

Three of the six tools work without an API key — they query local bundled data. `socialcrawl_request`, `socialcrawl_check_balance`, and `socialcrawl_monitors` require a key.

### Monitors — schedule any recipe

`socialcrawl_monitors` wraps any registry endpoint or Prism composite in a scheduled, stateful monitor (`/v1/monitors/*`). It re-runs the recipe hourly/daily/weekly (or on a cron), delivers each result to an HMAC-signed webhook, raises alerts on metric thresholds or changes, and keeps a per-run time-series you can read back. *"Prism answers once; monitors watch it for you."* Managing monitors costs 0 credits; each scheduled run bills the recipe's normal cost plus a 1-credit scheduling premium. See `socialcrawl_get_docs` topic `monitors` for the full contract.

### Smart validation

Before making any API call, `socialcrawl_request` validates locally that the platform exists, the endpoint exists, and all required parameters are present. If something is wrong, it tells the agent exactly how to fix it — without consuming any credits.

### Retry-safe requests

Pass an `idempotencyKey` to `socialcrawl_request` (UUIDv4 recommended) to make the call retry-safe. If the request is replayed within 24h, the server returns the original response and deducts **0 credits** (`X-Idempotent-Replay: true`).

## Supported Platforms

| Platform | Endpoints | Data Available |
|----------|-----------|----------------|
| **Prism** | 30 | Cross-platform composites — URL lookup, comment harvesting, brand mentions, demand signals, AI visibility, crisis radar/post-mortem, reputation, share-of-voice, creator vetting, AI consensus answers, video/app/product intelligence |
| **Facebook** | 22 | Pages, posts, comments, groups, photos, reels, events, Marketplace, transcripts, full Ad Library |
| **TikTok** | 19 | Profiles, videos, comments & replies, search, trending, audience, followers, live, songs, transcripts, profile-360 |
| **YouTube** | 17 | Channels, videos, shorts, comments & replies, sponsors, playlists, community posts, search, trending, transcripts, profile-360 |
| **Instagram** | 16 | Profiles, posts, reels, comments, highlights, search, trending reels, audio reels, embed, transcripts, profile-360 |
| **GitHub** | 12 | Users, repos, issues, PRs, READMEs, releases, search, repo dossier, user profile-velocity |
| **Naver** | 12 | Korea's #1 portal — blog, news, book, encyclopedia, cafe, KiN, local, shopping, doc, image, web search, brief |
| **Google** | 10 | Web search, Ads Transparency, Business Profile (info, reviews, updates, Q&A), Travel hotels |
| **Content Analysis** | 10 | Cross-web brand mentions, sentiment, rating distributions, phrase/category trends |
| **LinkedIn** | 9 | Profiles, company pages, posts, post search, transcripts, Ad Library, profile-360 |
| **Google Play** | 8 | App search, app details, reviews, charts, listings database, reference data |
| **Apple App Store** | 8 | App search, app details, reviews, charts, listings database, reference data |
| **Twitter/X** | 8 | Profiles, tweets, communities, video transcripts, AI search via Grok, profile-360 |
| **Reddit** | 7 | Subreddits, posts, comments, search, transcripts, omni-search VoC sweep |
| **Spotify** | 6 | Artists, tracks, albums, podcasts, episodes, search |
| **TikTok Shop** | 5 | Products, reviews, listings, search, creator showcases |
| **Threads** | 5 | Profiles, posts, keyword search, user search |
| **Pinterest** | 5 | Pins, boards, search, URL save-counts |
| **Amazon** | 5 | Product search, ASIN details, reviews, sellers, shop pages |
| **Rumble** | 5 | Search, channel videos, video details, comments, transcripts |
| **Twitch** | 4 | Profiles, clips, videos, schedules |
| **Hacker News** | 4 | Story search, story, comment tree, profile |
| **Tavily** | 4 | Web search (with LLM answer), URL extraction, sitemap, full crawl |
| **Google Shopping** | 4 | Product search, product details, cross-retailer reviews, sellers |
| **Truth Social** | 3 | Profiles, posts |
| **Kwai** | 3 | Profiles, posts |
| **Bluesky** | 3 | Profiles, posts |
| **Google Finance** | 3 | Instrument quotes, markets overview, ticker search |
| **Trustpilot** | 2 | Business search, company reviews |
| **Tripadvisor** | 2 | Place search, traveler reviews |
| **Universal Search** | 2 | One query fanned out across 12+ platforms (20cr); forums lane |
| **Snapchat** | 1 | Profiles |
| **Kick** | 1 | Clips |
| **Perplexity** | 1 | Sonar web research with cited sources |
| **Polymarket** | 1 | Prediction-market research — multi-query fan-out + ranking |
| **Google News** | 1 | Real-time Google News SERP search |
| **Linktree** | 1 | Link pages |
| **Linkbio** | 1 | Link pages |
| **Linkme** | 1 | Link pages |
| **Komi** | 1 | Link pages |
| **Pillar** | 1 | Link pages |
| **Utility** | 1 | Age & gender detection |

**Total: 264 endpoints across 42 platforms.**

## Error Handling

The MCP server handles errors gracefully and gives the agent actionable guidance:

| Error | What the agent sees |
|-------|---------------------|
| Missing API key | Prompts to set `SOCIALCRAWL_API_KEY` with link to sign up |
| Invalid API key | Asks to check the key configuration |
| Insufficient credits | Shows balance and links to billing page |
| Bad platform/resource | Suggests using discovery tools to find the right endpoint |
| Missing parameters | Lists exactly what's missing with examples |
| Resource not found (404) | Reports the upstream resource doesn't exist; credits auto-refunded (BIL-01) |
| Idempotency-Key conflict (409) | Tells the agent the key was used by another account — generate a fresh one |
| Idempotency-Key payload mismatch (422) | Tells the agent the same key was reused with different params |
| Method not allowed (405) | Reminds the caller that `/v1/*` is GET-only |
| Concurrency limit (429) | Asks the caller to back off (50 concurrent/key max) |
| Upstream error (502) | Reports the failure; credits refunded automatically |
| Platform unavailable (503) | Circuit breaker open; credits refunded; retry in 30s |

## Links

- [Get Your API Key](https://socialcrawl.dev/dashboard) — 100 free credits, no credit card required
- [API Documentation](https://socialcrawl.dev/docs) — full endpoint reference, credits, and error codes
- [SocialCrawl Website](https://socialcrawl.dev)
- [npm Package](https://www.npmjs.com/package/socialcrawl-mcp)
- [MCP Registry](https://registry.modelcontextprotocol.io)
- [Getting Started Guide](docs/GETTING-STARTED.md)
- [How It Works](docs/HOW-IT-WORKS.md)
