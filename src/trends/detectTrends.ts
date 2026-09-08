import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NormalizedPost, Platform } from "@/normalization/types";

const HOUR_MS = 3_600_000;

export type TrendSignals = {
  volumeAcceleration: number;
  engagementAcceleration: number;
  authorGrowth: number;
  performanceQuality: number;
  authorDiversity: number;
};

export type PostTypePerformance = {
  postType: string;
  postCount: number;
  uniqueAuthors: number;
  averagePerformance: number | null;
  totalEngagement: number;
  shareOfTrendActivity: number;
  relativePerformance: number | null;
  sampleSizeWarning?: string;
};

export type TrendRecord = {
  platform: Platform;
  topic: string;
  hour: string;
  postCount: number;
  uniqueAuthors: number;
  totalEngagement: number;
  averageEngagement: number | null;
  normalizedPerformance: number | null;
  baseline: { postCount: number; totalEngagement: number; uniqueAuthors: number; normalizedPerformance: number | null; windows: number } | null;
  signals: TrendSignals | null;
  trendScore: number | null;
  trajectory: "rising" | "accelerating" | "strong_acceleration" | "cooling" | null;
  eligibleForAlert: boolean;
  suppressionReasons: string[];
};

export type TrendAlert = {
  id: string;
  topic: string;
  platform: Platform;
  detectedAt: string;
  confidence: number;
  trendScore: number;
  trajectory: NonNullable<TrendRecord["trajectory"]>;
  dominantPostTypes: string[];
  postTypeBreakdown: PostTypePerformance[];
  signals: TrendSignals;
};

export type DetectionOptions = {
  historyWindowHours?: number;
  minimumHistoryWindows?: number;
  minimumHistoricalPosts?: number;
  minimumCurrentPosts?: number;
  minimumCurrentAuthors?: number;
  minimumAuthorDiversity?: number;
  minimumAcceleration?: number;
  alertThreshold?: number;
  cooldownHours?: number;
  strongSpikeVolumeGrowth?: number;
  strongSpikeEngagementGrowth?: number;
  minimumDominantPostTypePosts?: number;
};

export type DetectionResult = {
  trends: TrendRecord[];
  alerts: TrendAlert[];
  metrics: {
    configuration: Required<DetectionOptions>;
    totalPosts: number;
    combinationsAnalyzed: number;
    alertsByPlatform: Record<Platform, number>;
    alertsByTopic: Record<string, number>;
    earliestDetectionByTrend: Record<string, string>;
    strongestTrendByPlatform: Partial<Record<Platform, TrendRecord>>;
    suppressedByReason: Record<string, number>;
    suppressedExamples: Array<Pick<TrendRecord, "platform" | "topic" | "hour" | "postCount" | "totalEngagement" | "suppressionReasons">>;
  };
};

type Bucket = { posts: NormalizedPost[]; authors: Set<string>; engagement: number; performances: number[]; postTypes: Map<string, TypeAggregate> };
type TypeAggregate = { posts: number; authors: Set<string>; engagement: number; performances: number[] };
type ScoreSnapshot = { hour: string; score: number; volumeAcceleration: number; engagementAcceleration: number };

// Six recent hours establish local context; four observed windows, three prior
// topic posts, and three current posts limit cold-start and low-volume noise.
// The 55-point threshold requires meaningful acceleration and author diversity.
const DEFAULT_OPTIONS: Required<DetectionOptions> = {
  historyWindowHours: 6,
  minimumHistoryWindows: 4,
  minimumHistoricalPosts: 3,
  minimumCurrentPosts: 3,
  minimumCurrentAuthors: 2,
  minimumAuthorDiversity: 0.4,
  minimumAcceleration: 0.5,
  alertThreshold: 55,
  cooldownHours: 6,
  strongSpikeVolumeGrowth: 2,
  strongSpikeEngagementGrowth: 1,
  minimumDominantPostTypePosts: 3,
};

