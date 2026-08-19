import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  ShieldCheck,
  ShieldAlert,
  Droplet,
  Zap,
  Mail,
  FlaskConical,
  Waves,
  Thermometer,
  CircleDot,
  BarChart3,
  ScanSearch,
  Cog,
  Check,
  AlertTriangle,
  Shield,
  Pipette,
  RotateCcw,
} from "lucide-react";
import { Gauge } from "./Gauge";
import { sensors } from "./mock-data";
import { useSimulation } from "./simulation";
import { fmt, levelOf, type Level, type SensorKey } from "@/lib/effluent";
import { cn } from "@/lib/utils";

const icons: Record<string, typeof Droplet> = {
  ph: FlaskConical,
  tds: Droplet,
  turbidity: CircleDot,
  temperature: Thermometer,
  flow: Waves,
};

function levelVar(level: Level) {
  return level === "CRITICAL"
    ? "var(--critical)"
    : level === "WARNING"
      ? "var(--warn)"
      : "var(--safe)";
}

function glow(level: Level) {
  return level === "CRITICAL"
    ? "text-glow-critical"
    : level === "WARNING"
      ? "text-glow-warn"
      : "text-glow-safe";
}

function levelText(level: Level) {
  return level === "CRITICAL" ? "text-critical" : level === "WARNING" ? "text-warn" : "text-safe";
}

export function StatusPanel() {
  const { risk, status } = useSimulation();
  const Icon = status === "SAFE" ? ShieldCheck : ShieldAlert;

  return (
    <section className="scada-panel grid grid-cols-1 items-center gap-4 px-6 py-5 sm:grid-cols-[1fr_auto]">
      <div className="flex min-w-0 flex-col items-center gap-4 sm:flex-row sm:gap-6">
        <Icon
          className={cn("h-16 w-16 shrink-0", levelText(status))}
          style={{
            filter: `drop-shadow(0 0 12px color-mix(in oklab, ${levelVar(status)} 55%, transparent))`,
          }}
        />
        <div className="min-w-0 text-center sm:text-left">
          <p className="panel-title text-sm">System Status</p>
          <p className={cn("font-display text-5xl leading-none font-bold", glow(status))}>
            {status}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {status === "SAFE"
              ? "All systems operational — Discharge allowed"
              : status === "WARNING"
                ? "Abnormal readings detected — Caution required"
                : "Critical pollution — Discharge automatically blocked"}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 border-t border-border/60 pt-4 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">
        <p className="panel-title text-sm">Risk Score</p>
        <Gauge value={risk} color={levelVar(status)}>
          <span className="font-display text-3xl font-bold text-foreground">
            {String(risk).padStart(2, "0")}
          </span>
          <span className="text-xs text-muted-foreground">/100</span>
        </Gauge>
      </div>
    </section>
  );
}

export function ControlStripPanel() {
  const { valve, relay, discharge, status, systemHealth } = useSimulation();
  const critical = status === "CRITICAL";

  const controlTiles = [
    {
      label: "Discharge",
      value: discharge === "ALLOWED" ? "NORMAL" : discharge,
      tone: critical ? "critical" : "safe",
      icon: Droplet,
      note: critical ? "Discharge Blocked" : "Flow Allowed",
    },
    {
      label: "Valve",
      value: valve,
      tone: critical ? "critical" : "safe",
      icon: Pipette,
      note: critical ? "Safety Shutdown" : "Normal Operation",
    },
    {
      label: "Relay",
      value: relay,
      tone: critical ? "critical" : "muted",
      icon: Zap,
      note: critical ? "Cutoff Engaged" : "No Action",
    },
    {
      label: "Gmail Alert",
      value:
        systemHealth.gmailService === "ALERT SENT" ? "ALERT SENT" : critical ? "SENT" : "READY",
      tone: critical ? "critical" : "safe",
      icon: Mail,
      note: critical ? "Critical Alert Raised" : "Monitoring Active",
    },
  ];

  return (
    <section className="scada-panel grid grid-cols-2 divide-border/60 px-2 py-5 sm:grid-cols-4 sm:divide-x">
      {controlTiles.map(({ label, value, tone, icon: Icon, note }) => (
        <div key={label} className="flex flex-col items-center gap-1.5 px-3 py-2 text-center">
          <p className="label-caps">{label}</p>
          <p
            className={cn(
              "font-display text-2xl font-bold",
              tone === "safe"
                ? "text-glow-safe"
                : tone === "critical"
                  ? "text-glow-critical"
                  : "text-foreground",
            )}
          >
            {value}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="h-4 w-4 shrink-0 text-cyan" />
            {note}
          </p>
        </div>
      ))}
    </section>
  );
}

