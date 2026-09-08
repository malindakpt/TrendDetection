import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { NormalizedPost, Platform } from "@/normalization/types";

const DEFAULT_STOP_TOPICS = new Set(["viral", "trending", "foryou", "explore", "relatable"]);
const GAP_THRESHOLD_MS = 24 * 60 * 60 * 1000;

type PlatformStatistics = {
  totalRowsRead: number;
  successfullyNormalized: number;
  duplicatesRemoved: number;
  invalidOrSkipped: number;
  deletedPostsSkipped: number;
};

export type IngestionSummary = {
  platforms: Record<Platform, PlatformStatistics>;
  malformedJsonlLines: number;
  deletedPostsSkipped: number;
  uniqueTopicCount: number;
  discoveredTopics: string[];
  postCountPerTopic: Record<string, number>;
  postCountPerPlatform: Record<Platform, number>;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  postsPerPlatformByHour: Record<Platform, Record<string, number>>;
  potentialDataGaps: Record<Platform, Array<{ start: string; end: string; durationHours: number }>>;
};

export type LoadAndNormalizeOptions = {
  dataDirectory?: string;
  genericTopicStopList?: Iterable<string>;
};

type TikTokRecord = {
  id?: unknown;
  create_time?: unknown;
  author?: { unique_id?: unknown; follower_count?: unknown };
  desc?: unknown;
  stats?: { play_count?: unknown; digg_count?: unknown; comment_count?: unknown; share_count?: unknown; collect_count?: unknown };
  video?: { duration?: unknown };
  is_duet?: unknown;
  is_live_replay?: unknown;
  hashtags?: unknown;
};

export async function loadAndNormalizePosts(options: LoadAndNormalizeOptions = {}): Promise<{
  posts: NormalizedPost[];
  summary: IngestionSummary;
}> {
  const dataDirectory = options.dataDirectory ?? path.join(process.cwd(), "data");
  const stopTopics = new Set([...DEFAULT_STOP_TOPICS, ...(options.genericTopicStopList ?? [])].map(normalizeTopic).filter(Boolean));
  const summary = createSummary();
  const posts = [
    ...normalizeCsv(await readFile(path.join(dataDirectory, "x_posts.csv"), "utf8"), "x", stopTopics, summary),
    ...normalizeCsv(await readFile(path.join(dataDirectory, "instagram_posts.csv"), "utf8"), "instagram", stopTopics, summary),
    ...normalizeTikTokJsonl(await readFile(path.join(dataDirectory, "tiktok_posts.jsonl"), "utf8"), stopTopics, summary),
  ];

  posts.sort((first, second) => first.timestamp.localeCompare(second.timestamp) || first.platform.localeCompare(second.platform) || first.id.localeCompare(second.id));
  populateSummary(summary, posts);
  return { posts, summary };
}

export async function writeNormalizedOutput(posts: NormalizedPost[], summary: IngestionSummary, outputDirectory = path.join(process.cwd(), "output")): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, "normalized-posts.json"), `${JSON.stringify(posts, null, 2)}\n`),
    writeFile(path.join(outputDirectory, "ingestion-summary.json"), `${JSON.stringify(summary, null, 2)}\n`),
  ]);
}

export function parseXTimestamp(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(trimmed)) {
    const [datePart, timePart] = trimmed.split(" ");
    const [day, month, year] = datePart.split("/").map(Number);
    const [hours, minutes] = timePart.split(":").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, hours, minutes));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString() : null;
  }
  return toUtcIso(trimmed);
}

export function parseUnixTimestamp(value: unknown): string | null {
  const seconds = optionalNumber(value);
  return seconds === null ? null : toUtcIso(new Date(seconds * 1000).toISOString());
}

export function extractTopicsFromText(text: string, stopTopics = DEFAULT_STOP_TOPICS): string[] {
  const hashtags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return uniqueTopics(hashtags.map(normalizeTopic), stopTopics);
}

export function extractTikTokTopics(hashtags: unknown, stopTopics = DEFAULT_STOP_TOPICS): string[] {
  return Array.isArray(hashtags) ? uniqueTopics(hashtags.filter((tag): tag is string => typeof tag === "string").map(normalizeTopic), stopTopics) : [];
}

export function mapXPostType(mediaType: string): string {
  return ({ none: "text", photo: "photo", video: "video", gif: "gif" } as Record<string, string>)[mediaType.trim().toLowerCase()] ?? "text";
}

