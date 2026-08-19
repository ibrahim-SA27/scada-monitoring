import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, ShieldAlert, CheckCircle, Mail, AlertTriangle } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useSimulation } from "@/components/dashboard/simulation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "System Alerts — EFFLUENT DASHBOARD" },
      {
        name: "description",
        content:
          "Real-time pollution alert records, automatic safety incident logs, and Gmail SMTP alert transmission history.",
      },
    ],
  }),
  component: AlertsPage,
});

function AlertsPage() {
  const { alerts, resolveAlert, acknowledgeAlert } = useSimulation();
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "ACTIVE">("ALL");

  const filtered = alerts.filter((a) => {
    if (filter === "CRITICAL") return a.severity === "CRITICAL";
    if (filter === "ACTIVE") return !a.resolved;
    return true;
  });

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-4 px-1">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-critical/40 bg-critical/10">
                <Bell className="h-4 w-4 text-critical" />
              </span>
              <div>
                <h1 className="panel-title text-base">SAFETY INCIDENT &amp; POLLUTION ALERTS</h1>
                <p className="text-xs text-muted-foreground">
                  Database records of pollution threshold violations and automatic control actions
                </p>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-2">
              {(["ALL", "CRITICAL", "ACTIVE"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold tracking-wider transition-all",
                    filter === f
                      ? "border-primary/60 bg-primary/20 text-cyan shadow-[0_0_10px_rgba(0,229,255,0.2)]"
                      : "border-border bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f === "ALL" ? `ALL (${alerts.length})` : f}
                </button>
              ))}
            </div>
          </header>

          <section className="scada-panel flex flex-col p-5">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border/80 text-left">
                    <th className="label-caps px-3 py-2.5">Timestamp</th>
                    <th className="label-caps px-3 py-2.5">Parameter</th>
                    <th className="label-caps px-3 py-2.5">Value</th>
                    <th className="label-caps px-3 py-2.5">Risk Score</th>
                    <th className="label-caps px-3 py-2.5">Severity</th>
                    <th className="label-caps px-3 py-2.5">Message</th>
                    <th className="label-caps px-3 py-2.5">Gmail Status</th>
                    <th className="label-caps px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                        <CheckCircle className="mx-auto h-8 w-8 text-safe mb-2" />
                        No active safety alert events recorded in database.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((a) => (
                      <tr
                        key={a.id}
                        className={cn(
                          "transition-colors hover:bg-secondary/30",
                          !a.resolved && a.severity === "CRITICAL" && "bg-critical/5",
                        )}
                      >
                        <td className="whitespace-nowrap px-3 py-3 font-display font-medium text-cyan">
                          {a.time}
                        </td>
                        <td className="px-3 py-3 font-semibold text-foreground">{a.parameter}</td>
                        <td className="whitespace-nowrap px-3 py-3 font-mono">{a.value}</td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "font-display font-bold",
                              a.riskScore >= 80 ? "text-critical" : "text-warn",
                            )}
                          >
                            {a.riskScore}/100
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-display text-xs font-bold tracking-wider",
                              a.severity === "CRITICAL"
                                ? "bg-critical/20 text-critical border border-critical/40"
                                : "bg-warn/20 text-warn border border-warn/40",
                            )}
                          >
                            {a.severity === "CRITICAL" ? (
                              <ShieldAlert className="h-3 w-3" />
                            ) : (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            {a.severity}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground max-w-[260px] truncate">
                          {a.message}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 font-display text-xs font-bold",
                              a.gmailStatus === "SENT"
                                ? "text-safe"
                                : a.gmailStatus === "FAILED"
                                  ? "text-critical"
                                  : "text-muted-foreground",
                            )}
                          >
                            <Mail className="h-3.5 w-3.5" />
                            {a.gmailStatus === "SENT" ? "EMAIL SENT" : a.gmailStatus}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {a.resolved ? (
                            <span className="inline-flex items-center gap-1 text-xs text-safe font-medium">
                              <CheckCircle className="h-3.5 w-3.5" /> Resolved
                            </span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              {!a.message.includes("[ACKNOWLEDGED]") && (
                                <button
                                  onClick={() => acknowledgeAlert(a.id)}
                                  className="rounded-lg border border-border bg-secondary px-2.5 py-1 font-display text-xs font-semibold text-muted-foreground hover:text-foreground"
                                >
                                  Ack
                                </button>
                              )}
                              <button
                                onClick={() => resolveAlert(a.id)}
                                className="rounded-lg border border-primary/50 bg-primary/10 px-2.5 py-1 font-display text-xs font-bold text-cyan hover:bg-primary/20"
                              >
                                Resolve
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