export function SensorCards() {
  const { values, history, lastUpdateFormatted } = useSimulation();

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      {sensors.map((s) => {
        const key = s.key as SensorKey;
        const Icon = icons[key] ?? Droplet;
        const value = values[key];
        const level = levelOf(key, value);
        const data = history.slice(-30).map((r, i) => ({ t: i, v: r[key] }));
        return (
          <article key={key} className="scada-panel flex flex-col p-4">
            <header className="flex items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                style={{ background: `color-mix(in oklab, ${s.color} 22%, transparent)` }}
              >
                <Icon className="h-5 w-5" style={{ color: s.color }} />
              </span>
              <h3 className="min-w-0 truncate text-base font-semibold">{s.label}</h3>
            </header>

            <p className="mt-3 flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold tracking-tight">
                {fmt(key, value)}
              </span>
              <span className="text-sm text-muted-foreground">{s.unit}</span>
            </p>
            <p
              className={cn("mt-1 font-display text-sm font-semibold tracking-widest", glow(level))}
            >
              {level}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">{s.thresholds}</p>

            <div className="mt-3 h-14">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id={`g-${key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="linear"
                    dataKey="v"
                    stroke={s.color}
                    strokeWidth={1.4}
                    fill={`url(#g-${key})`}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <footer className="mt-2 flex items-center justify-between border-t border-border/50 pt-2">
              <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                Updated {lastUpdateFormatted || "live"}
              </span>
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: levelVar(level), boxShadow: `0 0 8px ${levelVar(level)}` }}
              />
            </footer>
          </article>
        );
      })}
    </section>
  );
}

const ranges = ["LIVE", "5 MIN", "15 MIN", "1 HOUR", "24 HOURS"];

const metrics: {
  label: string;
  key: SensorKey;
  domain: [number, number];
  ticks: number[];
  warn: number;
  crit: number;
  unit: string;
}[] = [
  {
    label: "TDS (ppm)",
    key: "tds",
    domain: [0, 2000],
    ticks: [0, 500, 1000, 1500, 2000],
    warn: 800,
    crit: 1500,
    unit: "ppm",
  },
  {
    label: "pH",
    key: "ph",
    domain: [0, 14],
    ticks: [0, 4, 7, 10, 14],
    warn: 8.5,
    crit: 9.5,
    unit: "",
  },
  {
    label: "Turbidity (NTU)",
    key: "turbidity",
    domain: [0, 200],
    ticks: [0, 50, 100, 150, 200],
    warn: 50,
    crit: 100,
    unit: "NTU",
  },
  {
    label: "Temperature (°C)",
    key: "temperature",
    domain: [0, 50],
    ticks: [0, 10, 20, 30, 40, 50],
    warn: 35,
    crit: 40,
    unit: "°C",
  },
  {
    label: "Flow (L/min)",
    key: "flow",
    domain: [0, 8],
    ticks: [0, 2, 4, 6, 8],
    warn: 3,
    crit: 5,
    unit: "L/min",
  },
];

const rangePoints: Record<string, number> = {
  LIVE: 30,
  "5 MIN": 60,
  "15 MIN": 120,
  "1 HOUR": 240,
  "24 HOURS": 400,
};

