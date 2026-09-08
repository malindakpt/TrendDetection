import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractTikTokTopics,
  extractTopicsFromText,
  mapInstagramPostType,
  mapTikTokPostType,
  mapXPostType,
  loadAndNormalizePosts,
  parseUnixTimestamp,
  parseXTimestamp,
} from "@/ingestion/loadAndNormalizePosts";

describe("normalization helpers", () => {
  it("parses X ISO and DD/MM/YYYY timestamps as UTC", () => {
    expect(parseXTimestamp("2026-08-24T15:38:41Z")).toBe("2026-08-24T15:38:41.000Z");
    expect(parseXTimestamp("24/08/2026 15:38")).toBe("2026-08-24T15:38:00.000Z");
  });

  it("parses Instagram and TikTok Unix timestamps", () => {
    expect(parseUnixTimestamp(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("extracts and normalizes topics while filtering generic tags", () => {
    expect(extractTopicsFromText("Watch #WatchParty #VIRAL #watchparty")).toEqual(["watchparty"]);
    expect(extractTopicsFromText("#FreshTopic", new Set())).toEqual(["freshtopic"]);
    expect(extractTikTokTopics(["MatchNight", "#viral", "foryou"])).toEqual(["matchnight"]);
  });

  it("maps platform post types", () => {
    expect(mapXPostType("none")).toBe("text");
    expect(mapInstagramPostType("STORY", "VIDEO")).toBe("story");
    expect(mapInstagramPostType("REELS", "VIDEO")).toBe("reel");
    expect(mapInstagramPostType("FEED", "CAROUSEL_ALBUM")).toBe("carousel");
    expect(mapTikTokPostType(true, true)).toBe("duet");
    expect(mapTikTokPostType(false, true)).toBe("live_clip");
    expect(mapTikTokPostType(false, false)).toBe("short_video");
  });

  it("parses JSONL one line at a time, skips malformed lines, and removes duplicates", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "trend-radar-"));
    try {
      await writeFile(dataDirectory + "/x_posts.csv", "post_id,created_at,author_handle,author_followers,text,media_type,like_count,repost_count,reply_count,quote_count,bookmark_count,impression_count,lang,in_reply_to_id\n");
      await writeFile(dataDirectory + "/instagram_posts.csv", "media_id,taken_at,username,follower_count,caption,media_product_type,media_type,like_count,comment_count,save_count,share_count,video_view_count,reach\n");
      const post = JSON.stringify({ id: "t1", create_time: 0, author: { unique_id: "author" }, desc: "hello #Topic", stats: { play_count: 5, digg_count: 1 }, video: { duration: 10 }, hashtags: ["Topic"] });
      await writeFile(dataDirectory + "/tiktok_posts.jsonl", `${post}\nnot-json\n${post}\n`);

      const { posts, summary } = await loadAndNormalizePosts({ dataDirectory });

      expect(posts).toHaveLength(1);
      expect(posts[0].topics).toEqual(["topic"]);
      expect(summary.malformedJsonlLines).toBe(1);
      expect(summary.platforms.tiktok.duplicatesRemoved).toBe(1);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  });
});