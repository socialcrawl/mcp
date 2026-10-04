<div align="center">

# socialcrawl-mcp

**Give your AI agent access to every SocialCrawl platform and endpoint — social media, commerce, marketplaces & product reviews, retail, app stores, places, travel & local, business & software reputation, jobs & salaries, markets & finance, congressional trading disclosures, news, web research, full web scraping & browser automation, on-page SEO, prediction markets, search trends, cross-platform Prism composites, and a universal meta-search — through a single API, with exact credit pricing for every endpoint**

[![npm](https://img.shields.io/npm/v/socialcrawl-mcp?style=flat-square&color=blue)](https://www.npmjs.com/package/socialcrawl-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-green?style=flat-square)](https://registry.modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)
[![mcp MCP server](https://glama.ai/mcp/servers/socialcrawl/mcp/badges/score.svg)](https://glama.ai/mcp/servers/socialcrawl/mcp)

<a href="https://glama.ai/mcp/servers/socialcrawl/mcp">
  <img width="380" src="https://glama.ai/mcp/servers/socialcrawl/mcp/badges/card.svg" alt="Socialcrawl MCP server" />
</a>

[Installation](#installation) | [Overview](#overview) | [Setup](#setup) | [Usage](#usage) | [Tools](#available-tools) | [Platforms](#supported-platforms)

</div>

---

## Installation

### Remote server (hosted — no install)

Connect straight to the hosted Streamable HTTP endpoint — nothing to install or run:

**Claude Code** (works in the CLI *and* Claude Code on the web / cloud sandboxes)

```bash
claude mcp add --scope user --transport http socialcrawl https://mcp.socialcrawl.dev/mcp \
  --header "Authorization: Bearer sc_your_key_here"
```

**Any client that reads `.mcp.json`**

```json
{
  "mcpServers": {
    "socialcrawl": {
      "type": "http",
      "url": "https://mcp.socialcrawl.dev/mcp",
      "headers": { "Authorization": "Bearer ${SOCIALCRAWL_API_KEY}" }
    }
  }
}
```

**Cursor / Windsurf / VS Code** — choose the HTTP ("streamable-http") server type with the same URL and header. `x-api-key: sc_your_key_here` works as an alternative header.

The discovery tools (`socialcrawl_find`, `socialcrawl_endpoint`, `socialcrawl_estimate`) work without a key, so you can explore before signing up. claude.ai custom connectors (Settings → Connectors) require OAuth. An OAuth 2.1 resource-server mode is in preview and off by default (`SOCIALCRAWL_OAUTH=1`; see `docs/REMOTE-STREAMABLE-HTTP.md`); until it is enabled on the hosted server, use the header-based setup above.

Prefer running it locally? Every stdio option below works exactly as before.

### npm

```bash
npm install -g socialcrawl-mcp
```

Available on [npm](https://www.npmjs.com/package/socialcrawl-mcp). Most users don't need this — the MCP client configs below use `npx` and auto-install on first run.

### Claude Code (quickest)

```bash
claude mcp add --scope user socialcrawl -e SOCIALCRAWL_API_KEY=sc_your_key_here -- npx -y socialcrawl-mcp
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

## Overview

`socialcrawl-mcp` is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that connects AI agents to the [SocialCrawl API](https://socialcrawl.dev) — a unified data API over social, commerce, jobs, finance, research and web data. `socialcrawl_find` with no task lists every platform; `socialcrawl_account` view `freshness` shows the live counts.

Retrieve profiles, posts, comments, search results, trending content, and analytics from TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Reddit, Threads, Douyin, Xiaohongshu, Telegram, Quora, Bluesky, Apple Music, GitHub, Hacker News, Product Hunt, Polymarket, and many more platforms. Pull products, offers, price history, reviews, and sellers from Amazon, Walmart, Target, Home Depot, eBay, Klarna, AliExpress, Etsy, Sephora, H&M, Kohl's, Wayfair, Gumtree, and Google Shopping; apps, charts, and reviews from Google Play and the Apple App Store; hotels, restaurants, attractions, cruises, and traveler reviews from Tripadvisor, plus local business data from Yelp and Google Business; brand reputation from Trustpilot and software reviews from G2; job listings and salary bands from LinkedIn, Indeed, Bing, and Xing; market quotes, price history, financial statements, and options chains; US congressional trading disclosures; Korean search and Data Lab trend series from Naver; cross-web brand mentions with sentiment via Content Analysis; Google News headlines and Google Trends interest curves — plus web research via Tavily and Perplexity, AI-powered X search via Grok, on-page SEO audits, and a single `/search/everywhere` endpoint that fans out across 14 sources in one call.

New in v2.0.0: **seven tools instead of eleven** (`socialcrawl_find`, `socialcrawl_endpoint`, `socialcrawl_estimate`, `socialcrawl_request`, `socialcrawl_collect`, `socialcrawl_account`, `socialcrawl_manage`). See [Available Tools](#available-tools) for the 1.x → 2.0 mapping and [CHANGELOG.md](CHANGELOG.md) for every release.

**What the MCP server does:**
- Finds the right endpoint for a task in plain words (ranked search across every endpoint, with URLs and handles resolved), and tells the agent what data each one returns
- Fetches live data on your behalf across every platform, method, and composite
- Prices every call up front — ladder, flat, or metered band — so an agent can budget before it spends
- Validates requests locally before calling the API: required params, `oneOf` groups, enum values, integer ranges, parameter couplings, and CSV limits. A bad call fails free instead of burning credits
- Provides built-in API documentation the agent can query on demand, paged rather than truncated

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

### Shop across retailers

```
Find the cheapest 65-inch OLED TV across Amazon, Walmart, Target, and eBay
```

### Explore available endpoints

```
What social media platforms can you access?
```

```
Show me all the TikTok endpoints
```

```
Which endpoints can give me video transcripts?
```

Each is a `socialcrawl_find` call: the task in plain words, ranked across every endpoint, no platform needed.

### Learn the API from the API

```
How do I get started with SocialCrawl?
```

```
Show me exactly how to call the Prism comments endpoint
```

```
Is this MCP server's endpoint list up to date?
```

These hit `socialcrawl_endpoint` and `socialcrawl_account` and cost nothing.

### Check what something costs before running it

```
What would it cost to run a Prism brand-mentions report?
```

```
Show me everything I can call for 1 credit
```

```
Why did that last call charge me 7 credits instead of 2?
```

The first two hit `socialcrawl_estimate`; the third reads the credit ledger via `socialcrawl_account` with `view: "transactions"` and shows the deduction and refund rows for that `request_id`.

### Access documentation

```
How does the SocialCrawl credit system work?
```

```
How do I page through a list endpoint?
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

Version 2.0.0 exposes 7 tools (about 4.7k tokens of `tools/list`, down from about 12.8k for the 11 tools of 1.x):

| Tool | What it does | Needs API key? |
|------|--------------|----------------|
| `socialcrawl_find` | **Start here.** A task in plain words becomes the best endpoints (3 by default), each with the params the task already supplies (URLs and `@handles` are resolved), the params still missing, the credit cost and the exact call to make. `platform` narrows it. With no task it lists the platforms, or one platform's endpoints. Ranked by the live `/v1/utility/find` when deployed, otherwise by the bundled ranker (BM25 over id, summary, returns, use_when and tags, with a platform boost) | No |
| `socialcrawl_endpoint` | The contract for one endpoint (`id: "tiktok/post/comments"`): purpose, required and optional params, where the rows are (`rows_at`) and up to 25 response fields, cost and pricing rule, paging, measured latency and timeout, next endpoints, and a sample-response link. A platform slug returns its endpoint table; a topic (`errors`, `pricing`, `pagination`, `judgments`, `hydration`, `overview`, ...) returns that guide. Live through `/v1/utility/endpoint` when a key is set | No |
| `socialcrawl_estimate` | Exact cost before you spend: one call (`id` + the `params` you will send, `calls` for a job total, `items` for a walk) or a `plan` of calls. Uses `/v1/utility/estimate` when deployed, otherwise the bundled pricing. A platform slug returns its price table; no id returns the pricing overview | No |
| `socialcrawl_request` | Call one endpoint: `platform`, `resource`, `params` (or `body` for POST batch endpoints). Validates locally first, quotes, refuses above `max_credits`, confirms above `SOCIALCRAWL_CONFIRM_ABOVE`, and returns `structuredContent` (rows, credits, paging). `fields` / `max_items` / `format` shape the result; large pages are cut at row boundaries behind a `socialcrawl://results/<request_id>` link. An unknown platform or resource gets a did-you-mean | Yes |
| `socialcrawl_collect` | Walk a paged endpoint until `items` unique rows, the last page, or `max_credits`, in one call, with a resource link to every row as JSONL, JSON or CSV | Yes |
| `socialcrawl_account` | Free checks: `balance` (with this session's spend), `transactions` (the itemised ledger, or the receipts for one `request_id`), `status` (platform health) and `freshness` (is this server's catalogue behind the API) | Yes (except `status`) |
| `socialcrawl_manage` | Stateful work by `area` + `action`: `monitors` (scheduled recipes), `cohorts` (mention search over your own panel), `web` (scrape, search, map, extract, crawl/batch/agent jobs, change monitors, browser sessions) and `jobs` (Prism background jobs: submit, list, get). The action's fields go in `input`, the resource id in `id`; a wrong field is refused free with the rules | Yes |

**Upgrading from 1.x.** Set `SOCIALCRAWL_LEGACY_TOOLS=1` to also register the nine retired 1.x names as thin wrappers for this major version. The mapping:

| 1.x tool | 2.0 tool |
|----------|----------|
| `socialcrawl_list_platforms` | `socialcrawl_find` with no arguments |
| `socialcrawl_list_endpoints` | `socialcrawl_find` (`task` or `platform`); `socialcrawl_endpoint` for one contract |
| `socialcrawl_pricing` | `socialcrawl_estimate` |
| `socialcrawl_discover` | `socialcrawl_endpoint` (endpoint guide), `socialcrawl_find` (catalog, plan), `socialcrawl_account` (freshness, status) |
| `socialcrawl_get_docs` | `socialcrawl_endpoint` with the topic as `id` |
| `socialcrawl_check_balance` | `socialcrawl_account` (`requestId` is now `request_id`) |
| `socialcrawl_monitors` / `socialcrawl_web` / `socialcrawl_cohorts` | `socialcrawl_manage` with `area: "monitors"` / `"web"` / `"cohorts"` |
| `socialcrawl_request`, `socialcrawl_collect` | unchanged (`platform` is now a plain string with did-you-mean) |

### Discovery, live and bundled

`socialcrawl_find`, `socialcrawl_endpoint` and `socialcrawl_estimate` answer from data bundled with the server (generated from the backend registry, dump schema v4) and need no key. With a key they first ask the API's free `/v1/utility/*` routes (`find`, `resolve`, `endpoint`, `estimate`), which answer from the live registry, and fall back to the bundled answer when a route is not deployed. Every one of these is 0 credits.

**Why freshness matters.** This server ships a catalogue generated when it was built; the API keeps moving. Data calls always hit the live API and keep working, but discovery, pricing and local validation answer from that snapshot. The server checks this itself once per process and, when it is behind, adds one line to the next tool result. One free call tells you which situation you are in:

```
socialcrawl_account  view: "freshness"
```

These same endpoints are plain HTTP, so a third-party integration or a non-MCP agent framework gets the identical information with a `curl`.

### Pricing — know the cost before you spend

`socialcrawl_estimate` exists because a single number is a lie for most of the surface. SocialCrawl bills three ways:

- **Ladder** — the tier rate per request: standard 1cr, advanced 5cr, premium 10cr.
- **Flat** (some of them free) — a per-endpoint override, e.g. `/v1/search/everywhere` at 20cr flat.
- **Metered** — the charge depends on the request. An upfront ceiling is deducted and refunded down to the work actually done.

Quoting a metered endpoint's base cost understates every call: `/v1/search/news` has a 1cr base but really charges **2–62cr** — one credit per Google country leg that returns articles, plus per-article billing when the bing engine is added. The tool returns the real band, the registry's own charging rule, the parameters that move the bill, and the worst case to budget for:

```
action: "overview"   → ladder, every free endpoint, every flat override, every metered band + rule, cache TTLs, full refund matrix
action: "endpoint"   → one endpoint's price, rule, price-driving params, paging cost, worst case
action: "platform"   → a whole platform's cost table
action: "list"       → rank/filter by cost — "everything I can call for 1 credit", "the 10 most expensive endpoints"
action: "hydration"  → every include= row join: what it fills, per-row rate, row cap, fully-joined ceiling
action: "judgments"  → every judged list: free default labels/relevance, metered presets, the hold per opt-in
```

Pass the `include` you intend to send to `action: "endpoint"` and the band becomes arithmetic — the exact hold, itemised per join, using the same formula the backend's pricer runs:

```
action: "endpoint", platform: "linkedin", resource: "search/people", include: "profile", rows: 3
→ holds 22 credits (10cr page + 12cr for 3 rows of `profile`), settling anywhere down to 10
```

Or pass the exact `params` you will send (and `calls`, for a whole job). Joins, metered judgments and `max_pages` are all itemised, and `max_pages` multiplies the page, because each page walked is billed as one call:

```
action: "endpoint", platform: "youtube", resource: "search", calls: 10,
params: { query: "espresso", include: "engagement,channel", label: "mention", brand: "Acme", max_pages: "3" }
→ 1cr page + 5cr engagement + 5cr channel + 4cr label=mention = up to 15cr per page
  × 3 pages = up to 45cr per call; 10 calls = up to 450 credits held, settling to what was filled and judged
```

It also states the rules that make the real charge differ from the sticker price. Cache hits, idempotent replays, empty results, upstream failures and `dry_run=1` previews are all 0 credits; `seen=<id>` discounts each page by its share of rows you already received; `since` / `stop_at_id` end a walk at rows you already hold.

### Judgments — labels and relevance, free by default

About 50 list endpoints judge their rows for you at no extra credit. Posts carry `sponsored`, `intent` and `niche`; comments carry `sentiment`, `question`, `purchase_intent` and `complaint`; reviews carry `sentiment` and `issue`. All of these land under `computed.labels`, and the judged searches score each row's relevance to your query under `computed.relevance`. Only these add credits:

- a metered preset: `mention` (with `brand=`), `quality`, `injection` on posts; `spam`, `toxic`, `low_quality` on comments; `reports`, `incentivized` on reviews,
- `label=intent` with `offer=` (what you sell),
- `relevance=score|filter` with your own topic in `relevant_to=`.

Each holds 1 credit per started 25 rows of the page (4cr on a 100-row page) and settles to the rows judged fresh. Already-judged rows and cached pages are free. `judgments=off` turns the defaults off, and `dry_run=1` previews the cost for 0 credits. `socialcrawl_endpoint` with `id: "judgments"` is the full contract.

### Row hydration — one call instead of a page plus a lookup per row

Some lists are thin because the upstream publishes nothing else on them: a Pinterest search result has no save count, a LinkedIn reactor row no follower count, a YouTube playlist no view counts or durations. Another SocialCrawl endpoint answers each of those for one row — so those endpoints accept an `include=` token that joins every row to that sibling in the same call.

```
GET /v1/pinterest/search?query=kitchen&include=engagement      → saves, likes, comments, shares on every row
GET /v1/youtube/playlist?playlistId=PL...&include=engagement,channel
GET /v1/linkedin/search/people?keywords=cto&include=profile&limit=3
```

- **Opt-in.** No token, no join, no extra credit, no extra latency — a caller who never asks pays exactly what they always paid.
- **Billed per row actually filled.** The ceiling is held up front; a credit is kept only for a row a fresh sibling lookup filled. Rows served from the sibling's cache are free, unfillable rows are refunded, and a page that joined in full is cached whole, so an immediate repeat is 0 credits.
- **A row cap caps the bill.** `limit=3&include=profile` on LinkedIn holds 22 credits, not 50.
- **It tells you what it did.** `data.hydration` reports rows, lookups, cache hits, credits held vs kept, and milliseconds; `_warnings` carries `<token>_partial` when only some rows filled.

`socialcrawl_endpoint` with `id: "hydration"` lists every join, its price and the full contract; `socialcrawl_estimate` quotes one call with its `include`.

### Monitors — schedule any recipe

`socialcrawl_manage` with `area: "monitors"` wraps any registry endpoint or Prism composite in a scheduled, stateful monitor (`/v1/monitors/*`). It re-runs the recipe hourly/daily/weekly (or on a cron), delivers each result to an HMAC-signed webhook, raises alerts on metric thresholds or changes, and keeps a per-run time-series you can read back. *"Prism answers once; monitors watch it for you."* Managing monitors costs 0 credits; each scheduled run bills the recipe's normal cost plus a 1-credit scheduling premium. See `socialcrawl_endpoint` with `id: "monitors"` for the full contract.

### Web — scrape, crawl, browse

`socialcrawl_manage` with `area: "web"` drives the full web-scraping and browser-automation surface (the `web` platform, `/v1/web/*`) through a single `action` parameter:

- **Sync reads** — `scrape` (URL → markdown/HTML/screenshot/links), `search` (web search with page content), `map` (discover a site's URLs), `extract` (LLM structured data from a page).
- **Async jobs** — `crawl` a whole site, `batch_scrape` many URLs, or `agent` (autonomous multi-step web task); each returns a job you poll with `job_get`/`job_list`, inspect with `job_errors` (per-page failures), and stop with `job_cancel`. `crawl_preview` dry-runs a crawl's parameters for free before you pay for it.
- **Monitors** — `monitor_create`/`list`/`get`/`update`/`delete`/`checks` re-check a URL on a cadence and deliver changes to a webhook.
- **Sessions** — `session_create`/`get`/`list`, `session_execute` (run code in the live page), `session_close`.

Most of the paid web surface is metered rather than flat: a crawl holds `limit` credits and refunds every page it did not crawl; a session holds against `ttl_seconds` and settles on close. Job, monitor, and session management is 0 credits. See `socialcrawl_endpoint` with `id: "web"`, or `socialcrawl_estimate` with `id: "web"`.

### Smart validation

Before making any API call, `socialcrawl_request` mirrors the backend's own pre-billing validator against the bundled registry data: the platform and resource exist, required parameters and `oneOf` groups are satisfied, enum values are legal, integers sit inside their declared range, parameter couplings hold (`order` needs `sort`; Reddit's `timeframe` needs `sort=top`), and CSV lists are within their entry limits. A malformed call fails instantly and for free instead of costing a round trip — and an agent gets told exactly what to fix rather than looping on a call that can never succeed.

### Retry-safe requests

Pass an `idempotencyKey` to `socialcrawl_request` (UUIDv4 recommended) to make the call retry-safe. If the request is replayed within 24h, the server returns the original response and deducts **0 credits** (`X-Idempotent-Replay: true`).

## Supported Platforms

| Platform | Data Available |
|----------|----------------|
| **LinkedIn** | Profiles (single sub-resources or one-call bundles: all, complete, with-posts) & company pages (incl. lookup by domain, also-viewed, employee counts), posts & post-with-comments, reposts, reactions, comments & replies, Pulse articles with comments and reactions, people search (keyword or search-URL), company & hashtag search, similar members, profile sub-resources (experience, education, skills, position skills, certifications, followed schools/newsletters/Top Voices, last activity…), jobs (search, company jobs, jobs a member posted, hiring team, details), company insights, groups, the complete post-history archive (metered per post), transcripts, Ad Library, profile-360 |
| **Prism** | Cross-platform composites — URL lookup, comment harvesting, batch post-stats/profile/comment lookup, async background jobs of up to 5,000 items, handle-audit, name→accounts resolution (find-accounts), handle/link mentions, adverse-post screening, campaign-brief checks, hook/format lift, term earliness, a no-keyword country trend board, commenter language mix, comment-sourced buyer leads, brand mentions, demand signals, AI visibility, crisis radar/post-mortem, reputation, share-of-voice, creator vetting & creator cards, org radar, Korea gap, AI consensus answers, video/app/product intelligence |
| **Instagram** | Profiles, account transparency (profile/about), posts, reels, comments & comment replies, highlights, stories, tagged & location feeds, followers/following, similar accounts, post likers, reshare stats, one-call reels/posts feeds with share counts, engagement analytics, universal + popular-post search, reels/hashtag/profile/location/music search (reel search with creator cards via `include=creator`), on-screen text (OCR), trending, transcripts, profile-360 |
| **TikTok** | Profiles, videos, comments & replies, on-screen text extraction, keyword/hashtag/user/music search + suggestions, hashtag details, trending (global or in-country For You), TikTok's own popular-hashtag and Top Videos boards, audience, similar accounts, followers, liked videos, playlists & collections, place feeds, effects, live, songs, transcripts, Ad Library, profile-360 |
| **Facebook** | Pages, groups & group posts, posts, comments & replies, photos, reels (incl. full reels feed with view counts), events & event search, Marketplace, keyword search over posts/pages/people/videos/groups, transcripts, full Ad Library |
| **YouTube** | Channels, videos, shorts, comments & replies, sponsors, playlists & items, community posts, search (advanced + autocomplete), trending, live streams, channel contact email lookup, media files (audio/video/subtitles/thumbnails), transcripts, batch videos/channels/transcripts, profile-360 |
| **Web Scraping** | Scrape, web search, site map, LLM extract, async crawl/batch-scrape/agent jobs with per-page error feeds, change monitors, interactive browser sessions, document parse — driven by `socialcrawl_manage` (area `web`) |
| **US Congress Trades** | US Congress STOCK Act disclosures — trade feeds (all/48h/7d), members, per-politician and per-ticker stats and trades, state delegations, and the full statistics suite (party, sectors, issuers, volume, unusual activity, buy/sell ratio, late filings) |
| **Klarna** | Product details and every merchant offer, keyword search + suggestions, user and professional reviews with score overviews, price history, product comparison, category browsing with filters/keywords/buying guides, store listings |
| **Tripadvisor** | Hotels, restaurants, attractions and cruise ships — search and full detail for each, traveler reviews with owner replies, place lookup by URL, destination autocomplete, experience types |
| **Twitter/X** | Profiles, tweets and replies, tweet & user search, user media, followers, following, retweeters, communities, video transcripts, AI search via Grok, profile-360 |
| **Naver** | Korea's #1 portal — blog, news, encyclopedia, cafe, KiN, local, image, web search, errata & adult classifiers, Data Lab search-trend & shopping-insight series, brief |
| **Reddit** | Subreddits, post detail, comments, user profiles with post and comment history, keyword/comment/media search, subreddit discovery, transcripts, omni-search VoC sweep |
| **GitHub** | Users, repos, issues, PRs, READMEs, releases, search, repo dossier, user profile-velocity |
| **Gumtree** | UK classifieds — listing search and details, similar listings, seller profiles and their ads, search suggestions, trending searches, category tree with filters, location lookup |
| **Jobs** | Job search and listing detail across LinkedIn, Indeed, Bing and Xing, LinkedIn organization-id resolution, and salary ranges by title and country |
| **Sephora** | Product details, reviews, keyword search + suggestions, category tree browsing, brand listings and per-brand products, store lookup, per-SKU in-store availability |
| **Content Analysis** | Cross-web brand mentions, sentiment, rating distributions, phrase/category trends |
| **Google** | Web search, Ads Transparency, Business Profile (info, reviews, updates, Q&A), Travel hotels |
| **AliExpress** | Product details, keyword search, similar products, reviews, per-SKU shipping, hot products, featured promotions, category tree |
| **Apple App Store** | App search, search suggestions, app details, reviews, charts, listings database, reference data |
| **Google Play** | App search, search suggestions, app details, reviews, charts, listings database, reference data |
| **Amazon** | Product search, ASIN details, reviews, sellers, shop pages, Best Sellers charts, current deals, seller profiles — ~13 marketplaces |
| **Douyin** | China's TikTok — video search, creator profiles and feeds, video detail, comments and comment replies, creator search, hot-search board (mostly metered per row) |
| **Finance** | Instrument quotes, ticker search, markets overview, instrument news, daily price history, company financial statements, options chains |
| **G2** | Software marketplace — product pages, reviews, category listings and the category index, vendor profiles and their catalogue, product URL index |
| **Quora** | Question search and detail, answer search, Space post search, profile search, Space/topic search |
| **H&M** | Keyword search + suggestions, store listings by country, countries/languages, category tree, per-product supplier and factory disclosure |
| **Pinterest** | Pins, boards, user boards, search, Pinterest Trends by country, URL save-counts |
| **Spotify** | Artists, tracks, albums, podcasts, episodes, search |
| **Threads** | Profiles, posts, post comments, keyword search, user search |
| **Utility** | Free API self-discovery — quickstart, endpoint catalogue, per-endpoint usage guide, cross-cutting capabilities index, plain-words call planner, LLM context payload. 0 credits, served from the live registry. Behind `socialcrawl_find`, `socialcrawl_endpoint`, `socialcrawl_estimate` and `socialcrawl_account` |
| **Xiaohongshu** | RED / Little Red Book — note search, hot-search board, creator profiles and their notes, note detail, top-level comments (5cr per returned row) |
| **Apple Music** | Catalog search, artist, album, track, per-country charts (songs, albums, music videos, playlists) |
| **Google Shopping** | Product search, product details, price history, cross-retailer reviews, per-seller offers |
| **Kohl's** | Keyword search, reviews, product questions and answers, store lookup, category tree |
| **Rumble** | Search, channel videos, video details, comments, transcripts |
| **Target** | Product details by TCIN, reviews, category browsing, full taxonomy, store lookup |
| **TikTok Shop** | Products, reviews, listings, search, creator showcases |
| **Universal Search** | One query fanned out across many platforms (20cr flat); `multi` — each named platform's own native search in one call at the sum of their page prices; forums lane; multi-country news lane (metered); creator-discovery lane across TikTok/Threads/Instagram |
| **Walmart** | Product details, reviews, keyword search, category browsing, seller offers |
| **Yelp** | Business profiles by encid, business reviews, business search (compact and full-card), search suggestions |
| **Bluesky** | Profiles, user posts, post details, keyword post search |
| **Etsy** | Listings by id or URL, a shop's catalogue, similar listings, search suggestions |
| **Hacker News** | Story search, story, comment tree, profile |
| **Home Depot** | Keyword search, product details by item id or URL (store/zip-aware pricing), reviews, store lookup by ZIP |
| **Tavily** | Web search (with LLM answer), URL extraction, sitemap, full crawl |
| **Twitch** | Profiles, clips, videos, schedules |
| **Google Trends** | Interest-over-time (explore), rising/breakout related queries, and Trending Now by location |
| **Kwai** | Profiles, posts |
| **Telegram** | Public channel profiles, channel post feeds, single post lookup |
| **Truth Social** | Profiles, posts |
| **Wayfair** | Product search, product details by SKU, reviews |
| **eBay** | Listing search incl. sold/completed with realised prices, listing details |
| **Snapchat** | Profiles, Spotlight comments |
| **Trustpilot** | Business search, company reviews |
| **Google News** | Real-time Google News SERP search |
| **Kick** | Clips |
| **Komi** | Link pages |
| **LinkBio** | Link pages |
| **LinkMe** | Link pages |
| **Linktree** | Link pages |
| **On-Page** | Single-URL on-page SEO audit — the technical, content and meta checks in one call |
| **Perplexity** | Sonar web research with cited sources |
| **Pillar** | Link pages |
| **Polymarket** | Prediction-market research — multi-query fan-out + ranking |
| **Product Hunt** | Current Product Hunt launches (~50 per page), optionally by topic |

`socialcrawl_find` with no task lists every platform with its live endpoint count.

## Error Handling

The MCP server handles errors gracefully and gives the agent actionable guidance. Every API error passes the server's own `error.message` through, followed by `reason: …` when the API names one and `request_id: req-…` on its own line (read from the body, or the `X-Request-Id` header when the body is not JSON). Quote the `request_id` when you report a problem: it is how a call is found in the logs and the credit ledger.

| Error | What the agent sees |
|-------|---------------------|
| Missing API key | Prompts to set `SOCIALCRAWL_API_KEY` with link to sign up |
| Invalid API key | Asks to check the key configuration |
| Insufficient credits | Shows balance and links to billing page |
| Bad platform/resource | Suggests using discovery tools to find the right endpoint |
| Missing parameters | Lists exactly what's missing with examples — caught locally, before billing |
| Invalid parameter value | Names the illegal enum value, out-of-range integer, broken coupling, or over-long CSV — caught locally, before billing |
| Resource not found (404) | The server's reason the item is missing (e.g. `reason: video_gone`) and whether you were charged (BIL-01) |
| Idempotency-Key conflict (409) | Tells the agent the key was used by another account — generate a fresh one |
| Idempotency-Key payload mismatch (422) | Tells the agent the same key was reused with different params |
| Method not allowed (405) | Reports the wrong HTTP method for that route |
| Payload too large (413) | Request body over the JSON size cap; rejected before parse |
| Rate limited (429) | Over the 600 req/min per-key window — unbilled; back off and retry |
| Concurrency limit (429) | Asks the caller to back off (50 concurrent/key max) |
| Key budget exceeded (402) | This key's own spend cap is spent while the account still has credits — raise the cap, don't top up |
| Upstream error (502) | The server's account of which platform failed, the refund, and when to retry |
| Platform unavailable (503) | The server's cause (circuit breaker open or upstream throttling) and retry hint; credits refunded |

## Links

- [Get Your API Key](https://socialcrawl.dev/dashboard) — 100 free credits, no credit card required
- [API Documentation](https://socialcrawl.dev/docs) — full endpoint reference, credits, and error codes
- [SocialCrawl Website](https://socialcrawl.dev)
- [npm Package](https://www.npmjs.com/package/socialcrawl-mcp)
- [MCP Registry](https://registry.modelcontextprotocol.io)
- [Getting Started Guide](docs/GETTING-STARTED.md)
- [How It Works](docs/HOW-IT-WORKS.md)
