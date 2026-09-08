import type { AlertPlatform, AlertTrajectory, TrendAlert } from "@/dashboard/types";

export type AlertFilters = {
  platform: "all" | AlertPlatform;
  trajectory: "all" | AlertTrajectory;
  minimumConfidence: number;
};

const platforms = new Set<AlertPlatform>(["x", "instagram", "tiktok"]);
const trajectories = new Set<AlertTrajectory>(["rising", "accelerating", "strong_acceleration", "cooling"]);

export const defaultFilters: AlertFilters = { platform: "all", trajectory: "all", minimumConfidence: 0 };

export function parseAlerts(value: unknown): TrendAlert[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.topic !== "string" || typeof item.detectedAt !== "string") return [];
    return [{
      id: item.id,
      topic: item.topic,
      platform: typeof item.platform === "string" && platforms.has(item.platform as AlertPlatform) ? item.platform as AlertPlatform : "unknown",
      detectedAt: item.detectedAt,
      confidence: numberValue(item.confidence),
      trendScore: numberValue(item.trendScore),
      trajectory: typeof item.trajectory === "string" && trajectories.has(item.trajectory as AlertTrajectory) ? item.trajectory as AlertTrajectory : "unknown",
      dominantPostTypes: Array.isArray(item.dominantPostTypes) ? item.dominantPostTypes.filter((type): type is string => typeof type === "string") : [],
      postTypeBreakdown: Array.isArray(item.postTypeBreakdown) ? item.postTypeBreakdown.flatMap(parsePostType) : [],
      signals: parseSignals(item.signals),
    }];
  });
}

export function filterAndSortAlerts(alerts: TrendAlert[], filters: AlertFilters): TrendAlert[] {
  return alerts.filter((alert) => (filters.platform === "all" || alert.platform === filters.platform) && (filters.trajectory === "all" || alert.trajectory === filters.trajectory) && alert.confidence >= filters.minimumConfidence).sort((left, right) => right.confidence - left.confidence || right.detectedAt.localeCompare(left.detectedAt));
}

export function getAlertById(alerts: TrendAlert[], id: string | null): TrendAlert | null {
  return alerts.find((alert) => alert.id === id) ?? null;
}

export function dashboardOverview(alerts: TrendAlert[]) {
  const strongestTrend = [...alerts].sort((left, right) => right.confidence - left.confidence || right.detectedAt.localeCompare(left.detectedAt))[0] ?? null;
  return { totalAlerts: alerts.length, highConfidenceAlerts: alerts.filter((alert) => alert.confidence >= 80).length, platformCount: new Set(alerts.map((alert) => alert.platform)).size, strongestTrend };
}

function parseSignals(value: unknown): TrendAlert["signals"] {
  const signals = isRecord(value) ? value : {};
  return { volumeAcceleration: numberValue(signals.volumeAcceleration), engagementAcceleration: numberValue(signals.engagementAcceleration), authorGrowth: numberValue(signals.authorGrowth), performanceQuality: numberValue(signals.performanceQuality), authorDiversity: numberValue(signals.authorDiversity) };
}
function parsePostType(value: unknown): TrendAlert["postTypeBreakdown"] {
  if (!isRecord(value) || typeof value.postType !== "string") return [];
  return [{ postType: value.postType, postCount: numberValue(value.postCount), uniqueAuthors: numberValue(value.uniqueAuthors), averagePerformance: nullableNumber(value.averagePerformance), totalEngagement: numberValue(value.totalEngagement), shareOfTrendActivity: numberValue(value.shareOfTrendActivity), relativePerformance: nullableNumber(value.relativePerformance), ...(typeof value.sampleSizeWarning === "string" ? { sampleSizeWarning: value.sampleSizeWarning } : {}) }];
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function numberValue(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function nullableNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }