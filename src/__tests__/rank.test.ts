import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildIndex, didYouMean, rank, resourceCoverage, tokenize, stem } from "../search/rank.js";
import { searchEndpoints } from "../search/catalog.js";

interface RankCase {
  query: string;
  expected_top: string;
  top_k: number;
}

const CASES = JSON.parse(
  readFileSync(new URL("../search/__fixtures__/rank-cases.json", import.meta.url), "utf8"),
) as RankCase[];

describe("tokenize", () => {
  it("lowercases and splits on / _ - and whitespace", () => {
    expect(tokenize("TikTok/post/comments google_play app-reviews")).toEqual([
      "tiktok",
      "post",
      "comment",
      "google",
      "play",
      "app",
      "review",
    ]);
  });

  it("drops stopwords and punctuation", () => {
    expect(tokenize("Get the comments, for a video!")).toEqual(["comment", "video"]);
  });

  it("folds simple plurals", () => {
    expect(stem("replies")).toBe("reply");
    expect(stem("searches")).toBe("search");
    expect(stem("comments")).toBe("comment");
    expect(stem("ads")).toBe("ad");
    expect(stem("status")).toBe("status");
    expect(stem("address")).toBe("address");
  });
});

describe("rank (algorithm, synthetic corpus)", () => {
  const docs = [
    { id: "a/post/comments", platform: "a", summary: "List post comments" },
    { id: "a/comment", platform: "a", summary: "Look up one comment" },
    { id: "a/profile", platform: "a", summary: "Get a profile" },
    { id: "b/post/comments", platform: "b", summary: "List post comments" },
    { id: "b/profile", platform: "b", summary: "Get a profile" },
  ];
  const platforms = [
    { slug: "a", name: "Alpha" },
    { slug: "b", name: "Beta Shop", aliases: ["bee"] },
  ];
  const index = buildIndex(docs, platforms);

  it("scores by term overlap and returns nothing for an unrelated query", () => {
    expect(rank(index, "profile").map((h) => h.id)).toEqual(["a/profile", "b/profile"]);
    expect(rank(index, "zebra")).toEqual([]);
  });

  it("prefers the exact (unstemmed) id token: plural list over singular lookup", () => {
    expect(rank(index, "comments")[0].id).toBe("a/post/comments");
  });

  it("boosts the platform the query names (by slug, name or alias)", () => {
    expect(rank(index, "beta shop comments")[0].id).toBe("b/post/comments");
    expect(rank(index, "bee profile")[0].id).toBe("b/profile");
    expect(rank(index, "alpha profile")[0].id).toBe("a/profile");
  });

  it("filters to one platform when asked", () => {
    expect(rank(index, "comments", { platform: "b" }).map((h) => h.id)).toEqual(["b/post/comments"]);
  });

  it("puts an exact id first and lists a platform's endpoints for a bare platform", () => {
    expect(rank(index, "b/profile")[0].id).toBe("b/profile");
    expect(rank(index, "beta shop").map((h) => h.id)).toEqual(["b/post/comments", "b/profile"]);
  });

  it("is deterministic and honours the limit", () => {
    expect(rank(index, "post", { limit: 1 })).toHaveLength(1);
    expect(rank(index, "post")).toEqual(rank(index, "post"));
  });
});

describe("rank-cases fixture over the bundled catalogue", () => {
  it("has at least 30 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it('ranks tiktok/post/comments first for "tiktok comments" (offline)', () => {
    expect(searchEndpoints("tiktok comments")[0].id).toBe("tiktok/post/comments");
  });

  it.each(CASES)("$query → $expected_top in top $top_k", ({ query, expected_top, top_k }) => {
    const ids = searchEndpoints(query, { limit: top_k }).map((h) => h.id);
    expect(ids, `got ${ids.join(", ")}`).toContain(expected_top);
  });
});

