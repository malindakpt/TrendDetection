import { describe, expect, it } from "vitest";
import { classifyTrajectory, detectTrends } from "@/trends/detectTrends";
import type { NormalizedPost } from "@/normalization/types";

function post(id: string, timestamp: string, authorId: string, engagement = 10, postType = "text"): NormalizedPost {
  return { id, platform: "x", timestamp, authorId, followers: 100, text: "#topic", topics: ["topic"], postType, likes: engagement, comments: 0, shares: 0, saves: 0, views: null, impressions: 100, engagement };
}

const testOptions = { historyWindowHours: 1, minimumHistoryWindows: 1, minimumHistoricalPosts: 1, minimumCurrentPosts: 1, minimumCurrentAuthors: 1, minimumAuthorDiversity: 0, minimumAcceleration: 0, alertThreshold: 0 };

describe("chronological trend replay", () => {
  it("does not let a 12:00 spike alter the 11:00 score", () => {
    const throughEleven = [post("10", "2026-08-25T10:00:00.000Z", "a", 2), post("11a", "2026-08-25T11:00:00.000Z", "b", 10), post("11b", "2026-08-25T11:05:00.000Z", "c", 10)];
    const withFutureSpike = [...throughEleven, ...Array.from({ length: 20 }, (_, index) => post(`12-${index}`, "2026-08-25T12:00:00.000Z", `future-${index}`, 100))];

    const before = detectTrends(throughEleven, testOptions).trends.find((trend) => trend.hour === "2026-08-25T11:00:00.000Z");
    const after = detectTrends(withFutureSpike, testOptions).trends.find((trend) => trend.hour === "2026-08-25T11:00:00.000Z");

    expect(after).toEqual(before);
  });

  it("keeps baseline and threshold inputs at T unchanged when future rows are appended", () => {
    const throughEleven = [post("10", "2026-08-25T10:00:00.000Z", "a", 2), post("11a", "2026-08-25T11:00:00.000Z", "b", 10), post("11b", "2026-08-25T11:05:00.000Z", "c", 10)];
    const future = [...throughEleven, post("12", "2026-08-25T12:00:00.000Z", "d", 1_000)];

    const before = detectTrends(throughEleven, testOptions).trends.find((trend) => trend.hour === "2026-08-25T11:00:00.000Z");
    const after = detectTrends(future, testOptions).trends.find((trend) => trend.hour === "2026-08-25T11:00:00.000Z");

    expect(after?.baseline).toEqual(before?.baseline);
    expect(after?.signals).toEqual(before?.signals);
    expect(after?.trendScore).toBe(before?.trendScore);
  });

  it("suppresses a zero-engagement volume spike", () => {
    const records = [post("10", "2026-08-25T10:00:00.000Z", "a", 10), ...["b", "c", "d"].map((author, index) => post(`11-${author}`, "2026-08-25T11:00:00.000Z", author, 0))];
    const result = detectTrends(records, { ...testOptions, minimumCurrentPosts: 3, minimumCurrentAuthors: 2, alertThreshold: 50, strongSpikeVolumeGrowth: 1, strongSpikeEngagementGrowth: 0 });
    const spike = result.trends.find((trend) => trend.hour === "2026-08-25T11:00:00.000Z");

    expect(result.alerts).toHaveLength(0);
    expect(spike?.suppressionReasons).toContain("no engagement or performance signal");
  });

  it("suppresses an isolated spike but alerts after sustained acceleration", () => {
    const records = [
      post("10", "2026-08-25T10:00:00.000Z", "a", 3),
      ...["b", "c", "d"].map((author) => post(`11-${author}`, "2026-08-25T11:00:00.000Z", author, 1)),
      ...Array.from({ length: 6 }, (_, index) => post(`12-${index}`, "2026-08-25T12:00:00.000Z", `e${index}`, 3)),
    ];
    const result = detectTrends(records, { ...testOptions, minimumCurrentPosts: 3, minimumCurrentAuthors: 2, alertThreshold: 50, strongSpikeVolumeGrowth: 100, strongSpikeEngagementGrowth: 100 });

    expect(result.trends.find((trend) => trend.hour === "2026-08-25T11:00:00.000Z")?.suppressionReasons).toContain("insufficient sustained evidence");
    expect(result.alerts.map((alert) => alert.detectedAt)).toEqual(["2026-08-25T12:00:00.000Z"]);
  });

  it("classifies score trajectories from recent score history", () => {
    expect(classifyTrajectory([30, 40])).toBe("rising");
    expect(classifyTrajectory([20, 30, 45])).toBe("accelerating");
    expect(classifyTrajectory([20, 40, 65])).toBe("strong_acceleration");
    expect(classifyTrajectory([50, 40])).toBe("cooling");
  });

  it("does not promote a tiny high-performance format over the activity-driving format", () => {
    const records = [
      post("10", "2026-08-25T10:00:00.000Z", "baseline", 1, "short_video"),
      ...Array.from({ length: 15 }, (_, index) => post(`11-short-${index}`, "2026-08-25T11:00:00.000Z", `short-${index}`, 2, "short_video")),
      ...Array.from({ length: 2 }, (_, index) => post(`11-live-${index}`, "2026-08-25T11:00:00.000Z", `live-${index}`, 10, "live_clip")),
    ];
    const result = detectTrends(records, { ...testOptions, minimumCurrentPosts: 3, minimumCurrentAuthors: 2, alertThreshold: 50 });
    const alert = result.alerts[0];

    expect(alert.dominantPostTypes).toEqual(["short_video"]);
    expect(alert.postTypeBreakdown.find((item) => item.postType === "live_clip")?.sampleSizeWarning).toContain("Fewer than 3 posts");
  });
});