"use client";

import { useState } from "react";
import { Activity, ChevronRight, CircleAlert, Gauge, Sparkles, Users } from "lucide-react";
import { dashboardOverview, defaultFilters, filterAndSortAlerts, getAlertById, type AlertFilters } from "@/dashboard/alertData";
import type { AlertPlatform, AlertTrajectory, TrendAlert } from "@/dashboard/types";

const trajectoryLabels: Record<AlertTrajectory, string> = { rising: "Rising", accelerating: "Accelerating", strong_acceleration: "Strong acceleration", cooling: "Cooling", unknown: "Unknown" };
const platformLabels: Record<AlertPlatform, string> = { x: "X", instagram: "Instagram", tiktok: "TikTok", unknown: "Unknown" };
const signalDetails = [
  ["volumeAcceleration", "Volume acceleration", "Posting activity relative to the historical baseline."],
  ["engagementAcceleration", "Engagement acceleration", "Engagement relative to the historical baseline."],
  ["authorGrowth", "Author growth", "Growth in unique authors participating."],
  ["performanceQuality", "Performance quality", "Current content performance relative to baseline."],
  ["authorDiversity", "Author diversity", "How broadly activity is distributed across authors."],
] as const;

export function TrendDashboard({ alerts }: { alerts: TrendAlert[] }) {
  const [filters, setFilters] = useState<AlertFilters>(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | null>(alerts[0]?.id ?? null);
  const overview = dashboardOverview(alerts);
  const filteredAlerts = filterAndSortAlerts(alerts, filters);
  const selected = getAlertById(alerts, selectedId) ?? filteredAlerts[0] ?? null;

  function updateFilter<Key extends keyof AlertFilters>(key: Key, value: AlertFilters[Key]) { setFilters((current) => ({ ...current, [key]: value })); }

  return <main className="radar-shell">
    <header className="radar-header">
      <div><p className="eyebrow">Signal intelligence / 48 hour replay</p><h1>Early Trend Radar</h1><p>Topics beginning to accelerate, ranked by explainable evidence.</p></div>
      <div className="status-mark"><Activity size={18} aria-hidden="true" /> Offline dataset</div>
    </header>

    <section className="overview-grid" aria-label="Alert overview">
      <OverviewCard icon={<CircleAlert />} label="Total alerts" value={overview.totalAlerts} detail="Detector threshold crossings" />
      <OverviewCard icon={<Sparkles />} label="High confidence" value={overview.highConfidenceAlerts} detail="Confidence of 80 or higher" />
      <OverviewCard icon={<Users />} label="Platforms" value={overview.platformCount} detail="Sources with active signals" />
      <OverviewCard icon={<Gauge />} label="Strongest signal" value={overview.strongestTrend?.topic ?? "None"} detail={overview.strongestTrend ? `${platformLabels[overview.strongestTrend.platform]} / ${overview.strongestTrend.confidence}% / ${trajectoryLabels[overview.strongestTrend.trajectory]}` : "No alert data"} emphasis />
    </section>

    <section className="workbench">
      <div className="trend-list-panel">
        <div className="section-heading"><div><p className="eyebrow">Live review</p><h2>Emerging trends</h2></div><span>{filteredAlerts.length} shown</span></div>
        <div className="filters" aria-label="Alert filters">
          <label>Platform<select value={filters.platform} onChange={(event) => updateFilter("platform", event.target.value as AlertFilters["platform"])}><option value="all">All platforms</option><option value="x">X</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select></label>
          <label>Trajectory<select value={filters.trajectory} onChange={(event) => updateFilter("trajectory", event.target.value as AlertFilters["trajectory"])}><option value="all">All trajectories</option>{Object.entries(trajectoryLabels).filter(([key]) => key !== "unknown").map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Minimum confidence <output>{filters.minimumConfidence}%</output><input aria-label="Minimum confidence" type="range" min="0" max="100" step="5" value={filters.minimumConfidence} onChange={(event) => updateFilter("minimumConfidence", Number(event.target.value))} /></label>
        </div>
        {filteredAlerts.length ? <div className="trend-table" role="list">{filteredAlerts.map((alert) => <button type="button" role="listitem" className={`trend-row ${selected?.id === alert.id ? "selected" : ""}`} key={alert.id} onClick={() => setSelectedId(alert.id)}>
          <span className="topic-cell"><strong>{alert.topic}</strong><small>{platformLabels[alert.platform]} / {alert.dominantPostTypes.join(", ") || "Format unavailable"}</small></span><span className="score-cell"><strong>{alert.confidence}%</strong><small>Score {alert.trendScore}</small></span><TrajectoryBadge trajectory={alert.trajectory} /><time dateTime={alert.detectedAt}>{formatDate(alert.detectedAt)}</time><ChevronRight size={17} aria-hidden="true" />
        </button>)}</div> : <div className="empty-state"><CircleAlert size={24} /><strong>No alerts match these filters.</strong><span>Lower the confidence threshold or broaden the selected filters.</span></div>}
      </div>
      <TrendDetail alert={selected} />
    </section>
  </main>;
}

function OverviewCard({ icon, label, value, detail, emphasis = false }: { icon: React.ReactNode; label: string; value: string | number; detail: string; emphasis?: boolean }) { return <article className={`overview-card ${emphasis ? "overview-emphasis" : ""}`}><span className="overview-icon">{icon}</span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>; }
function TrajectoryBadge({ trajectory }: { trajectory: AlertTrajectory }) { return <span className={`trajectory trajectory-${trajectory}`}><span aria-hidden="true">{trajectory === "cooling" ? "↓" : trajectory === "strong_acceleration" ? "↑↑" : "↑"}</span>{trajectoryLabels[trajectory]}</span>; }
function TrendDetail({ alert }: { alert: TrendAlert | null }) {
  if (!alert) return <aside className="detail-panel empty-detail"><Activity size={28} /><strong>Select an alert</strong><span>Choose a trend to inspect its evidence and content formats.</span></aside>;
  return <aside className="detail-panel" aria-label={`${alert.topic} trend details`}><div className="detail-header"><div><p className="eyebrow">Selected signal</p><h2>{alert.topic}</h2><p>{platformLabels[alert.platform]} / <time dateTime={alert.detectedAt}>{formatDate(alert.detectedAt)}</time></p></div><TrajectoryBadge trajectory={alert.trajectory} /></div><div className="detail-score"><div><span>Confidence</span><strong>{alert.confidence}%</strong></div><div><span>Trend score</span><strong>{alert.trendScore}</strong></div><div><span>Dominant format</span><strong>{alert.dominantPostTypes.join(", ") || "Unavailable"}</strong></div></div><section><h3>Detection signals</h3><div className="signal-list">{signalDetails.map(([key, label, description]) => <div className="signal-row" key={key}><div><strong>{label}</strong><span>{description}</span></div><b>{formatSignal(key, alert.signals[key])}</b></div>)}</div></section><section><h3>Content format analysis</h3>{alert.postTypeBreakdown.length ? <div className="format-list">{alert.postTypeBreakdown.map((format) => <article className={alert.dominantPostTypes.includes(format.postType) ? "format-card dominant-format" : "format-card"} key={format.postType}><div><strong>{format.postType}</strong>{alert.dominantPostTypes.includes(format.postType) && <span className="dominant-label">Dominant</span>}</div><div className="format-metrics"><span>{format.postCount} posts</span><span>{format.uniqueAuthors} authors</span><span>{format.totalEngagement} engagement</span><span>{percent(format.shareOfTrendActivity)} activity</span><span>{format.averagePerformance === null ? "Performance unavailable" : `${format.averagePerformance.toFixed(3)} avg. performance`}</span><span>{format.relativePerformance === null ? "Relative performance unavailable" : `${format.relativePerformance.toFixed(2)}x relative`}</span></div>{format.sampleSizeWarning && <p className="sample-warning">{format.sampleSizeWarning}</p>}</article>)}</div> : <p className="missing-copy">No content format breakdown is available for this alert.</p>}</section></aside>;
}
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date); }
function formatSignal(key: keyof TrendAlert["signals"], value: number): string { return key === "authorDiversity" ? percent(value) : `${value >= 0 ? "+" : ""}${value.toFixed(2)}x`; }
function percent(value: number): string { return `${Math.round(value * 100)}%`; }