describe("didYouMean", () => {
  const slugs = ["tiktok", "instagram", "youtube", "google_play"];
  it("suggests the nearest values", () => {
    expect(didYouMean("tiktk", slugs)[0]).toBe("tiktok");
    expect(didYouMean("youtub", slugs)[0]).toBe("youtube");
    expect(didYouMean("insta", slugs)[0]).toBe("instagram");
    expect(didYouMean("googleplay", slugs)[0]).toBe("google_play");
  });
  it("returns nothing for a far-off value", () => {
    expect(didYouMean("zzzzzzzz", slugs)).toEqual([]);
  });
});

describe("list_endpoints search uses the ranker", () => {
  it("finds a multi-word task a substring search missed, best match first", async () => {
    const { listEndpoints } = await import("../tools/list-endpoints.js");
    const out = listEndpoints({ search: "tiktok comments", detail: "compact" });
    const rows = out.split("\n").filter((l) => l.startsWith("| GET") || l.startsWith("| POST"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toContain("tiktok/post/comments");
  });

  it("suggests a platform for a typo", async () => {
    const { listEndpoints } = await import("../tools/list-endpoints.js");
    expect(listEndpoints({ platform: "tiktk" })).toContain("`tiktok`");
  });
});

describe("rank fix round 1", () => {
  it("folds -ing and -ed (and a trailing e) onto the same stem", () => {
    expect(stem("searching")).toBe("search");
    expect(stem("posted")).toBe("post");
    expect(stem("liked")).toBe(stem("like"));
    expect(stem("trending")).toBe(stem("trend"));
    expect(stem("shopping")).toBe("shop");
    expect(stem("using")).toBe("using");
  });

  it("a named platform's hits come before cross-platform hits (precedence, not a boost)", () => {
    const docs = [
      { id: "a/restaurants", platform: "a", summary: "Search restaurants restaurants in a city" },
      { id: "b/search", platform: "b", summary: "Search businesses" },
    ];
    const index = buildIndex(docs, [{ slug: "a", name: "Alpha" }, { slug: "b", name: "Beta" }]);
    expect(rank(index, "beta restaurants search").map((h) => h.id)[0]).toBe("b/search");
  });

  it("tweet / tweets / x name twitter, and keep tweet as a search word", () => {
    expect(searchEndpoints("tweets mentioning a brand")[0].id).toBe("twitter/search/tweets");
    expect(searchEndpoints("x/twitter user tweets")[0].id).toBe("twitter/user/tweets");
  });

  it("r/<name> names reddit and the subreddit", () => {
    expect(searchEndpoints("r/python top posts")[0].id).toBe("reddit/subreddit");
  });

  it("a generic verb (search) prefers <platform>/search over detail endpoints", () => {
    // Either YouTube search endpoint; never the videos-by-id batch.
    expect(["youtube/search", "youtube/search/advanced"]).toContain(searchEndpoints("youtube search videos")[0].id);
    expect(searchEndpoints("searching tiktok for cooking videos")[0].id).toBe("tiktok/search");
  });

  it("plural / list words prefer list endpoints over a single-item detail", () => {
    expect(searchEndpoints("linkedin company employees list")[0].id).toBe("linkedin/company/people");
    expect(searchEndpoints("hotel reviews tripadvisor")[0].id).toBe("tripadvisor/reviews");
    expect(searchEndpoints("tiktok videos using a hashtag")[0].id).toBe("tiktok/search/hashtag");
  });
});

describe("rank-heldout fixture (phrasings the ranker was not tuned on)", () => {
  const HELD = JSON.parse(
    readFileSync(new URL("../search/__fixtures__/rank-heldout.json", import.meta.url), "utf8"),
  ) as Array<{ query: string; expected: string[] }>;

  it("has 45 phrasings", () => {
    expect(HELD.length).toBe(45);
  });

  it("top-1 >= 80% and top-3 >= 95%", () => {
    let top1 = 0;
    let top3 = 0;
    const misses: string[] = [];
    for (const c of HELD) {
      const ids = searchEndpoints(c.query, { limit: 3 }).map((h) => h.id);
      if (c.expected.includes(ids[0])) top1++;
      else misses.push(`${c.query} -> ${ids.join(", ")}`);
      if (ids.some((i) => c.expected.includes(i))) top3++;
    }
    expect(top1 / HELD.length, misses.join("\n")).toBeGreaterThanOrEqual(0.8);
    expect(top3 / HELD.length, misses.join("\n")).toBeGreaterThanOrEqual(0.95);
  });
});

describe("rank fix round 2 (general rules)", () => {
  const listDetail = [
    { id: "s/item", platform: "s", summary: "Get one widget with its price and details", list: false },
    { id: "s/item/offers", platform: "s", summary: "List offers and price for a widget", list: true },
    { id: "s/item/likers", platform: "s", summary: "Widget likers", list: true },
    { id: "s/item/stats", platform: "s", summary: "Widget liker count", list: false },
  ];
  const sIndex = buildIndex(listDetail, [{ slug: "s", name: "Shopz" }]);

  it("detects a mistyped platform name (edit distance) but never a real word", () => {
    const index = buildIndex(
      [
        { id: "yelp/reviews", platform: "yelp", summary: "Yelp reviews" },
        { id: "instagram/profile", platform: "instagram", summary: "Instagram profile" },
        { id: "help/center", platform: "zz", summary: "help center articles" },
      ],
      [{ slug: "yelp", name: "Yelp" }, { slug: "instagram", name: "Instagram" }, { slug: "zz", name: "Zz" }],
    );
    expect(rank(index, "instagarm profile")[0].id).toBe("instagram/profile");
    expect(rank(index, "instagarm profile")[0].named).toBe(true);
    // "help" is a word the corpus knows, so it is not a typo of "yelp".
    expect(rank(index, "help center")[0].id).toBe("help/center");
    expect(searchEndpoints("tiktk comments")[0].id).toBe("tiktok/post/comments");
  });

  it("android / iphone / maps / trends name their platforms", () => {
    expect(searchEndpoints("android app reviews")[0].id).toBe("google_play/app-reviews");
    expect(searchEndpoints("iphone app reviews")[0].id).toBe("app_store/app-reviews");
    expect(searchEndpoints("maps business reviews")[0].endpoint.platform).toBe("google");
    expect(searchEndpoints("rising trends for a keyword")[0].endpoint.platform).toBe("google_trends");
  });

  it("a family member beats its parent platform when both are named", () => {
    const index = buildIndex(
      [
        { id: "a/widgets", platform: "a", summary: "widgets widgets" },
        { id: "a_b/widgets", platform: "a_b", summary: "widgets" },
        { id: "c/widgets", platform: "c", summary: "widgets" },
      ],
      [{ slug: "a", name: "Alpha" }, { slug: "a_b", name: "Alpha Beta", aliases: ["beta"] }, { slug: "c", name: "Gamma" }],
    );
    const hits = rank(index, "beta widgets on alpha");
    expect(hits[0].id).toBe("a_b/widgets");
    expect(hits.find((h) => h.id === "a/widgets")?.named).toBe(false);
  });

  it("a soft alias does not name its platform when another platform is named outright", () => {
    expect(searchEndpoints("pinterest trends")[0].id).toBe("pinterest/trends");
  });

  it("'who <verb>ed' and collection words ask for a list", () => {
    expect(rank(sIndex, "who liked the widget")[0].id).toBe("s/item/likers");
  });

  it("details / info words ask for the single object, not a list", () => {
    expect(rank(sIndex, "widget price and details")[0].id).toBe("s/item");
  });
});

describe("rank fix round 2 (guards)", () => {
  it("a typo must share the platform's first letter: 'help' is not 'yelp'", () => {
    expect(searchEndpoints("help with my account balance").every((h) => h.endpoint.platform !== "yelp")).toBe(true);
  });

  it("'who <verb>ed' also looks for the people who did it (agent noun)", () => {
    const index = buildIndex(
      [
        { id: "x/post", platform: "x", summary: "Get one post with its share count", list: false },
        { id: "x/post/sharers", platform: "x", summary: "Accounts that sharers of a post", list: true },
      ],
      [{ slug: "x", name: "Ex" }],
    );
    expect(rank(index, "who shared a post")[0].id).toBe("x/post/sharers");
    expect(searchEndpoints("who retweeted a tweet")[0].id).toBe("twitter/tweet/retweeters");
  });
});

describe("rank round 3 (general rules)", () => {
  it("a family member's qualifier word (any form) next to the parent's name names the family member", () => {
    const index = buildIndex(
      [
        { id: "g/search", platform: "g", summary: "Gee web search results for topics" },
        { id: "g_t/explore", platform: "g_t", summary: "Interest over time" },
      ],
      [{ slug: "g", name: "Gee" }, { slug: "g_t", name: "Gee Trends" }],
    );
    for (const q of ["gee trending topics", "gee trend topics", "topics trends on gee"]) {
      expect(rank(index, q)[0].id, q).toBe("g_t/explore");
    }
  });

  it("find / list / discover / lookup + a plural object prefer search and list endpoints over a detail", () => {
    const index = buildIndex(
      [
        { id: "s/creator", platform: "s", summary: "Get one creator profile with creators stats", list: false },
        { id: "s/search/creators", platform: "s", summary: "Creators matching a keyword", list: true },
      ],
      [{ slug: "s", name: "Ess" }],
    );
    for (const q of ["find creators", "discover creators", "lookup creators", "list creators"]) {
      expect(rank(index, q)[0].id, q).toBe("s/search/creators");
    }
  });

  it("resource coverage counts singular and plural forms (exact form counts most)", () => {
    expect(resourceCoverage(["videos"], ["videos"])).toBe(1);
    expect(resourceCoverage(["videos"], ["video"])).toBe(0.5);
    expect(resourceCoverage(["comment"], ["comments"])).toBe(0.5);
    expect(resourceCoverage(["post", "comments"], ["comments"])).toBe(0.5);
    expect(resourceCoverage([], ["x"])).toBe(0);
  });

  it("locations / nearby / branches mean stores", () => {
    const index = buildIndex(
      [
        { id: "r/stores", platform: "r", summary: "Store finder by zip code", list: true },
        { id: "r/product", platform: "r", summary: "One product", list: false },
      ],
      [{ slug: "r", name: "Arr" }],
    );
    for (const q of ["nearby branches", "store locations", "branches near me"]) {
      expect(rank(index, q)[0].id, q).toBe("r/stores");
    }
  });

  it("a collection noun inside another object picks the inner object's list endpoint", () => {
    const index = buildIndex(
      [
        { id: "y/channel/videos", platform: "y", summary: "Videos of a channel", list: true },
        { id: "y/song/videos", platform: "y", summary: "Videos using a song", list: true },
        { id: "y/playlist/items", platform: "y", summary: "The entries of a playlist", list: true },
        { id: "y/playlist", platform: "y", summary: "Get a playlist", list: false },
      ],
      [{ slug: "y", name: "Why" }],
    );
    for (const q of ["videos in a playlist", "videos inside a playlist", "videos of a playlist", "items from a playlist"]) {
      expect(rank(index, q)[0].id, q).toBe("y/playlist/items");
    }
  });
});

describe("rank T26b (general rules)", () => {
  it("the use_when intent is its first clause; a follow-up ('Use it after') states none; named endpoints are dropped", async () => {
    const { splitUseWhen } = await import("../search/rank.js");
    expect(splitUseWhen("Use it to read a video's comment section; to expand one thread, call a/video/comment/replies.").intent).toBe(
      "Use it to read a video's comment section",
    );
    expect(splitUseWhen("Use it after a/post/comments: pass the comment id.").intent).toBe("");
    expect(splitUseWhen("Use it to look up one handle everywhere at once, then pick").intent).toBe("Use it to look up one handle everywhere at once");
  });

  it("a container named in what an endpoint returns counts like one in its path; path words weigh less than the leaf", () => {
    const index = buildIndex(
      [
        { id: "a/post/comments", platform: "a", summary: "List post comments", returns: "Comments on one video.", use_when: "Use it to read a video's comment section; to expand a thread call a/video/comment/replies.", list: true },
        { id: "a/video/comment/replies", platform: "a", summary: "List comment replies", returns: "Replies under one comment.", use_when: "Use it after a/post/comments: pass the comment id with the video url.", list: true },
        { id: "a/collection/videos", platform: "a", summary: "List videos in a collection", list: true },
      ],
      [{ slug: "a", name: "Alpha" }],
    );
    expect(rank(index, "comments on an alpha video")[0].id).toBe("a/post/comments");
  });

  it("a counted list of inputs across named platforms prefers the cross-platform batch", () => {
    const index = buildIndex(
      [
        { id: "a/post", platform: "a", summary: "Post views and likes", returns: "Views and likes of one post url." },
        { id: "b/post", platform: "b", summary: "Post views and likes", returns: "Views and likes of one post url." },
        { id: "x/post-stats", platform: "x", summary: "Post stats per url", returns: "Views and likes for a batch of post urls.", batch: true, cross: true },
      ],
      [
        { slug: "a", name: "Alpha" },
        { slug: "b", name: "Beta" },
        { slug: "x", name: "Ex" },
      ],
    );
    expect(rank(index, "views and likes for 300 alpha and beta post urls")[0].id).toBe("x/post-stats");
    expect(rank(index, "views and likes of an alpha post")[0].id).toBe("a/post");
  });

  it("a plural object with a topic is a discovery; a 'with ...' clause filters the object rather than naming it", () => {
    const index = buildIndex(
      [
        { id: "a/profile", platform: "a", summary: "Creator profile", returns: "One creator's profile and follower count." },
        { id: "a/followers", platform: "a", summary: "Account followers", list: true },
        { id: "a/search/users", platform: "a", summary: "Search users", use_when: "Use it to find accounts by topic; creators in one country.", list: true },
      ],
      [{ slug: "a", name: "Alpha" }],
    );
    expect(rank(index, "alpha creators about cooking")[0].id).toBe("a/search/users");
    expect(rank(index, "alpha creators about cooking with over 100k followers")[0].id).toBe("a/search/users");
  });

  it("a watching verb prefers the endpoint whose use_when tracks changes", () => {
    const index = buildIndex(
      [
        { id: "l/page", platform: "l", summary: "Link page", returns: "A link-in-bio page." },
        { id: "w/monitors", platform: "w", summary: "Create a web monitor", returns: "Rechecks a page on a schedule.", use_when: "Use it to track something that changes over time." },
      ],
      [],
    );
    expect(rank(index, "watch this pricing page for changes and alert me")[0].id).toBe("w/monitors");
  });

  it("an explicit cadence or a set of the user's own names the stateful family whose words they are", () => {
    const index = buildIndex(
      [
        { id: "a/user/posts", platform: "a", summary: "A user's posts", returns: "Posts by one account.", list: true },
        { id: "a/search", platform: "a", summary: "Search posts about a topic", list: true },
        { id: "cohorts", platform: "cohorts", summary: "Which of these accounts talked about X: you supply the panel.", anyPlatform: true },
        { id: "monitors", platform: "monitors", summary: "Re-runs a recipe on a cadence and fires alert rules.", anyPlatform: true },
      ],
      [{ slug: "a", name: "Alpha" }],
    );
    expect(rank(index, "which of my customer accounts posted about acme")[0].id).toBe("cohorts");
    expect(rank(index, "search posts about acme every day")[0].id).toBe("monitors");
    expect(rank(index, "search posts about acme")[0].id).toBe("a/search");
  });
});
