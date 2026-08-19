import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Activity,
  Bell,
  Clock,
  BarChart3,
  Settings,
  Droplet,
  ShieldCheck,
  ShieldAlert,
  Radio,
  WifiOff,
  Wifi,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import industrial from "@/assets/industrial-outfall.jpg";
import { useSimulation } from "./simulation";
import { cn } from "@/lib/utils";

const items = [
  { label: "Overview", icon: Home, to: "/" },
  { label: "Live Monitoring", icon: Activity, to: "/live" },
  { label: "Alerts", icon: Bell, to: "/alerts", hasBadge: true },
  { label: "History", icon: Clock, to: "/history" },
  { label: "Analytics", icon: BarChart3, to: "/analytics" },
  { label: "Settings", icon: Settings, to: "/settings" },
];

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const {
    status,
    alerts,
    systemHealth,
    deviceRecord,
    deviceStatus,
    secondsSinceHeartbeat,
    isDeviceOffline,
    sendHeartbeatPing,
    simulateDropConnection,
    simulateRestoreConnection,
  } = useSimulation();
  const critical = status === "CRITICAL";
  const unreadAlerts = alerts.filter((a) => !a.resolved).length;

  return (
    <aside className="scada-panel relative flex w-full shrink-0 flex-col overflow-hidden bg-sidebar p-4 lg:h-[calc(100vh-2rem)] lg:w-[264px]">
      {/* Brand Header */}
      <Link
        to="/"
        className="flex items-center gap-3 px-1 pb-5 pt-1 transition-opacity hover:opacity-90"
      >
        <div
          className={cn(
            "grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition-all",
            critical
              ? "border-critical/60 bg-critical/15 text-critical shadow-[0_0_12px_rgba(255,59,48,0.3)]"
              : "border-primary/40 bg-primary/10 text-cyan shadow-[0_0_12px_rgba(0,229,255,0.2)]",
          )}
        >
          <Droplet className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-xl leading-none font-bold tracking-wide">
            <span className="text-foreground">EFFLUENT</span>
            <span className="text-cyan"> DASHBOARD</span>
          </h1>
          <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
            Industrial Effluent Monitoring &amp; Safety Control
          </p>
        </div>
      </Link>

      {/* Navigation */}
      <nav className="flex flex-col gap-1.5">
        {items.map(({ label, icon: Icon, to, hasBadge }) => {
          const isActive = pathname === to;

          return (
            <Link
              key={label}
              to={to}
              className={cn(
                "flex items-center justify-between rounded-xl px-3 py-3 text-left text-[15px] transition-all",
                isActive
                  ? "border border-primary/45 bg-primary/12 text-cyan shadow-[0_0_18px_-8px_color-mix(in_oklab,var(--cyan)_60%,transparent)]"
                  : "border border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Icon className={cn("h-5 w-5 shrink-0", isActive && "text-cyan")} />
                <span className="truncate font-medium">{label}</span>
              </div>
              {hasBadge && unreadAlerts > 0 && (
                <span
                  className={cn(
                    "ml-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-display text-[11px] font-bold tracking-wider",
                    critical
                      ? "bg-critical text-destructive-foreground shadow-[0_0_8px_var(--critical)]"
                      : "bg-warn text-background",
                  )}
                >
                  {unreadAlerts}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ESP32 Heartbeat & Hardware Watchdog Status Panel */}
      <div
        className={cn(
          "mt-4 rounded-xl border p-3 text-xs transition-all",
          isDeviceOffline
            ? "border-critical/60 bg-critical/10 shadow-[0_0_16px_rgba(255,59,48,0.25)]"
            : "border-border/60 bg-secondary/30",
        )}
      >
        <div className="flex items-center justify-between">
          <span className="label-caps text-[10px] flex items-center gap-1.5">
            <Radio className="h-3 w-3 text-cyan" />
            ESP32 RTU Link
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 font-display font-bold text-[11px] tracking-wider px-2 py-0.5 rounded",
              isDeviceOffline
                ? "bg-critical/25 text-critical border border-critical/50 animate-pulse"
                : "bg-safe/20 text-safe border border-safe/40",
            )}
          >
            {isDeviceOffline ? (
              <>
                <WifiOff className="h-3 w-3 shrink-0" />
                OFFLINE
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-safe animate-pulse shrink-0" />
                ONLINE
              </>
            )}
          </span>
        </div>

        {/* Heartbeat elapsed timer */}
        <div className="mt-2.5 flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Heartbeat:</span>
          <span
            className={cn(
              "font-mono font-bold",
              isDeviceOffline
                ? "text-critical"
                : secondsSinceHeartbeat > 15
                  ? "text-warn"
                  : "text-cyan",
            )}
          >
            {secondsSinceHeartbeat}s ago{" "}
            <span className="text-[9px] font-normal text-muted-foreground">(&gt;30s limit)</span>
          </span>
        </div>

        {/* Device ID info */}
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Station ID:</span>
          <span className="font-mono text-foreground">{deviceRecord.deviceId}</span>
        </div>

        {isDeviceOffline && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-critical/40 bg-critical/15 p-1.5 text-[10px] text-critical">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="leading-tight">Watchdog alert: No packet received for over 30 seconds.</p>
          </div>
        )}

        {/* Heartbeat quick testing actions */}
        <div className="mt-3 flex items-center gap-1.5 border-t border-border/40 pt-2">
          {isDeviceOffline ? (
            <button
              onClick={simulateRestoreConnection}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-safe/50 bg-safe/15 py-1.5 text-[10px] font-bold text-safe hover:bg-safe/25 transition-all"
              title="Resume ESP32 Heartbeat and restore ONLINE status"
            >
              <RefreshCw className="h-3 w-3" />
              RESTORE ONLINE
            </button>
          ) : (
            <>
              <button
                onClick={sendHeartbeatPing}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-primary/40 bg-primary/10 py-1 text-[10px] font-bold text-cyan hover:bg-primary/20 transition-all"
                title="Send instant Heartbeat packet"
              >
                <Wifi className="h-2.5 w-2.5" />
                PING
              </button>
              <button
                onClick={simulateDropConnection}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-critical/40 bg-critical/10 py-1 text-[10px] font-bold text-critical hover:bg-critical/20 transition-all"
                title="Simulate connection loss (>30s timeout)"
              >
                <WifiOff className="h-2.5 w-2.5" />
                DROP
              </button>
            </>
          )}
        </div>
      </div>

      {/* Safety & System Status */}
      <div className="mt-3 rounded-xl border border-border/60 bg-secondary/30 p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="label-caps text-[10px]">Safety State</span>
          <span
            className={cn(
              "flex items-center gap-1 font-display font-semibold",
              critical ? "text-critical" : "text-safe",
            )}
          >
            {critical ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
            {status}
          </span>
        </div>
      </div>

      {/* Industrial Visual */}
      <div className="relative mt-3 flex-1 overflow-hidden rounded-xl">
        <img
          src={industrial}
          alt="Industrial effluent discharge outfall at night"
          loading="lazy"
          width={672}
          height={992}
          className="h-full min-h-[140px] w-full object-cover opacity-85 brightness-95"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-sidebar/60 via-transparent to-sidebar/90" />
        <div className="absolute bottom-2.5 left-2.5 right-2.5 rounded-lg border border-border/50 bg-sidebar/80 p-2 backdrop-blur-sm">
          <p className="font-display text-[10px] font-bold tracking-wider text-cyan uppercase">
            Outfall Station Alpha-1
          </p>
          <p className="text-[10px] text-muted-foreground">SCADA Remote Telemetry Unit (RTU)</p>
        </div>
      </div>
    </aside>
  );
}
