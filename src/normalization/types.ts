export type Platform = "x" | "instagram" | "tiktok";

export interface NormalizedPost {
  id: string;
  platform: Platform;
  timestamp: string;
  authorId: string;
  followers: number | null;
  text: string;
  topics: string[];
  postType: string;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  views: number | null;
  impressions: number | null;
  engagement: number | null;
  reposts?: number | null;
  replies?: number | null;
  quotes?: number | null;
  metadata?: {
    language?: string;
    inReplyToId?: string;
    reach?: number | null;
    videoDurationSeconds?: number | null;
    isDuet?: boolean;
    isLiveReplay?: boolean;
  };
}