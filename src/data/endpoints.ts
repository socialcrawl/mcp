import type { Endpoint } from "../types.js";

export const ENDPOINTS: Endpoint[] = [
  // --- TikTok (24 endpoints) ---
  {
    platform: "tiktok",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "TikTok username without the @ symbol", example: "charlidamelio" },
    ],
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
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List TikTok post comments",
    description:
      "Returns a list of comments on a specific TikTok video. Each comment includes the author username, comment text, like count, reply count, and creation timestamp.",
  },
  {
    platform: "tiktok",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find TikTok videos", example: "cooking recipes" },
    ],
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
    params: [
      { name: "handle", required: true, description: "TikTok username without the @ symbol", example: "charlidamelio" },
    ],
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
    params: [
      { name: "clipId", required: true, description: "TikTok sound/song clip ID", example: "7252403792087040774" },
    ],
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
    params: [
      { name: "url", required: true, description: "Full URL of the TikTok Shop product page", example: "https://www.tiktok.com/@shop/product/1234567890" },
    ],
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
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search TikTok Shop products",
    description:
      "Searches TikTok Shop for products matching a query. Returns matching products with prices, ratings, and seller info.",
  },

  // --- Instagram (12 endpoints) ---
  {
    platform: "instagram",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Instagram username without the @ symbol", example: "instagram" },
    ],
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
    params: [
      { name: "userId", required: true, description: "Instagram numeric user ID", example: "25025320" },
    ],
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
    params: [
      { name: "handle", required: true, description: "Instagram username without the @ symbol", example: "instagram" },
    ],
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
    params: [
      { name: "handle", required: true, description: "Instagram username without the @ symbol", example: "instagram" },
    ],
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
    params: [
      { name: "id", required: true, description: "Instagram highlight ID", example: "17854360229135492" },
    ],
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
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Instagram reels using a song",
    description:
      "Returns reels that use a specific audio track on Instagram. Each reel includes engagement metrics and author info.",
  },

  // --- YouTube (11 endpoints) ---
  {
    platform: "youtube",
    resource: "channel",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "YouTube channel handle without the @ symbol", example: "MrBeast" },
    ],
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
    params: [
      { name: "handle", required: true, description: "YouTube channel handle without the @ symbol", example: "MrBeast" },
    ],
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
    creditTier: "standard",
    creditCost: 1,
    archetype: "CommentList",
    summary: "List YouTube video comments",
    description:
      "Returns a list of comments on a specific YouTube video. Each comment includes the author name, comment text, like count, reply count, and publish timestamp.",
  },
  {
    platform: "youtube",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find YouTube videos", example: "javascript tutorial" },
    ],
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
    params: [
      { name: "handle", required: true, description: "YouTube channel handle without the @ symbol", example: "MrBeast" },
    ],
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
    creditTier: "premium",
    creditCost: 10,
    archetype: "Post",
    summary: "Get YouTube video transcript",
    description:
      "Returns the transcript of a YouTube video with timestamped text segments. Supports multiple languages.",
  },

  // --- Facebook (12 endpoints) ---
  {
    platform: "facebook",
    resource: "profile",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook page or profile", example: "https://www.facebook.com/Meta" },
    ],
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
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook page or profile to fetch posts for", example: "https://www.facebook.com/Meta" },
    ],
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
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook post to fetch comments for", example: "https://www.facebook.com/Meta/posts/1234567890" },
    ],
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
    params: [
      { name: "url", required: true, description: "Full URL of the Facebook group", example: "https://www.facebook.com/groups/reactjs/" },
    ],
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
    params: [
      { name: "id", required: true, description: "Facebook Ad Library ad ID", example: "23851234567890123" },
    ],
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
    params: [
      { name: "pageId", required: true, description: "Facebook page ID of the advertiser", example: "20531316728" },
    ],
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
    creditTier: "advanced",
    creditCost: 5,
    archetype: "SearchResult",
    summary: "Search Facebook Ad Library companies",
    description:
      "Searches for companies/pages in the Facebook Ad Library. Returns matching pages with active ad counts and page details.",
  },

  // --- Twitter (6 endpoints) ---
  {
    platform: "twitter",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Twitter username without the @ symbol", example: "elonmusk" },
    ],
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
    creditTier: "premium",
    creditCost: 10,
    archetype: "Post",
    summary: "Get Twitter video transcript",
    description:
      "Returns the transcript of a video attached to a tweet. Supports auto-generated captions.",
  },

  // --- LinkedIn (6 endpoints) ---
  {
    platform: "linkedin",
    resource: "profile",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the LinkedIn profile page", example: "https://www.linkedin.com/in/williamhgates/" },
    ],
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
    params: [
      { name: "company", required: true, description: "Company name or LinkedIn company page URL to search ads for", example: "Microsoft" },
    ],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "SearchResult",
    summary: "Search LinkedIn ads",
    description:
      "Searches the LinkedIn Ad Library for ads by company, keyword, or filters. Returns matching ads with ad copy and sponsor info.",
  },

  // --- Reddit (7 endpoints) ---
  {
    platform: "reddit",
    resource: "subreddit",
    method: "GET",
    params: [
      { name: "subreddit", required: true, description: "Subreddit name without the r/ prefix", example: "technology" },
    ],
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
    params: [
      { name: "subreddit", required: true, description: "Subreddit name without the r/ prefix", example: "technology" },
    ],
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
      { name: "query", required: true, description: "Search keyword or phrase to find Reddit ads", example: "gaming" },
    ],
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
      { name: "subreddit", required: true, description: "Subreddit name without the r/ prefix", example: "technology" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search within a subreddit",
    description:
      "Searches for posts within a specific subreddit. Returns matching posts with titles, scores, comment counts, and permalinks.",
  },

  // --- Threads (5 endpoints) ---
  {
    platform: "threads",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Threads username without the @ symbol", example: "zuck" },
    ],
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
    creditTier: "standard",
    creditCost: 1,
    archetype: "SearchResult",
    summary: "Search Threads users",
    description:
      "Searches Threads for user accounts matching a query. Returns matching profiles with follower counts and verification status.",
  },

  // --- Pinterest (4 endpoints) ---
  {
    platform: "pinterest",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase to find Pinterest pins", example: "home decor ideas" },
    ],
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
      { name: "handle", required: true, description: "Pinterest username", example: "pinterest" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "PostList",
    summary: "List Pinterest user boards",
    description:
      "Returns boards created by a Pinterest user. Each board includes title, description, pin count, and cover image.",
  },

  // --- Google (4 endpoints) ---
  {
    platform: "google",
    resource: "search",
    method: "GET",
    params: [
      { name: "query", required: true, description: "Search keyword or phrase", example: "best restaurants in London" },
    ],
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
    params: [
      { name: "domain", required: true, description: "Company domain name to look up ads for", example: "nike.com" },
    ],
    creditTier: "advanced",
    creditCost: 5,
    archetype: "PostList",
    summary: "List Google ads by company",
    description:
      "Returns ads from a specific company/domain in the Google Ads Transparency Center. Each ad includes creative, format, and date range.",
  },

  // --- Twitch (2 endpoints) ---
  {
    platform: "twitch",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Twitch username", example: "ninja" },
    ],
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
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Twitch clip details",
    description:
      "Returns detailed information about a specific Twitch clip including the title, view count, duration, creator name, broadcaster name, game name, thumbnail URL, and creation timestamp.",
  },

  // --- Truth Social (3 endpoints) ---
  {
    platform: "truthsocial",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Truth Social username without the @ symbol", example: "realDonaldTrump" },
    ],
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
    params: [
      { name: "handle", required: true, description: "Truth Social username without the @ symbol", example: "realDonaldTrump" },
    ],
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
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Truth Social post details",
    description:
      "Returns detailed information about a specific Truth Social post including the text content, like count, retruth count, reply count, media attachments, author info, and creation timestamp.",
  },

  // --- Snapchat (1 endpoint) ---
  {
    platform: "snapchat",
    resource: "profile",
    method: "GET",
    params: [
      { name: "handle", required: true, description: "Snapchat username", example: "djkhaled305" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Snapchat user profile",
    description:
      "Returns public profile information for a Snapchat user including display name, Bitmoji avatar URL, subscriber count, and bio description.",
  },

  // --- Kick (1 endpoint) ---
  {
    platform: "kick",
    resource: "clip",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Kick clip", example: "https://kick.com/xqc/clips/clip_abc123" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Kick clip details",
    description:
      "Returns detailed information about a specific Kick clip including the title, view count, duration, category, creator name, channel name, thumbnail URL, and creation timestamp.",
  },

  // --- Amazon (1 endpoint) ---
  {
    platform: "amazon",
    resource: "shop",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Amazon shop or storefront page", example: "https://www.amazon.com/shop/influencer123" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "Get Amazon shop page",
    description:
      "Returns product listings from an Amazon shop or storefront page including product names, prices, ratings, and images.",
  },

  // --- Utility (1 endpoint) ---
  {
    platform: "utility",
    resource: "age-gender",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Direct URL of the image to analyze", example: "https://example.com/photo.jpg" },
    ],
    creditTier: "premium",
    creditCost: 10,
    archetype: "Analytics",
    summary: "Detect age and gender",
    description:
      "Uses AI to detect the estimated age and gender of a person from an image URL. Returns age estimate, gender, and confidence score.",
  },

  // --- Linktree (1 endpoint) ---
  {
    platform: "linktree",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Linktree page", example: "https://linktr.ee/charlidamelio" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Linktree page",
    description:
      "Returns data from a Linktree page including the user's display name, bio, avatar, and list of links with titles and URLs.",
  },

  // --- Linkbio (1 endpoint) ---
  {
    platform: "linkbio",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Linkbio page", example: "https://lnk.bio/example" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Linkbio page",
    description:
      "Returns data from a Linkbio page including display name, bio, avatar, and list of links with titles and URLs.",
  },

  // --- Linkme (1 endpoint) ---
  {
    platform: "linkme",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Linkme page", example: "https://linkme.bio/example" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Linkme profile",
    description:
      "Returns data from a Linkme page including display name, bio, avatar, and list of links with titles and URLs.",
  },

  // --- Komi (1 endpoint) ---
  {
    platform: "komi",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Komi page", example: "https://komi.io/example" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Komi page",
    description:
      "Returns data from a Komi page including display name, bio, avatar, and list of links with titles and URLs.",
  },

  // --- Pillar (1 endpoint) ---
  {
    platform: "pillar",
    resource: "page",
    method: "GET",
    params: [
      { name: "url", required: true, description: "Full URL of the Pillar page", example: "https://pillar.io/example" },
    ],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Author",
    summary: "Get Pillar page",
    description:
      "Returns data from a Pillar page including display name, bio, avatar, and list of links with titles and URLs.",
  },
];

export function findEndpoint(platform: string, resource: string): Endpoint | undefined {
  return ENDPOINTS.find((e) => e.platform === platform && e.resource === resource);
}

export function getEndpointsByPlatform(platform: string): Endpoint[] {
  return ENDPOINTS.filter((e) => e.platform === platform);
}
