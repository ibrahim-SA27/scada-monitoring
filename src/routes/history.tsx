import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Clock, Download, Search, RefreshCw, Filter } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useSimulation } from "@/components/dashboard/simulation";
import { fmt, type SensorKey } from "@/lib/effluent";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Sensor History — EFFLUENT DASHBOARD" },
      {
        name: "description",
        content:
          "Complete timestamped log of industrial effluent sensor readings with pH, TDS, turbidity, temperature, flow, risk score, and safety statuses.",
      },
    ],
  }),
  component: HistoryPage,
});

function statusClass(status: string) {
  return status === "CRITICAL" ? "text-critical" : status === "WARNING" ? "text-warn" : "text-safe";
}

function HistoryPage() {
  const { history, refreshHistory } = useSimulation();
  const [filter, setFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const rows = [...history].reverse().filter((r) => {
    if (filter !== "ALL" && r.status !== filter) return false;
    if (search && !r.time.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const exportCSV = () => {
    const header =
      "Timestamp,pH,TDS (ppm),Turbidity (NTU),Temperature (°C),Flow (L/min),Risk Score,Status\n";
    const body = rows
      .map(
        (r) =>
          `"${r.time}",${fmt("ph", r.ph)},${fmt("tds", r.tds)},${fmt("turbidity", r.turbidity)},${fmt(
            "temperature",
            r.temperature,
          )},${fmt("flow", r.flow)},${r.risk},"${r.status}"`,
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `effluent-sensor-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshHistory();
    setRefreshing(false);
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-4 px-1">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-primary/40 bg-primary/10">
                <Clock className="h-4 w-4 text-cyan" />
              </span>
              <div>
                <h1 className="panel-title text-base">TELEMETRY READING HISTORY</h1>
                <p className="text-xs text-muted-foreground">
                  Timestamped records stored in backend database ({rows.length} records displayed)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter timestamp..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="rounded-lg border border-border bg-secondary py-1.5 pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary"
                />
              </div>

              <div className="flex items-center gap-1">
                {(["ALL", "SAFE", "WARNING", "CRITICAL"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5 text-xs font-semibold tracking-wider transition-all",
                      filter === f
                        ? "border-primary/60 bg-primary/20 text-cyan"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>

              <button
                onClick={handleRefresh}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                Refresh
              </button>

              <button
                onClick={exportCSV}
                className="flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/15 px-3 py-1.5 font-display text-xs font-bold text-cyan hover:bg-primary/25 shadow-[0_0_10px_rgba(0,229,255,0.2)]"
              >
                <Download className="h-3.5 w-3.5" />
                EXPORT CSV
              </button>
            </div>
          </header>

          <section className="scada-panel flex flex-col p-5">
            <div className="max-h-[calc(100vh-14rem)] overflow-auto rounded-xl border border-border/70 bg-card/60">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 bg-secondary/90 backdrop-blur-md">
                  <tr className="text-left border-b border-border/80">
                    {[
                      "Timestamp",
                      "pH",
                      "TDS (ppm)",
                      "Turbidity (NTU)",
                      "Temperature (°C)",
                      "Flow (L/min)",
                      "Risk Score",
                      "Status",
                    ].map((h) => (
                      <th key={h} className="label-caps px-3 py-2.5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 font-mono text-xs">
                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-8 text-center text-muted-foreground font-sans"
                      >
                        No telemetry records matching filter.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "transition-colors hover:bg-secondary/40",
                        r.status === "CRITICAL" && "bg-critical/8",
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-display font-medium text-cyan">
                        {r.time}
                      </td>
                      <td className="px-3 py-2.5 text-foreground">{fmt("ph", r.ph)}</td>
                      <td className="px-3 py-2.5 text-foreground">{fmt("tds", r.tds)}</td>
                      <td className="px-3 py-2.5 text-foreground">
                        {fmt("turbidity", r.turbidity)}
                      </td>
                      <td className="px-3 py-2.5 text-foreground">
                        {fmt("temperature", r.temperature)}
                      </td>
                      <td className="px-3 py-2.5 text-foreground">{fmt("flow", r.flow)}</td>
                      <td className="px-3 py-2.5 font-display font-bold text-foreground">
                        {r.risk}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2.5 font-display font-bold tracking-widest text-[11px]",
                          statusClass(r.status),
                        )}
                      >
                        {r.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
