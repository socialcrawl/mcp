export const DOCS: Record<string, string> = {
  overview: `# SocialCrawl API

Unified social media data API. One API key, one response format, 24+ platforms.

## Base URL

https://socialcrawl.dev/v1

## Authentication

Pass your API key in the \`x-api-key\` header with every request.

## Platforms

- amazon (1 endpoint)
- facebook (12 endpoints)
- google (4 endpoints)
- instagram (12 endpoints)
- kick (1 endpoint)
- komi (1 endpoint)
- linkbio (1 endpoint)
- linkedin (6 endpoints)
- linkme (1 endpoint)
- linktree (1 endpoint)
- pillar (1 endpoint)
- pinterest (4 endpoints)
- reddit (7 endpoints)
- snapchat (1 endpoint)
- threads (5 endpoints)
- tiktok (24 endpoints)
- truthsocial (3 endpoints)
- twitch (2 endpoints)
- twitter (6 endpoints)
- utility (1 endpoint)
- youtube (11 endpoints)

## Credits

- Standard: 1 credit per request
- Advanced: 5 credits per request
- Premium: 10 credits per request

All endpoints currently cost 1 credit (standard tier).

## Full Reference

For complete endpoint documentation with parameters, examples, and response schemas:
https://socialcrawl.dev/llms-full.txt

## OpenAPI Spec

https://socialcrawl.dev/v1/openapi.json`,

  full: `# SocialCrawl API — Full Reference

## Base URL: https://socialcrawl.dev/v1

## Authentication

Every request requires an \`x-api-key\` header:

\`\`\`
curl https://socialcrawl.dev/v1/tiktok/profile?handle=charlidamelio \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

## Response Format

All responses follow this envelope:

\`\`\`json
{
  "success": true,
  "platform": "tiktok",
  "endpoint": "/v1/tiktok/profile",
  "data": { ... },
  "credits_used": 1,
  "credits_remaining": 4999,
  "request_id": "req-XXXXX",
  "cached": false
}
\`\`\`

---

## Amazon

### GET /amazon/shop

Get Amazon shop page

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Amazon shop or storefront page. Example: \`https://www.amazon.com/shop/influencer123\`

\`\`\`
curl "https://socialcrawl.dev/v1/amazon/shop?url=https://www.amazon.com/shop/influencer123" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Facebook

### GET /facebook/profile

Get Facebook page profile

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Facebook page or profile. Example: \`https://www.facebook.com/Meta\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/profile?url=https://www.facebook.com/Meta" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/profile/posts

List Facebook page posts

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Facebook page or profile to fetch posts for. Example: \`https://www.facebook.com/Meta\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/profile/posts?url=https://www.facebook.com/Meta" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/post

Get Facebook post details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Facebook post. Example: \`https://www.facebook.com/Meta/posts/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/post?url=https://www.facebook.com/Meta/posts/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/post/comments

List Facebook post comments

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Facebook post to fetch comments for. Example: \`https://www.facebook.com/Meta/posts/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/post/comments?url=https://www.facebook.com/Meta/posts/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/group/posts

List Facebook group posts

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Facebook group. Example: \`https://www.facebook.com/groups/reactjs/\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/group/posts?url=https://www.facebook.com/groups/reactjs/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/post/transcript

Get Facebook video transcript

Credit cost: 10 (premium)

Parameters:
- \`url\` (required): Full URL of the Facebook video post. Example: \`https://www.facebook.com/Meta/videos/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/post/transcript?url=https://www.facebook.com/Meta/videos/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/profile/photos

List Facebook profile photos

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Facebook page or profile. Example: \`https://www.facebook.com/Meta\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/profile/photos?url=https://www.facebook.com/Meta" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/profile/reels

List Facebook profile reels

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Facebook page or profile. Example: \`https://www.facebook.com/Meta\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/profile/reels?url=https://www.facebook.com/Meta" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/adlibrary/ad

Get Facebook Ad Library ad details

Credit cost: 5 (advanced)

Parameters:
- \`id\` (required): Facebook Ad Library ad ID. Example: \`23851234567890123\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/adlibrary/ad?id=23851234567890123" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/adlibrary/company/ads

List Facebook Ad Library company ads

Credit cost: 5 (advanced)

Parameters:
- \`pageId\` (required): Facebook page ID of the advertiser. Example: \`20531316728\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/adlibrary/company/ads?pageId=20531316728" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/adlibrary/search/ads

Search Facebook Ad Library

Credit cost: 5 (advanced)

Parameters:
- \`query\` (required): Search keyword or phrase to find ads in the Facebook Ad Library. Example: \`artificial intelligence\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/adlibrary/search/ads?query=artificial intelligence" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /facebook/adlibrary/search/companies

Search Facebook Ad Library companies

Credit cost: 5 (advanced)

Parameters:
- \`query\` (required): Search keyword or phrase to find companies in the Facebook Ad Library. Example: \`Nike\`

\`\`\`
curl "https://socialcrawl.dev/v1/facebook/adlibrary/search/companies?query=Nike" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Google

### GET /google/search

Google web search

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase. Example: \`best restaurants in London\`

\`\`\`
curl "https://socialcrawl.dev/v1/google/search?query=best restaurants in London" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /google/ad

Get Google ad details

Credit cost: 5 (advanced)

Parameters:
- \`url\` (required): Full URL of the Google ad or Ads Transparency Center page. Example: \`https://adstransparency.google.com/advertiser/AR12345678901234567\`

\`\`\`
curl "https://socialcrawl.dev/v1/google/ad?url=https://adstransparency.google.com/advertiser/AR12345678901234567" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /google/adlibrary/advertisers/search

Search Google Ad Library advertisers

Credit cost: 5 (advanced)

Parameters:
- \`query\` (required): Search keyword or phrase to find advertisers in the Google Ads Transparency Center. Example: \`Nike\`

\`\`\`
curl "https://socialcrawl.dev/v1/google/adlibrary/advertisers/search?query=Nike" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /google/company/ads

List Google ads by company

Credit cost: 5 (advanced)

Parameters:
- \`domain\` (required): Company domain name to look up ads for. Example: \`nike.com\`

\`\`\`
curl "https://socialcrawl.dev/v1/google/company/ads?domain=nike.com" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Instagram

### GET /instagram/profile

Get Instagram user profile

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/profile?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/profile/posts

List Instagram user posts

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/profile/posts?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/post

Get Instagram post details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Instagram post. Example: \`https://www.instagram.com/p/CwA1234abcd/\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/post?url=https://www.instagram.com/p/CwA1234abcd/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/post/comments

List Instagram post comments

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Instagram post to fetch comments for. Example: \`https://www.instagram.com/p/CwA1234abcd/\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/post/comments?url=https://www.instagram.com/p/CwA1234abcd/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/basic-profile

Get Instagram basic profile

Credit cost: 1 (standard)

Parameters:
- \`userId\` (required): Instagram numeric user ID. Example: \`25025320\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/basic-profile?userId=25025320" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/profile/reels

List Instagram user reels

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/profile/reels?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/highlights

List Instagram story highlights

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/highlights?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/highlight/detail

Get Instagram highlight detail

Credit cost: 1 (standard)

Parameters:
- \`id\` (required): Instagram highlight ID. Example: \`17854360229135492\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/highlight/detail?id=17854360229135492" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/search/reels

Search Instagram reels

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find Instagram reels. Example: \`workout routine\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/search/reels?query=workout routine" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/media/transcript

Get Instagram media transcript

Credit cost: 10 (premium)

Parameters:
- \`url\` (required): Full URL of the Instagram video or reel. Example: \`https://www.instagram.com/reel/CwA1234abcd/\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/media/transcript?url=https://www.instagram.com/reel/CwA1234abcd/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/user/embed

Get Instagram user embed HTML

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/user/embed?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /instagram/song/reels

List Instagram reels using a song

Credit cost: 1 (standard)

Parameters:
- \`audio_id\` (required): Instagram audio/song ID. Example: \`243313786724210\`

\`\`\`
curl "https://socialcrawl.dev/v1/instagram/song/reels?audio_id=243313786724210" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Kick

### GET /kick/clip

Get Kick clip details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Kick clip. Example: \`https://kick.com/xqc/clips/clip_abc123\`

\`\`\`
curl "https://socialcrawl.dev/v1/kick/clip?url=https://kick.com/xqc/clips/clip_abc123" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Komi

### GET /komi/page

Get Komi page

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Komi page. Example: \`https://komi.io/example\`

\`\`\`
curl "https://socialcrawl.dev/v1/komi/page?url=https://komi.io/example" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Linkbio

### GET /linkbio/page

Get Linkbio page

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Linkbio page. Example: \`https://lnk.bio/example\`

\`\`\`
curl "https://socialcrawl.dev/v1/linkbio/page?url=https://lnk.bio/example" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Linkedin

### GET /linkedin/profile

Get LinkedIn user profile

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the LinkedIn profile page. Example: \`https://www.linkedin.com/in/williamhgates/\`

\`\`\`
curl "https://socialcrawl.dev/v1/linkedin/profile?url=https://www.linkedin.com/in/williamhgates/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /linkedin/company

Get LinkedIn company page

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the LinkedIn company page. Example: \`https://www.linkedin.com/company/microsoft/\`

\`\`\`
curl "https://socialcrawl.dev/v1/linkedin/company?url=https://www.linkedin.com/company/microsoft/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /linkedin/post

Get LinkedIn post details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the LinkedIn post. Example: \`https://www.linkedin.com/posts/williamhgates_example-activity-1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/linkedin/post?url=https://www.linkedin.com/posts/williamhgates_example-activity-1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /linkedin/company/posts

List LinkedIn company posts

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the LinkedIn company page. Example: \`https://www.linkedin.com/company/microsoft/\`

\`\`\`
curl "https://socialcrawl.dev/v1/linkedin/company/posts?url=https://www.linkedin.com/company/microsoft/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /linkedin/ad

Get LinkedIn ad details

Credit cost: 5 (advanced)

Parameters:
- \`url\` (required): Full URL of the LinkedIn ad. Example: \`https://www.linkedin.com/ad/library/detail/12345\`

\`\`\`
curl "https://socialcrawl.dev/v1/linkedin/ad?url=https://www.linkedin.com/ad/library/detail/12345" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /linkedin/ads/search

Search LinkedIn ads

Credit cost: 5 (advanced)

Parameters:
- \`company\` (required): Company name or LinkedIn company page URL to search ads for. Example: \`Microsoft\`

\`\`\`
curl "https://socialcrawl.dev/v1/linkedin/ads/search?company=Microsoft" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Linkme

### GET /linkme/page

Get Linkme profile

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Linkme page. Example: \`https://linkme.bio/example\`

\`\`\`
curl "https://socialcrawl.dev/v1/linkme/page?url=https://linkme.bio/example" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Linktree

### GET /linktree/page

Get Linktree page

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Linktree page. Example: \`https://linktr.ee/charlidamelio\`

\`\`\`
curl "https://socialcrawl.dev/v1/linktree/page?url=https://linktr.ee/charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Pillar

### GET /pillar/page

Get Pillar page

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Pillar page. Example: \`https://pillar.io/example\`

\`\`\`
curl "https://socialcrawl.dev/v1/pillar/page?url=https://pillar.io/example" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Pinterest

### GET /pinterest/search

Search Pinterest pins

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find Pinterest pins. Example: \`home decor ideas\`

\`\`\`
curl "https://socialcrawl.dev/v1/pinterest/search?query=home decor ideas" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /pinterest/pin

Get Pinterest pin details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Pinterest pin. Example: \`https://www.pinterest.com/pin/1234567890/\`

\`\`\`
curl "https://socialcrawl.dev/v1/pinterest/pin?url=https://www.pinterest.com/pin/1234567890/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /pinterest/board

Get Pinterest board

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Pinterest board. Example: \`https://www.pinterest.com/pinterest/official-pinterest-pins/\`

\`\`\`
curl "https://socialcrawl.dev/v1/pinterest/board?url=https://www.pinterest.com/pinterest/official-pinterest-pins/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /pinterest/user/boards

List Pinterest user boards

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Pinterest username. Example: \`pinterest\`

\`\`\`
curl "https://socialcrawl.dev/v1/pinterest/user/boards?handle=pinterest" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Reddit

### GET /reddit/subreddit

List Reddit subreddit posts

Credit cost: 1 (standard)

Parameters:
- \`subreddit\` (required): Subreddit name without the r/ prefix. Example: \`technology\`

\`\`\`
curl "https://socialcrawl.dev/v1/reddit/subreddit?subreddit=technology" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /reddit/subreddit/details

Get Reddit subreddit details

Credit cost: 1 (standard)

Parameters:
- \`subreddit\` (required): Subreddit name without the r/ prefix. Example: \`technology\`

\`\`\`
curl "https://socialcrawl.dev/v1/reddit/subreddit/details?subreddit=technology" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /reddit/search

Search Reddit posts

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find Reddit posts. Example: \`best programming languages 2024\`

\`\`\`
curl "https://socialcrawl.dev/v1/reddit/search?query=best programming languages 2024" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /reddit/post/comments

List Reddit post comments

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Reddit post to fetch comments for. Example: \`https://www.reddit.com/r/technology/comments/abc123/example_post/\`

\`\`\`
curl "https://socialcrawl.dev/v1/reddit/post/comments?url=https://www.reddit.com/r/technology/comments/abc123/example_post/" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /reddit/ad

Get Reddit ad details

Credit cost: 5 (advanced)

Parameters:
- \`id\` (required): Reddit ad ID. Example: \`t3_abc123\`

\`\`\`
curl "https://socialcrawl.dev/v1/reddit/ad?id=t3_abc123" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /reddit/ads/search

Search Reddit ads

Credit cost: 5 (advanced)

Parameters:
- \`query\` (required): Search keyword or phrase to find Reddit ads. Example: \`gaming\`

\`\`\`
curl "https://socialcrawl.dev/v1/reddit/ads/search?query=gaming" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /reddit/subreddit/search

Search within a subreddit

Credit cost: 1 (standard)

Parameters:
- \`subreddit\` (required): Subreddit name without the r/ prefix. Example: \`technology\`

\`\`\`
curl "https://socialcrawl.dev/v1/reddit/subreddit/search?subreddit=technology" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Snapchat

### GET /snapchat/profile

Get Snapchat user profile

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Snapchat username. Example: \`djkhaled305\`

\`\`\`
curl "https://socialcrawl.dev/v1/snapchat/profile?handle=djkhaled305" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Threads

### GET /threads/profile

Get Threads user profile

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Threads username without the @ symbol. Example: \`zuck\`

\`\`\`
curl "https://socialcrawl.dev/v1/threads/profile?handle=zuck" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /threads/user/posts

List Threads user posts

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Threads username without the @ symbol. Example: \`zuck\`

\`\`\`
curl "https://socialcrawl.dev/v1/threads/user/posts?handle=zuck" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /threads/post

Get Threads post details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Threads post. Example: \`https://www.threads.net/@zuck/post/CwABCDEFGHI\`

\`\`\`
curl "https://socialcrawl.dev/v1/threads/post?url=https://www.threads.net/@zuck/post/CwABCDEFGHI" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /threads/search

Search Threads posts

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find Threads posts. Example: \`artificial intelligence\`

\`\`\`
curl "https://socialcrawl.dev/v1/threads/search?query=artificial intelligence" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /threads/search/users

Search Threads users

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find Threads users. Example: \`tech\`

\`\`\`
curl "https://socialcrawl.dev/v1/threads/search/users?query=tech" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Tiktok

### GET /tiktok/profile

Get TikTok user profile

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/profile?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/profile/videos

List TikTok user videos

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/profile/videos?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/post

Get TikTok post details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the TikTok video. Example: \`https://www.tiktok.com/@charlidamelio/video/7321485815660738859\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/post?url=https://www.tiktok.com/@charlidamelio/video/7321485815660738859" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/post/comments

List TikTok post comments

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the TikTok video to fetch comments for. Example: \`https://www.tiktok.com/@charlidamelio/video/7321485815660738859\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/post/comments?url=https://www.tiktok.com/@charlidamelio/video/7321485815660738859" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/search

Search TikTok videos by keyword

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find TikTok videos. Example: \`cooking recipes\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/search?query=cooking recipes" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/trending

Get TikTok trending feed

Credit cost: 5 (advanced)

Parameters:
- \`region\` (required): ISO 3166-1 alpha-2 country code (e.g., US, GB, KR). Example: \`US\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/trending?region=US" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/search/hashtag

Search TikTok by hashtag

Credit cost: 1 (standard)

Parameters:
- \`hashtag\` (required): Hashtag to search for without the # symbol. Example: \`fyp\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/search/hashtag?hashtag=fyp" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/search/top

TikTok top search results

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase. Example: \`dance challenge\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/search/top?query=dance challenge" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/search/users

Search TikTok users

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find TikTok users. Example: \`cooking\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/search/users?query=cooking" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/user/audience

Get TikTok user audience demographics

Credit cost: 5 (advanced)

Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/user/audience?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/user/followers

List TikTok user followers

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/user/followers?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/user/following

List TikTok user following

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/user/following?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/user/live

Get TikTok user live stream

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/user/live?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/post/transcript

Get TikTok video transcript

Credit cost: 10 (premium)

Parameters:
- \`url\` (required): Full URL of the TikTok video. Example: \`https://www.tiktok.com/@charlidamelio/video/7321485815660738859\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/post/transcript?url=https://www.tiktok.com/@charlidamelio/video/7321485815660738859" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/song

Get TikTok song details

Credit cost: 1 (standard)

Parameters:
- \`clipId\` (required): TikTok sound/song clip ID. Example: \`7252403792087040774\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/song?clipId=7252403792087040774" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/song/videos

List TikTok videos using a song

Credit cost: 1 (standard)

Parameters:
- \`clipId\` (required): TikTok sound/song clip ID. Example: \`7252403792087040774\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/song/videos?clipId=7252403792087040774" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/songs/popular

Get popular TikTok songs

Credit cost: 5 (advanced)

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/songs/popular?" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/creators/popular

Get popular TikTok creators

Credit cost: 5 (advanced)

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/creators/popular?" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/hashtags/popular

Get popular TikTok hashtags

Credit cost: 5 (advanced)

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/hashtags/popular?" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/videos/popular

Get popular TikTok videos

Credit cost: 5 (advanced)

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/videos/popular?" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/shop/product

Get TikTok Shop product details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the TikTok Shop product page. Example: \`https://www.tiktok.com/@shop/product/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/shop/product?url=https://www.tiktok.com/@shop/product/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/shop/product/reviews

List TikTok Shop product reviews

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the TikTok Shop product page. Example: \`https://www.tiktok.com/@shop/product/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/shop/product/reviews?url=https://www.tiktok.com/@shop/product/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/shop/products

List TikTok Shop products

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the TikTok Shop page. Example: \`https://www.tiktok.com/@shop/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/shop/products?url=https://www.tiktok.com/@shop/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /tiktok/shop/search

Search TikTok Shop products

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find TikTok Shop products. Example: \`phone case\`

\`\`\`
curl "https://socialcrawl.dev/v1/tiktok/shop/search?query=phone case" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Truthsocial

### GET /truthsocial/profile

Get Truth Social user profile

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Truth Social username without the @ symbol. Example: \`realDonaldTrump\`

\`\`\`
curl "https://socialcrawl.dev/v1/truthsocial/profile?handle=realDonaldTrump" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /truthsocial/user/posts

List Truth Social user posts

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Truth Social username without the @ symbol. Example: \`realDonaldTrump\`

\`\`\`
curl "https://socialcrawl.dev/v1/truthsocial/user/posts?handle=realDonaldTrump" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /truthsocial/post

Get Truth Social post details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Truth Social post. Example: \`https://truthsocial.com/@realDonaldTrump/posts/123456789\`

\`\`\`
curl "https://socialcrawl.dev/v1/truthsocial/post?url=https://truthsocial.com/@realDonaldTrump/posts/123456789" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Twitch

### GET /twitch/profile

Get Twitch streamer profile

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Twitch username. Example: \`ninja\`

\`\`\`
curl "https://socialcrawl.dev/v1/twitch/profile?handle=ninja" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /twitch/clip

Get Twitch clip details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Twitch clip. Example: \`https://www.twitch.tv/ninja/clip/ExampleClipSlug\`

\`\`\`
curl "https://socialcrawl.dev/v1/twitch/clip?url=https://www.twitch.tv/ninja/clip/ExampleClipSlug" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Twitter

### GET /twitter/profile

Get Twitter user profile

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Twitter username without the @ symbol. Example: \`elonmusk\`

\`\`\`
curl "https://socialcrawl.dev/v1/twitter/profile?handle=elonmusk" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /twitter/user/tweets

List Twitter user tweets

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): Twitter username without the @ symbol. Example: \`elonmusk\`

\`\`\`
curl "https://socialcrawl.dev/v1/twitter/user/tweets?handle=elonmusk" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /twitter/tweet

Get Twitter tweet details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the tweet. Example: \`https://x.com/elonmusk/status/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/twitter/tweet?url=https://x.com/elonmusk/status/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /twitter/community

Get Twitter community details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Twitter/X community. Example: \`https://x.com/i/communities/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/twitter/community?url=https://x.com/i/communities/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /twitter/community/tweets

List Twitter community tweets

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the Twitter/X community. Example: \`https://x.com/i/communities/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/twitter/community/tweets?url=https://x.com/i/communities/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /twitter/tweet/transcript

Get Twitter video transcript

Credit cost: 10 (premium)

Parameters:
- \`url\` (required): Full URL of the tweet containing a video. Example: \`https://x.com/elonmusk/status/1234567890\`

\`\`\`
curl "https://socialcrawl.dev/v1/twitter/tweet/transcript?url=https://x.com/elonmusk/status/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Utility

### GET /utility/age-gender

Detect age and gender

Credit cost: 10 (premium)

Parameters:
- \`url\` (required): Direct URL of the image to analyze. Example: \`https://example.com/photo.jpg\`

\`\`\`
curl "https://socialcrawl.dev/v1/utility/age-gender?url=https://example.com/photo.jpg" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Youtube

### GET /youtube/channel

Get YouTube channel info

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): YouTube channel handle without the @ symbol. Example: \`MrBeast\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/channel?handle=MrBeast" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/channel/videos

List YouTube channel videos

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): YouTube channel handle without the @ symbol. Example: \`MrBeast\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/channel/videos?handle=MrBeast" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/video

Get YouTube video details

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the YouTube video. Example: \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/video?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/video/comments

List YouTube video comments

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the YouTube video to fetch comments for. Example: \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/video/comments?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/search

Search YouTube videos

Credit cost: 1 (standard)

Parameters:
- \`query\` (required): Search keyword or phrase to find YouTube videos. Example: \`javascript tutorial\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/search?query=javascript tutorial" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/channel/shorts

List YouTube channel shorts

Credit cost: 1 (standard)

Parameters:
- \`handle\` (required): YouTube channel handle without the @ symbol. Example: \`MrBeast\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/channel/shorts?handle=MrBeast" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/community-post

Get YouTube community post

Credit cost: 1 (standard)

Parameters:
- \`url\` (required): Full URL of the YouTube community post. Example: \`https://www.youtube.com/post/UgkxCWeKpIOHLknREsNOF9M_aqz4fKkCERjP\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/community-post?url=https://www.youtube.com/post/UgkxCWeKpIOHLknREsNOF9M_aqz4fKkCERjP" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/playlist

Get YouTube playlist

Credit cost: 1 (standard)

Parameters:
- \`playlist_id\` (required): YouTube playlist ID. Example: \`PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/playlist?playlist_id=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/search/hashtag

Search YouTube by hashtag

Credit cost: 1 (standard)

Parameters:
- \`hashtag\` (required): Hashtag to search for without the # symbol. Example: \`shorts\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/search/hashtag?hashtag=shorts" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/shorts/trending

Get trending YouTube shorts

Credit cost: 5 (advanced)

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/shorts/trending?" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

### GET /youtube/video/transcript

Get YouTube video transcript

Credit cost: 10 (premium)

Parameters:
- \`url\` (required): Full URL of the YouTube video. Example: \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`

\`\`\`
curl "https://socialcrawl.dev/v1/youtube/video/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

---

## Error Codes

| Code | Status | Description |
|---|---|---|
| MISSING_API_KEY | 401 | No x-api-key header provided |
| INVALID_API_KEY | 401 | API key is malformed or not found |
| INSUFFICIENT_CREDITS | 402 | Not enough credits — purchase more at socialcrawl.dev |
| INVALID_REQUEST | 400 | Missing required parameters |
| ENDPOINT_NOT_FOUND | 404 | Unknown platform or resource |
| RESOURCE_NOT_FOUND | 404 | The requested item was not found on the platform |
| CONCURRENCY_LIMIT | 429 | Too many simultaneous requests (max 50 per key) |
| UPSTREAM_ERROR | 502 | Platform returned an error — credits refunded |
| SERVICE_UNAVAILABLE | 503 | Circuit breaker open — try again shortly, credits refunded |
| INTERNAL_ERROR | 500 | Unexpected error — credits refunded |`,

  authentication: `# Authentication

Pass your API key in the \`x-api-key\` header with every request.

\`\`\`bash
curl "https://www.socialcrawl.dev/v1/tiktok/profile?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"
\`\`\`

Get your free API key at https://socialcrawl.dev (100 credits, no credit card required).`,

  credits: `# Credit System

SocialCrawl uses a simple credit system:

| Tier | Cost | Description |
|------|------|-------------|
| Standard | 1 credit | Profiles, posts, comments, search (~90% of endpoints) |
| Advanced | 5 credits | Trending feeds, audience data, ad libraries |
| Premium | 10 credits | AI transcripts, age/gender detection |

Credits are deducted per request. If a request fails due to an upstream error, credits are automatically refunded.

## Pricing

| Plan | Price | Credits |
|------|-------|---------|
| Free | £0 | 100 (one-time signup bonus) |
| Starter | £14 | 5,000 |
| Growth | £49 | 25,000 |
| Pro | £299 | 180,000 |
| Enterprise | Contact | Custom |

Credits never expire. No rate limits.`,

  errors: `# Error Handling

All errors follow the same envelope format:

\`\`\`json
{
  "success": false,
  "error": {
    "type": "ERROR_CODE",
    "message": "Human-readable description",
    "status": 400
  },
  "request_id": "req-XXXXX"
}
\`\`\`

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| INVALID_API_KEY | 401 | API key is missing or invalid |
| INSUFFICIENT_CREDITS | 402 | Not enough credits for this request |
| MISSING_PARAMETER | 400 | Required query parameter missing |
| ENDPOINT_NOT_FOUND | 404 | Platform or resource does not exist |
| PLATFORM_UNAVAILABLE | 503 | Platform temporarily unavailable (circuit breaker open) |
| UPSTREAM_ERROR | 502 | Upstream data provider error (credits auto-refunded) |
| RATE_LIMIT_EXCEEDED | 429 | Too many concurrent requests |
| INTERNAL_ERROR | 500 | Unexpected server error`,

  tiktok: `# SocialCrawl API — tiktok endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/tiktok

## GET /v1/tiktok/profile
Get TikTok user profile
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`
curl "https://socialcrawl.dev/v1/tiktok/profile?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/profile/videos
List TikTok user videos
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`
curl "https://socialcrawl.dev/v1/tiktok/profile/videos?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/post
Get TikTok post details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the TikTok video. Example: \`https://www.tiktok.com/@charlidamelio/video/7321485815660738859\`
curl "https://socialcrawl.dev/v1/tiktok/post?url=https://www.tiktok.com/@charlidamelio/video/7321485815660738859" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/post/comments
List TikTok post comments
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the TikTok video to fetch comments for. Example: \`https://www.tiktok.com/@charlidamelio/video/7321485815660738859\`
curl "https://socialcrawl.dev/v1/tiktok/post/comments?url=https://www.tiktok.com/@charlidamelio/video/7321485815660738859" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/search
Search TikTok videos by keyword
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find TikTok videos. Example: \`cooking recipes\`
curl "https://socialcrawl.dev/v1/tiktok/search?query=cooking recipes" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/trending
Get TikTok trending feed
Credit cost: 5 (advanced)
Parameters:
- \`region\` (required): ISO 3166-1 alpha-2 country code (e.g., US, GB, KR). Example: \`US\`
curl "https://socialcrawl.dev/v1/tiktok/trending?region=US" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/search/hashtag
Search TikTok by hashtag
Credit cost: 1 (standard)
Parameters:
- \`hashtag\` (required): Hashtag to search for without the # symbol. Example: \`fyp\`
curl "https://socialcrawl.dev/v1/tiktok/search/hashtag?hashtag=fyp" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/search/top
TikTok top search results
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase. Example: \`dance challenge\`
curl "https://socialcrawl.dev/v1/tiktok/search/top?query=dance challenge" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/search/users
Search TikTok users
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find TikTok users. Example: \`cooking\`
curl "https://socialcrawl.dev/v1/tiktok/search/users?query=cooking" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/user/audience
Get TikTok user audience demographics
Credit cost: 5 (advanced)
Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`
curl "https://socialcrawl.dev/v1/tiktok/user/audience?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/user/followers
List TikTok user followers
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`
curl "https://socialcrawl.dev/v1/tiktok/user/followers?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/user/following
List TikTok user following
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`
curl "https://socialcrawl.dev/v1/tiktok/user/following?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/user/live
Get TikTok user live stream
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): TikTok username without the @ symbol. Example: \`charlidamelio\`
curl "https://socialcrawl.dev/v1/tiktok/user/live?handle=charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/post/transcript
Get TikTok video transcript
Credit cost: 10 (premium)
Parameters:
- \`url\` (required): Full URL of the TikTok video. Example: \`https://www.tiktok.com/@charlidamelio/video/7321485815660738859\`
curl "https://socialcrawl.dev/v1/tiktok/post/transcript?url=https://www.tiktok.com/@charlidamelio/video/7321485815660738859" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/song
Get TikTok song details
Credit cost: 1 (standard)
Parameters:
- \`clipId\` (required): TikTok sound/song clip ID. Example: \`7252403792087040774\`
curl "https://socialcrawl.dev/v1/tiktok/song?clipId=7252403792087040774" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/song/videos
List TikTok videos using a song
Credit cost: 1 (standard)
Parameters:
- \`clipId\` (required): TikTok sound/song clip ID. Example: \`7252403792087040774\`
curl "https://socialcrawl.dev/v1/tiktok/song/videos?clipId=7252403792087040774" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/songs/popular
Get popular TikTok songs
Credit cost: 5 (advanced)
curl "https://socialcrawl.dev/v1/tiktok/songs/popular" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/creators/popular
Get popular TikTok creators
Credit cost: 5 (advanced)
curl "https://socialcrawl.dev/v1/tiktok/creators/popular" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/hashtags/popular
Get popular TikTok hashtags
Credit cost: 5 (advanced)
curl "https://socialcrawl.dev/v1/tiktok/hashtags/popular" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/videos/popular
Get popular TikTok videos
Credit cost: 5 (advanced)
curl "https://socialcrawl.dev/v1/tiktok/videos/popular" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/shop/product
Get TikTok Shop product details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the TikTok Shop product page. Example: \`https://www.tiktok.com/@shop/product/1234567890\`
curl "https://socialcrawl.dev/v1/tiktok/shop/product?url=https://www.tiktok.com/@shop/product/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/shop/product/reviews
List TikTok Shop product reviews
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the TikTok Shop product page. Example: \`https://www.tiktok.com/@shop/product/1234567890\`
curl "https://socialcrawl.dev/v1/tiktok/shop/product/reviews?url=https://www.tiktok.com/@shop/product/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/shop/products
List TikTok Shop products
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the TikTok Shop page. Example: \`https://www.tiktok.com/@shop/1234567890\`
curl "https://socialcrawl.dev/v1/tiktok/shop/products?url=https://www.tiktok.com/@shop/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/tiktok/shop/search
Search TikTok Shop products
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find TikTok Shop products. Example: \`phone case\`
curl "https://socialcrawl.dev/v1/tiktok/shop/search?query=phone case" \\
  -H "x-api-key: sc_your_api_key_here"`,

  instagram: `# SocialCrawl API — instagram endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/instagram

## GET /v1/instagram/profile
Get Instagram user profile
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`
curl "https://socialcrawl.dev/v1/instagram/profile?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/profile/posts
List Instagram user posts
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`
curl "https://socialcrawl.dev/v1/instagram/profile/posts?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/post
Get Instagram post details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Instagram post. Example: \`https://www.instagram.com/p/CwA1234abcd/\`
curl "https://socialcrawl.dev/v1/instagram/post?url=https://www.instagram.com/p/CwA1234abcd/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/post/comments
List Instagram post comments
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Instagram post to fetch comments for. Example: \`https://www.instagram.com/p/CwA1234abcd/\`
curl "https://socialcrawl.dev/v1/instagram/post/comments?url=https://www.instagram.com/p/CwA1234abcd/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/basic-profile
Get Instagram basic profile
Credit cost: 1 (standard)
Parameters:
- \`userId\` (required): Instagram numeric user ID. Example: \`25025320\`
curl "https://socialcrawl.dev/v1/instagram/basic-profile?userId=25025320" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/profile/reels
List Instagram user reels
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`
curl "https://socialcrawl.dev/v1/instagram/profile/reels?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/highlights
List Instagram story highlights
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`
curl "https://socialcrawl.dev/v1/instagram/highlights?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/highlight/detail
Get Instagram highlight detail
Credit cost: 1 (standard)
Parameters:
- \`id\` (required): Instagram highlight ID. Example: \`17854360229135492\`
curl "https://socialcrawl.dev/v1/instagram/highlight/detail?id=17854360229135492" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/search/reels
Search Instagram reels
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find Instagram reels. Example: \`workout routine\`
curl "https://socialcrawl.dev/v1/instagram/search/reels?query=workout routine" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/media/transcript
Get Instagram media transcript
Credit cost: 10 (premium)
Parameters:
- \`url\` (required): Full URL of the Instagram video or reel. Example: \`https://www.instagram.com/reel/CwA1234abcd/\`
curl "https://socialcrawl.dev/v1/instagram/media/transcript?url=https://www.instagram.com/reel/CwA1234abcd/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/user/embed
Get Instagram user embed HTML
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Instagram username without the @ symbol. Example: \`instagram\`
curl "https://socialcrawl.dev/v1/instagram/user/embed?handle=instagram" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/instagram/song/reels
List Instagram reels using a song
Credit cost: 1 (standard)
Parameters:
- \`audio_id\` (required): Instagram audio/song ID. Example: \`243313786724210\`
curl "https://socialcrawl.dev/v1/instagram/song/reels?audio_id=243313786724210" \\
  -H "x-api-key: sc_your_api_key_here"`,

  youtube: `# SocialCrawl API — youtube endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/youtube

## GET /v1/youtube/channel
Get YouTube channel info
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): YouTube channel handle without the @ symbol. Example: \`MrBeast\`
curl "https://socialcrawl.dev/v1/youtube/channel?handle=MrBeast" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/channel/videos
List YouTube channel videos
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): YouTube channel handle without the @ symbol. Example: \`MrBeast\`
curl "https://socialcrawl.dev/v1/youtube/channel/videos?handle=MrBeast" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/video
Get YouTube video details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the YouTube video. Example: \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`
curl "https://socialcrawl.dev/v1/youtube/video?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/video/comments
List YouTube video comments
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the YouTube video to fetch comments for. Example: \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`
curl "https://socialcrawl.dev/v1/youtube/video/comments?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/search
Search YouTube videos
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find YouTube videos. Example: \`javascript tutorial\`
curl "https://socialcrawl.dev/v1/youtube/search?query=javascript tutorial" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/channel/shorts
List YouTube channel shorts
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): YouTube channel handle without the @ symbol. Example: \`MrBeast\`
curl "https://socialcrawl.dev/v1/youtube/channel/shorts?handle=MrBeast" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/community-post
Get YouTube community post
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the YouTube community post. Example: \`https://www.youtube.com/post/UgkxCWeKpIOHLknREsNOF9M_aqz4fKkCERjP\`
curl "https://socialcrawl.dev/v1/youtube/community-post?url=https://www.youtube.com/post/UgkxCWeKpIOHLknREsNOF9M_aqz4fKkCERjP" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/playlist
Get YouTube playlist
Credit cost: 1 (standard)
Parameters:
- \`playlist_id\` (required): YouTube playlist ID. Example: \`PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf\`
curl "https://socialcrawl.dev/v1/youtube/playlist?playlist_id=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/search/hashtag
Search YouTube by hashtag
Credit cost: 1 (standard)
Parameters:
- \`hashtag\` (required): Hashtag to search for without the # symbol. Example: \`shorts\`
curl "https://socialcrawl.dev/v1/youtube/search/hashtag?hashtag=shorts" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/shorts/trending
Get trending YouTube shorts
Credit cost: 5 (advanced)
curl "https://socialcrawl.dev/v1/youtube/shorts/trending" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/youtube/video/transcript
Get YouTube video transcript
Credit cost: 10 (premium)
Parameters:
- \`url\` (required): Full URL of the YouTube video. Example: \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`
curl "https://socialcrawl.dev/v1/youtube/video/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" \\
  -H "x-api-key: sc_your_api_key_here"`,

  facebook: `# SocialCrawl API — facebook endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/facebook

