import type { Endpoint } from "../types.js";

/**
 * All SocialCrawl endpoints, derived from the backend registry config.
 * Source: packages/social-api/src/registry/config.ts
 * Regenerate by running tmp-extract/extract.ts + generate-endpoints.ts
 * against the backend. Do not hand-edit.
 */
export const ENDPOINTS: Endpoint[] = [
  // --- tiktok (26 endpoints) ---
  {
    platform: "tiktok",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "TikTok username without the @ symbol", example: "charlidamelio" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get TikTok user profile",
    description:
      "Returns public profile information for a TikTok user including follower count, following count, total likes, bio, avatar URL, and verification status.",
  },
  {
    platform: "tiktok",
    resource: "profile/videos",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "TikTok username without the @ symbol", example: "charlidamelio" },
    ],
    optionalParams: [
      { name: "user_id", type: "string", description: "TikTok user id. Use this for faster responses." },
      { name: "sort_by", type: "enum", enumValues: ["latest", "popular"], description: "What to sort by" },
      { name: "max_cursor", type: "string", description: "Cursor to get more videos. Get 'max_cursor' from previous response." },
      { name: "region", type: "string", description: "Region (Country) you want the proxy in. Defaults to US." },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List TikTok user videos",
    description:
      "Returns a paginated list of recent public videos posted by a TikTok user. Each video includes view count, like count, comment count, share count, caption, and thumbnail URL.",
  },
  {
    platform: "tiktok",
    resource: "post",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the TikTok video", example: "https://www.tiktok.com/@charlidamelio/video/7321485815660738859" },
    ],
    optionalParams: [
      { name: "get_transcript", type: "boolean", description: "Get transcript of the video" },
      { name: "region", type: "string", description: "Region of the proxy. Sometimes you'll need to specify the region if you're not getting a response. Commonly for videos from the Phillipines, in which case you'd use 'PH'. Use 2 letter country codes like US, GB, FR, etc" },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
      { name: "download_media", type: "boolean", description: "Set to true to download the video/images and get back permanent Supabase URLs. Costs 10 credits if media is found, 1 credit otherwise." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get TikTok post details",
    description:
      "Returns detailed information about a specific TikTok video including view count, like count, comment count, share count, caption, music info, author details, and video metadata.",
  },
  {
    platform: "tiktok",
    resource: "post/comments",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the TikTok video to fetch comments for", example: "https://www.tiktok.com/@charlidamelio/video/7321485815660738859" },
    ],
    optionalParams: [
      { name: "cursor", type: "integer", description: "Cursor to get more comments. Get 'cursor' from previous response." },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List TikTok post comments",
    description:
      "Returns a list of comments on a specific TikTok video. Each comment includes the author username, comment text, like count, reply count, and creation timestamp.",
  },
  {
    platform: "tiktok",
    resource: "video/comment/replies",
    method: "GET",
    params: [
      { name: "comment_id", required: true, description: "TikTok comment ID. This is the cid from the comments endpoint.", example: "7623828115408274207" },
      { name: "url", required: true, description: "TikTok video URL. This is the url from the comments endpoint.", example: "https://www.tiktok.com/@stoolpresidente/video/7623818255903329566" },
    ],
    optionalParams: [
      { name: "cursor", type: "integer", description: "Cursor to get more replies. Get 'cursor' from previous response." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List TikTok comment replies",
    description:
      "Fetches replies to a specific TikTok comment by its ID. Returns an array of comment objects each with text, user info, and creation time. Paginate with the cursor from the previous response.",
  },
  {
    platform: "tiktok",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find TikTok videos", example: "cooking recipes" },
    ],
    optionalParams: [
      { name: "date_posted", type: "enum", enumValues: ["yesterday", "this-week", "this-month", "last-3-months", "last-6-months", "all-time"], description: "Time Frame" },
      { name: "sort_by", type: "enum", enumValues: ["relevance", "most-liked", "date-posted"], description: "Sort by" },
      { name: "region", type: "string", description: "Note, this doesn't filter the tiktoks only in a specfic region, it puts the proxy there. Use it in case you want to scrape posts only available for some country. Use 2 letter country codes like US, GB, FR, etc" },
      { name: "cursor", type: "integer", description: "Cursor to get more videos. Get 'cursor' from previous response." },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "Search TikTok videos by keyword",
    description:
      "Searches TikTok for videos matching a keyword query. Returns a list of matching videos with view counts, like counts, captions, author info, and thumbnails.",
  },
  {
    platform: "tiktok",
    resource: "trending",
    method: "GET",
    params: [
      { name: "region", required: true, description: "ISO 3166-1 alpha-2 country code (e.g., US, GB, KR)", example: "US" },
    ],
    optionalParams: [
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response." },
    ],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "PostList",
    summary: "Get TikTok trending feed",
    description:
      "Returns trending videos for a specific region. Each video includes view count, like count, caption, author info, and thumbnail.",
  },
  {
    platform: "tiktok",
    resource: "search/hashtag",
    method: "GET",
    params: [
      { name: "hashtag", required: true, description: "Hashtag to search for without the # symbol", example: "fyp" },
    ],
    optionalParams: [
      { name: "region", type: "string", description: "Region the proxy will be set to. Note: this isn't going to grab you all tiktoks from this region, you're just setting the proxy there." },
      { name: "cursor", type: "integer", description: "Cursor to get more videos. Get 'cursor' from previous response." },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search TikTok by hashtag",
    description:
      "Searches TikTok for videos under a specific hashtag. Returns matching videos with engagement metrics and author info.",
  },
  {
    platform: "tiktok",
    resource: "search/top",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase", example: "dance challenge" },
    ],
    optionalParams: [
      { name: "publish_time", type: "enum", enumValues: ["yesterday", "this-week", "this-month", "last-3-months", "last-6-months", "all-time"], description: "Time Frame TikTok was posted" },
      { name: "sort_by", type: "enum", enumValues: ["relevance", "most-liked", "date-posted"], description: "Sort by" },
      { name: "region", type: "string", description: "Note, this doesn't filter the tiktoks only in a specfic region, it puts the proxy there. Use it in case you want to scrape posts only available for some country. Use 2 letter country codes like US, GB, FR, etc" },
      { name: "cursor", type: "integer", description: "Cursor to get more videos. Get 'cursor' from previous response." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "TikTok top search results",
    description:
      "Returns top search results for a keyword query on TikTok, including accounts, videos, and sounds.",
  },
  {
    platform: "tiktok",
    resource: "search/users",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find TikTok users", example: "cooking" },
    ],
    optionalParams: [
      { name: "cursor", type: "integer", description: "Cursor to get more users. Get 'cursor' from previous response." },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search TikTok users",
    description:
      "Searches TikTok for user accounts matching a query. Returns matching profiles with follower counts and verification status.",
  },
  {
    platform: "tiktok",
    resource: "user/audience",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "TikTok username without the @ symbol", example: "charlidamelio" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Audience",
    summary: "Get TikTok user audience demographics",
    description:
      "Returns audience demographic data for a TikTok creator including age distribution, gender split, and top countries.",
  },
  {
    platform: "tiktok",
    resource: "user/followers",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "handle", type: "string", description: "TikTok username without the @ symbol" },
      { name: "user_id", type: "string", description: "User id. Use this for faster response times." },
      { name: "min_time", type: "integer", description: "Used to paginate. Get 'min_time' from previous response." },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
    ],
    oneOfGroups: [["handle", "user_id"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List TikTok user followers",
    description:
      "Returns a list of followers for a TikTok user. Each follower includes username, display name, avatar, and follower count.",
  },
  {
    platform: "tiktok",
    resource: "user/following",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "TikTok username without the @ symbol", example: "charlidamelio" },
    ],
    optionalParams: [
      { name: "min_time", type: "integer", description: "Used to paginate. Get 'min_time' from previous response." },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List TikTok user following",
    description:
      "Returns a list of accounts that a TikTok user is following. Each account includes username, display name, avatar, and follower count.",
  },
  {
    platform: "tiktok",
    resource: "user/live",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "TikTok username without the @ symbol", example: "charlidamelio" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Analytics",
    summary: "Get TikTok user live stream",
    description:
      "Returns current live stream information for a TikTok user including viewer count, stream title, duration, and gift count.",
  },
  {
    platform: "tiktok",
    resource: "post/transcript",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the TikTok video", example: "https://www.tiktok.com/@charlidamelio/video/7321485815660738859" },
    ],
    optionalParams: [
      { name: "language", type: "string", description: "Language of the transcript. 2 letter language code, ie 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh'" },
      { name: "use_ai_as_fallback", type: "string", description: "Set to 'true' to use AI as a fallback to get the transcript if the transcript is not found. Costs 10 credits to use this feature. And only if the video is under 2 minutes." },
    ],
    oneOfGroups: [],
    creditTier: "premium",
    creditCost: 10,
    archetype: "Post",
    summary: "Get TikTok video transcript",
    description:
      "Returns the transcript of a TikTok video. Supports auto-generated captions and AI-powered transcription as fallback.",
  },
  {
    platform: "tiktok",
    resource: "song",
    method: "GET",
    params: [
      { name: "clipId", required: true, description: "TikTok sound/song clip ID", example: "7252403792087040774" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get TikTok song details",
    description:
      "Returns details about a specific TikTok sound/song including title, artist, duration, usage count, and cover image.",
  },
  {
    platform: "tiktok",
    resource: "song/videos",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "clipId", type: "string", description: "TikTok sound/song clip ID" },
      { name: "cursor", type: "integer", description: "The cursor to get the next page of results." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List TikTok videos using a song",
    description:
      "Returns videos that use a specific TikTok sound/song. Each video includes engagement metrics, author info, and caption.",
  },
  {
    platform: "tiktok",
    resource: "songs/popular",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "page", type: "integer", description: "Page number" },
      { name: "timePeriod", type: "enum", enumValues: ["7", "30", "130"], description: "Time period to get popular songs from" },
      { name: "rankType", type: "enum", enumValues: ["popular", "surging"], description: "Get popular or surging songs" },
      { name: "newOnBoard", type: "boolean", description: "New to top 100" },
      { name: "commercialMusic", type: "boolean", description: "Approved for business use?" },
      { name: "countryCode", type: "enum", enumValues: ["AR", "AU", "AT", "BH", "BD", "BY", "BE", "BR", "BG", "KH", "CA", "CL", "CO", "HR", "CZ", "DK", "EG", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "ID", "IQ", "IE", "IL", "IT", "JP", "JO", "KZ", "KW", "LV", "LB", "LT", "LU", "MO", "MY", "MX", "MA", "MM", "NL", "NZ", "NG", "NO", "OM", "PK", "PE", "PH", "PL", "PT", "QA", "RO", "SA", "SG", "SK", "ZA", "KR", "ES", "SE", "CH", "TW", "TH", "TR", "UA", "AE", "GB", "US", "UZ", "VN"], description: "Country code to get popular songs from" },
    ],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Analytics",
    summary: "Get popular TikTok songs",
    description:
      "Returns currently popular songs on TikTok with ranking, usage counts, artist info, and trend data.",
  },
  {
    platform: "tiktok",
    resource: "creators/popular",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "page", type: "integer", description: "Page number" },
      { name: "sortBy", type: "enum", enumValues: ["engagement", "follower", "avg_views"], description: "Sort creators by engagement, follower count, or average views" },
      { name: "followerCount", type: "enum", enumValues: ["10K-100K", "100K-1M", "1M-10M", "10M+"], description: "Filter by follower count range" },
      { name: "creatorCountry", type: "enum", enumValues: ["AU", "BR", "CA", "EG", "FR", "DE", "ID", "IL", "IT", "JP", "MY", "PH", "RU", "SA", "SG", "KR", "ES", "TW", "TH", "TR", "AE", "GB", "US", "VN"], description: "Country code of the creator" },
      { name: "audienceCountry", type: "enum", enumValues: ["AU", "BR", "CA", "EG", "FR", "DE", "ID", "IL", "IT", "JP", "MY", "PH", "RU", "SA", "SG", "KR", "ES", "TW", "TH", "TR", "AE", "GB", "US", "VN"], description: "Country code of the audience/follower" },
    ],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Analytics",
    summary: "Get popular TikTok creators",
    description:
      "Returns currently popular TikTok creators with follower counts, engagement rates, and content categories.",
  },
  {
    platform: "tiktok",
    resource: "hashtags/popular",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "period", type: "enum", enumValues: ["7", "30", "120"], description: "Time period in days (7, 30, or 120)" },
      { name: "page", type: "integer", description: "Page number" },
      { name: "countryCode", type: "enum", enumValues: ["AU", "BR", "CA", "EG", "FR", "DE", "ID", "IL", "IT", "JP", "MY", "PH", "RU", "SA", "SG", "KR", "ES", "TW", "TH", "TR", "AE", "GB", "US", "VN"], description: "Country code to get popular hashtags from" },
      { name: "newOnBoard", type: "boolean", description: "Show only newly trending hashtags" },
      { name: "industry", type: "enum", enumValues: ["apparel-and-accessories", "baby-kids-and-maternity", "beauty-and-personal-care", "business-services", "education", "financial-services", "food-and-beverage", "games", "health", "home-improvement", "household-products", "life-services", "news-and-entertainment", "pets", "sports-and-outdoor", "tech-and-electronics", "travel", "vehicle-and-transportation"], description: "Industry to get popular hashtags from." },
    ],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Analytics",
    summary: "Get popular TikTok hashtags",
    description:
      "Returns currently trending hashtags on TikTok with view counts, video counts, and trend data.",
  },
  {
    platform: "tiktok",
    resource: "videos/popular",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "period", type: "enum", enumValues: ["7", "30"], description: "Time period in days (7 or 30)" },
      { name: "page", type: "integer", description: "Page number" },
      { name: "orderBy", type: "enum", enumValues: ["like", "hot", "comment", "repost"], description: "Sort videos by likes, views (hot), comments, or reposts" },
      { name: "countryCode", type: "enum", enumValues: ["AU", "BR", "CA", "EG", "FR", "DE", "ID", "IL", "IT", "JP", "MY", "PH", "RU", "SA", "SG", "KR", "ES", "TW", "TH", "TR", "AE", "GB", "US", "VN"], description: "Country code to get popular videos from" },
    ],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Analytics",
    summary: "Get popular TikTok videos",
    description:
      "Returns currently popular TikTok videos with view counts, engagement metrics, and creator info.",
  },
  {
    platform: "tiktok",
    resource: "shop/product",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the TikTok Shop product page", example: "https://www.tiktok.com/@shop/product/1234567890" },
    ],
    optionalParams: [
      { name: "region", type: "string", description: "Region the proxy will be set to so you can access products from that country. Use 2 letter country codes like US, GB, FR, etc. For England, don't use UK, use GB." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get TikTok Shop product details",
    description:
      "Returns detailed information about a TikTok Shop product including price, rating, review count, seller info, and images.",
  },
  {
    platform: "tiktok",
    resource: "shop/product/reviews",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "url", type: "string", description: "Full URL of the TikTok Shop product page" },
      { name: "product_id", type: "string", description: "The ID of the product (required if url is not provided)" },
      { name: "page", type: "integer", description: "The page number of the reviews" },
    ],
    oneOfGroups: [["url", "product_id"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List TikTok Shop product reviews",
    description:
      "Returns reviews for a TikTok Shop product. Each review includes rating, text, author, and timestamp.",
  },
  {
    platform: "tiktok",
    resource: "shop/products",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the TikTok Shop page", example: "https://www.tiktok.com/@shop/1234567890" },
    ],
    optionalParams: [
      { name: "cursor", type: "string", description: "Cursor parameter from the previous response to retrieve the next page of products. Omit for the first page." },
      { name: "region", type: "enum", enumValues: ["US", "GB", "DE", "FR", "IT", "ID", "MY", "MX", "PH", "SG", "ES", "TH", "VN", "BR", "JP", "IE"], description: "Region to get shop products from. Defaults to US if not provided." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List TikTok Shop products",
    description:
      "Returns products from a TikTok Shop page including names, prices, ratings, and images.",
  },
  {
    platform: "tiktok",
    resource: "shop/search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find TikTok Shop products", example: "phone case" },
    ],
    optionalParams: [
      { name: "page", type: "integer", description: "Page number to retrieve" },
      { name: "region", type: "enum", enumValues: ["US", "GB", "DE", "FR", "IT", "ID", "MY", "MX", "PH", "SG", "ES", "TH", "VN", "BR", "JP", "IE"], description: "Region to search shop products in." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search TikTok Shop products",
    description:
      "Searches TikTok Shop for products matching a query. Returns matching products with prices, ratings, and seller info.",
  },
  {
    platform: "tiktok",
    resource: "user/showcase",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "The handle of the user", example: "mrtiktokreviews" },
    ],
    optionalParams: [
      { name: "region", type: "string", description: "Region to put the proxy in" },
      { name: "cursor", type: "string", description: "The cursor to the next page of products" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List TikTok user showcase products",
    description:
      "Fetches products featured in a TikTok user's public showcase — the products a creator promotes on their profile. Each product includes title, price, images, and shop details.",
  },
  // --- instagram (12 endpoints) ---
  {
    platform: "instagram",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Instagram username without the @ symbol", example: "instagram" },
    ],
    optionalParams: [
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Instagram user profile",
    description:
      "Returns public profile information for an Instagram user including follower count, following count, post count, bio, profile picture URL, and verification status.",
  },
  {
    platform: "instagram",
    resource: "profile/posts",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Instagram username without the @ symbol", example: "instagram" },
    ],
    optionalParams: [
      { name: "next_max_id", type: "string", description: "Cursor to get next page of results." },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Instagram user posts",
    description:
      "Returns a list of recent posts from an Instagram user's profile. Each post includes like count, comment count, caption, media URL, media type, and timestamp.",
  },
  {
    platform: "instagram",
    resource: "post",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Instagram post", example: "https://www.instagram.com/p/CwA1234abcd/" },
    ],
    optionalParams: [
      { name: "region", type: "string", description: "2 letter country code to set the proxy in" },
      { name: "trim", type: "boolean", description: "Set to true to get a trimmed response" },
      { name: "download_media", type: "boolean", description: "Set to true to download the video/images and get back permanent Supabase URLs. Costs 10 credits if media is found, 1 credit otherwise." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Instagram post details",
    description:
      "Returns detailed information about a specific Instagram post including like count, comment count, caption, media URLs, media type, author info, and tagged users.",
  },
  {
    platform: "instagram",
    resource: "post/comments",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Instagram post to fetch comments for", example: "https://www.instagram.com/p/CwA1234abcd/" },
    ],
    optionalParams: [
      { name: "cursor", type: "string", description: "The cursor to get more comments. Get 'cursor' from previous response." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List Instagram post comments",
    description:
      "Returns a list of comments on a specific Instagram post. Each comment includes the author username, comment text, like count, reply count, and creation timestamp.",
  },
  {
    platform: "instagram",
    resource: "basic-profile",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "userId", type: "string", description: "Instagram numeric user ID" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Instagram basic profile",
    description:
      "Returns basic public profile info for an Instagram user by user ID including username, full name, and profile picture.",
  },
  {
    platform: "instagram",
    resource: "profile/reels",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "user_id", type: "string", description: "Instagram user id. Use this for faster response times." },
      { name: "handle", type: "string", description: "Instagram username without the @ symbol" },
      { name: "max_id", type: "string", description: "Max id to get more reels. Get 'max_id' from previous response." },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [["user_id", "handle"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Instagram user reels",
    description:
      "Returns a list of reels posted by an Instagram user. Each reel includes view count, like count, comment count, and thumbnail.",
  },
  {
    platform: "instagram",
    resource: "highlights",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "user_id", type: "string", description: "Instagram user id. Use for faster response times." },
      { name: "handle", type: "string", description: "Instagram username without the @ symbol" },
    ],
    oneOfGroups: [["user_id", "handle"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Instagram story highlights",
    description:
      "Returns a list of story highlight collections for an Instagram user including highlight titles, cover images, and item counts.",
  },
  {
    platform: "instagram",
    resource: "highlight/detail",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "id", type: "string", description: "Instagram highlight ID" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "Get Instagram highlight detail",
    description:
      "Returns the items within a specific Instagram story highlight including media URLs, timestamps, and interaction counts.",
  },
  {
    platform: "instagram",
    resource: "search/reels",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find Instagram reels", example: "workout routine" },
    ],
    optionalParams: [
      { name: "date_posted", type: "enum", enumValues: ["last-hour", "last-day", "last-week", "last-month", "last-year"], description: "Date posted" },
      { name: "page", type: "integer", description: "The page number to return." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search Instagram reels",
    description:
      "Searches Instagram for reels matching a keyword query. Returns matching reels with view counts, like counts, and author info.",
  },
  {
    platform: "instagram",
    resource: "media/transcript",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Instagram video or reel", example: "https://www.instagram.com/reel/CwA1234abcd/" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "premium",
    creditCost: 10,
    archetype: "Post",
    summary: "Get Instagram media transcript",
    description:
      "Returns the AI-generated transcript of an Instagram video or reel. Supports auto-generated and AI-powered transcription.",
  },
  {
    platform: "instagram",
    resource: "user/embed",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Instagram username without the @ symbol", example: "instagram" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Instagram user embed HTML",
    description:
      "Returns embeddable HTML snippet for an Instagram user profile that can be embedded on external websites.",
  },
  {
    platform: "instagram",
    resource: "song/reels",
    method: "GET",
    params: [
      { name: "audio_id", required: true, description: "Instagram audio/song ID", example: "243313786724210" },
    ],
    optionalParams: [
      { name: "max_id", type: "string", description: "How you paginate the results. Pass the max_id from the previous response to get the next set of reels." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Instagram reels using a song",
    description:
      "Returns reels that use a specific audio track on Instagram. Each reel includes engagement metrics and author info.",
  },
  // --- youtube (12 endpoints) ---
  {
    platform: "youtube",
    resource: "channel",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "channelId", type: "string", description: "YouTube channel ID. Can pass a channelId, handle or url" },
      { name: "handle", type: "string", description: "YouTube channel handle without the @ symbol" },
      { name: "url", type: "string", description: "YouTube channel URL. Can pass a channelId, handle or url" },
    ],
    oneOfGroups: [["channelId", "handle", "url"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get YouTube channel info",
    description:
      "Returns public channel information for a YouTube channel including subscriber count, total video count, total view count, channel description, banner URL, and avatar URL.",
  },
  {
    platform: "youtube",
    resource: "channel/videos",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "channelId", type: "string", description: "YouTube channel ID" },
      { name: "handle", type: "string", description: "YouTube channel handle without the @ symbol" },
      { name: "sort", type: "enum", enumValues: ["latest", "popular"], description: "Sort by latest or popular" },
      { name: "continuationToken", type: "string", description: "Continuation token to get more videos. Get 'continuationToken' from previous response." },
      { name: "includeExtras", type: "string", description: "This will get you the like + comment count and the description. To get the full details of the video, use the /v1/youtube/video endpoint. This will slow down the response slightly." },
    ],
    oneOfGroups: [["channelId", "handle"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List YouTube channel videos",
    description:
      "Returns a list of recent videos published by a YouTube channel. Each video includes title, view count, like count, comment count, duration, thumbnail URL, and publish date.",
  },
  {
    platform: "youtube",
    resource: "video",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the YouTube video", example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ],
    optionalParams: [
      { name: "language", type: "string", description: "Preferred response language (mapped to Accept-Language header; not guaranteed due to YouTube localization behavior). 2 letter language code, ie 'en', 'es', 'fr' etc." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get YouTube video details",
    description:
      "Returns detailed information about a specific YouTube video including title, view count, like count, comment count, description, tags, duration, channel info, and publish date.",
  },
  {
    platform: "youtube",
    resource: "video/comments",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the YouTube video to fetch comments for", example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ],
    optionalParams: [
      { name: "continuationToken", type: "string", description: "Continuation token to get more comments. Get 'continuationToken' from previous response." },
      { name: "order", type: "enum", enumValues: ["top", "newest"], description: "Order of comments" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List YouTube video comments",
    description:
      "Returns a list of comments on a specific YouTube video. Each comment includes the author name, comment text, like count, reply count, and publish timestamp.",
  },
  {
    platform: "youtube",
    resource: "video/comment/replies",
    method: "GET",
    params: [
      { name: "continuationToken", required: true, description: "Continuation token for the comment replies. Use 'repliesContinuationToken' from the Comments endpoint, or 'continuationToken' from a previous replies response to paginate.", example: "Eg0SC2RRdzR3OVdnWGNRGAYygwEaUBIa..." },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List YouTube comment replies",
    description:
      "Fetches replies to a specific comment on a YouTube video. Each reply includes text content, author details, like count, and publish date. Requires a continuationToken from the Comments endpoint.",
  },
  {
    platform: "youtube",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find YouTube videos", example: "javascript tutorial" },
    ],
    optionalParams: [
      { name: "uploadDate", type: "enum", enumValues: ["today", "this_week", "this_month", "this_year"], description: "Upload date" },
      { name: "sortBy", type: "enum", enumValues: ["relevance", "popular"], description: "Sort by" },
      { name: "filter", type: "enum", enumValues: ["shorts"], description: "Filter by these options. Note this doesn't work when you use either 'uploadDate' or 'sortBy'. It basically only works when you have a query." },
      { name: "region", type: "string", description: "2 letter country code of the country to put the proxy in." },
      { name: "continuationToken", type: "string", description: "Continuation token to get more videos. Get 'continuationToken' from previous response." },
      { name: "includeExtras", type: "string", description: "This will get you the like + comment count and the description. To get the full details of the video, use the /v1/youtube/video endpoint. *This will slow down the response slightly.*" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search YouTube videos",
    description:
      "Searches YouTube for videos matching a keyword query. Returns a list of matching videos with titles, view counts, channel names, thumbnails, and publish dates.",
  },
  {
    platform: "youtube",
    resource: "channel/shorts",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "handle", type: "string", description: "YouTube channel handle without the @ symbol" },
      { name: "channelId", type: "string", description: "Can pass channelId or handle" },
      { name: "sort", type: "enum", enumValues: ["newest", "popular"], description: "Sort by newest or popular" },
      { name: "continuationToken", type: "string", description: "Continuation token to get more videos. Get 'continuationToken' from previous response." },
    ],
    oneOfGroups: [["channelId", "handle"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List YouTube channel shorts",
    description:
      "Returns a list of YouTube Shorts published by a channel. Each short includes view count, like count, title, and thumbnail.",
  },
  {
    platform: "youtube",
    resource: "community-post",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the YouTube community post", example: "https://www.youtube.com/post/UgkxCWeKpIOHLknREsNOF9M_aqz4fKkCERjP" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get YouTube community post",
    description:
      "Returns details of a YouTube community post including text content, like count, comment count, images, and author info.",
  },
  {
    platform: "youtube",
    resource: "playlist",
    method: "GET",
    params: [
      { name: "playlist_id", required: true, description: "YouTube playlist ID", example: "PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "Get YouTube playlist",
    description:
      "Returns videos in a YouTube playlist including titles, view counts, durations, thumbnails, and channel info.",
  },
  {
    platform: "youtube",
    resource: "search/hashtag",
    method: "GET",
    params: [
      { name: "hashtag", required: true, description: "Hashtag to search for without the # symbol", example: "shorts" },
    ],
    optionalParams: [
      { name: "continuationToken", type: "string", description: "Continuation token to get more videos. Get 'continuationToken' from previous response." },
      { name: "type", type: "enum", enumValues: ["all", "shorts"], description: "Search for all types of content or only shorts" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search YouTube by hashtag",
    description:
      "Searches YouTube for videos under a specific hashtag. Returns matching videos with view counts, channel info, and publish dates.",
  },
  {
    platform: "youtube",
    resource: "shorts/trending",
    method: "GET",
    params: [],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "PostList",
    summary: "Get trending YouTube shorts",
    description:
      "Returns currently trending YouTube Shorts with view counts, like counts, channel info, and thumbnails.",
  },
  {
    platform: "youtube",
    resource: "video/transcript",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the YouTube video", example: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ],
    optionalParams: [
      { name: "language", type: "string", description: "2 letter language code, ie 'en', 'es', 'fr' etc. If the transcript is not available in the language you specify, the transcript will be null." },
    ],
    oneOfGroups: [],
    creditTier: "premium",
    creditCost: 10,
    archetype: "Post",
    summary: "Get YouTube video transcript",
    description:
      "Returns the transcript of a YouTube video with timestamped text segments. Supports multiple languages.",
  },
  // --- facebook (12 endpoints) ---
  {
    platform: "facebook",
    resource: "profile",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook page or profile", example: "https://www.facebook.com/Meta" },
    ],
    optionalParams: [
      { name: "get_business_hours", type: "string", description: "Get the business's hours" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Facebook page profile",
    description:
      "Returns public profile information for a Facebook page or user including name, follower count, like count, category, about text, profile picture URL, and cover photo URL.",
  },
  {
    platform: "facebook",
    resource: "profile/posts",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "url", type: "string", description: "Full URL of the Facebook page or profile to fetch posts for" },
      { name: "pageId", type: "string", description: "Facebook profile page id" },
      { name: "cursor", type: "string", description: "To paginate through the posts" },
    ],
    oneOfGroups: [["url", "pageId"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Facebook page posts",
    description:
      "Returns a list of recent posts from a Facebook page or profile. Each post includes the post text, like count, comment count, share count, media attachments, and publish timestamp.",
  },
  {
    platform: "facebook",
    resource: "post",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook post", example: "https://www.facebook.com/Meta/posts/1234567890" },
    ],
    optionalParams: [
      { name: "get_comments", type: "boolean", description: "Whether you want to get the first several comments of the post" },
      { name: "get_transcript", type: "boolean", description: "Whether you want to get the transcript of the post" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Facebook post details",
    description:
      "Returns detailed information about a specific Facebook post including the post text, like count, comment count, share count, reactions breakdown, media attachments, and author info.",
  },
  {
    platform: "facebook",
    resource: "post/comments",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "url", type: "string", description: "Full URL of the Facebook post to fetch comments for" },
      { name: "feedback_id", type: "string", description: "Using feedback_id (instead of url) will *really* speed up the request. You can get the feedback_id when you make a request to /v1/facebook/post." },
      { name: "cursor", type: "string", description: "Cursor to get more comments. Get 'cursor' from previous response." },
    ],
    oneOfGroups: [["url", "feedback_id"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List Facebook post comments",
    description:
      "Returns a list of comments on a specific Facebook post. Each comment includes the author name, comment text, like count, reply count, and creation timestamp.",
  },
  {
    platform: "facebook",
    resource: "group/posts",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "url", type: "string", description: "Full URL of the Facebook group" },
      { name: "group_id", type: "string", description: "The ID of the group" },
      { name: "sort_by", type: "enum", enumValues: ["TOP_POSTS", "RECENT_ACTIVITY", "CHRONOLOGICAL", "CHRONOLOGICAL_LISTINGS"], description: "How to sort the posts" },
      { name: "cursor", type: "string", description: "The cursor to paginate to the next page" },
    ],
    oneOfGroups: [["url", "group_id"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Facebook group posts",
    description:
      "Returns recent posts from a Facebook group. Each post includes text, reaction count, comment count, shares, and author info.",
  },
  {
    platform: "facebook",
    resource: "post/transcript",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook video post", example: "https://www.facebook.com/Meta/videos/1234567890" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "premium",
    creditCost: 10,
    archetype: "Post",
    summary: "Get Facebook video transcript",
    description:
      "Returns the transcript of a Facebook video post. Supports auto-generated captions.",
  },
  {
    platform: "facebook",
    resource: "profile/photos",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook page or profile", example: "https://www.facebook.com/Meta" },
    ],
    optionalParams: [
      { name: "next_page_id", type: "string", description: "To paginate through to the next page" },
      { name: "cursor", type: "string", description: "To paginate through to the next page" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Facebook profile photos",
    description:
      "Returns photos from a Facebook page or profile. Each photo includes image URL, caption, reaction count, and comment count.",
  },
  {
    platform: "facebook",
    resource: "profile/reels",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook page or profile", example: "https://www.facebook.com/Meta" },
    ],
    optionalParams: [
      { name: "next_page_id", type: "string", description: "To paginate through to the next page" },
      { name: "cursor", type: "string", description: "To paginate through to the next page" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Facebook profile reels",
    description:
      "Returns reels from a Facebook page or profile. Each reel includes view count, reaction count, comment count, and thumbnail.",
  },
  {
    platform: "facebook",
    resource: "adlibrary/ad",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "id", type: "string", description: "Facebook Ad Library ad ID" },
      { name: "url", type: "string", description: "Facebook Ad URL" },
      { name: "get_transcript", type: "boolean", description: "Get the transcript of the ad. Only works if the video is under 2 minutes." },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [["id", "url"]],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Post",
    summary: "Get Facebook Ad Library ad details",
    description:
      "Returns detailed information about a specific ad from the Facebook Ad Library including creative, spend, impressions, and targeting.",
  },
  {
    platform: "facebook",
    resource: "adlibrary/company/ads",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "pageId", type: "string", description: "Facebook page ID of the advertiser" },
      { name: "companyName", type: "string", description: "The name of the company. Can either use this or pageId" },
      { name: "country", type: "string", description: "This can only be one country. It has to be the 2 letter code for the country. It defaults to ALL." },
      { name: "status", type: "enum", enumValues: ["ALL", "ACTIVE", "INACTIVE"], description: "Status of the ad. Defaults to ACTIVE." },
      { name: "media_type", type: "enum", enumValues: ["ALL", "IMAGE", "VIDEO", "MEME", "IMAGE_AND_MEME", "NONE"], description: "Media type of the ad. Defaults to ALL. Meme refers to ads with image and text. Not sure why they call it meme." },
      { name: "language", type: "string", description: "Language to filter ads on. Needs to be 2 letter language code, ie EN, ES, FR, etc" },
      { name: "sort_by", type: "enum", enumValues: ["total_impressions", "relevancy_monthly_grouped"], description: "Sort by impressions (high to low), or Most Recent (relevancy_monthly_grouped). Defaults to impressions." },
      { name: "start_date", type: "string", description: "Start date to search for. Format: YYYY-MM-DD" },
      { name: "end_date", type: "string", description: "End date to search for. Format: YYYY-MM-DD" },
      { name: "cursor", type: "string", description: "Cursor to paginate through results" },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [["pageId", "companyName"]],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "PostList",
    summary: "List Facebook Ad Library company ads",
    description:
      "Returns ads from a specific company/page in the Facebook Ad Library. Each ad includes creative, status, spend, and targeting info.",
  },
  {
    platform: "facebook",
    resource: "adlibrary/search/ads",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find ads in the Facebook Ad Library", example: "artificial intelligence" },
    ],
    optionalParams: [
      { name: "sort_by", type: "enum", enumValues: ["total_impressions", "relevancy_monthly_grouped"], description: "Sort by impressions (high to low), or Most Recent (relevancy_monthly_grouped). Defaults to impressions." },
      { name: "search_type", type: "enum", enumValues: ["keyword_unordered", "keyword_exact_phrase"], description: "If you want to search by exact phrase or not" },
      { name: "ad_type", type: "enum", enumValues: ["all", "political_and_issue_ads"], description: "Search for all ads or only political and issue ads" },
      { name: "country", type: "string", description: "This can only be one country. It has to be the 2 letter code for the country. It defaults to ALL." },
      { name: "status", type: "enum", enumValues: ["ALL", "ACTIVE", "INACTIVE"], description: "Status of the ad. Defaults to ACTIVE." },
      { name: "media_type", type: "enum", enumValues: ["ALL", "IMAGE", "VIDEO", "MEME", "IMAGE_AND_MEME", "NONE"], description: "Media type of the ad. Defaults to ALL. Meme just means the ad has text and an image. No clue why they call it meme." },
      { name: "start_date", type: "string", description: "Impressions start date. Needs to be in YYYY-MM-DD format." },
      { name: "end_date", type: "string", description: "Impressions end date. Needs to be in YYYY-MM-DD format." },
      { name: "cursor", type: "string", description: "Cursor to paginate through results" },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "SearchResult",
    summary: "Search Facebook Ad Library",
    description:
      "Searches the Facebook Ad Library for ads matching a keyword. Returns matching ads with creative text, images, sponsor info, and status.",
  },
  {
    platform: "facebook",
    resource: "adlibrary/search/companies",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find companies in the Facebook Ad Library", example: "Nike" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "SearchResult",
    summary: "Search Facebook Ad Library companies",
    description:
      "Searches for companies/pages in the Facebook Ad Library. Returns matching pages with active ad counts and page details.",
  },
  // --- twitter (6 endpoints) ---
  {
    platform: "twitter",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Twitter username without the @ symbol", example: "elonmusk" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Twitter user profile",
    description:
      "Returns public profile information for a Twitter/X user including follower count, following count, tweet count, bio, profile image URL, banner URL, and verification status.",
  },
  {
    platform: "twitter",
    resource: "user/tweets",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Twitter username without the @ symbol", example: "elonmusk" },
    ],
    optionalParams: [
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Twitter user tweets",
    description:
      "Returns a list of recent tweets posted by a Twitter/X user. Each tweet includes the full text, like count, retweet count, reply count, media attachments, and creation timestamp.",
  },
  {
    platform: "twitter",
    resource: "tweet",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the tweet", example: "https://x.com/elonmusk/status/1234567890" },
    ],
    optionalParams: [
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Twitter tweet details",
    description:
      "Returns detailed information about a specific tweet including the full text, like count, retweet count, reply count, quote count, media attachments, author info, and creation timestamp.",
  },
  {
    platform: "twitter",
    resource: "community",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Twitter/X community", example: "https://x.com/i/communities/1234567890" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Twitter community details",
    description:
      "Returns information about a Twitter/X community including name, description, member count, rules, and creation date.",
  },
  {
    platform: "twitter",
    resource: "community/tweets",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Twitter/X community", example: "https://x.com/i/communities/1234567890" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Twitter community tweets",
    description:
      "Returns recent tweets posted in a Twitter/X community. Each tweet includes text, engagement metrics, and author info.",
  },
  {
    platform: "twitter",
    resource: "tweet/transcript",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the tweet containing a video", example: "https://x.com/elonmusk/status/1234567890" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "premium",
    creditCost: 10,
    archetype: "Post",
    summary: "Get Twitter video transcript",
    description:
      "Returns the transcript of a video attached to a tweet. Supports auto-generated captions.",
  },
  {
    platform: "twitter",
    resource: "ai-search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Natural-language prompt — answered by Grok with autonomous X (Twitter) search", example: "What is Elon Musk saying about xAI this week?" },
    ],
    optionalParams: [
      { name: "from_handles", type: "string", description: "Comma-separated list of X handles to restrict the search to (max 10). Mutually exclusive with exclude_handles." },
      { name: "exclude_handles", type: "string", description: "Comma-separated list of X handles to exclude from the search (max 10). Mutually exclusive with from_handles." },
      { name: "from_date", type: "string", description: "ISO 8601 YYYY-MM-DD lower bound on tweet recency." },
      { name: "to_date", type: "string", description: "ISO 8601 YYYY-MM-DD upper bound on tweet recency." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Analytics",
    summary: "AI-powered X (Twitter) search via Grok",
    description:
      "Calls xAI Grok 4.20 Reasoning with the built-in x_search tool to answer a natural-language question about X. Returns { answer, sources, tool_calls_count } where sources are the X URLs Grok cited. Supports handle filters and date ranges.",
  },
  // --- linkedin (6 endpoints) ---
  {
    platform: "linkedin",
    resource: "profile",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the LinkedIn profile page", example: "https://www.linkedin.com/in/williamhgates/" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get LinkedIn user profile",
    description:
      "Returns public profile information for a LinkedIn user including name, headline, summary, location, current company, education, skills, and profile picture URL.",
  },
  {
    platform: "linkedin",
    resource: "company",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the LinkedIn company page", example: "https://www.linkedin.com/company/microsoft/" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get LinkedIn company page",
    description:
      "Returns public information about a LinkedIn company page including company name, description, industry, employee count, headquarters location, website, and logo URL.",
  },
  {
    platform: "linkedin",
    resource: "post",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the LinkedIn post", example: "https://www.linkedin.com/posts/williamhgates_example-activity-1234567890" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get LinkedIn post details",
    description:
      "Returns detailed information about a specific LinkedIn post including the post text, like count, comment count, share count, author info, media attachments, and publish timestamp.",
  },
  {
    platform: "linkedin",
    resource: "company/posts",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the LinkedIn company page", example: "https://www.linkedin.com/company/microsoft/" },
    ],
    optionalParams: [
      { name: "page", type: "integer", description: "The page number to get" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List LinkedIn company posts",
    description:
      "Returns recent posts from a LinkedIn company page. Each post includes text, reaction count, comment count, and media.",
  },
  {
    platform: "linkedin",
    resource: "ad",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the LinkedIn ad", example: "https://www.linkedin.com/ad/library/detail/12345" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Post",
    summary: "Get LinkedIn ad details",
    description:
      "Returns detailed information about a specific LinkedIn advertisement including ad copy, sponsor info, impressions, and targeting.",
  },
  {
    platform: "linkedin",
    resource: "ads/search",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "company", type: "string", description: "The company name to search for. 'Microsoft' for example" },
      { name: "keyword", type: "string", description: "The keyword to search for" },
      { name: "companyId", type: "string", description: "The company id to search for" },
      { name: "countries", type: "string", description: "Comma separated list of countries. Example: US,CA,MX" },
      { name: "startDate", type: "string", description: "Start date to search for. Format: YYYY-MM-DD" },
      { name: "endDate", type: "string", description: "End date to search for. Format: YYYY-MM-DD" },
      { name: "paginationToken", type: "string", description: "Pagination token to paginate through results" },
    ],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "SearchResult",
    summary: "Search LinkedIn ads",
    description:
      "Searches the LinkedIn Ad Library for ads by company, keyword, or filters. Returns matching ads with ad copy and sponsor info.",
  },
  // --- reddit (7 endpoints) ---
  {
    platform: "reddit",
    resource: "subreddit",
    method: "GET",
    params: [
      { name: "subreddit", required: true, description: "Subreddit name without the r/ prefix", example: "technology" },
    ],
    optionalParams: [
      { name: "timeframe", type: "enum", enumValues: ["all", "day", "week", "month", "year"], description: "Timeframe to get posts from" },
      { name: "sort", type: "enum", enumValues: ["best", "hot", "new", "top", "rising"], description: "Sort order" },
      { name: "after", type: "string", description: "After to get more posts. Get 'after' from previous response." },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Reddit subreddit posts",
    description:
      "Returns a list of top posts from a subreddit. Each post includes the title, score, upvote ratio, comment count, author, flair, permalink, and creation timestamp.",
  },
  {
    platform: "reddit",
    resource: "subreddit/details",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "subreddit", type: "string", description: "Subreddit name without the r/ prefix" },
      { name: "url", type: "string", description: "Subreddit URL" },
    ],
    oneOfGroups: [["subreddit", "url"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Reddit subreddit details",
    description:
      "Returns detailed information about a subreddit including subscriber count, active user count, description, creation date, rules, and subreddit icon URL.",
  },
  {
    platform: "reddit",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find Reddit posts", example: "best programming languages 2024" },
    ],
    optionalParams: [
      { name: "sort", type: "enum", enumValues: ["relevance", "new", "top", "comment_count"], description: "Sort by" },
      { name: "timeframe", type: "enum", enumValues: ["all", "day", "week", "month", "year"], description: "Timeframe" },
      { name: "after", type: "string", description: "Used to paginate to next page" },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search Reddit posts",
    description:
      "Searches Reddit for posts matching a keyword query. Returns a list of matching posts with titles, scores, comment counts, subreddit names, and permalinks.",
  },
  {
    platform: "reddit",
    resource: "post/comments",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Reddit post to fetch comments for", example: "https://www.reddit.com/r/technology/comments/abc123/example_post/" },
    ],
    optionalParams: [
      { name: "cursor", type: "string", description: "Cursor to get more comments, or replies." },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List Reddit post comments",
    description:
      "Returns a threaded list of comments on a specific Reddit post. Each comment includes the author, comment body, score, reply count, awards, and creation timestamp.",
  },
  {
    platform: "reddit",
    resource: "ad",
    method: "GET",
    params: [
      { name: "id", required: true, description: "Reddit ad ID", example: "t3_abc123" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Post",
    summary: "Get Reddit ad details",
    description:
      "Returns detailed information about a specific Reddit advertisement including ad copy, targeting, and engagement metrics.",
  },
  {
    platform: "reddit",
    resource: "ads/search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search query", example: "gaming" },
    ],
    optionalParams: [
      { name: "industries", type: "enum", enumValues: ["RETAIL_AND_ECOMMERCE", "TECH_B2B", "TECH_B2C", "EDUCATION", "ENTERTAINMENT", "GAMING", "FINANCIAL_SERVICES", "HEALTH_AND_BEAUTY", "CONSUMER_PACKAGED_GOODS", "EMPLOYMENT", "AUTO", "TRAVEL", "REAL_ESTATE", "GAMBLING_AND_FANTASY_SPORTS", "POLITICS_AND_GOVERNMENT", "OTHER"], description: "Industries to filter by" },
      { name: "budgets", type: "enum", enumValues: ["LOW", "MEDIUM", "HIGH"], description: "Budgets to filter by" },
      { name: "formats", type: "enum", enumValues: ["IMAGE", "VIDEO", "CAROUSEL", "FREE_FORM"], description: "Formats to filter by" },
      { name: "placements", type: "enum", enumValues: ["FEED", "COMMENTS_PAGE"], description: "Placements to filter by" },
      { name: "objectives", type: "enum", enumValues: ["IMPRESSIONS", "CLICKS", "CONVERSIONS", "VIDEO_VIEWABLE_IMPRESSIONS", "APP_INSTALLS"], description: "Objectives to filter by" },
    ],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "SearchResult",
    summary: "Search Reddit ads",
    description:
      "Searches Reddit's ad transparency center for ads matching a query. Returns matching ads with creative, industry, and budget info.",
  },
  {
    platform: "reddit",
    resource: "subreddit/search",
    method: "GET",
    params: [
      { name: "subreddit", required: true, description: "Subreddit name (e.g. 'Fitness', not 'r/Fitness' or a full URL)", example: "technology" },
    ],
    optionalParams: [
      { name: "query", type: "string", description: "Search query to find matching content" },
      { name: "sort", type: "enum", enumValues: ["relevance", "hot", "top", "new", "comments"], description: "Sort order. For posts/media: relevance, hot, top, new, comments. For comments: relevance, top, new" },
      { name: "timeframe", type: "enum", enumValues: ["all", "year", "month", "week", "day", "hour"], description: "Timeframe to filter results" },
      { name: "cursor", type: "string", description: "Cursor to get more results. Get 'cursor' from previous response." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search within a subreddit",
    description:
      "Searches for posts within a specific subreddit. Returns matching posts with titles, scores, comment counts, and permalinks.",
  },
  // --- threads (5 endpoints) ---
  {
    platform: "threads",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Threads username without the @ symbol", example: "zuck" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Threads user profile",
    description:
      "Returns public profile information for a Threads user including follower count, bio, profile picture URL, and verification status.",
  },
  {
    platform: "threads",
    resource: "user/posts",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Threads username without the @ symbol", example: "zuck" },
    ],
    optionalParams: [
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Threads user posts",
    description:
      "Returns a list of recent posts from a Threads user. Each post includes the text content, like count, reply count, repost count, media attachments, and creation timestamp.",
  },
  {
    platform: "threads",
    resource: "post",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Threads post", example: "https://www.threads.net/@zuck/post/CwABCDEFGHI" },
    ],
    optionalParams: [
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Threads post details",
    description:
      "Returns detailed information about a specific Threads post including the text content, like count, reply count, repost count, media attachments, author info, and creation timestamp.",
  },
  {
    platform: "threads",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find Threads posts", example: "artificial intelligence" },
    ],
    optionalParams: [
      { name: "start_date", type: "string", description: "Start date to search for" },
      { name: "end_date", type: "string", description: "End date to search for" },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search Threads posts",
    description:
      "Searches Threads for posts matching a keyword query. Returns a list of matching posts with text content, like counts, author info, and creation timestamps.",
  },
  {
    platform: "threads",
    resource: "search/users",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find Threads users", example: "tech" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search Threads users",
    description:
      "Searches Threads for user accounts matching a query. Returns matching profiles with follower counts and verification status.",
  },
  // --- pinterest (4 endpoints) ---
  {
    platform: "pinterest",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search query", example: "home decor ideas" },
    ],
    optionalParams: [
      { name: "cursor", type: "string", description: "Cursor" },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search Pinterest pins",
    description:
      "Searches Pinterest for pins matching a keyword query. Returns a list of matching pins with titles, image URLs, save counts, author info, and board details.",
  },
  {
    platform: "pinterest",
    resource: "pin",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Pinterest pin", example: "https://www.pinterest.com/pin/1234567890/" },
    ],
    optionalParams: [
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Pinterest pin details",
    description:
      "Returns detailed information about a specific Pinterest pin including the title, description, image URL, save count, comment count, author info, and board details.",
  },
  {
    platform: "pinterest",
    resource: "board",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Pinterest board", example: "https://www.pinterest.com/pinterest/official-pinterest-pins/" },
    ],
    optionalParams: [
      { name: "cursor", type: "string", description: "The cursor to get the next page of results" },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "Get Pinterest board",
    description:
      "Returns pins from a Pinterest board. Each pin includes title, image URL, save count, and link destination.",
  },
  {
    platform: "pinterest",
    resource: "user/boards",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "The username of the user to get boards for. (e.g. broadstbullycom from https://www.pinterest.com/broadstbullycom/)", example: "pinterest" },
    ],
    optionalParams: [
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Pinterest user boards",
    description:
      "Returns boards created by a Pinterest user. Each board includes title, description, pin count, and cover image.",
  },
  // --- google (4 endpoints) ---
  {
    platform: "google",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase", example: "best restaurants in London" },
    ],
    optionalParams: [
      { name: "region", type: "string", description: "2 letter country code, ie US, UK, CA, etc This will show results from that country" },
      { name: "date_posted", type: "enum", enumValues: ["last-hour", "last-day", "last-week", "last-month", "last-year"], description: "Date posted" },
      { name: "page", type: "integer", description: "Page number to retrieve" },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Google web search",
    description:
      "Returns Google search results for a query. Each result includes title, URL, snippet, and position.",
  },
  {
    platform: "google",
    resource: "ad",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Google ad or Ads Transparency Center page", example: "https://adstransparency.google.com/advertiser/AR12345678901234567" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Post",
    summary: "Get Google ad details",
    description:
      "Returns detailed information about a specific Google advertisement including ad copy, advertiser, and format.",
  },
  {
    platform: "google",
    resource: "adlibrary/advertisers/search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find advertisers in the Google Ads Transparency Center", example: "Nike" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "SearchResult",
    summary: "Search Google Ad Library advertisers",
    description:
      "Searches the Google Ads Transparency Center for advertisers matching a query. Returns matching advertisers with ad counts.",
  },
  {
    platform: "google",
    resource: "company/ads",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "domain", type: "string", description: "Company domain name to look up ads for" },
      { name: "advertiser_id", type: "string", description: "The advertiser id of the company" },
      { name: "topic", type: "enum", enumValues: ["all", "political"], description: "The topic to search for. If you search for 'political', you will also need to pass a 'region', like 'US' or 'AU'" },
      { name: "region", type: "string", description: "The region to search for. Defaults to anywhere" },
      { name: "start_date", type: "string", description: "Start date to search for. Format: YYYY-MM-DD" },
      { name: "end_date", type: "string", description: "End date to search for. Format: YYYY-MM-DD" },
      { name: "get_ad_details", type: "string", description: "Set to true to get the ad details. Will cost 25 credits." },
      { name: "cursor", type: "string", description: "Cursor to paginate through results" },
    ],
    oneOfGroups: [["domain", "advertiser_id"]],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "PostList",
    summary: "List Google ads by company",
    description:
      "Returns ads from a specific company/domain in the Google Ads Transparency Center. Each ad includes creative, format, and date range.",
  },
  // --- twitch (2 endpoints) ---
  {
    platform: "twitch",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Twitch username", example: "ninja" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Twitch streamer profile",
    description:
      "Returns public profile information for a Twitch streamer including display name, follower count, bio, profile image URL, broadcast language, and partner/affiliate status.",
  },
  {
    platform: "twitch",
    resource: "clip",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Twitch clip", example: "https://www.twitch.tv/ninja/clip/ExampleClipSlug" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Twitch clip details",
    description:
      "Returns detailed information about a specific Twitch clip including the title, view count, duration, creator name, broadcaster name, game name, thumbnail URL, and creation timestamp.",
  },
  // --- truthsocial (3 endpoints) ---
  {
    platform: "truthsocial",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Truth Social username without the @ symbol", example: "realDonaldTrump" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Truth Social user profile",
    description:
      "Returns public profile information for a Truth Social user including display name, follower count, following count, truth count, bio, and profile image URL.",
  },
  {
    platform: "truthsocial",
    resource: "user/posts",
    method: "GET",
    params: [],
    optionalParams: [
      { name: "handle", type: "string", description: "Truth Social username without the @ symbol" },
      { name: "user_id", type: "string", description: "Truth Social user id. Use this for faster response times. Trumps is 107780257626128497. It is the 'id' field in the profile endpoint." },
      { name: "next_max_id", type: "string", description: "Used to paginate to next page" },
      { name: "trim", type: "boolean", description: "Set to true for a trimmed down version of the response" },
    ],
    oneOfGroups: [["handle", "user_id"]],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Truth Social user posts",
    description:
      "Returns a list of recent truths posted by a Truth Social user. Each truth includes the text content, like count, retruth count, reply count, media attachments, and creation timestamp.",
  },
  {
    platform: "truthsocial",
    resource: "post",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Truth Social post", example: "https://truthsocial.com/@realDonaldTrump/posts/123456789" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Truth Social post details",
    description:
      "Returns detailed information about a specific Truth Social post including the text content, like count, retruth count, reply count, media attachments, author info, and creation timestamp.",
  },
  // --- snapchat (1 endpoint) ---
  {
    platform: "snapchat",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Snapchat username", example: "djkhaled305" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Snapchat user profile",
    description:
      "Returns public profile information for a Snapchat user including display name, Bitmoji avatar URL, subscriber count, and bio description.",
  },
  // --- kick (1 endpoint) ---
  {
    platform: "kick",
    resource: "clip",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Kick clip", example: "https://kick.com/xqc/clips/clip_abc123" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Kick clip details",
    description:
      "Returns detailed information about a specific Kick clip including the title, view count, duration, category, creator name, channel name, thumbnail URL, and creation timestamp.",
  },
  // --- amazon (1 endpoint) ---
  {
    platform: "amazon",
    resource: "shop",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Amazon shop or storefront page", example: "https://www.amazon.com/shop/influencer123" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Amazon shop page",
    description:
      "Returns product listings from an Amazon shop or storefront page including product names, prices, ratings, and images.",
  },
  // --- linktree (1 endpoint) ---
  {
    platform: "linktree",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Linktree page", example: "https://linktr.ee/charlidamelio" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Linktree page",
    description:
      "Returns data from a Linktree page including the user's display name, bio, avatar, and list of links with titles and URLs.",
  },
  // --- linkbio (1 endpoint) ---
  {
    platform: "linkbio",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Linkbio page", example: "https://lnk.bio/example" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Linkbio page",
    description:
      "Returns data from a Linkbio page including display name, bio, avatar, and list of links with titles and URLs.",
  },
  // --- linkme (1 endpoint) ---
  {
    platform: "linkme",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Linkme page", example: "https://linkme.bio/example" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Linkme profile",
    description:
      "Returns data from a Linkme page including display name, bio, avatar, and list of links with titles and URLs.",
  },
  // --- komi (1 endpoint) ---
  {
    platform: "komi",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Komi page", example: "https://komi.io/example" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Komi page",
    description:
      "Returns data from a Komi page including display name, bio, avatar, and list of links with titles and URLs.",
  },
  // --- pillar (1 endpoint) ---
  {
    platform: "pillar",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Pillar page", example: "https://pillar.io/example" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Pillar page",
    description:
      "Returns data from a Pillar page including display name, bio, avatar, and list of links with titles and URLs.",
  },
  // --- utility (1 endpoint) ---
  {
    platform: "utility",
    resource: "age-gender",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Direct URL of the image to analyze", example: "https://example.com/photo.jpg" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "premium",
    creditCost: 10,
    archetype: "Analytics",
    summary: "Detect age and gender",
    description:
      "Uses AI to detect the estimated age and gender of a person from an image URL. Returns age estimate, gender, and confidence score.",
  },
  // --- github (12 endpoints) ---
  {
    platform: "github",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "GitHub username (login)", example: "octocat" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get GitHub user profile",
    description:
      "Returns public profile information for a GitHub user including followers, following, public repo count, bio, avatar, and account creation date. Mapped to the unified Author archetype via the github-author field map.",
  },
  {
    platform: "github",
    resource: "profile/repos",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "GitHub username (login)", example: "octocat" },
    ],
    optionalParams: [
      { name: "type", type: "enum", enumValues: ["all", "owner", "member"], description: "Filter by ownership relationship. Defaults to owner." },
      { name: "sort", type: "enum", enumValues: ["created", "updated", "pushed", "full_name"], description: "Sort the results." },
      { name: "direction", type: "enum", enumValues: ["asc", "desc"], description: "Sort direction." },
      { name: "per_page", type: "integer", description: "Page size (1–100)." },
      { name: "page", type: "integer", description: "1-indexed page number." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List a user's repositories",
    description:
      "Returns a paginated list of public repositories owned by a GitHub user, with stars, forks, language, and last-pushed timestamp.",
  },
  {
    platform: "github",
    resource: "repo",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Canonical GitHub repository URL (https://github.com/{owner}/{repo})", example: "https://github.com/facebook/react" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get repository details",
    description:
      "Returns detailed metadata about a public GitHub repository including stars, forks, open issues, watchers, default branch, license, and description. Mapped to the unified Author archetype via the github-repo field map (stars → followers, forks → following).",
  },
  {
    platform: "github",
    resource: "repo/readme",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Canonical GitHub repository URL", example: "https://github.com/facebook/react" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get repository README",
    description:
      "Fetches the rendered README contents of a public GitHub repository as raw markdown. Uses Accept: application/vnd.github.raw+json upstream so the body is the file contents, not a base64-wrapped JSON envelope.",
  },
  {
    platform: "github",
    resource: "repo/releases",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Canonical GitHub repository URL", example: "https://github.com/facebook/react" },
    ],
    optionalParams: [
      { name: "per_page", type: "integer", description: "Page size (1–100)." },
      { name: "page", type: "integer", description: "1-indexed page number." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List repository releases",
    description:
      "Returns a paginated list of releases for a public GitHub repository, including tag, name, body, author, draft/prerelease flags, and published timestamp.",
  },
  {
    platform: "github",
    resource: "repo/issues",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Canonical GitHub repository URL", example: "https://github.com/facebook/react" },
    ],
    optionalParams: [
      { name: "state", type: "enum", enumValues: ["open", "closed", "all"], description: "Filter by issue state. Defaults to open." },
      { name: "labels", type: "string", description: "Comma-separated list of label names to filter by." },
      { name: "sort", type: "enum", enumValues: ["created", "updated", "comments"], description: "Sort by." },
      { name: "direction", type: "enum", enumValues: ["asc", "desc"], description: "Sort direction." },
      { name: "since", type: "string", description: "ISO 8601 timestamp — only issues updated at or after this time." },
      { name: "per_page", type: "integer", description: "Page size (1–100)." },
      { name: "page", type: "integer", description: "1-indexed page number." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List repository issues",
    description:
      "Returns a paginated list of issues for a public GitHub repository. NOTE: GitHub's /issues endpoint returns pull requests too — every PR is also an issue under the hood. Filter by checking the pull_request field on each item.",
  },
  {
    platform: "github",
    resource: "issue",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Canonical GitHub issue or pull-request URL (https://github.com/{owner}/{repo}/issues/{n} or .../pull/{n})", example: "https://github.com/facebook/react/issues/1" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get issue or pull-request details",
    description:
      "Returns detailed information about a GitHub issue or pull request including title, body, state, labels, author, assignees, reactions, comment count, and creation timestamp. Mapped to the unified Post archetype via the github-post field map (title → content.text, reactions.total_count → engagement.likes).",
  },
  {
    platform: "github",
    resource: "issue/comments",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Canonical GitHub issue or pull-request URL", example: "https://github.com/facebook/react/issues/1" },
    ],
    optionalParams: [
      { name: "sort", type: "enum", enumValues: ["created", "updated"], description: "Sort by." },
      { name: "direction", type: "enum", enumValues: ["asc", "desc"], description: "Sort direction." },
      { name: "since", type: "string", description: "ISO 8601 timestamp — only comments updated at or after this time." },
      { name: "per_page", type: "integer", description: "Page size (1–100)." },
      { name: "page", type: "integer", description: "1-indexed page number." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List issue or pull-request comments",
    description:
      "Returns a paginated list of comments on a GitHub issue or pull request. Each comment includes the author, body, reactions, and creation timestamp.",
  },
  {
    platform: "github",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "GitHub search query — supports the full GitHub issues/PRs query syntax (e.g. is:issue is:open label:bug)", example: "claude code repo:anthropics/claude-code is:issue is:open" },
    ],
    optionalParams: [
      { name: "sort", type: "enum", enumValues: ["comments", "reactions", "reactions-+1", "reactions--1", "reactions-smile", "reactions-thinking_face", "reactions-heart", "reactions-tada", "interactions", "created", "updated"], description: "Sort field." },
      { name: "order", type: "enum", enumValues: ["asc", "desc"], description: "Sort order." },
      { name: "per_page", type: "integer", description: "Page size (1–100)." },
      { name: "page", type: "integer", description: "1-indexed page number." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search issues and pull requests",
    description:
      "Searches issues and pull requests across GitHub using the same query syntax as github.com search. Subject to GitHub's 30 req/min search rate limit shared across all SocialCrawl callers; cache hits are free.",
  },
  {
    platform: "github",
    resource: "repo/top-issues",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Canonical GitHub repository URL", example: "https://github.com/facebook/react" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Analytics",
    summary: "Top feature request and complaint for a repo",
    description:
      "Composite endpoint — runs 2-3 server-side searches against the repository to surface the top open feature request (sorted by reactions) and the top open complaint (sorted by comment count). Returns { top_feature_request, top_complaint }; either can be null. 404s with auto-refund if both are null.",
  },
  {
    platform: "github",
    resource: "repo/dossier",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Canonical GitHub repository URL", example: "https://github.com/facebook/react" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "Analytics",
    summary: "Repository dossier (info + readme + releases + top issues)",
    description:
      "Composite endpoint — runs 5 GitHub calls in parallel and returns { info, readme, releases, top_issues } as a single dossier. Repo info is the critical call; if it 404s the whole composite refunds. README, releases, and top-issue searches degrade gracefully on partial failure.",
  },
  {
    platform: "github",
    resource: "user/profile-velocity",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "GitHub username (login)", example: "octocat" },
    ],
    optionalParams: [
      { name: "depth", type: "enum", enumValues: ["quick", "default", "deep"], description: "How wide to fan out: quick = 3 own repos + 5 external; default = 5 own + 10 external; deep = 5 own + 15 external. Default is 'default'." },
    ],
    oneOfGroups: [],
    creditTier: "premium",
    creditCost: 10,
    archetype: "Analytics",
    summary: "User PR velocity + contribution dossier",
    description:
      "Composite endpoint — fans out 5–15 GitHub calls in three phases: PR velocity totals, own-repos discovery, and per-repo enrichment for both contributed-to and own repos. Returns { velocity, contributed_repos, own_repos }. Critical call is the user's repo list; 404s on nonexistent users with auto-refund.",
  },
  // --- hackernews (4 endpoints) ---
  {
    platform: "hackernews",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find Hacker News stories", example: "claude code" },
    ],
    optionalParams: [
      { name: "tags", type: "string", description: "Algolia tag filter (e.g. 'story', 'comment', 'poll'). Defaults to 'story'." },
      { name: "numericFilters", type: "string", description: "Algolia numeric filter expression (e.g. 'points>2'). Defaults to 'points>2'." },
      { name: "hitsPerPage", type: "integer", description: "Results per page (1–1000). Defaults to 30." },
      { name: "page", type: "integer", description: "0-indexed page number." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "Search Hacker News stories",
    description:
      "Searches Hacker News (via the public Algolia HN API) for stories matching a keyword query. Returns hits with title, url, author, points, comment count, and creation timestamp. Algolia's _highlightResult / _snippetResult / children fields are stripped server-side to keep payloads lean.",
  },
  {
    platform: "hackernews",
    resource: "story",
    method: "GET",
    params: [
      { name: "id", required: true, description: "Hacker News story id (numeric)", example: "8863" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Hacker News story details",
    description:
      "Returns detailed metadata about a single Hacker News story including title, url, author, points, comment count, and creation timestamp. Mapped to the unified Post archetype via the hackernews-post field map.",
  },
  {
    platform: "hackernews",
    resource: "story/comments",
    method: "GET",
    params: [
      { name: "id", required: true, description: "Hacker News story id (numeric)", example: "8863" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "Get Hacker News comment tree",
    description:
      "Returns the full nested comment tree for a Hacker News story. Each comment carries author, text, points, parent_id, story_id, and recursive children replies.",
  },
  {
    platform: "hackernews",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Hacker News username", example: "pg" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Hacker News user profile",
    description:
      "Returns public profile information for a Hacker News user including karma, about/bio, and account creation timestamp. HN has no follower/following/avatar concept; those fields resolve to null.",
  },
  // --- polymarket (2 endpoints) ---
  {
    platform: "polymarket",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Free-text search query against Polymarket Gamma's public-search index", example: "trump" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search active Polymarket events",
    description:
      "Returns active prediction-market events matching a keyword. Each event carries the canonical Polymarket Gamma shape (outcomes, outcomePrices, volume, liquidity, end date, etc.) — no field mapping is applied. Closed markets are excluded upstream.",
  },
  {
    platform: "polymarket",
    resource: "research",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Natural-language research topic — framing prefixes like 'last 30 days …' or 'what are people saying about …' are stripped server-side", example: "last 30 days bitcoin halving" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "SearchResult",
    summary: "Server-side fan-out research over Polymarket",
    description:
      "Server-side topic expansion + ranking. Strips framing, expands the topic into up to 6 deduped sub-queries, fans out in parallel against Polymarket Gamma, dedupes by event id, applies a topic filter, and returns events sorted by text similarity. Partial-success: if at least one sub-call succeeds the merged result is returned.",
  },
  // --- tavily (4 endpoints) ---
  {
    platform: "tavily",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Free-text web-search query", example: "who founded anthropic" },
    ],
    optionalParams: [
      { name: "search_depth", type: "enum", enumValues: ["basic", "advanced", "fast", "ultra-fast"], description: "Search depth. Defaults to basic." },
      { name: "topic", type: "enum", enumValues: ["general", "news", "finance"], description: "Topic vertical. Defaults to general." },
      { name: "time_range", type: "enum", enumValues: ["day", "week", "month", "year", "d", "w", "m", "y"], description: "Recency window." },
      { name: "max_results", type: "integer", description: "1–20. Defaults to 5." },
      { name: "chunks_per_source", type: "integer", description: "1–5. Only honoured when search_depth=advanced." },
      { name: "include_images", type: "boolean", description: "Include images in results." },
      { name: "include_image_descriptions", type: "boolean", description: "Include AI captions for returned images." },
      { name: "include_answer", type: "boolean", description: "Include an LLM-synthesised answer string alongside ranked results — Tavily's main differentiator." },
      { name: "include_raw_content", type: "boolean", description: "Include raw HTML/text alongside cleaned content." },
      { name: "include_domains", type: "string", description: "Comma-separated list of domains to restrict results to." },
      { name: "exclude_domains", type: "string", description: "Comma-separated list of domains to exclude from results." },
      { name: "country", type: "string", description: "ISO 3166-1 alpha-2 country code." },
      { name: "start_date", type: "string", description: "YYYY-MM-DD lower bound." },
      { name: "end_date", type: "string", description: "YYYY-MM-DD upper bound." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Analytics",
    summary: "Tavily web search",
    description:
      "Web search returning ranked results plus an optional LLM-synthesised answer and metadata (suggestions, query_analysis, total_results, time_taken). Uses the Analytics archetype to preserve every top-level field — passing through SearchResult would silently drop the answer.",
  },
  {
    platform: "tavily",
    resource: "extract",
    method: "GET",
    params: [
      { name: "urls", required: true, description: "Comma-separated list of up to 20 URLs to extract clean AI-ready content from", example: "https://en.wikipedia.org/wiki/Lionel_Messi" },
    ],
    optionalParams: [
      { name: "extract_depth", type: "enum", enumValues: ["basic", "advanced"], description: "Extraction depth. Defaults to basic." },
      { name: "format", type: "enum", enumValues: ["markdown", "text"], description: "Output format. Defaults to markdown." },
      { name: "include_images", type: "boolean", description: "Include images." },
      { name: "include_favicon", type: "boolean", description: "Include favicon." },
      { name: "timeout", type: "integer", description: "Per-URL timeout in seconds (1–60)." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Analytics",
    summary: "Tavily URL content extraction",
    description:
      "Pull clean AI-ready text from up to 20 URLs in a single call. The 'urls' param accepts a comma-separated list which is split server-side into a JSON array before hitting Tavily.",
  },
  {
    platform: "tavily",
    resource: "map",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Root URL whose sitegraph should be discovered", example: "https://docs.tavily.com" },
    ],
    optionalParams: [
      { name: "max_depth", type: "integer", description: "Crawl depth. Defaults to 1." },
      { name: "max_breadth", type: "integer", description: "Per-page link cap. Defaults to 20." },
      { name: "limit", type: "integer", description: "Total pages cap. Defaults to 50." },
      { name: "instructions", type: "string", description: "Natural-language guidance for the mapper." },
      { name: "select_paths", type: "string", description: "Comma-separated regex whitelist for paths." },
      { name: "select_domains", type: "string", description: "Comma-separated regex whitelist for domains." },
      { name: "exclude_paths", type: "string", description: "Comma-separated regex blacklist for paths." },
      { name: "exclude_domains", type: "string", description: "Comma-separated regex blacklist for domains." },
      { name: "allow_external", type: "boolean", description: "Allow following links outside the root domain. Defaults to true." },
      { name: "timeout", type: "integer", description: "Total timeout in seconds (10–150)." },
      { name: "categories", type: "string", description: "Comma-separated category hints." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Analytics",
    summary: "Tavily lightweight sitegraph",
    description:
      "Returns URLs only — no full content. Cheaper and faster than crawl when you only need to enumerate pages.",
  },
  {
    platform: "tavily",
    resource: "crawl",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Root URL to crawl", example: "https://docs.tavily.com" },
    ],
    optionalParams: [
      { name: "max_depth", type: "integer", description: "Crawl depth." },
      { name: "max_breadth", type: "integer", description: "Per-page link cap." },
      { name: "limit", type: "integer", description: "Total pages cap." },
      { name: "instructions", type: "string", description: "Natural-language guidance — the LLM uses this to score which paths to follow." },
      { name: "select_paths", type: "string", description: "Comma-separated regex whitelist for paths." },
      { name: "select_domains", type: "string", description: "Comma-separated regex whitelist for domains." },
      { name: "exclude_paths", type: "string", description: "Comma-separated regex blacklist for paths." },
      { name: "exclude_domains", type: "string", description: "Comma-separated regex blacklist for domains." },
      { name: "allow_external", type: "boolean", description: "Allow following links outside the root domain." },
      { name: "extract_depth", type: "enum", enumValues: ["basic", "advanced"], description: "Per-page extraction strategy." },
      { name: "format", type: "enum", enumValues: ["markdown", "text"], description: "Output format." },
      { name: "categories", type: "string", description: "Comma-separated category hints." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Analytics",
    summary: "Tavily multi-page crawl",
    description:
      "Multi-page crawl with per-page extraction. LLM-driven path selection when 'instructions' is set. Heavier than map; use map first if you only need URLs.",
  },
  // --- perplexity (1 endpoint) ---
  {
    platform: "perplexity",
    resource: "research",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Natural-language research prompt", example: "What is the capital of France?" },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Analytics",
    summary: "Web research via Perplexity Sonar",
    description:
      "Calls Perplexity Sonar through the Vercel AI Gateway and returns { answer, sources } where sources are the URLs the model cited. Sources can be empty for one-line factual answers. Cached responses are free for 120 seconds.",
  },
  // --- search (1 endpoint) ---
  {
    platform: "search",
    resource: "everywhere",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Natural-language search query — fanned out across 12 platforms in parallel", example: "claude code review skills" },
    ],
    optionalParams: [
      { name: "lookback_days", type: "integer", description: "Restrict results to the trailing N days (where supported by the underlying source)." },
      { name: "from_date", type: "string", description: "ISO 8601 YYYY-MM-DD lower bound." },
      { name: "to_date", type: "string", description: "ISO 8601 YYYY-MM-DD upper bound." },
      { name: "sources", type: "string", description: "Comma-separated allowlist of source slugs (reddit, twitter-ai-search, youtube, tiktok, instagram, hackernews, polymarket, github, threads, pinterest, perplexity, tavily). Mutually exclusive with exclude." },
      { name: "exclude", type: "string", description: "Comma-separated blocklist of source slugs. Mutually exclusive with sources." },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 20,
    archetype: "Analytics",
    summary: "Universal search across 12 platforms",
    description:
      "Meta-search endpoint that fans out one query across 12 platforms (Reddit, Twitter AI search, YouTube, TikTok, Instagram, Hacker News, Polymarket, GitHub, Threads, Pinterest, Perplexity, Tavily) in parallel. Pipeline: deterministic plan → parallel LLM plan refine → fan-out → per-source mappers → dedupe → weighted RRF fusion → LLM rerank → greedy clustering. Flat 20 credits per call regardless of how many sources respond. Refunds automatically if every source returns empty. Streaming SSE is also available on the same path when Accept: text/event-stream is sent — but the MCP client receives the JSON envelope (cached, transformed, refund-on-failure).",
  },
];

export function findEndpoint(platform: string, resource: string): Endpoint | undefined {
  return ENDPOINTS.find((e) => e.platform === platform && e.resource === resource);
}

export function getEndpointsByPlatform(platform: string): Endpoint[] {
  return ENDPOINTS.filter((e) => e.platform === platform);
}