/**
 * Replays complete hourly buckets in order. At hour T, state contains only
 * buckets from T and earlier; score baselines are read before T is recorded.
 */
export function detectTrends(inputPosts: NormalizedPost[], overrides: DetectionOptions = {}): DetectionResult {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const posts = [...inputPosts].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
  const bucketsByHour = groupByHour(posts);
  const hours = [...bucketsByHour.keys()].sort();
  const history = new Map<string, Array<{ bucket: Bucket; platformHasData: boolean }>>();
  const knownKeys = new Set<string>();
  const scoreHistory = new Map<string, ScoreSnapshot[]>();
  const lastAlertAt = new Map<string, number>();
  const wasEligible = new Map<string, boolean>();
  const trends: TrendRecord[] = [];
  const alerts: TrendAlert[] = [];

  for (const hour of hours) {
    const hourBuckets = bucketsByHour.get(hour)!;
    const platforms: Platform[] = ["x", "instagram", "tiktok"];
    const platformHasData = new Map<Platform, boolean>(platforms.map((platform) => [platform, (hourBuckets.get(platform)?.posts.length ?? 0) > 0]));
    const currentKeys = new Set<string>();
    for (const [platform, topicBuckets] of hourBuckets) {
      for (const topic of topicBuckets.topics.keys()) {
        const key = combinationKey(platform, topic);
        knownKeys.add(key);
        currentKeys.add(key);
      }
    }

    for (const key of currentKeys) {
      const [platform, topic] = splitKey(key);
      const current = hourBuckets.get(platform)?.topics.get(topic)!;
      const prior = (history.get(key) ?? []).filter((entry) => entry.platformHasData).slice(-options.historyWindowHours);
      const baseline = calculateBaseline(prior);
      const record = createTrendRecord(platform, topic, hour, current, baseline, prior.length, options, scoreHistory.get(key) ?? []);
      trends.push(record);
      if (record.trendScore !== null && record.signals) scoreHistory.set(key, [...(scoreHistory.get(key) ?? []), { hour, score: record.trendScore, volumeAcceleration: record.signals.volumeAcceleration, engagementAcceleration: record.signals.engagementAcceleration }].slice(-3));

      const lastAlert = lastAlertAt.get(key);
      const crossedThreshold = record.eligibleForAlert && !wasEligible.get(key);
      if (crossedThreshold && (lastAlert === undefined || Date.parse(hour) - lastAlert >= options.cooldownHours * HOUR_MS)) {
        const alert = createAlert(record, [...prior.map((entry) => entry.bucket), current]);
        alerts.push(alert);
        lastAlertAt.set(key, Date.parse(hour));
      }
      wasEligible.set(key, record.eligibleForAlert);
    }

    for (const key of knownKeys) {
      const [platform, topic] = splitKey(key);
      const bucket = hourBuckets.get(platform)?.topics.get(topic) ?? emptyBucket();
      const entries = history.get(key) ?? [];
      history.set(key, [...entries, { bucket, platformHasData: platformHasData.get(platform)! }].slice(-options.historyWindowHours));
    }
  }

  return { trends, alerts, metrics: buildMetrics(posts.length, trends, alerts, options) };
}

export async function writeTrendOutput(result: DetectionResult, outputDirectory = path.join(process.cwd(), "output")): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "trends.json"), `${JSON.stringify(result.trends, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "alerts.json"), `${JSON.stringify(result.alerts, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "metrics.json"), `${JSON.stringify(result.metrics, null, 2)}\n`),
  ]);
}

