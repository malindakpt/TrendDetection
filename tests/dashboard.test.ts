import { describe, expect, it } from "vitest";
import { dashboardOverview, defaultFilters, filterAndSortAlerts, getAlertById, parseAlerts } from "@/dashboard/alertData";

const rawAlerts = [
  { id: "x:alpha", topic: "alpha", platform: "x", detectedAt: "2026-08-24T10:00:00.000Z", confidence: 80, trendScore: 75, trajectory: "rising", dominantPostTypes: ["text"], postTypeBreakdown: [], signals: { volumeAcceleration: 1, engagementAcceleration: 1, authorGrowth: 1, performanceQuality: 1, authorDiversity: 1 } },
  { id: "instagram:beta", topic: "beta", platform: "instagram", detectedAt: "2026-08-24T12:00:00.000Z", confidence: 90, trendScore: 85, trajectory: "accelerating", dominantPostTypes: ["reel"], postTypeBreakdown: [], signals: { volumeAcceleration: 2, engagementAcceleration: 2, authorGrowth: 2, performanceQuality: 2, authorDiversity: 1 } },
  { id: "tiktok:gamma", topic: "gamma", platform: "tiktok", detectedAt: "2026-08-24T11:00:00.000Z", confidence: 80, trendScore: 70, trajectory: "cooling", dominantPostTypes: [], postTypeBreakdown: [], signals: {} },
];

describe("dashboard alert data", () => {
  it("parses alerts defensively and handles an empty or invalid payload", () => {
    expect(parseAlerts(rawAlerts)).toHaveLength(3);
    expect(parseAlerts([])).toEqual([]);
    expect(parseAlerts({ alerts: rawAlerts })).toEqual([]);
    expect(parseAlerts([{ id: "bad" }])).toEqual([]);
  });

  it("filters alerts by platform, trajectory, and confidence", () => {
    const alerts = parseAlerts(rawAlerts);
    expect(filterAndSortAlerts(alerts, { ...defaultFilters, platform: "instagram" }).map((alert) => alert.topic)).toEqual(["beta"]);
    expect(filterAndSortAlerts(alerts, { ...defaultFilters, trajectory: "cooling" }).map((alert) => alert.topic)).toEqual(["gamma"]);
    expect(filterAndSortAlerts(alerts, { ...defaultFilters, minimumConfidence: 85 }).map((alert) => alert.topic)).toEqual(["beta"]);
  });

  it("sorts by confidence and then most recent detection time", () => {
    const alerts = parseAlerts(rawAlerts);
    expect(filterAndSortAlerts(alerts, defaultFilters).map((alert) => alert.id)).toEqual(["instagram:beta", "tiktok:gamma", "x:alpha"]);
  });

  it("selects an alert by id and returns null for unknown selections", () => {
    const alerts = parseAlerts(rawAlerts);
    expect(getAlertById(alerts, "instagram:beta")?.topic).toBe("beta");
    expect(getAlertById(alerts, "missing")).toBeNull();
  });

  it("computes overview values and supports an empty alert list", () => {
    const overview = dashboardOverview(parseAlerts(rawAlerts));
    expect(overview).toMatchObject({ totalAlerts: 3, highConfidenceAlerts: 3, platformCount: 3, strongestTrend: { topic: "beta" } });
    expect(dashboardOverview([])).toMatchObject({ totalAlerts: 0, highConfidenceAlerts: 0, platformCount: 0, strongestTrend: null });
  });
});