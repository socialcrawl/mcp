import type { Platform } from "../types.js";

export const PLATFORMS: Platform[] = [
  {
    slug: "tiktok",
    name: "TikTok",
    endpointCount: 24,
    description:
      "Profiles, videos, comments, search, trending, hashtags, followers, following, live streams, songs, TikTok Shop products, and audience demographics.",
  },
  {
    slug: "instagram",
    name: "Instagram",
    endpointCount: 12,
    description:
      "Profiles, posts, reels, comments, story highlights, search, songs, embed HTML, and AI-powered media transcripts.",
  },
  {
    slug: "youtube",
    name: "YouTube",
    endpointCount: 11,
    description:
      "Channels, videos, shorts, comments, playlists, community posts, search, hashtag search, trending shorts, and video transcripts.",
  },
  {
    slug: "facebook",
    name: "Facebook",
    endpointCount: 12,
    description:
      "Pages, posts, comments, groups, photos, reels, video transcripts, and Facebook Ad Library (ads, company ads, search).",
  },
  {
    slug: "twitter",
    name: "X (Twitter)",
    endpointCount: 6,
    description:
      "Profiles, tweets, communities, community tweets, search, and video transcripts.",
  },
  {
    slug: "linkedin",
    name: "LinkedIn",
    endpointCount: 6,
    description:
      "Personal profiles, company pages, posts, company posts, and LinkedIn Ad Library (ad details, ad search).",
  },
  {
    slug: "reddit",
    name: "Reddit",
    endpointCount: 7,
    description:
      "Subreddit posts and details, post comments, search, subreddit search, and Reddit ad transparency (ad details, ad search).",
  },
  {
    slug: "threads",
    name: "Threads",
    endpointCount: 5,
    description:
      "Profiles, posts, post details, user search, and keyword search.",
  },
  {
    slug: "pinterest",
    name: "Pinterest",
    endpointCount: 4,
    description: "Pins, boards, user boards, and keyword search.",
  },
  {
    slug: "google",
    name: "Google",
    endpointCount: 4,
    description:
      "Web search results and Google Ads Transparency Center (ad details, advertiser search, company ads).",
  },
  {
    slug: "twitch",
    name: "Twitch",
    endpointCount: 2,
    description: "Streamer profiles and clip details.",
  },
  {
    slug: "truthsocial",
    name: "Truth Social",
    endpointCount: 3,
    description: "Profiles, user posts, and post details.",
  },
  {
    slug: "snapchat",
    name: "Snapchat",
    endpointCount: 1,
    description: "Public user profiles including subscriber count and bio.",
  },
  {
    slug: "kick",
    name: "Kick",
    endpointCount: 1,
    description: "Clip details including view count, duration, and category.",
  },
  {
    slug: "amazon",
    name: "Amazon",
    endpointCount: 1,
    description:
      "Amazon shop and storefront pages including product listings, prices, and ratings.",
  },
  {
    slug: "linktree",
    name: "Linktree",
    endpointCount: 1,
    description:
      "Linktree link-in-bio pages including display name, bio, avatar, and link list.",
  },
  {
    slug: "linkbio",
    name: "Linkbio",
    endpointCount: 1,
    description:
      "Linkbio link-in-bio pages including display name, bio, avatar, and link list.",
  },
  {
    slug: "linkme",
    name: "Linkme",
    endpointCount: 1,
    description:
      "Linkme link-in-bio pages including display name, bio, avatar, and link list.",
  },
  {
    slug: "komi",
    name: "Komi",
    endpointCount: 1,
    description:
      "Komi link-in-bio pages including display name, bio, avatar, and link list.",
  },
  {
    slug: "pillar",
    name: "Pillar",
    endpointCount: 1,
    description:
      "Pillar link-in-bio pages including display name, bio, avatar, and link list.",
  },
  {
    slug: "utility",
    name: "Utility",
    endpointCount: 1,
    description:
      "AI-powered utility tools including age and gender detection from image URLs.",
  },
];

export function findPlatform(slug: string): Platform | undefined {
  return PLATFORMS.find((p) => p.slug === slug);
}

export function getAllPlatformSlugs(): string[] {
  return PLATFORMS.map((p) => p.slug);
}