export function mapInstagramPostType(productType: string, mediaType: string): string {
  const product = productType.trim().toUpperCase();
  const media = mediaType.trim().toUpperCase();
  if (product === "STORY") return "story";
  if (product === "REELS" && media === "VIDEO") return "reel";
  if (product === "FEED" && media === "CAROUSEL_ALBUM") return "carousel";
  if (product === "FEED" && media === "IMAGE") return "image";
  if (product === "FEED" && media === "VIDEO") return "video";
  return media.toLowerCase() || "unknown";
}

export function mapTikTokPostType(isDuet: boolean, isLiveReplay: boolean): string {
  return isDuet ? "duet" : isLiveReplay ? "live_clip" : "short_video";
}

function normalizeCsv(content: string, platform: "x" | "instagram", stopTopics: Set<string>, summary: IngestionSummary): NormalizedPost[] {
  const [headers = [], ...rows] = parseCsv(content);
  const seen = new Set<string>();
  const posts: NormalizedPost[] = [];
  for (const cells of rows) {
    summary.platforms[platform].totalRowsRead++;
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    const id = platform === "x" ? row.post_id : row.media_id;
    if (!id || cells.length !== headers.length) { summary.platforms[platform].invalidOrSkipped++; continue; }
    if (seen.has(id)) { summary.platforms[platform].duplicatesRemoved++; continue; }
    seen.add(id);
    const post = platform === "x" ? normalizeX(row, stopTopics) : normalizeInstagram(row, stopTopics);
    addPost(post, platform, posts, summary);
  }
  return posts;
}

function normalizeTikTokJsonl(content: string, stopTopics: Set<string>, summary: IngestionSummary): NormalizedPost[] {
  const seen = new Set<string>();
  const posts: NormalizedPost[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    summary.platforms.tiktok.totalRowsRead++;
    let record: TikTokRecord;
    try { record = JSON.parse(line) as TikTokRecord; } catch { summary.malformedJsonlLines++; summary.platforms.tiktok.invalidOrSkipped++; continue; }
    const id = stringValue(record.id);
    if (!id) { summary.platforms.tiktok.invalidOrSkipped++; continue; }
    if (seen.has(id)) { summary.platforms.tiktok.duplicatesRemoved++; continue; }
    seen.add(id);
    addPost(normalizeTikTok(record, stopTopics), "tiktok", posts, summary);
  }
  return posts;
}

function normalizeX(row: Record<string, string>, stopTopics: Set<string>): NormalizedPost | null {
  const text = row.text.trim();
  const timestamp = parseXTimestamp(row.created_at);
  if (!timestamp || !text) return null;
  const likes = optionalNumber(row.like_count); const reposts = optionalNumber(row.repost_count); const replies = optionalNumber(row.reply_count); const quotes = optionalNumber(row.quote_count); const bookmarks = optionalNumber(row.bookmark_count);
  return { id: row.post_id, platform: "x", timestamp, authorId: row.author_handle.trim(), followers: optionalNumber(row.author_followers), text, topics: extractTopicsFromText(text, stopTopics), postType: mapXPostType(row.media_type), likes, comments: replies, shares: reposts, saves: bookmarks, views: null, impressions: optionalNumber(row.impression_count), engagement: sumMetrics([likes, reposts, replies, quotes, bookmarks]), reposts, replies, quotes, metadata: { language: blankToUndefined(row.lang), inReplyToId: blankToUndefined(row.in_reply_to_id) } };
}

function normalizeInstagram(row: Record<string, string>, stopTopics: Set<string>): NormalizedPost | null {
  const text = row.caption.trim();
  const timestamp = parseUnixTimestamp(row.taken_at);
  if (!timestamp || !text) return null;
  const likes = optionalNumber(row.like_count); const comments = optionalNumber(row.comment_count); const saves = optionalNumber(row.save_count); const shares = optionalNumber(row.share_count);
  return { id: row.media_id, platform: "instagram", timestamp, authorId: row.username.trim(), followers: optionalNumber(row.follower_count), text, topics: extractTopicsFromText(text, stopTopics), postType: mapInstagramPostType(row.media_product_type, row.media_type), likes, comments, shares, saves, views: optionalNumber(row.video_view_count), impressions: null, engagement: sumMetrics([likes, comments, saves, shares]), metadata: { reach: optionalNumber(row.reach) } };
}

