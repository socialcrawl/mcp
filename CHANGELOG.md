# Changelog

All notable changes to `socialcrawl-mcp` are documented here. The format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-05-05

Adds 6 new platforms and 25 new endpoints, bringing total coverage to
**27 platforms / 133 endpoints**. Mirrors the backend additions shipped
on 2026-04-28.

### Added

- **GitHub** (12 endpoints) — `profile`, `profile/repos`, `repo`,
  `repo/readme`, `repo/releases`, `repo/issues`, `issue`,
  `issue/comments`, `search`, plus three server-side composite endpoints
  (`repo/top-issues` 5cr, `repo/dossier` 5cr, `user/profile-velocity`
  10cr). Backed by the official GitHub REST API.
- **Hacker News** (4 endpoints) — `search`, `story`, `story/comments`,
  `profile`. Backed by the public Algolia HN API; no upstream auth.
- **Polymarket** (2 endpoints) — `search` (1cr) and `research` (5cr,
  multi-query fan-out + ranking).
- **Tavily** (4 endpoints) — `search` (with optional LLM-synthesised
  answer), `extract`, `map`, `crawl`. All standard tier.
- **Perplexity** (1 endpoint) — `research` via Sonar with cited sources.
- **Universal Search** (1 endpoint) — `GET /v1/search/everywhere`. Fans
  one query out across 12 platforms in parallel with LLM-planned,
  RRF-fused, LLM-reranked results. Flat **20 credits** per call (the
  first endpoint to override the 1/5/10 tier ladder).
- **Twitter `ai-search`** — natural-language X search via xAI Grok with
  `from_handles` / `exclude_handles` / `from_date` / `to_date` filters.
  Returns `{ answer, sources, tool_calls_count }`. Twitter platform now
  has 7 endpoints (was 6).

### Changed

- README, badges, and platform table updated to reflect 27 platforms /
  133 endpoints.
- `server.json` and `package.json` descriptions broadened to mention web
  research, prediction markets, and universal meta-search.
- `getDoc("credits")` now documents the flat 20cr `search/everywhere`
  override.
- `data-integrity.test.ts` adjusted: platform count → 27, endpoint count
  → 133, allowed credit costs include 20 for the universal-search
  override.

### Notes

- Streaming SSE on `/v1/search/everywhere` is not exposed through the
  MCP tool — the `socialcrawl_request` tool always reads JSON. Agents
  who want live chunks should call the HTTP endpoint directly with
  `Accept: text/event-stream`.
- No new MCP tool was added; the new endpoints flow through the
  existing `socialcrawl_request` tool. They are discoverable via
  `socialcrawl_list_platforms` / `socialcrawl_list_endpoints`.

## [1.2.0] - prior release

Initial published baseline tracked in this changelog. See git history
for details.
