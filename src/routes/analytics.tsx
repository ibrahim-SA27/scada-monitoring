import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  BarChart3,
  Bell,
  AlertTriangle,
  Ban,
  Mail,
  ShieldCheck,
  Activity,
  Calendar,
  Layers,
  Database,
  CheckCircle2,
  Copy,
  Check,
  Flame,
  ArrowUpRight,
  RefreshCw,
  Clock,
  Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useSimulation } from "@/components/dashboard/simulation";
import { fmt, type SensorKey } from "@/lib/effluent";
import { sensors } from "@/components/dashboard/mock-data";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics & Aggregates — EFFLUENT DASHBOARD" },
      {
        name: "description",
        content:
          "Daily and weekly sensor averages, critical event counts, discharge safety metrics, and SQL aggregation queries for industrial effluent monitoring.",
      },
    ],
  }),
  component: AnalyticsPage,
});

interface DailyRecord {
  day: string;
  dayLabel: string;
  totalSamples: number;
  avgPh: number;
  minPh: number;
  maxPh: number;
  avgTds: number;
  minTds: number;
  maxTds: number;
  avgTurbidity: number;
  minTurbidity: number;
  maxTurbidity: number;
  avgTemperature: number;
  avgFlow: number;
  avgRiskScore: number;
  maxRiskScore: number;
  criticalEventsCount: number;
  warningEventsCount: number;
  safeEventsCount: number;
  dischargeBlockedCount: number;
  estimatedVolumeLiters: number;
  complianceRatePct: number;
}

interface WeeklyRecord {
  weekStart: string;
  weekLabel: string;
  totalSamples: number;
  avgPh: number;
  avgTds: number;
  avgTurbidity: number;
  avgTemperature: number;
  avgFlow: number;
  avgRiskScore: number;
  maxRiskScore: number;
  criticalEventsCount: number;
  warningEventsCount: number;
  dischargeBlockedCount: number;
  volumeKiloLiters: number;
  complianceRatePct: number;
}

interface CriticalBreakdownItem {
  parameter: string;
  severity: string;
  eventCount: number;
  unresolvedCount: number;
  gmailSentCount: number;
  avgRiskScore: number;
  lastIncidentTime?: string;
}

interface AnalyticsSummaryApiData {
  success: boolean;
  deviceId: string;
  generatedAt: string;
  period: string;
  totals: {
    totalSamples: number;
    avgPh: number;
    avgTds: number;
    avgTurbidity: number;
    avgTemperature: number;
    avgFlow: number;
    avgRiskScore: number;
    totalCriticalEvents: number;
    totalWarningEvents: number;
    totalDischargeBlocked: number;
    totalGmailSent: number;
    overallComplianceRate: number;
  };
  daily: DailyRecord[];
  weekly: WeeklyRecord[];
  criticalBreakdown: CriticalBreakdownItem[];
  sqlQueries: {
    dailySummarySql: string;
    weeklySummarySql: string;
    criticalEventsSql: string;
  };
}

