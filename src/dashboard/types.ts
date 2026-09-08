export type AlertPlatform = "x" | "instagram" | "tiktok" | "unknown";
export type AlertTrajectory = "rising" | "accelerating" | "strong_acceleration" | "cooling" | "unknown";

export type AlertSignals = {
  volumeAcceleration: number;
  engagementAcceleration: number;
  authorGrowth: number;
  performanceQuality: number;
  authorDiversity: number;
};

export type PostTypeBreakdown = {
  postType: string;
  postCount: number;
  uniqueAuthors: number;
  averagePerformance: number | null;
  totalEngagement: number;
  shareOfTrendActivity: number;
  relativePerformance: number | null;
  sampleSizeWarning?: string;
};

export type TrendAlert = {
  id: string;
  topic: string;
  platform: AlertPlatform;
  detectedAt: string;
  confidence: number;
  trendScore: number;
  trajectory: AlertTrajectory;
  dominantPostTypes: string[];
  postTypeBreakdown: PostTypeBreakdown[];
  signals: AlertSignals;
};