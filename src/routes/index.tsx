import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  ControlStripPanel,
  DischargePanel,
  RiskPanel,
  SensorCards,
  StatusPanel,
  TrendPanel,
} from "@/components/dashboard/panels";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EFFLUENT DASHBOARD — Industrial Effluent Monitoring & Safety Control" },
      {
        name: "description",
        content:
          "Real-time Industrial Effluent Pollution Monitoring and Automatic Discharge Safety Control System.",
      },
      { property: "og:title", content: "EFFLUENT DASHBOARD — Industrial Effluent Monitoring" },
      {
        property: "og:description",
        content:
          "Real-time industrial effluent sensor monitoring with pollution risk analysis, automatic discharge safety control, and Gmail alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Dashboard() {
  const now = useClock();
  const date = now
    ? now
        .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        .toUpperCase()
    : "--";
  const time = now
    ? now.toLocaleTimeString("en-US", {
        hour12: true,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--";

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-1">
            <p className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-safe shadow-[0_0_10px_var(--safe)]" />
              <span className="panel-title truncate text-sm text-safe">Live Data Stream</span>
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-4 text-sm">
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span
                  className="font-display font-semibold tracking-wider"
                  suppressHydrationWarning
                >
                  {date}
                </span>
              </span>
              <span className="hidden h-5 w-px bg-border sm:block" />
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span
                  className="font-display font-semibold tracking-wider text-cyan"
                  suppressHydrationWarning
                >
                  {time}
                </span>
              </span>
            </div>
          </header>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <StatusPanel />
            <ControlStripPanel />
          </div>

          <SensorCards />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-1 2xl:col-span-1">
              <TrendPanel />
            </div>
            <RiskPanel />
            <DischargePanel />
          </div>
        </main>
      </div>
    </div>
  );
}
