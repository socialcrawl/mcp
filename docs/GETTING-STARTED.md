# Getting Started with SocialCrawl MCP

A step-by-step guide to using the SocialCrawl MCP server with your AI agent.

---

## What You Get

Once installed, your AI agent gains 4 tools that let it interact with 21 social media platforms:

- **Discover** what platforms and endpoints are available
- **Fetch** profiles, posts, comments, search results, trending content, and analytics
- **Read** detailed API documentation on demand

All data comes back in a clean, unified format — the same response structure whether you're querying TikTok, Instagram, YouTube, or any other platform.

---

## Step 1: Get Your API Key

1. Go to [socialcrawl.dev](https://socialcrawl.dev) and create an account
2. You'll receive **100 free credits** instantly (no credit card required)
3. Navigate to your dashboard and copy your API key — it starts with `sc_`

---

## Step 2: Install the MCP Server

Add the SocialCrawl MCP to your AI client's configuration. Pick the one you use:

### Claude Desktop

Open your config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add:

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

Add to `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):

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

Restart your AI client after saving the config. The SocialCrawl tools will appear in the tool list.

---

## Step 3: Start Using It

Just ask your AI agent in natural language. Here are practical examples:

### Fetch a profile

> "Get the TikTok profile for charlidamelio"

The agent will call `socialcrawl_request` with `platform: "tiktok"`, `resource: "profile"`, `params: { handle: "charlidamelio" }` and return structured profile data — followers, bio, verification status, engagement metrics.

### Search across platforms

> "Search YouTube for 'machine learning tutorials'"

The agent calls `socialcrawl_request` with `platform: "youtube"`, `resource: "search"`, `params: { query: "machine learning tutorials" }`.

### Get post comments

> "Get the comments on this Instagram post: https://instagram.com/p/ABC123"

The agent calls `socialcrawl_request` with `platform: "instagram"`, `resource: "post/comments"`, `params: { url: "https://instagram.com/p/ABC123" }`.

### Explore what's available

> "What social media platforms can you access?"

The agent calls `socialcrawl_list_platforms` and shows all 21 platforms with endpoint counts.

> "Show me all the TikTok endpoints"

The agent calls `socialcrawl_list_endpoints` with `platform: "tiktok"` and returns all 24 endpoints with their required parameters and credit costs.

### Cross-platform research

> "Compare the follower counts of @mkbhd on TikTok, Instagram, YouTube, and Twitter"

The agent makes 4 sequential `socialcrawl_request` calls — one per platform — and compiles the results.

### Access documentation

> "How does the credit system work?"

The agent calls `socialcrawl_get_docs` with `topic: "credits"` and returns the pricing and tier documentation.

---

## Understanding the 4 Tools

### `socialcrawl_list_platforms`

**When to use:** When you (or the agent) need to know what platforms are available.

**Input:** None.

**Output:** A table of all 21 platforms with their slug, endpoint count, and description of available data.

**No API key required.** This queries local bundled data.

---

### `socialcrawl_list_endpoints`

**When to use:** When you need to know what endpoints exist for a specific platform, what parameters they require, and how many credits they cost.

**Input:**
- `platform` (required) — the platform slug, e.g., `"tiktok"`, `"instagram"`, `"youtube"`

**Output:** A table of all endpoints for that platform, including resource path, required parameters with examples, credit tier, and response type.

**No API key required.** This queries local bundled data.

---

### `socialcrawl_request`

**When to use:** To actually fetch social media data.

**Input:**
- `platform` (required) — platform slug
- `resource` (required) — the endpoint resource path (e.g., `"profile"`, `"post/comments"`, `"search"`)
- `params` (optional) — query parameters as key-value pairs (e.g., `{ "handle": "charlidamelio" }`)

**Output:** The full SocialCrawl API response with social media data, credit usage, and cache status.

**Requires API key.** This makes a real HTTP request to the SocialCrawl API.

**Smart validation:** Before making the API call, the tool validates that:
1. The platform exists
2. The endpoint exists for that platform
3. All required parameters are present

If validation fails, it tells the agent exactly what's wrong and what tool to use to fix it — without consuming any credits.

---

### `socialcrawl_get_docs`

**When to use:** When the agent needs more context about the API — authentication, credit system, error handling, or platform-specific documentation.

**Input:**
- `topic` (optional, defaults to `"overview"`) — one of:
  - `"overview"` — compact API introduction
  - `"full"` — comprehensive reference (all endpoints, all parameters)
  - `"authentication"` — how API keys work
  - `"credits"` — credit tiers and pricing
  - `"errors"` — error codes and what they mean
  - Any platform slug (e.g., `"tiktok"`) — platform-specific endpoint reference

**Output:** Markdown documentation for the requested topic.

**No API key required.** This returns bundled documentation.

---

## How Credits Work

Every API request costs credits. Most endpoints cost **1 credit** (Standard tier).

| Tier | Cost | What it covers |
|------|------|----------------|
| Standard | 1 credit | Profiles, posts, comments, search (~90% of endpoints) |
| Advanced | 5 credits | Trending feeds, audience demographics, ad libraries |
| Premium | 10 credits | AI transcripts, age/gender detection |

- You get **100 free credits** on signup
- Credits **never expire**
- No rate limits — your credit balance is the only throttle
- If a request fails due to an upstream error, credits are **automatically refunded**

Every response includes `credits_used` and `credits_remaining` so the agent always knows the current balance.

---

## Error Handling

The MCP handles errors gracefully and gives the agent actionable guidance:

| Error | What the agent sees |
|-------|---------------------|
| Missing API key | "No API key configured. Set SOCIALCRAWL_API_KEY..." |
| Invalid API key | "Invalid API key. Check your SOCIALCRAWL_API_KEY configuration." |
| Insufficient credits | "Insufficient credits (X remaining). Top up at socialcrawl.dev/billing." |
| Bad platform/resource | "Unknown platform/resource. Use socialcrawl_list_endpoints to see available endpoints." |
| Missing parameters | "Missing required parameter: handle. This endpoint requires: handle." |
| Platform down | "Platform temporarily unavailable. Try again shortly." |
| Upstream error | "Upstream error fetching data. Credits have been auto-refunded." |

The agent can self-correct from most errors by calling `socialcrawl_list_platforms` or `socialcrawl_list_endpoints` to discover the right platform, endpoint, or parameters.

---

## Tips

- **Start with discovery.** If you're unsure what data is available, ask the agent to list platforms and endpoints first.
- **Use platform slugs.** The API uses lowercase slugs: `tiktok`, `instagram`, `youtube`, `twitter`, `linkedin`, `reddit`, `threads`, `facebook`, `pinterest`, `google`, `twitch`, `truthsocial`, `snapchat`, `kick`, `amazon`, `linktree`, `linkbio`, `linkme`, `komi`, `pillar`, `utility`.
- **Check credit costs before bulk operations.** Ask the agent to show endpoint details so you know the per-call cost before running a batch.
- **Cross-platform queries work naturally.** The unified response format means the agent can compare data across platforms without special handling.
- **The `full` docs topic is comprehensive.** If the agent needs a complete reference of every endpoint and parameter, `socialcrawl_get_docs(topic: "full")` gives it everything.
