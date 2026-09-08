import { loadAndNormalizePosts, writeNormalizedOutput } from "@/ingestion/loadAndNormalizePosts";
import { detectTrends, writeTrendOutput } from "@/trends/detectTrends";

async function main(): Promise<void> {
	const { posts, summary } = await loadAndNormalizePosts();
	await writeNormalizedOutput(posts, summary);
	const detection = detectTrends(posts);
	await writeTrendOutput(detection);

	const duplicates = Object.values(summary.platforms).reduce((total, platform) => total + platform.duplicatesRemoved, 0);
	const invalid = Object.values(summary.platforms).reduce((total, platform) => total + platform.invalidOrSkipped, 0);

	console.log(`X: ${summary.postCountPerPlatform.x} posts`);
	console.log(`Instagram: ${summary.postCountPerPlatform.instagram} posts`);
	console.log(`TikTok: ${summary.postCountPerPlatform.tiktok} posts`);
	console.log(`Duplicates removed: ${duplicates}`);
	console.log(`Invalid/skipped: ${invalid}`);
	console.log(`Unique topics: ${summary.uniqueTopicCount}`);
	console.log(`Time range: ${summary.earliestTimestamp ?? "n/a"} -> ${summary.latestTimestamp ?? "n/a"}`);
	console.log(`Platform/topic combinations analyzed: ${detection.metrics.combinationsAnalyzed}`);
	console.log(`Total alerts: ${detection.alerts.length}`);
	console.log(`Alerts by platform: ${Object.entries(detection.metrics.alertsByPlatform).map(([platform, count]) => `${platform}=${count}`).join(", ")}`);
	console.log(`Alerts by topic: ${Object.entries(detection.metrics.alertsByTopic).map(([topic, count]) => `${topic}=${count}`).join(", ") || "none"}`);
	for (const platform of ["x", "instagram", "tiktok"] as const) {
		const strongest = detection.metrics.strongestTrendByPlatform[platform];
		if (strongest) console.log(`Strongest ${platform}: ${strongest.topic} (${strongest.trendScore}) at ${strongest.hour}`);
	}
	for (const alert of detection.alerts.slice(0, 10)) console.log(`Alert ${alert.platform}:${alert.topic} ${alert.detectedAt} score=${alert.trendScore} types=${alert.dominantPostTypes.join(",")}`);
}

void main();