function createTrendRecord(platform: Platform, topic: string, hour: string, current: Bucket, baseline: ReturnType<typeof calculateBaseline>, historyWindows: number, options: Required<DetectionOptions>, previousScores: ScoreSnapshot[]): TrendRecord {
  const currentPerformance = average(current.performances);
  if (!baseline) return { platform, topic, hour, ...bucketMetrics(current), normalizedPerformance: currentPerformance, baseline: null, signals: null, trendScore: null, trajectory: null, eligibleForAlert: false, suppressionReasons: ["no historical baseline"] };
  const signals: TrendSignals = {
    volumeAcceleration: relativeGrowth(current.posts.length, baseline.postCount),
    engagementAcceleration: relativeGrowth(current.engagement, baseline.totalEngagement),
    authorGrowth: relativeGrowth(current.authors.size, baseline.uniqueAuthors),
    performanceQuality: currentPerformance === null || baseline.normalizedPerformance === null ? 0 : relativeGrowth(currentPerformance, baseline.normalizedPerformance),
    authorDiversity: current.posts.length ? current.authors.size / current.posts.length : 0,
  };
  const score = Math.round(100 * (0.35 * capSignal(signals.volumeAcceleration) + 0.35 * capSignal(signals.engagementAcceleration) + 0.2 * capSignal(signals.authorGrowth) + 0.1 * capSignal(signals.performanceQuality)) * signals.authorDiversity);
  const trajectory = classifyTrajectory([...previousScores.map((snapshot) => snapshot.score), score]);
  const sustained = hasSustainedEvidence(previousScores, hour, score, options.alertThreshold);
  const strongSpike = signals.volumeAcceleration >= options.strongSpikeVolumeGrowth && signals.engagementAcceleration >= options.strongSpikeEngagementGrowth && signals.authorDiversity >= options.minimumAuthorDiversity;
  const suppressionReasons: string[] = [];
  if (historyWindows < options.minimumHistoryWindows) suppressionReasons.push("insufficient historical windows");
  if (baseline.historicalPosts < options.minimumHistoricalPosts) suppressionReasons.push("insufficient historical topic activity");
  if (current.posts.length < options.minimumCurrentPosts) suppressionReasons.push("too few current posts");
  if (current.authors.size < options.minimumCurrentAuthors) suppressionReasons.push("too few current authors");
  if (signals.authorDiversity < options.minimumAuthorDiversity) suppressionReasons.push("single-author domination");
  if (current.engagement === 0 && (currentPerformance === null || currentPerformance <= 0)) suppressionReasons.push("no engagement or performance signal");
  if (signals.volumeAcceleration < options.minimumAcceleration) suppressionReasons.push("insufficient volume acceleration");
  if (score < options.alertThreshold) suppressionReasons.push("trend score below threshold");
  if (!sustained && !strongSpike) suppressionReasons.push("insufficient sustained evidence");
  if (trajectory === "cooling") suppressionReasons.push("cooling trajectory");
  return { platform, topic, hour, ...bucketMetrics(current), normalizedPerformance: currentPerformance, baseline: { postCount: baseline.postCount, totalEngagement: baseline.totalEngagement, uniqueAuthors: baseline.uniqueAuthors, normalizedPerformance: baseline.normalizedPerformance, windows: historyWindows }, signals, trendScore: score, trajectory, eligibleForAlert: suppressionReasons.length === 0, suppressionReasons };
}

function createAlert(record: TrendRecord, buckets: Bucket[]): TrendAlert {
  const postTypeBreakdown = calculatePostTypes(buckets);
  const eligibleFormats = postTypeBreakdown.filter((item) => item.postCount >= 3);
  const dominantPostTypes = eligibleFormats.length
    ? dominantFormatsByCombinedSignal(eligibleFormats)
    : postTypeBreakdown.filter((item) => item.postCount === Math.max(...postTypeBreakdown.map((item) => item.postCount))).map((item) => item.postType);
  return { id: `${record.platform}:${record.topic}:${record.hour}`, topic: record.topic, platform: record.platform, detectedAt: record.hour, confidence: Math.min(100, Math.round(record.trendScore! * (0.75 + 0.25 * record.signals!.authorDiversity))), trendScore: record.trendScore!, trajectory: record.trajectory ?? "rising", dominantPostTypes, postTypeBreakdown, signals: record.signals! };
}
function dominantFormatsByCombinedSignal(formats: PostTypePerformance[]): string[] {
  const highestCombinedSignal = Math.max(...formats.map((item) => item.shareOfTrendActivity * Math.max(item.relativePerformance ?? 0, 0)));
  return formats.filter((item) => item.shareOfTrendActivity * Math.max(item.relativePerformance ?? 0, 0) === highestCombinedSignal).map((item) => item.postType);
}