## GET /v1/facebook/profile
Get Facebook page profile
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Facebook page or profile. Example: \`https://www.facebook.com/Meta\`
curl "https://socialcrawl.dev/v1/facebook/profile?url=https://www.facebook.com/Meta" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/profile/posts
List Facebook page posts
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Facebook page or profile to fetch posts for. Example: \`https://www.facebook.com/Meta\`
curl "https://socialcrawl.dev/v1/facebook/profile/posts?url=https://www.facebook.com/Meta" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/post
Get Facebook post details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Facebook post. Example: \`https://www.facebook.com/Meta/posts/1234567890\`
curl "https://socialcrawl.dev/v1/facebook/post?url=https://www.facebook.com/Meta/posts/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/post/comments
List Facebook post comments
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Facebook post to fetch comments for. Example: \`https://www.facebook.com/Meta/posts/1234567890\`
curl "https://socialcrawl.dev/v1/facebook/post/comments?url=https://www.facebook.com/Meta/posts/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/group/posts
List Facebook group posts
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Facebook group. Example: \`https://www.facebook.com/groups/reactjs/\`
curl "https://socialcrawl.dev/v1/facebook/group/posts?url=https://www.facebook.com/groups/reactjs/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/post/transcript
Get Facebook video transcript
Credit cost: 10 (premium)
Parameters:
- \`url\` (required): Full URL of the Facebook video post. Example: \`https://www.facebook.com/Meta/videos/1234567890\`
curl "https://socialcrawl.dev/v1/facebook/post/transcript?url=https://www.facebook.com/Meta/videos/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/profile/photos
List Facebook profile photos
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Facebook page or profile. Example: \`https://www.facebook.com/Meta\`
curl "https://socialcrawl.dev/v1/facebook/profile/photos?url=https://www.facebook.com/Meta" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/profile/reels
List Facebook profile reels
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Facebook page or profile. Example: \`https://www.facebook.com/Meta\`
curl "https://socialcrawl.dev/v1/facebook/profile/reels?url=https://www.facebook.com/Meta" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/adlibrary/ad
Get Facebook Ad Library ad details
Credit cost: 5 (advanced)
Parameters:
- \`id\` (required): Facebook Ad Library ad ID. Example: \`23851234567890123\`
curl "https://socialcrawl.dev/v1/facebook/adlibrary/ad?id=23851234567890123" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/adlibrary/company/ads
List Facebook Ad Library company ads
Credit cost: 5 (advanced)
Parameters:
- \`pageId\` (required): Facebook page ID of the advertiser. Example: \`20531316728\`
curl "https://socialcrawl.dev/v1/facebook/adlibrary/company/ads?pageId=20531316728" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/adlibrary/search/ads
Search Facebook Ad Library
Credit cost: 5 (advanced)
Parameters:
- \`query\` (required): Search keyword or phrase to find ads in the Facebook Ad Library. Example: \`artificial intelligence\`
curl "https://socialcrawl.dev/v1/facebook/adlibrary/search/ads?query=artificial intelligence" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/facebook/adlibrary/search/companies
Search Facebook Ad Library companies
Credit cost: 5 (advanced)
Parameters:
- \`query\` (required): Search keyword or phrase to find companies in the Facebook Ad Library. Example: \`Nike\`
curl "https://socialcrawl.dev/v1/facebook/adlibrary/search/companies?query=Nike" \\
  -H "x-api-key: sc_your_api_key_here"`,

  twitter: `# SocialCrawl API — twitter endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/twitter

## GET /v1/twitter/profile
Get Twitter user profile
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Twitter username without the @ symbol. Example: \`elonmusk\`
curl "https://socialcrawl.dev/v1/twitter/profile?handle=elonmusk" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/twitter/user/tweets
List Twitter user tweets
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Twitter username without the @ symbol. Example: \`elonmusk\`
curl "https://socialcrawl.dev/v1/twitter/user/tweets?handle=elonmusk" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/twitter/tweet
Get Twitter tweet details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the tweet. Example: \`https://x.com/elonmusk/status/1234567890\`
curl "https://socialcrawl.dev/v1/twitter/tweet?url=https://x.com/elonmusk/status/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/twitter/community
Get Twitter community details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Twitter/X community. Example: \`https://x.com/i/communities/1234567890\`
curl "https://socialcrawl.dev/v1/twitter/community?url=https://x.com/i/communities/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/twitter/community/tweets
List Twitter community tweets
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Twitter/X community. Example: \`https://x.com/i/communities/1234567890\`
curl "https://socialcrawl.dev/v1/twitter/community/tweets?url=https://x.com/i/communities/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/twitter/tweet/transcript
Get Twitter video transcript
Credit cost: 10 (premium)
Parameters:
- \`url\` (required): Full URL of the tweet containing a video. Example: \`https://x.com/elonmusk/status/1234567890\`
curl "https://socialcrawl.dev/v1/twitter/tweet/transcript?url=https://x.com/elonmusk/status/1234567890" \\
  -H "x-api-key: sc_your_api_key_here"`,

  linkedin: `# SocialCrawl API — linkedin endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/linkedin

## GET /v1/linkedin/profile
Get LinkedIn user profile
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the LinkedIn profile page. Example: \`https://www.linkedin.com/in/williamhgates/\`
curl "https://socialcrawl.dev/v1/linkedin/profile?url=https://www.linkedin.com/in/williamhgates/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/linkedin/company
Get LinkedIn company page
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the LinkedIn company page. Example: \`https://www.linkedin.com/company/microsoft/\`
curl "https://socialcrawl.dev/v1/linkedin/company?url=https://www.linkedin.com/company/microsoft/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/linkedin/post
Get LinkedIn post details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the LinkedIn post. Example: \`https://www.linkedin.com/posts/williamhgates_example-activity-1234567890\`
curl "https://socialcrawl.dev/v1/linkedin/post?url=https://www.linkedin.com/posts/williamhgates_example-activity-1234567890" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/linkedin/company/posts
List LinkedIn company posts
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the LinkedIn company page. Example: \`https://www.linkedin.com/company/microsoft/\`
curl "https://socialcrawl.dev/v1/linkedin/company/posts?url=https://www.linkedin.com/company/microsoft/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/linkedin/ad
Get LinkedIn ad details
Credit cost: 5 (advanced)
Parameters:
- \`url\` (required): Full URL of the LinkedIn ad. Example: \`https://www.linkedin.com/ad/library/detail/12345\`
curl "https://socialcrawl.dev/v1/linkedin/ad?url=https://www.linkedin.com/ad/library/detail/12345" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/linkedin/ads/search
Search LinkedIn ads
Credit cost: 5 (advanced)
Parameters:
- \`company\` (required): Company name or LinkedIn company page URL to search ads for. Example: \`Microsoft\`
curl "https://socialcrawl.dev/v1/linkedin/ads/search?company=Microsoft" \\
  -H "x-api-key: sc_your_api_key_here"`,

  reddit: `# SocialCrawl API — reddit endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/reddit

## GET /v1/reddit/subreddit
List Reddit subreddit posts
Credit cost: 1 (standard)
Parameters:
- \`subreddit\` (required): Subreddit name without the r/ prefix. Example: \`technology\`
curl "https://socialcrawl.dev/v1/reddit/subreddit?subreddit=technology" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/reddit/subreddit/details
Get Reddit subreddit details
Credit cost: 1 (standard)
Parameters:
- \`subreddit\` (required): Subreddit name without the r/ prefix. Example: \`technology\`
curl "https://socialcrawl.dev/v1/reddit/subreddit/details?subreddit=technology" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/reddit/search
Search Reddit posts
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find Reddit posts. Example: \`best programming languages 2024\`
curl "https://socialcrawl.dev/v1/reddit/search?query=best programming languages 2024" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/reddit/post/comments
List Reddit post comments
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Reddit post to fetch comments for. Example: \`https://www.reddit.com/r/technology/comments/abc123/example_post/\`
curl "https://socialcrawl.dev/v1/reddit/post/comments?url=https://www.reddit.com/r/technology/comments/abc123/example_post/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/reddit/ad
Get Reddit ad details
Credit cost: 5 (advanced)
Parameters:
- \`id\` (required): Reddit ad ID. Example: \`t3_abc123\`
curl "https://socialcrawl.dev/v1/reddit/ad?id=t3_abc123" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/reddit/ads/search
Search Reddit ads
Credit cost: 5 (advanced)
Parameters:
- \`query\` (required): Search keyword or phrase to find Reddit ads. Example: \`gaming\`
curl "https://socialcrawl.dev/v1/reddit/ads/search?query=gaming" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/reddit/subreddit/search
Search within a subreddit
Credit cost: 1 (standard)
Parameters:
- \`subreddit\` (required): Subreddit name without the r/ prefix. Example: \`technology\`
curl "https://socialcrawl.dev/v1/reddit/subreddit/search?subreddit=technology" \\
  -H "x-api-key: sc_your_api_key_here"`,

  threads: `# SocialCrawl API — threads endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/threads

## GET /v1/threads/profile
Get Threads user profile
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Threads username without the @ symbol. Example: \`zuck\`
curl "https://socialcrawl.dev/v1/threads/profile?handle=zuck" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/threads/user/posts
List Threads user posts
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Threads username without the @ symbol. Example: \`zuck\`
curl "https://socialcrawl.dev/v1/threads/user/posts?handle=zuck" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/threads/post
Get Threads post details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Threads post. Example: \`https://www.threads.net/@zuck/post/CwABCDEFGHI\`
curl "https://socialcrawl.dev/v1/threads/post?url=https://www.threads.net/@zuck/post/CwABCDEFGHI" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/threads/search
Search Threads posts
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find Threads posts. Example: \`artificial intelligence\`
curl "https://socialcrawl.dev/v1/threads/search?query=artificial intelligence" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/threads/search/users
Search Threads users
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find Threads users. Example: \`tech\`
curl "https://socialcrawl.dev/v1/threads/search/users?query=tech" \\
  -H "x-api-key: sc_your_api_key_here"`,

  pinterest: `# SocialCrawl API — pinterest endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/pinterest

## GET /v1/pinterest/search
Search Pinterest pins
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase to find Pinterest pins. Example: \`home decor ideas\`
curl "https://socialcrawl.dev/v1/pinterest/search?query=home decor ideas" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/pinterest/pin
Get Pinterest pin details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Pinterest pin. Example: \`https://www.pinterest.com/pin/1234567890/\`
curl "https://socialcrawl.dev/v1/pinterest/pin?url=https://www.pinterest.com/pin/1234567890/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/pinterest/board
Get Pinterest board
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Pinterest board. Example: \`https://www.pinterest.com/pinterest/official-pinterest-pins/\`
curl "https://socialcrawl.dev/v1/pinterest/board?url=https://www.pinterest.com/pinterest/official-pinterest-pins/" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/pinterest/user/boards
List Pinterest user boards
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Pinterest username. Example: \`pinterest\`
curl "https://socialcrawl.dev/v1/pinterest/user/boards?handle=pinterest" \\
  -H "x-api-key: sc_your_api_key_here"`,

  google: `# SocialCrawl API — google endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/google

## GET /v1/google/search
Google web search
Credit cost: 1 (standard)
Parameters:
- \`query\` (required): Search keyword or phrase. Example: \`best restaurants in London\`
curl "https://socialcrawl.dev/v1/google/search?query=best restaurants in London" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/google/ad
Get Google ad details
Credit cost: 5 (advanced)
Parameters:
- \`url\` (required): Full URL of the Google ad or Ads Transparency Center page. Example: \`https://adstransparency.google.com/advertiser/AR12345678901234567\`
curl "https://socialcrawl.dev/v1/google/ad?url=https://adstransparency.google.com/advertiser/AR12345678901234567" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/google/adlibrary/advertisers/search
Search Google Ad Library advertisers
Credit cost: 5 (advanced)
Parameters:
- \`query\` (required): Search keyword or phrase to find advertisers in the Google Ads Transparency Center. Example: \`Nike\`
curl "https://socialcrawl.dev/v1/google/adlibrary/advertisers/search?query=Nike" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/google/company/ads
List Google ads by company
Credit cost: 5 (advanced)
Parameters:
- \`domain\` (required): Company domain name to look up ads for. Example: \`nike.com\`
curl "https://socialcrawl.dev/v1/google/company/ads?domain=nike.com" \\
  -H "x-api-key: sc_your_api_key_here"`,

  twitch: `# SocialCrawl API — twitch endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/twitch

## GET /v1/twitch/profile
Get Twitch streamer profile
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Twitch username. Example: \`ninja\`
curl "https://socialcrawl.dev/v1/twitch/profile?handle=ninja" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/twitch/clip
Get Twitch clip details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Twitch clip. Example: \`https://www.twitch.tv/ninja/clip/ExampleClipSlug\`
curl "https://socialcrawl.dev/v1/twitch/clip?url=https://www.twitch.tv/ninja/clip/ExampleClipSlug" \\
  -H "x-api-key: sc_your_api_key_here"`,

  truthsocial: `# SocialCrawl API — truthsocial endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/truthsocial

## GET /v1/truthsocial/profile
Get Truth Social user profile
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Truth Social username without the @ symbol. Example: \`realDonaldTrump\`
curl "https://socialcrawl.dev/v1/truthsocial/profile?handle=realDonaldTrump" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/truthsocial/user/posts
List Truth Social user posts
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Truth Social username without the @ symbol. Example: \`realDonaldTrump\`
curl "https://socialcrawl.dev/v1/truthsocial/user/posts?handle=realDonaldTrump" \\
  -H "x-api-key: sc_your_api_key_here"

## GET /v1/truthsocial/post
Get Truth Social post details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Truth Social post. Example: \`https://truthsocial.com/@realDonaldTrump/posts/123456789\`
curl "https://socialcrawl.dev/v1/truthsocial/post?url=https://truthsocial.com/@realDonaldTrump/posts/123456789" \\
  -H "x-api-key: sc_your_api_key_here"`,

  snapchat: `# SocialCrawl API — snapchat endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/snapchat

## GET /v1/snapchat/profile
Get Snapchat user profile
Credit cost: 1 (standard)
Parameters:
- \`handle\` (required): Snapchat username. Example: \`djkhaled305\`
curl "https://socialcrawl.dev/v1/snapchat/profile?handle=djkhaled305" \\
  -H "x-api-key: sc_your_api_key_here"`,

  kick: `# SocialCrawl API — kick endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/kick

## GET /v1/kick/clip
Get Kick clip details
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Kick clip. Example: \`https://kick.com/xqc/clips/clip_abc123\`
curl "https://socialcrawl.dev/v1/kick/clip?url=https://kick.com/xqc/clips/clip_abc123" \\
  -H "x-api-key: sc_your_api_key_here"`,

  amazon: `# SocialCrawl API — amazon endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/amazon

## GET /v1/amazon/shop
Get Amazon shop page
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Amazon shop or storefront page. Example: \`https://www.amazon.com/shop/influencer123\`
curl "https://socialcrawl.dev/v1/amazon/shop?url=https://www.amazon.com/shop/influencer123" \\
  -H "x-api-key: sc_your_api_key_here"`,

  linktree: `# SocialCrawl API — linktree endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/linktree

## GET /v1/linktree/page
Get Linktree page
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Linktree page. Example: \`https://linktr.ee/charlidamelio\`
curl "https://socialcrawl.dev/v1/linktree/page?url=https://linktr.ee/charlidamelio" \\
  -H "x-api-key: sc_your_api_key_here"`,

  linkbio: `# SocialCrawl API — linkbio endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/linkbio

## GET /v1/linkbio/page
Get Linkbio page
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Linkbio page. Example: \`https://lnk.bio/example\`
curl "https://socialcrawl.dev/v1/linkbio/page?url=https://lnk.bio/example" \\
  -H "x-api-key: sc_your_api_key_here"`,

  linkme: `# SocialCrawl API — linkme endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/linkme

## GET /v1/linkme/page
Get Linkme profile
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Linkme page. Example: \`https://linkme.bio/example\`
curl "https://socialcrawl.dev/v1/linkme/page?url=https://linkme.bio/example" \\
  -H "x-api-key: sc_your_api_key_here"`,

  komi: `# SocialCrawl API — komi endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/komi

## GET /v1/komi/page
Get Komi page
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Komi page. Example: \`https://komi.io/example\`
curl "https://socialcrawl.dev/v1/komi/page?url=https://komi.io/example" \\
  -H "x-api-key: sc_your_api_key_here"`,

  pillar: `# SocialCrawl API — pillar endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/pillar

## GET /v1/pillar/page
Get Pillar page
Credit cost: 1 (standard)
Parameters:
- \`url\` (required): Full URL of the Pillar page. Example: \`https://pillar.io/example\`
curl "https://socialcrawl.dev/v1/pillar/page?url=https://pillar.io/example" \\
  -H "x-api-key: sc_your_api_key_here"`,

  utility: `# SocialCrawl API — utility endpoints
# Base URL: https://socialcrawl.dev
# Auth: x-api-key header
# Full docs: https://socialcrawl.dev/docs/utility

## GET /v1/utility/age-gender
Detect age and gender
Credit cost: 10 (premium)
Parameters:
- \`url\` (required): Direct URL of the image to analyze. Example: \`https://example.com/photo.jpg\`
curl "https://socialcrawl.dev/v1/utility/age-gender?url=https://example.com/photo.jpg" \\
  -H "x-api-key: sc_your_api_key_here"`,
};

export function getDoc(topic: string): string | undefined {
  return DOCS[topic];
}

export function getAvailableTopics(): string[] {
  return Object.keys(DOCS);
}