export function TrendPanel() {
  const [range, setRange] = useState("5 MIN");
  const [metric, setMetric] = useState("TDS (ppm)");
  const { history, values } = useSimulation();

  const m = metrics.find((x) => x.label === metric) ?? metrics[0]!;
  const sliceCount = rangePoints[range] ?? 60;
  const data = history.slice(-sliceCount).map((r) => ({ time: r.time, value: r[m.key] }));
  const color = sensors.find((s) => s.key === m.key)?.color ?? "var(--tds)";
  const currentValue = values[m.key];

  return (
    <section className="scada-panel flex flex-col p-5">
      <div className="flex items-center justify-between">
        <h2 className="panel-title flex items-center gap-2 text-sm">
          <BarChart3 className="h-4 w-4 text-cyan" />
          REAL-TIME SENSOR TREND
        </h2>
        <span className="font-display text-xs text-muted-foreground">
          Current:{" "}
          <strong className="text-cyan">
            {fmt(m.key, currentValue)} {m.unit}
          </strong>
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-primary"
        >
          {metrics.map((x) => (
            <option key={x.label} value={x.label}>
              {x.label}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-semibold tracking-wider transition-colors",
                range === r
                  ? "border-primary/60 bg-primary/20 text-cyan shadow-[0_0_12px_rgba(0,229,255,0.25)]"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 56, left: 0, bottom: 0 }}>
            <CartesianGrid
              stroke="color-mix(in oklab, var(--border) 55%, transparent)"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              interval={Math.max(0, Math.floor(data.length / 5))}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              stroke="var(--border)"
            />
            <YAxis
              domain={m.domain}
              ticks={m.ticks}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              stroke="var(--border)"
            />
            <ReferenceLine
              y={m.crit}
              stroke="var(--critical)"
              strokeDasharray="6 5"
              label={{
                value: `CRITICAL (${m.crit} ${m.unit})`.trim(),
                position: "insideTopRight",
                fill: "var(--critical)",
                fontSize: 10,
              }}
            />
            <ReferenceLine
              y={m.warn}
              stroke="var(--warn)"
              strokeDasharray="6 5"
              label={{
                value: `WARNING (${m.warn} ${m.unit})`.trim(),
                position: "insideTopRight",
                fill: "var(--warn)",
                fontSize: 10,
              }}
            />
            <Line
              type="linear"
              dataKey="value"
              stroke={color}
              strokeWidth={1.8}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function RiskPanel() {
  const { risk, status, values } = useSimulation();

  return (
    <section className="scada-panel flex flex-col p-5">
      <h2 className="panel-title flex items-center gap-2 text-sm">
        <ScanSearch className="h-4 w-4 text-cyan" />
        POLLUTION RISK ANALYSIS
      </h2>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-6">
        <div className="flex flex-col items-center">
          <Gauge value={risk} size={132} stroke={12} color={levelVar(status)}>
            <span className="font-display text-4xl font-bold">{String(risk).padStart(2, "0")}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </Gauge>
          <p className={cn("mt-2 font-display text-2xl font-bold", glow(status))}>{status}</p>
        </div>
        <ul className="flex min-w-[160px] flex-1 flex-col gap-3">
          {sensors.map((s) => {
            const level = levelOf(s.key as SensorKey, values[s.key as SensorKey]);
            return (
              <li key={s.key} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: levelVar(level), boxShadow: `0 0 8px ${levelVar(level)}` }}
                />
                <span className="min-w-0 flex-1 truncate text-foreground">{s.label}</span>
                <span className={cn("text-[11px] font-semibold tracking-widest", levelText(level))}>
                  {level === "SAFE" ? "NORMAL" : level}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-6 border-t border-border/60 pt-4">
        <p className="label-caps">Detection</p>
        <p className="mt-2 flex items-center gap-2 text-sm text-foreground">
          {status === "SAFE" ? (
            <>
              <Check className="h-4 w-4 text-safe" />✓ No abnormal condition detected.
            </>
          ) : (
            <>
              <AlertTriangle className={cn("h-4 w-4", levelText(status))} />⚠ Critical pollution
              condition detected.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

export function DischargePanel() {
  const { valve, relay, discharge, status, simulateCritical, reset } = useSimulation();
  const critical = status === "CRITICAL";

  return (
    <section className="scada-panel flex flex-col p-5">
      <h2 className="panel-title flex items-center gap-2 text-sm">
        <Cog className="h-4 w-4 text-cyan" />
        AUTOMATIC DISCHARGE CONTROL
      </h2>

      <p className="mt-4 text-sm text-muted-foreground">
        Current Mode:{" "}
        <span className="ml-2 font-display font-bold tracking-wider text-cyan">AUTO</span>
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl p-4 transition-all",
            critical
              ? "border border-critical/50 bg-critical/10 shadow-[0_0_15px_rgba(255,59,48,0.15)]"
              : "border border-safe/40 bg-safe/8",
          )}
        >
          <Pipette className={cn("h-7 w-7 shrink-0", critical ? "text-critical" : "text-safe")} />
          <div className="min-w-0">
            <p className="truncate text-sm text-muted-foreground">Valve Status</p>
            <p
              className={cn(
                "font-display text-xl font-bold",
                critical ? "text-glow-critical" : "text-glow-safe",
              )}
            >
              {valve}
            </p>
          </div>
        </div>
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl p-4 transition-all",
            critical
              ? "border border-critical/50 bg-critical/10 shadow-[0_0_15px_rgba(255,59,48,0.15)]"
              : "border border-border bg-secondary/60",
          )}
        >
          <Zap
            className={cn("h-7 w-7 shrink-0", critical ? "text-critical" : "text-muted-foreground")}
          />
          <div className="min-w-0">
            <p className="truncate text-sm text-muted-foreground">Relay Status</p>
            <p
              className={cn(
                "font-display text-xl font-bold",
                critical ? "text-glow-critical" : "text-foreground",
              )}
            >
              {relay}
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "mt-4 flex items-center gap-3 rounded-xl p-4 transition-all",
          critical
            ? "border border-critical/50 bg-critical/10 shadow-[0_0_15px_rgba(255,59,48,0.15)]"
            : "border border-primary/35 bg-primary/8",
        )}
      >
        <Droplet className={cn("h-7 w-7 shrink-0", critical ? "text-critical" : "text-cyan")} />
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">Discharge Status</p>
          <p
            className={cn(
              "font-display text-xl font-bold",
              critical ? "text-glow-critical" : "text-glow-safe",
            )}
          >
            {discharge}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={simulateCritical}
          className="flex items-center justify-center gap-2 rounded-xl border border-critical/60 bg-critical/15 px-4 py-3 font-display text-xs font-bold tracking-widest text-critical transition-all hover:bg-critical/25 active:scale-95 shadow-[0_0_15px_rgba(255,59,48,0.2)]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          SIMULATE CRITICAL POLLUTION
        </button>
        <button
          onClick={reset}
          className="flex items-center justify-center gap-2 rounded-xl border border-primary/60 bg-primary/15 px-4 py-3 font-display text-xs font-bold tracking-widest text-cyan transition-all hover:bg-primary/25 active:scale-95 shadow-[0_0_15px_rgba(0,229,255,0.2)]"
        >
          <RotateCcw className="h-4 w-4 shrink-0" />
          RESET TO NORMAL
        </button>
      </div>

      <div className="mt-5 flex items-start gap-3 border-t border-border/60 pt-4">
        <Shield
          className={cn("mt-0.5 h-5 w-5 shrink-0", critical ? "text-critical" : "text-safe")}
        />
        <div>
          <p
            className={cn("text-sm font-semibold", critical ? "text-critical" : "text-foreground")}
          >
            {critical
              ? "Discharge automatically blocked due to critical pollution."
              : "Automatic safety control is active."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {critical
              ? "Emergency shutdown engaged. Safety relay activated to prevent industrial outfall contamination."
              : "System continuously validates effluent telemetry against EPA & industrial safety standards."}
          </p>
        </div>
      </div>
    </section>
  );
}
