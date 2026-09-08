# Early Trend Radar

**Live application:** [https://trend-detection.vercel.app/](https://trend-detection.vercel.app/)

## Overview

Early Trend Radar is a TypeScript/Next.js take-home assignment that replays 48 hours of normalized social-media activity from X, Instagram, and TikTok. It detects and ranks **candidate** emerging trends using explainable, time-aware evidence. An alert is a detector result to review, not confirmation of a real-world trend.

## Problem Statement

Social activity can increase rapidly around emerging topics, but absolute volume alone is not enough: normal activity varies by topic and platform. The system compares each topic's current activity with its own rolling historical baseline, then combines volume, engagement, author, and performance signals to identify meaningful acceleration.

## Solution Overview

```text
Raw social data
    ↓
Normalization
    ↓
Deduplication / deleted-post handling
    ↓
Hourly aggregation
    ↓
Rolling historical baseline
    ↓
Multi-signal trend scoring
    ↓
Trajectory classification
    ↓
Alert generation
    ↓
Dashboard
```

The current supplied data spans from `2026-08-24T00:03:02.000Z` to `2026-08-25T23:59:47.000Z`.

## Supported Platforms

- X: `data/x_posts.csv`
- Instagram: `data/instagram_posts.csv`
- TikTok: `data/tiktok_posts.jsonl` (read as JSON Lines, one object per line)

## Architecture

| Module | Responsibility |
| --- | --- |
| [src/ingestion/loadAndNormalizePosts.ts](src/ingestion/loadAndNormalizePosts.ts) | Reads source files, handles CSV/JSONL differences, cleans data, extracts hashtags, deduplicates posts, and writes normalized output. |
| [src/normalization/types.ts](src/normalization/types.ts) | Defines the common `NormalizedPost` model used independently of the UI. |
| [src/trends/detectTrends.ts](src/trends/detectTrends.ts) | Runs the chronological, hourly replay; produces trend records, alerts, metrics, and post-type analysis. |
| [src/pipeline/run.ts](src/pipeline/run.ts) | Offline entry point that runs normalization followed by detection and prints a concise report. |
| [src/dashboard/readAlerts.ts](src/dashboard/readAlerts.ts) | Reads and defensively parses `output/alerts.json` on the server. |
| [src/dashboard/TrendDashboard.tsx](src/dashboard/TrendDashboard.tsx) | Client dashboard with filters, alert selection, signal detail, and content-format analysis. |
| [src/app/page.tsx](src/app/page.tsx) | App Router route for the dashboard at `/`. |

## Trend Detection Methodology

The detector groups posts by **platform + topic + one-hour bucket**. Each bucket records post count, unique authors, total and average engagement, normalized performance, and post-type metrics.

Replay is chronological. For an evaluation hour $T$, the rolling baseline is read before the current bucket is added to history. The baseline uses up to six earlier platform-data-present windows for that platform/topic.

The score combines capped relative-growth signals with these weights:

- Volume acceleration: 35%
- Engagement acceleration: 35%
- Unique-author growth: 20%
- Performance quality: 10%

The resulting score is adjusted by the current unique-author-to-post ratio, an organic/diversity heuristic. Normalized performance uses engagement relative to the best available platform denominator: X impressions then followers, Instagram reach then followers, and TikTok views then followers. Missing or non-positive denominators omit that post from performance averages.

Using multiple signals prevents a topic with only high volume, repeated posts from one account, or raw engagement alone from being treated as equally convincing.

### Alert Gates

The default detector configuration is deliberately conservative:

- Up to 6 historical windows, with at least 4 available to form a baseline.
- At least 3 historical topic posts.
- At least 3 current posts and 2 current authors.
- At least 40% author diversity and 50% volume acceleration.
- Trend score of at least 55.
- Either sustained evidence across consecutive available windows or a strong spike with at least 2x volume growth and 1x engagement growth.
- No alert for a cooling trajectory or for a zero-engagement candidate with no meaningful performance signal.

The detector also records suppression reasons in `metrics.json`, including insufficient history, low activity, inadequate sustained evidence, no engagement/performance signal, and cooling trajectory.

## Future Leakage Prevention

The replay loop processes hourly buckets in ascending timestamp order. At hour $T$, historical state contains only buckets from $T$ and earlier; baseline inputs are read before the current hour is written to that state. Platform hours with no collected posts are excluded from the historical comparison rather than treated as zero activity.

[tests/detectTrends.test.ts](tests/detectTrends.test.ts) verifies that adding a large 12:00 spike does not change the 11:00 trend record, baseline, signals, or score. These tests demonstrate the implemented replay behavior; they do not substitute for production data-quality monitoring.

## Trend Trajectories

Each scored record is classified from recent trend-score history:

- **Rising**: score increased.
- **Accelerating**: score increased with greater momentum than the prior increase.
- **Strong acceleration**: a large recent score increase after non-declining scores.
- **Cooling**: recent score decreased; new alerts are suppressed.

## Alert Generation and Explainability

An alert is emitted when a platform/topic first crosses all gates. The detector tracks the prior eligible state and applies a six-hour cooldown to control repeated alerts for the same platform/topic.

Every alert contains its confidence, trend score, trajectory, and structured signals: volume acceleration, engagement acceleration, author growth, performance quality, and author diversity. Confidence is derived from the score and author diversity.

Alerts also include detector-provided post-type analysis: post count, unique authors, average and relative performance, total engagement, and activity share. A dominant format is selected from formats with at least three posts using activity share and relative performance. Smaller samples keep their performance data but receive a `sampleSizeWarning` and are not used to select the dominant format.

## Dashboard

The Next.js App Router dashboard is available at `/` and reads `output/alerts.json`. The deployed dashboard is available at [trend-detection.vercel.app](https://trend-detection.vercel.app/). It provides:

- Overview metrics: total alerts, high-confidence alerts, represented platforms, and strongest signal.
- A confidence-and-time-sorted emerging-trends list.
- Client-side platform, trajectory, and minimum-confidence filters.
- Readable trajectory indicators for rising, accelerating, strong acceleration, and cooling states.
- A selected-alert panel with the five detection signals and concise definitions.
- Detector-provided content-format analysis, dominant formats, and sample-size warnings.
- Empty states for absent or filtered-out alerts, and defensive handling for incomplete optional fields.

## Output Files

`npm run process` regenerates these files under `output/`:

| File | Contents |
| --- | --- |
| [output/normalized-posts.json](output/normalized-posts.json) | Chronologically sorted common normalized post records. |
| [output/ingestion-summary.json](output/ingestion-summary.json) | Per-platform ingestion counts, duplicates, topics, hourly post counts, time range, and potential data gaps. |
| [output/trends.json](output/trends.json) | Per-hour platform/topic trend records, baselines, signals, scores, trajectories, and suppression reasons. |
| [output/alerts.json](output/alerts.json) | Threshold-crossing alerts and their post-type evidence; this is the dashboard source of truth. |
| [output/metrics.json](output/metrics.json) | Detector configuration, aggregate counts, strongest eligible trends, and suppression statistics. |

## Getting Started

Install dependencies:

```bash
npm install
```

Run the unit tests:

```bash
npm run test
```

Process the supplied datasets and regenerate all output artifacts:

```bash
npm run process
```

Start the development dashboard at `http://localhost:3000`:

```bash
npm run dev
```

Build and run the production application:

```bash
npm run build
npm run start
```

`npm run test:watch` runs Vitest in watch mode.

## Testing

Vitest is used for unit tests.

- [tests/smoke.test.ts](tests/smoke.test.ts) covers timestamp parsing, hashtag extraction/filtering, platform post-type mapping, JSONL malformed-line recovery, and deduplication.
- [tests/detectTrends.test.ts](tests/detectTrends.test.ts) covers future-data isolation, zero-engagement suppression, isolated versus sustained acceleration, trajectory classification, and post-type sample-size protection.
- [tests/dashboard.test.ts](tests/dashboard.test.ts) covers defensive alert parsing, platform/trajectory/confidence filtering, sorting, selection, overview values, and empty alert lists.

## Example Detection

The generated output includes an X `appdown` alert at `2026-08-24T05:00:00.000Z` with 100 confidence and a 100 trend score. Its current hour had volume acceleration of $2.33$, engagement acceleration of $22.37$, author growth of $2.33$, performance quality of $3.61$, and author diversity of $1.00$. The detector identifies `text` as the dominant content format based on the available activity and relative performance.

This illustrates the intended evidence: increased posting volume, engagement, and author participation alongside performance context, rather than a single opaque rank.

## Design Decisions and Trade-offs

- **Deterministic offline replay:** The solution uses supplied files and generated JSON artifacts instead of an LLM or live integrations, keeping the take-home scope reproducible.
- **Normalized cross-platform model:** Ingestion translates different source shapes into one `NormalizedPost` contract while retaining useful platform metadata.
- **Rolling local baselines:** Comparing a topic to its own recent history is more useful for early acceleration than a global absolute threshold.
- **Explainable heuristics:** Weighted signals, explicit gates, suppression reasons, and visible post-type evidence make alert behavior inspectable.
- **No future data in decisions:** Chronological replay preserves the evaluation-time boundary and is exercised by dedicated tests.

## Limitations

- The system is an offline replay of the supplied dataset, not live platform ingestion.
- The detector's six-hour history and weighted thresholds are heuristics, not learned or calibrated models.
- Hashtag extraction is the implemented topic-discovery method; it does not perform semantic clustering.
- Potential data gaps are identified from unusually long post gaps, but are not confirmed collection outages.
- The in-memory, single-process implementation is intentionally scoped for an interview assignment rather than production-scale throughput.

## Future Work

The following are not implemented:

- Streaming ingestion and durable storage for live platform data.
- Distributed processing and operational monitoring/observability.
- Live platform API integrations and alert delivery channels.
- Model-based score calibration, topic grouping, and ranking evaluation against labeled outcomes.

## Interview Demo Flow

1. Explain why relative acceleration is more useful than absolute volume.
2. Walk through ingestion and the normalized cross-platform post model.
3. Run `npm run process` and inspect the generated trend, alert, and metrics artifacts.
4. Open the dashboard with `npm run dev`.
5. Select a strong alert such as `appdown` on X.
6. Review its signals, trajectory, author diversity, and content-format breakdown.
7. Explain the chronological replay and future-leakage tests.
8. Discuss the future-work path from offline replay to a production system.