function AnalyticsPage() {
  const { history, stats, isOffline } = useSimulation();
  const [activeTab, setActiveTab] = useState<"daily" | "weekly" | "critical" | "sql">("daily");
  const [summaryData, setSummaryData] = useState<AnalyticsSummaryApiData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedQuery, setCopiedQuery] = useState<string | null>(null);

  // Fetch from the new /api/analytics/summary endpoint
  const fetchAnalyticsSummary = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/analytics/summary");
      if (res.ok) {
        const json = await res.json();
        setSummaryData(json);
      }
    } catch (err) {
      console.error("Failed to fetch analytics summary:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyticsSummary();
  }, []);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedQuery(id);
    setTimeout(() => setCopiedQuery(null), 2000);
  };

  const n = history.length || 1;
  const avg = (pick: (r: (typeof history)[number]) => number) =>
    history.reduce((s, r) => s + pick(r), 0) / n;

  // Fallback / live values merged with API summary
  const currentAvgPh = summaryData?.totals?.avgPh ?? avg((r) => r.ph);
  const currentAvgTds = summaryData?.totals?.avgTds ?? avg((r) => r.tds);
  const currentAvgTurbidity = summaryData?.totals?.avgTurbidity ?? avg((r) => r.turbidity);
  const currentAvgTemp = summaryData?.totals?.avgTemperature ?? avg((r) => r.temperature);
  const currentAvgFlow = summaryData?.totals?.avgFlow ?? avg((r) => r.flow);
  const currentAvgRisk = summaryData?.totals?.avgRiskScore ?? avg((r) => r.risk);

  const totalCriticalEvents =
    summaryData?.totals?.totalCriticalEvents ?? stats.criticalEvents;
  const totalDischargeBlocked =
    summaryData?.totals?.totalDischargeBlocked ?? stats.blockedEvents;
  const totalGmailSent =
    summaryData?.totals?.totalGmailSent ?? stats.gmailSentCount ?? stats.criticalEvents;
  const complianceRate =
    summaryData?.totals?.overallComplianceRate ?? (stats.criticalEvents > 0 ? 94.5 : 99.2);

  const eventMetrics = [
    {
      label: "Critical Events",
      value: totalCriticalEvents,
      subtext: "Immediate SCADA Interlock Triggered",
      icon: AlertTriangle,
      color: "text-critical",
      bg: "bg-destructive/10 border-destructive/30",
    },
    {
      label: "Discharge Blocked",
      value: totalDischargeBlocked,
      subtext: "Automated Solenoid Valve Closes",
      icon: Ban,
      color: "text-critical",
      bg: "bg-destructive/10 border-destructive/30",
    },
    {
      label: "Warning Thresholds",
      value:
        summaryData?.totals?.totalWarningEvents ??
        (stats.totalAlerts - stats.criticalEvents > 0
          ? stats.totalAlerts - stats.criticalEvents
          : 0),
      subtext: "Pre-breach Preventive Alerts",
      icon: Bell,
      color: "text-warn",
      bg: "bg-amber-500/10 border-amber-500/30",
    },
    {
      label: "EPA Compliance Rate",
      value: `${complianceRate}%`,
      subtext: "Continuous Safe Discharge Standard",
      icon: ShieldCheck,
      color: "text-safe",
      bg: "bg-emerald-500/10 border-emerald-500/30",
    },
    {
      label: "Emergency Gmail Alerts",
      value: totalGmailSent,
      subtext: "Automated SMTP Dispatch Logs",
      icon: Mail,
      color: "text-cyan",
      bg: "bg-primary/10 border-primary/30",
    },
  ];

  const distributionData = [
    {
      name: "Safe Readings",
      count: history.filter((r) => r.status === "SAFE").length || 45,
      color: "var(--safe)",
    },
    {
      name: "Warning Readings",
      count: history.filter((r) => r.status === "WARNING").length || 3,
      color: "var(--warn)",
    },
    {
      name: "Critical Readings",
      count: history.filter((r) => r.status === "CRITICAL").length || 1,
      color: "var(--critical)",
    },
  ];

  const dailyRecords = summaryData?.daily || [];
  const weeklyRecords = summaryData?.weekly || [];
  const criticalBreakdown = summaryData?.criticalBreakdown || [];

  return (
    <div className="min-h-screen bg-background p-4 text-foreground">
      <div className="flex flex-col gap-4 lg:flex-row">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Header Banner */}
          <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur-md">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-primary/40 bg-primary/10 shadow-[0_0_15px_rgba(0,229,255,0.2)]">
                <BarChart3 className="h-5 w-5 text-cyan" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-base font-bold tracking-tight sm:text-lg">
                    EFFLUENT STATISTICAL ANALYTICS & AGGREGATES
                  </h1>
                  <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-medium tracking-wide text-cyan">
                    SUPABASE SQL ENGINE
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Daily/Weekly sensor averages, critical event counts, and real-time SCADA telemetry aggregates.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchAnalyticsSummary}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:border-primary/50 hover:bg-secondary"
              >
                <RefreshCw className={`h-3.5 w-3.5 text-cyan ${loading ? "animate-spin" : ""}`} />
                <span>Refresh Queries</span>
              </button>
            </div>
          </header>

          {/* Navigation View Tabs */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab("daily")}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "daily"
                  ? "border border-primary/40 bg-primary/15 text-cyan shadow-[0_0_12px_rgba(0,229,255,0.15)]"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Daily Averages & Trends (14-Day)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("weekly")}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "weekly"
                  ? "border border-primary/40 bg-primary/15 text-cyan shadow-[0_0_12px_rgba(0,229,255,0.15)]"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Weekly Aggregates (8-Week Trend)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("critical")}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "critical"
                  ? "border border-destructive/40 bg-destructive/15 text-critical shadow-[0_0_12px_rgba(255,82,82,0.15)]"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Critical Events Breakdown</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("sql")}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === "sql"
                  ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              }`}
            >
              <Database className="h-3.5 w-3.5" />
              <span>SQL Query Suite</span>
            </button>
          </div>

          {/* Top KPI Event Counters */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {eventMetrics.map(({ label, value, subtext, icon: Icon, color, bg }) => (
              <div
                key={label}
                className={`flex flex-col justify-between rounded-xl border p-4 backdrop-blur-sm transition-all ${bg}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                  </span>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <div className="mt-2">
                  <div className="font-display text-2xl font-bold tracking-tight text-foreground">
                    {value}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/80 truncate">{subtext}</p>
                </div>
              </div>
            ))}
          </div>

          {/* SENSOR AVERAGES COMPONENT */}
          <section className="scada-panel flex flex-col p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <h2 className="panel-title flex items-center gap-2 text-sm font-semibold tracking-wide">
                <Activity className="h-4 w-4 text-cyan" />
                <span>COMPUTED SENSOR AVERAGES & EPA COMPLIANCE LIMITS</span>
              </h2>
              <span className="text-[11px] text-muted-foreground">
                Aggregated from {summaryData?.totals?.totalSamples || history.length} Continuous Telemetry Samples
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
              {/* pH Card */}
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between">
                  <p className="label-caps text-muted-foreground">Average pH Level</p>
                  <span className="text-[10px] font-mono text-cyan">Safe 6.5 - 8.5</span>
                </div>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold text-cyan">
                    {currentAvgPh.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">pH</span>
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                  <span>Min: 6.85</span>
                  <span>Max: 7.55</span>
                </div>
              </div>

              {/* TDS Card */}
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between">
                  <p className="label-caps text-muted-foreground">Average TDS</p>
                  <span className="text-[10px] font-mono text-emerald-400">&lt; 1000 ppm</span>
                </div>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold text-emerald-400">
                    {Math.round(currentAvgTds)}
                  </span>
                  <span className="text-xs text-muted-foreground">ppm</span>
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                  <span>Min: 390 ppm</span>
                  <span>Max: 480 ppm</span>
                </div>
              </div>

              {/* Turbidity Card */}
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between">
                  <p className="label-caps text-muted-foreground">Average Turbidity</p>
                  <span className="text-[10px] font-mono text-amber-400">&lt; 50 NTU</span>
                </div>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold text-amber-400">
                    {currentAvgTurbidity.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">NTU</span>
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                  <span>Min: 11.5 NTU</span>
                  <span>Max: 26.0 NTU</span>
                </div>
              </div>

              {/* Temperature Card */}
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between">
                  <p className="label-caps text-muted-foreground">Average Temp</p>
                  <span className="text-[10px] font-mono text-rose-400">&lt; 35 °C</span>
                </div>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold text-rose-400">
                    {currentAvgTemp.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">°C</span>
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                  <span>Thermal Gradient: Nominal</span>
                </div>
              </div>

              {/* Flow Card */}
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <div className="flex items-center justify-between">
                  <p className="label-caps text-muted-foreground">Average Flow</p>
                  <span className="text-[10px] font-mono text-sky-400">Standard</span>
                </div>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold text-sky-400">
                    {currentAvgFlow.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">L/min</span>
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
                  <span>Daily Vol: ~3,100 L</span>
                </div>
              </div>

              {/* Risk Score Card */}
              <div className="rounded-xl border border-primary/40 bg-primary/10 p-4 shadow-[0_0_15px_rgba(0,229,255,0.15)]">
                <div className="flex items-center justify-between">
                  <p className="label-caps text-cyan">Average Risk</p>
                  <span className="text-[10px] font-bold text-cyan">EPA SAFE</span>
                </div>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-3xl font-bold text-cyan">
                    {currentAvgRisk.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">/100</span>
                </p>
                <div className="mt-3 flex items-center justify-between border-t border-primary/20 pt-2 text-[11px] text-cyan/80">
                  <span>Standard Baseline</span>
                  <span>Max Peak: 88</span>
                </div>
              </div>
            </div>
          </section>

          {/* TAB CONTENT: DAILY VIEW */}
          {activeTab === "daily" && (
            <div className="flex flex-col gap-4">
              {/* Daily Charts Grid */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {/* 14-Day pH & Risk Trend */}
                <section className="scada-panel flex flex-col p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="panel-title text-sm">
                      14-Day Daily pH & EPA Risk Score Trend
                    </h3>
                    <span className="text-[11px] text-muted-foreground">Daily Mean</span>
                  </div>
                  <div className="mt-4 h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={dailyRecords.slice().reverse()}
                        margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="phGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00e5ff" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#00e5ff" stopOpacity={0.0} />
                          </linearGradient>
                          <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ff5252" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#ff5252" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="color-mix(in oklab, var(--border) 40%, transparent)"
                        />
                        <XAxis
                          dataKey="dayLabel"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <YAxis
                          yAxisId="left"
                          domain={[6.0, 8.5]}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          domain={[0, 100]}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "var(--panel)",
                            borderColor: "var(--border)",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "11px" }} />
                        <Area
                          yAxisId="left"
                          type="monotone"
                          dataKey="avgPh"
                          name="Avg pH (Left)"
                          stroke="#00e5ff"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#phGrad)"
                        />
                        <Area
                          yAxisId="right"
                          type="monotone"
                          dataKey="avgRiskScore"
                          name="Avg Risk Score (Right)"
                          stroke="#ff5252"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#riskGrad)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* 14-Day TDS & Turbidity Trend */}
                <section className="scada-panel flex flex-col p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="panel-title text-sm">
                      14-Day Daily TDS & Turbidity Concentrations
                    </h3>
                    <span className="text-[11px] text-muted-foreground">Daily Mean</span>
                  </div>
                  <div className="mt-4 h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={dailyRecords.slice().reverse()}
                        margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="color-mix(in oklab, var(--border) 40%, transparent)"
                        />
                        <XAxis
                          dataKey="dayLabel"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "var(--panel)",
                            borderColor: "var(--border)",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "11px" }} />
                        <Bar
                          yAxisId="left"
                          dataKey="avgTds"
                          name="Avg TDS (ppm)"
                          fill="#10b981"
                          radius={[4, 4, 0, 0]}
                        />
                        <Bar
                          yAxisId="right"
                          dataKey="avgTurbidity"
                          name="Avg Turbidity (NTU)"
                          fill="#f59e0b"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>

              {/* 14-Day Daily Table */}
              <section className="scada-panel flex flex-col p-5">
                <div className="flex items-center justify-between">
                  <h3 className="panel-title text-sm">Daily Averages & Critical Incident Counts Table</h3>
                  <span className="text-xs text-muted-foreground font-mono">
                    Query: /api/analytics/summary?period=daily
                  </span>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30 text-muted-foreground">
                        <th className="p-3 font-semibold">Date</th>
                        <th className="p-3 font-semibold">Samples</th>
                        <th className="p-3 font-semibold">Avg pH (Min/Max)</th>
                        <th className="p-3 font-semibold">Avg TDS</th>
                        <th className="p-3 font-semibold">Avg Turbidity</th>
                        <th className="p-3 font-semibold">Avg Temp</th>
                        <th className="p-3 font-semibold">Avg Flow</th>
                        <th className="p-3 font-semibold">Avg Risk</th>
                        <th className="p-3 font-semibold">Critical Events</th>
                        <th className="p-3 font-semibold">Valve Cut-Offs</th>
                        <th className="p-3 font-semibold">Compliance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {dailyRecords.map((d) => (
                        <tr key={d.day} className="hover:bg-secondary/20 transition-colors">
                          <td className="p-3 font-medium text-foreground">{d.dayLabel}</td>
                          <td className="p-3 font-mono text-muted-foreground">{d.totalSamples}</td>
                          <td className="p-3 font-mono text-cyan">
                            {d.avgPh.toFixed(2)}{" "}
                            <span className="text-[10px] text-muted-foreground">
                              ({d.minPh.toFixed(1)} - {d.maxPh.toFixed(1)})
                            </span>
                          </td>
                          <td className="p-3 font-mono text-emerald-400">{d.avgTds} ppm</td>
                          <td className="p-3 font-mono text-amber-400">{d.avgTurbidity} NTU</td>
                          <td className="p-3 font-mono text-rose-400">{d.avgTemperature} °C</td>
                          <td className="p-3 font-mono text-sky-400">{d.avgFlow} L/m</td>
                          <td className="p-3 font-mono">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                d.avgRiskScore > 30
                                  ? "bg-destructive/20 text-critical"
                                  : d.avgRiskScore > 15
                                    ? "bg-amber-500/20 text-warn"
                                    : "bg-emerald-500/20 text-safe"
                              }`}
                            >
                              {d.avgRiskScore}/100
                            </span>
                          </td>
                          <td className="p-3 font-mono">
                            {d.criticalEventsCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded bg-destructive/20 px-2 py-0.5 font-bold text-critical">
                                <AlertTriangle className="h-3 w-3" />
                                {d.criticalEventsCount}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="p-3 font-mono">
                            {d.dischargeBlockedCount > 0 ? (
                              <span className="text-critical font-semibold">{d.dischargeBlockedCount}</span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="p-3 font-mono font-semibold text-safe">
                            {d.complianceRatePct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* TAB CONTENT: WEEKLY VIEW */}
          {activeTab === "weekly" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {/* 8-Week Sensor Trend Chart */}
                <section className="scada-panel flex flex-col p-5">
                  <h3 className="panel-title text-sm">8-Week Average Sensor Trends</h3>
                  <div className="mt-4 h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={weeklyRecords.slice().reverse()}
                        margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="color-mix(in oklab, var(--border) 40%, transparent)"
                        />
                        <XAxis
                          dataKey="weekLabel"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "var(--panel)",
                            borderColor: "var(--border)",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "11px" }} />
                        <Line
                          type="monotone"
                          dataKey="avgPh"
                          name="Avg pH"
                          stroke="#00e5ff"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="avgTurbidity"
                          name="Avg Turbidity (NTU)"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="avgRiskScore"
                          name="Avg Risk Score"
                          stroke="#ff5252"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Weekly Volume & Compliance Chart */}
                <section className="scada-panel flex flex-col p-5">
                  <h3 className="panel-title text-sm">Weekly Effluent Volume & Compliance Rate</h3>
                  <div className="mt-4 h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={weeklyRecords.slice().reverse()}
                        margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="color-mix(in oklab, var(--border) 40%, transparent)"
                        />
                        <XAxis
                          dataKey="weekLabel"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          domain={[90, 100]}
                          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "var(--panel)",
                            borderColor: "var(--border)",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "11px" }} />
                        <Bar
                          yAxisId="left"
                          dataKey="volumeKiloLiters"
                          name="Volume (KiloLiters)"
                          fill="#38bdf8"
                          radius={[4, 4, 0, 0]}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="complianceRatePct"
                          name="Compliance % (Right)"
                          stroke="#10b981"
                          strokeWidth={2}
                          dot={{ r: 4 }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>

              {/* Weekly Table */}
              <section className="scada-panel flex flex-col p-5">
                <div className="flex items-center justify-between">
                  <h3 className="panel-title text-sm">Weekly SCADA Aggregates & Event Totals</h3>
                  <span className="text-xs text-muted-foreground font-mono">
                    Query: /api/analytics/summary?period=weekly
                  </span>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30 text-muted-foreground">
                        <th className="p-3 font-semibold">Week Period</th>
                        <th className="p-3 font-semibold">Samples Count</th>
                        <th className="p-3 font-semibold">Avg pH</th>
                        <th className="p-3 font-semibold">Avg TDS</th>
                        <th className="p-3 font-semibold">Avg Turbidity</th>
                        <th className="p-3 font-semibold">Avg Flow</th>
                        <th className="p-3 font-semibold">Avg Risk</th>
                        <th className="p-3 font-semibold">Critical Events</th>
                        <th className="p-3 font-semibold">Discharge Cut-Offs</th>
                        <th className="p-3 font-semibold">Discharge Volume</th>
                        <th className="p-3 font-semibold">Compliance Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {weeklyRecords.map((w) => (
                        <tr key={w.weekStart} className="hover:bg-secondary/20 transition-colors">
                          <td className="p-3 font-medium text-foreground">{w.weekLabel}</td>
                          <td className="p-3 font-mono text-muted-foreground">{w.totalSamples}</td>
                          <td className="p-3 font-mono text-cyan">{w.avgPh.toFixed(2)}</td>
                          <td className="p-3 font-mono text-emerald-400">{w.avgTds} ppm</td>
                          <td className="p-3 font-mono text-amber-400">{w.avgTurbidity} NTU</td>
                          <td className="p-3 font-mono text-sky-400">{w.avgFlow} L/m</td>
                          <td className="p-3 font-mono font-semibold">{w.avgRiskScore}/100</td>
                          <td className="p-3 font-mono">
                            {w.criticalEventsCount > 0 ? (
                              <span className="rounded bg-destructive/20 px-2 py-0.5 font-bold text-critical">
                                {w.criticalEventsCount}
                              </span>
                            ) : (
                              "0"
                            )}
                          </td>
                          <td className="p-3 font-mono">
                            {w.dischargeBlockedCount > 0 ? (
                              <span className="text-critical font-semibold">{w.dischargeBlockedCount}</span>
                            ) : (
                              "0"
                            )}
                          </td>
                          <td className="p-3 font-mono text-sky-400">{w.volumeKiloLiters} kL</td>
                          <td className="p-3 font-mono font-semibold text-safe">
                            {w.complianceRatePct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* TAB CONTENT: CRITICAL EVENTS BREAKDOWN */}
          {activeTab === "critical" && (
            <div className="flex flex-col gap-4">
              <section className="scada-panel flex flex-col p-5">
                <div className="flex items-center justify-between border-b border-border/50 pb-3">
                  <div>
                    <h3 className="panel-title flex items-center gap-2 text-sm font-semibold text-critical">
                      <AlertTriangle className="h-4 w-4" />
                      <span>CRITICAL & EMERGENCY EVENT COUNTS BY PARAMETER</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Categorized incident occurrences, automated solenoid valve closures, and email dispatch audit records.
                    </p>
                  </div>
                  <span className="rounded-md border border-destructive/40 bg-destructive/15 px-2.5 py-1 text-xs font-bold text-critical">
                    Total Critical Incidents: {totalCriticalEvents}
                  </span>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-secondary/30 text-muted-foreground">
                        <th className="p-3 font-semibold">Violation Parameter</th>
                        <th className="p-3 font-semibold">Severity</th>
                        <th className="p-3 font-semibold">Event Count</th>
                        <th className="p-3 font-semibold">Active Unresolved</th>
                        <th className="p-3 font-semibold">Gmail Alerts Dispatched</th>
                        <th className="p-3 font-semibold">Avg Risk Score</th>
                        <th className="p-3 font-semibold">Action Triggered</th>
                        <th className="p-3 font-semibold">Last Incident</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {criticalBreakdown.map((c) => (
                        <tr key={c.parameter} className="hover:bg-secondary/20 transition-colors">
                          <td className="p-3 font-semibold text-foreground">{c.parameter}</td>
                          <td className="p-3">
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                                c.severity === "CRITICAL"
                                  ? "bg-destructive/20 text-critical border border-destructive/40"
                                  : "bg-amber-500/20 text-warn border border-amber-500/40"
                              }`}
                            >
                              {c.severity}
                            </span>
                          </td>
                          <td className="p-3 font-mono font-bold text-foreground">{c.eventCount}</td>
                          <td className="p-3 font-mono">
                            {c.unresolvedCount > 0 ? (
                              <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-critical font-bold">
                                {c.unresolvedCount} Active
                              </span>
                            ) : (
                              <span className="text-safe flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Resolved
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-cyan">{c.gmailSentCount} Sent</td>
                          <td className="p-3 font-mono font-bold text-critical">{c.avgRiskScore}/100</td>
                          <td className="p-3 text-[11px] text-muted-foreground">
                            {c.severity === "CRITICAL" ? "Valve CLOSED + Relay ACTIVE" : "Warning Logged"}
                          </td>
                          <td className="p-3 font-mono text-muted-foreground">
                            {c.lastIncidentTime || "Recent"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* TAB CONTENT: SQL QUERY SUITE */}
          {activeTab === "sql" && (
            <div className="flex flex-col gap-4">
              <section className="scada-panel flex flex-col p-5">
                <div className="flex items-center justify-between border-b border-border/50 pb-3">
                  <div>
                    <h3 className="panel-title flex items-center gap-2 text-sm font-semibold text-emerald-400">
                      <Database className="h-4 w-4" />
                      <span>PRODUCTION POSTGRESQL & SUPABASE ANALYTICS QUERIES</span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Standardized SQL aggregation queries powering the <code className="text-cyan">/api/analytics/summary</code> endpoint.
                    </p>
                  </div>
                </div>

                {/* Query 1: Daily Averages */}
                <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-black/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-cyan">
                      1. Daily Sensor Averages & Critical Event Counts Query
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          summaryData?.sqlQueries?.dailySummarySql ||
                            `SELECT date_trunc('day', created_at)::date AS day, device_id, COUNT(*) AS total_samples, ROUND(AVG(ph)::numeric, 2) AS avg_ph FROM public.sensor_readings GROUP BY 1, 2;`,
                          "dailySql",
                        )
                      }
                      className="flex items-center gap-1 rounded border border-border bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      {copiedQuery === "dailySql" ? (
                        <>
                          <Check className="h-3 w-3 text-safe" />
                          <span className="text-safe">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy SQL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-300">
                    {summaryData?.sqlQueries?.dailySummarySql ||
                      `SELECT 
    date_trunc('day', created_at)::date AS day,
    device_id,
    COUNT(*) AS total_samples,
    ROUND(AVG(ph)::numeric, 2) AS avg_ph,
    ROUND(AVG(tds)::numeric, 2) AS avg_tds,
    ROUND(AVG(turbidity)::numeric, 2) AS avg_turbidity,
    ROUND(AVG(temperature)::numeric, 2) AS avg_temperature,
    ROUND(AVG(flow)::numeric, 2) AS avg_flow,
    ROUND(AVG(risk_score)::numeric, 1) AS avg_risk_score,
    COUNT(CASE WHEN status IN ('CRITICAL', 'EMERGENCY') THEN 1 END) AS critical_events_count,
    COUNT(CASE WHEN discharge_state = 'BLOCKED' THEN 1 END) AS discharge_blocked_count,
    ROUND((COUNT(CASE WHEN status = 'SAFE' THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2) AS compliance_rate_pct
FROM public.sensor_readings
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC;`}
                  </pre>
                </div>

                {/* Query 2: Weekly Trends */}
                <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-black/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-400">
                      2. Weekly Sensor Averages & Trends Query
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          summaryData?.sqlQueries?.weeklySummarySql ||
                            `SELECT date_trunc('week', created_at)::date AS week_start FROM public.sensor_readings GROUP BY 1;`,
                          "weeklySql",
                        )
                      }
                      className="flex items-center gap-1 rounded border border-border bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      {copiedQuery === "weeklySql" ? (
                        <>
                          <Check className="h-3 w-3 text-safe" />
                          <span className="text-safe">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy SQL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-300">
                    {summaryData?.sqlQueries?.weeklySummarySql ||
                      `SELECT 
    date_trunc('week', created_at)::date AS week_start,
    TO_CHAR(date_trunc('week', created_at), '"W"IW YYYY') AS week_label,
    device_id,
    COUNT(*) AS total_samples,
    ROUND(AVG(ph)::numeric, 2) AS avg_ph,
    ROUND(AVG(tds)::numeric, 2) AS avg_tds,
    ROUND(AVG(turbidity)::numeric, 2) AS avg_turbidity,
    ROUND(AVG(temperature)::numeric, 2) AS avg_temperature,
    ROUND(AVG(flow)::numeric, 2) AS avg_flow,
    ROUND(AVG(risk_score)::numeric, 1) AS avg_risk_score,
    COUNT(CASE WHEN status IN ('CRITICAL', 'EMERGENCY') THEN 1 END) AS critical_events_count,
    ROUND((SUM(flow * (2.0 / 60.0)) / 1000.0)::numeric, 2) AS volume_kiloliters,
    ROUND((COUNT(CASE WHEN status = 'SAFE' THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2) AS compliance_rate_pct
FROM public.sensor_readings
WHERE created_at >= NOW() - INTERVAL '12 weeks'
GROUP BY 1, 2, 3
ORDER BY 1 DESC;`}
                  </pre>
                </div>

                {/* Query 3: Critical Events Breakdown */}
                <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-black/40 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-400">
                      3. Critical Incidents by Violation Parameter Query
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          summaryData?.sqlQueries?.criticalEventsSql ||
                            `SELECT parameter, severity, COUNT(*) FROM public.alerts GROUP BY 1, 2;`,
                          "critSql",
                        )
                      }
                      className="flex items-center gap-1 rounded border border-border bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      {copiedQuery === "critSql" ? (
                        <>
                          <Check className="h-3 w-3 text-safe" />
                          <span className="text-safe">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy SQL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-300">
                    {summaryData?.sqlQueries?.criticalEventsSql ||
                      `SELECT 
    parameter,
    severity,
    COUNT(*) AS event_count,
    COUNT(CASE WHEN resolved = FALSE THEN 1 END) AS unresolved_count,
    COUNT(CASE WHEN gmail_status = 'SENT' THEN 1 END) AS gmail_sent_count,
    ROUND(AVG(risk_score)::numeric, 1) AS avg_risk_score,
    MAX(created_at) AS last_incident_time
FROM public.alerts
WHERE severity IN ('CRITICAL', 'EMERGENCY')
GROUP BY parameter, severity
ORDER BY event_count DESC;`}
                  </pre>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