function groupByHour(posts: NormalizedPost[]): Map<string, Map<Platform, { posts: NormalizedPost[]; topics: Map<string, Bucket> }>> {
  const result = new Map<string, Map<Platform, { posts: NormalizedPost[]; topics: Map<string, Bucket> }>>();
  for (const post of posts) {
    const hour = `${post.timestamp.slice(0, 13)}:00:00.000Z`;
    const platforms = result.get(hour) ?? new Map();
    const platformBucket = platforms.get(post.platform) ?? { posts: [], topics: new Map() };
    platformBucket.posts.push(post);
    for (const topic of post.topics) {
      const bucket = platformBucket.topics.get(topic) ?? emptyBucket();
      addToBucket(bucket, post);
      platformBucket.topics.set(topic, bucket);
    }
    platforms.set(post.platform, platformBucket);
    result.set(hour, platforms);
  }
  return result;
}

function emptyBucket(): Bucket { return { posts: [], authors: new Set(), engagement: 0, performances: [], postTypes: new Map() }; }
function addToBucket(bucket: Bucket, post: NormalizedPost): void {
  bucket.posts.push(post); bucket.authors.add(post.authorId); bucket.engagement += post.engagement ?? 0;
  const performance = normalizedPerformance(post); if (performance !== null) bucket.performances.push(performance);
  const type = bucket.postTypes.get(post.postType) ?? { posts: 0, authors: new Set(), engagement: 0, performances: [] };
  type.posts++; type.authors.add(post.authorId); type.engagement += post.engagement ?? 0; if (performance !== null) type.performances.push(performance); bucket.postTypes.set(post.postType, type);
}
function normalizedPerformance(post: NormalizedPost): number | null {
  const denominator = post.platform === "x" ? post.impressions ?? post.followers : post.platform === "instagram" ? post.metadata?.reach ?? post.followers : post.views ?? post.followers;
  return post.engagement === null || denominator === null || denominator <= 0 ? null : post.engagement / denominator;
}
function calculateBaseline(entries: Array<{ bucket: Bucket }>): { postCount: number; totalEngagement: number; uniqueAuthors: number; normalizedPerformance: number | null; historicalPosts: number } | null {
  if (!entries.length) return null;
  const count = entries.length; const performances = entries.flatMap((entry) => entry.bucket.performances);
  return { postCount: entries.reduce((sum, entry) => sum + entry.bucket.posts.length, 0) / count, totalEngagement: entries.reduce((sum, entry) => sum + entry.bucket.engagement, 0) / count, uniqueAuthors: entries.reduce((sum, entry) => sum + entry.bucket.authors.size, 0) / count, normalizedPerformance: average(performances), historicalPosts: entries.reduce((sum, entry) => sum + entry.bucket.posts.length, 0) };
}
function bucketMetrics(bucket: Bucket): Pick<TrendRecord, "postCount" | "uniqueAuthors" | "totalEngagement" | "averageEngagement"> { return { postCount: bucket.posts.length, uniqueAuthors: bucket.authors.size, totalEngagement: bucket.engagement, averageEngagement: bucket.posts.length ? bucket.engagement / bucket.posts.length : null }; }
function calculatePostTypes(buckets: Bucket[]): PostTypePerformance[] {
  const all = emptyBucket(); for (const bucket of buckets) for (const post of bucket.posts) addToBucket(all, post);
  const overall = average(all.performances);
  return [...all.postTypes.entries()].map(([postType, type]) => ({ postType, postCount: type.posts, uniqueAuthors: type.authors.size, averagePerformance: average(type.performances), totalEngagement: type.engagement, shareOfTrendActivity: all.posts.length ? type.posts / all.posts.length : 0, relativePerformance: average(type.performances) === null || overall === null || overall === 0 ? null : average(type.performances)! / overall, ...(type.posts < 3 ? { sampleSizeWarning: "Fewer than 3 posts; relative performance is not used for the dominant format." } : {}) })).sort((left, right) => right.shareOfTrendActivity - left.shareOfTrendActivity || (right.relativePerformance ?? -Infinity) - (left.relativePerformance ?? -Infinity));
}
function buildMetrics(totalPosts: number, trends: TrendRecord[], alerts: TrendAlert[], configuration: Required<DetectionOptions>): DetectionResult["metrics"] {
  const alertsByPlatform: Record<Platform, number> = { x: 0, instagram: 0, tiktok: 0 }; const alertsByTopic: Record<string, number> = {}; const earliestDetectionByTrend: Record<string, string> = {}; const strongestTrendByPlatform: Partial<Record<Platform, TrendRecord>> = {}; const suppressedByReason: Record<string, number> = {};
  for (const alert of alerts) { alertsByPlatform[alert.platform]++; alertsByTopic[alert.topic] = (alertsByTopic[alert.topic] ?? 0) + 1; earliestDetectionByTrend[`${alert.platform}:${alert.topic}`] ??= alert.detectedAt; }
  for (const trend of trends) if (trend.eligibleForAlert && (!strongestTrendByPlatform[trend.platform] || trend.trendScore! > strongestTrendByPlatform[trend.platform]!.trendScore!)) strongestTrendByPlatform[trend.platform] = trend;
  for (const trend of trends) for (const reason of trend.suppressionReasons) suppressedByReason[reason] = (suppressedByReason[reason] ?? 0) + 1;
  const suppressedExamples = trends.filter((trend) => trend.suppressionReasons.length > 0 && (trend.totalEngagement === 0 || trend.suppressionReasons.includes("insufficient sustained evidence"))).slice(0, 10).map(({ platform, topic, hour, postCount, totalEngagement, suppressionReasons }) => ({ platform, topic, hour, postCount, totalEngagement, suppressionReasons }));
  return { configuration, totalPosts, combinationsAnalyzed: new Set(trends.map((trend) => combinationKey(trend.platform, trend.topic))).size, alertsByPlatform, alertsByTopic, earliestDetectionByTrend, strongestTrendByPlatform, suppressedByReason, suppressedExamples };
}
function relativeGrowth(current: number, baseline: number): number { return baseline <= 0 ? (current > 0 ? 2 : 0) : (current - baseline) / baseline; }
function capSignal(value: number): number { return Math.max(0, Math.min(value / 2, 1)); }
function average(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function hasSustainedEvidence(previous: ScoreSnapshot[], hour: string, score: number, threshold: number): boolean { const latest = previous.at(-1); return latest !== undefined && Date.parse(hour) - Date.parse(latest.hour) === HOUR_MS && latest.score >= threshold * 0.7 && score > latest.score; }
export function classifyTrajectory(scores: number[]): TrendRecord["trajectory"] { if (scores.length < 2) return "rising"; const last = scores.at(-1)!; const prior = scores.at(-2)!; const change = last - prior; if (change < 0) return "cooling"; if (scores.length >= 3) { const earlier = scores.at(-3)!; const priorChange = prior - earlier; if (change >= 20 && prior >= earlier) return "strong_acceleration"; if (change > 0 && change > priorChange) return "accelerating"; } return "rising"; }
function combinationKey(platform: Platform, topic: string): string { return `${platform}\u0000${topic}`; }
function splitKey(key: string): [Platform, string] { const [platform, topic] = key.split("\u0000"); return [platform as Platform, topic]; }