function normalizeTikTok(record: TikTokRecord, stopTopics: Set<string>): NormalizedPost | null {
  const timestamp = parseUnixTimestamp(record.create_time); const text = stringValue(record.desc).trim(); const id = stringValue(record.id);
  if (!timestamp || !text || !id) return null;
  const likes = optionalNumber(record.stats?.digg_count); const comments = optionalNumber(record.stats?.comment_count); const shares = optionalNumber(record.stats?.share_count); const saves = optionalNumber(record.stats?.collect_count); const isDuet = record.is_duet === true; const isLiveReplay = record.is_live_replay === true;
  return { id, platform: "tiktok", timestamp, authorId: stringValue(record.author?.unique_id), followers: optionalNumber(record.author?.follower_count), text, topics: extractTikTokTopics(record.hashtags, stopTopics), postType: mapTikTokPostType(isDuet, isLiveReplay), likes, comments, shares, saves, views: optionalNumber(record.stats?.play_count), impressions: null, engagement: sumMetrics([likes, comments, shares, saves]), metadata: { videoDurationSeconds: optionalNumber(record.video?.duration), isDuet, isLiveReplay } };
}

function addPost(post: NormalizedPost | null, platform: Platform, posts: NormalizedPost[], summary: IngestionSummary): void {
  if (!post) { summary.platforms[platform].invalidOrSkipped++; return; }
  if (post.text.toLowerCase() === "[deleted]") { summary.platforms[platform].deletedPostsSkipped++; summary.deletedPostsSkipped++; return; }
  posts.push(post); summary.platforms[platform].successfullyNormalized++;
}

function createSummary(): IngestionSummary {
  const stats = (): PlatformStatistics => ({ totalRowsRead: 0, successfullyNormalized: 0, duplicatesRemoved: 0, invalidOrSkipped: 0, deletedPostsSkipped: 0 });
  return { platforms: { x: stats(), instagram: stats(), tiktok: stats() }, malformedJsonlLines: 0, deletedPostsSkipped: 0, uniqueTopicCount: 0, discoveredTopics: [], postCountPerTopic: {}, postCountPerPlatform: { x: 0, instagram: 0, tiktok: 0 }, earliestTimestamp: null, latestTimestamp: null, postsPerPlatformByHour: { x: {}, instagram: {}, tiktok: {} }, potentialDataGaps: { x: [], instagram: [], tiktok: [] } };
}

function populateSummary(summary: IngestionSummary, posts: NormalizedPost[]): void {
  if (posts.length) { summary.earliestTimestamp = posts[0].timestamp; summary.latestTimestamp = posts[posts.length - 1].timestamp; }
  for (const post of posts) {
    summary.postCountPerPlatform[post.platform]++;
    const hour = `${post.timestamp.slice(0, 13)}:00:00.000Z`;
    summary.postsPerPlatformByHour[post.platform][hour] = (summary.postsPerPlatformByHour[post.platform][hour] ?? 0) + 1;
    for (const topic of post.topics) summary.postCountPerTopic[topic] = (summary.postCountPerTopic[topic] ?? 0) + 1;
  }
  summary.discoveredTopics = Object.keys(summary.postCountPerTopic).sort(); summary.uniqueTopicCount = summary.discoveredTopics.length;
  for (const platform of Object.keys(summary.platforms) as Platform[]) {
    const platformPosts = posts.filter((post) => post.platform === platform);
    for (let index = 1; index < platformPosts.length; index++) {
      const previous = new Date(platformPosts[index - 1].timestamp); const current = new Date(platformPosts[index].timestamp); const gap = current.getTime() - previous.getTime();
      if (gap > GAP_THRESHOLD_MS) summary.potentialDataGaps[platform].push({ start: previous.toISOString(), end: current.toISOString(), durationHours: Number((gap / 3_600_000).toFixed(2)) });
    }
  }
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '"') { if (quoted && content[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted; }
    else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && content[index + 1] === "\n") index++; row.push(value); if (row.some((cell) => cell !== "")) rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

function normalizeTopic(value: string): string { return value.trim().replace(/^#+/, "").toLocaleLowerCase(); }
function uniqueTopics(topics: string[], stopTopics: Set<string>): string[] { return [...new Set(topics.filter((topic) => topic && !stopTopics.has(topic)))].sort(); }
function optionalNumber(value: unknown): number | null { if (value === null || value === undefined || value === "") return null; const number = typeof value === "number" ? value : Number(value); return Number.isFinite(number) ? number : null; }
function sumMetrics(metrics: Array<number | null>): number | null { return metrics.every((metric) => metric === null) ? null : metrics.reduce<number>((total, metric) => total + (metric ?? 0), 0); }
function toUtcIso(value: string): string | null { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function stringValue(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""; }
function blankToUndefined(value: string): string | undefined { const trimmed = value.trim(); return trimmed || undefined; }