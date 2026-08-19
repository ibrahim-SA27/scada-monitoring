import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Radio,
  Cpu,
  Wifi,
  Server,
  CheckCircle2,
  AlertCircle,
  FlaskConical,
  Droplet,
  CircleDot,
  Thermometer,
  Waves,
  Zap,
  Pipette,
  ShieldAlert,
  ShieldCheck,
  Power,
  RotateCcw,
  Sliders,
  Send,
} from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useSimulation } from "@/components/dashboard/simulation";
import { Gauge } from "@/components/dashboard/Gauge";
import { sensors } from "@/components/dashboard/mock-data";
import { fmt, levelOf, type SensorKey, type Level } from "@/lib/effluent";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Monitoring & Hardware SCADA — EFFLUENT DASHBOARD" },
      {
        name: "description",
        content:
          "Real-time high frequency industrial sensor telemetry, remote ESP32 telemetry packet feed, physical ADC probe diagnostics, and actuator overrides.",
      },
    ],
  }),
  component: LiveMonitoringPage,
});

function levelVar(level: Level) {
  return level === "CRITICAL"
    ? "var(--critical)"
    : level === "WARNING"
      ? "var(--warn)"
      : "var(--safe)";
}

function LiveMonitoringPage() {
  const {
    values,
    risk,
    status,
    valve,
    relay,
    discharge,
    mode,
    history,
    systemHealth,
    lastUpdateFormatted,
    lastSource,
    deviceRecord,
    isDeviceOffline,
    secondsSinceHeartbeat,
    controlOverride,
    simulatePreset,
    sendManualReading,
    sendHeartbeatPing,
    simulateDropConnection,
    simulateRestoreConnection,
    reset,
  } = useSimulation();

  const [testPayload, setTestPayload] = useState({
    ph: values.ph || 7.2,
    tds: values.tds || 430,
    turbidity: values.turbidity || 18,
    temperature: values.temperature || 28.5,
    flow: values.flow || 2.1,
  });

  const recentHistory = history.slice(-25).reverse();

  // Simulated hardware probe electrical conversions (ESP32 12-bit ADC / 3.3V)
  const hardwareProbes = [
    {
      name: "pH Sensor Kit 4502C",
      pin: "GPIO 34 (ADC1_CH6)",
      key: "ph" as SensorKey,
      val: values.ph,
      unit: "pH",
      voltage: (2.5 + (7.0 - values.ph) * 0.18).toFixed(2),
      spec: "Glass Electrode / ±0.1 pH Precision",
      calibrated: "Standard Buffer 4.01 / 6.86 / 9.18",
    },
    {
      name: "TDS Analog Meter V1.0",
      pin: "GPIO 35 (ADC1_CH7)",
      key: "tds" as SensorKey,
      val: values.tds,
      unit: "ppm",
      voltage: ((values.tds / 2000) * 3.3).toFixed(2),
      spec: "2-Pin Titanium Probe / 0-2000 ppm",
      calibrated: "Temp Coeff 2.0% / °C Active",
    },
    {
      name: "Turbidity Gravity Optical",
      pin: "GPIO 32 (ADC1_CH4)",
      key: "turbidity" as SensorKey,
      val: values.turbidity,
      unit: "NTU",
      voltage: Math.max(0.5, 4.1 - (values.turbidity / 200) * 3.0).toFixed(2),
      spec: "Infrared Optical Scatter / 0-3000 NTU",
      calibrated: "Zero Point Voltage: 4.15V",
    },
    {
      name: "DS18B20 Thermal Probe",
      pin: "GPIO 4 (OneWire Digital)",
      key: "temperature" as SensorKey,
      val: values.temperature,
      unit: "°C",
      voltage: "3.30",
      spec: "Stainless Steel Submersible / ±0.5°C",
      calibrated: "CRC Checksum Hardware Verified",
    },
    {
      name: "YF-S201 Flow Sensor",
      pin: "GPIO 27 (Interrupt Pulse)",
      key: "flow" as SensorKey,
      val: values.flow,
      unit: "L/min",
      voltage: "5.00",
      spec: "Hall-Effect Turbine / 1-30 L/min",
      calibrated: "Pulse Frequency: F = 7.5 * Q (L/min)",
    },
  ];

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Header */}
          <header className="flex flex-wrap items-center justify-between gap-4 px-1">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-primary/40 bg-primary/10">
                <Radio className="h-4 w-4 text-cyan animate-pulse" />
              </span>
              <div>
                <h1 className="panel-title text-base">LIVE SCADA MONITORING &amp; SENSOR RACK</h1>
                <p className="text-xs text-muted-foreground">
                  High-frequency industrial sensor telemetry, remote ESP32 hardware rack, and live
                  actuator overrides
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-display font-bold",
                  isDeviceOffline
                    ? "border-critical/60 bg-critical/15 text-critical animate-pulse"
                    : "border-safe/40 bg-safe/10 text-safe",
                )}
              >
                <Wifi className="h-3.5 w-3.5" />
                ESP32: {isDeviceOffline ? "OFFLINE (>30s)" : "ONLINE"} ({secondsSinceHeartbeat}s
                ago)
              </span>
              <span className="rounded-lg border border-border bg-secondary px-3 py-1.5 font-display text-muted-foreground">
                SOURCE: <span className="text-cyan">{lastSource}</span>
              </span>
            </div>
          </header>

          {/* System Telemetry Gauges Grid */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {sensors.map((s) => {
              const key = s.key as SensorKey;
              const val = values[key];
              const level = levelOf(key, val);
              const maxVal =
                key === "ph"
                  ? 14
                  : key === "tds"
                    ? 2000
                    : key === "turbidity"
                      ? 200
                      : key === "temperature"
                        ? 50
                        : 8;
              const pct = Math.min(100, Math.max(0, (val / maxVal) * 100));

              return (
                <div key={key} className="scada-panel flex flex-col items-center p-4 text-center">
                  <p className="label-caps">{s.label}</p>
                  <div className="my-3">
                    <Gauge value={pct} size={110} stroke={10} color={levelVar(level)}>
                      <span className="font-display text-2xl font-bold">{fmt(key, val)}</span>
                      <span className="text-[10px] text-muted-foreground">{s.unit}</span>
                    </Gauge>
                  </div>
                  <span
                    className={cn(
                      "rounded-md px-2.5 py-0.5 font-display text-xs font-bold tracking-wider",
                      level === "CRITICAL"
                        ? "bg-critical/20 text-critical border border-critical/40"
                        : level === "WARNING"
                          ? "bg-warn/20 text-warn border border-warn/40"
                          : "bg-safe/20 text-safe border border-safe/40",
                    )}
                  >
                    {level}
                  </span>
                </div>
              );
            })}
          </section>

          {/* Physical Hardware Sensor Ingestion Rack */}
          <section className="scada-panel flex flex-col p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="panel-title flex items-center gap-2 text-sm">
                <Cpu className="h-4 w-4 text-cyan" />
                Physical Sensor Probe Diagnostics &amp; ADC Conversion Bus
              </h2>
              <span className="font-display text-xs font-semibold text-safe flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-safe animate-pulse" />
                RTU Station Alpha-1 Hardware Stream Active
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {hardwareProbes.map((probe) => {
                const level = levelOf(probe.key, probe.val);
                return (
                  <div
                    key={probe.name}
                    className="rounded-xl border border-border/70 bg-card/60 p-3.5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="label-caps text-[10px] truncate max-w-[130px]">
                          {probe.name}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 font-mono text-[9px] font-bold",
                            level === "CRITICAL"
                              ? "bg-critical/20 text-critical"
                              : level === "WARNING"
                                ? "bg-warn/20 text-warn"
                                : "bg-safe/20 text-safe",
                          )}
                        >
                          {level}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-cyan">{probe.pin}</p>
                      <div className="mt-3 flex items-baseline justify-between">
                        <span className="text-2xl font-bold font-display text-foreground">
                          {fmt(probe.key, probe.val)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {probe.unit}
                          </span>
                        </span>
                        <span className="font-mono text-xs text-muted-foreground bg-secondary/80 px-2 py-0.5 rounded">
                          {probe.voltage} V
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 pt-2.5 border-t border-border/40 text-[10px] text-muted-foreground space-y-0.5">
                      <p className="truncate">{probe.spec}</p>
                      <p className="truncate text-cyan/80">{probe.calibrated}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Actuator Override & Scenario Injector Grid */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Actuator Manual Controls */}
            <section className="scada-panel flex flex-col p-5">
              <div className="flex items-center justify-between">
                <h2 className="panel-title flex items-center gap-2 text-sm">
                  <Pipette className="h-4 w-4 text-cyan" />
                  SCADA Actuator Controller &amp; Safety Relays
                </h2>
                <span className="font-mono text-xs text-muted-foreground">
                  MODE: <span className="font-bold text-cyan">{mode}</span>
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Discharge
                  </p>
                  <p
                    className={cn(
                      "font-display text-lg font-bold mt-1",
                      discharge === "ALLOWED" ? "text-safe" : "text-critical",
                    )}
                  >
                    {discharge}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Valve (GPIO 25)
                  </p>
                  <p
                    className={cn(
                      "font-display text-lg font-bold mt-1",
                      valve === "OPEN" ? "text-safe" : "text-critical",
                    )}
                  >
                    {valve}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Relay (GPIO 26)
                  </p>
                  <p
                    className={cn(
                      "font-display text-lg font-bold mt-1",
                      relay === "ACTIVE" ? "text-critical" : "text-muted-foreground",
                    )}
                  >
                    {relay}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Pollution Risk
                  </p>
                  <p
                    className={cn(
                      "font-display text-lg font-bold mt-1",
                      status === "CRITICAL"
                        ? "text-critical"
                        : status === "WARNING"
                          ? "text-warn"
                          : "text-safe",
                    )}
                  >
                    {risk}/100
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  onClick={() => controlOverride("VALVE_OPEN")}
                  className="rounded-lg border border-safe/50 bg-safe/10 py-2.5 font-display text-xs font-bold text-safe hover:bg-safe/20 transition-all"
                >
                  FORCE OPEN VALVE
                </button>
                <button
                  onClick={() => controlOverride("VALVE_CLOSE")}
                  className="rounded-lg border border-critical/50 bg-critical/10 py-2.5 font-display text-xs font-bold text-critical hover:bg-critical/20 transition-all"
                >
                  FORCE CLOSE VALVE
                </button>
                <button
                  onClick={() => controlOverride(mode === "AUTO" ? "MODE_MANUAL" : "MODE_AUTO")}
                  className="rounded-lg border border-primary/50 bg-primary/10 py-2.5 font-display text-xs font-bold text-cyan hover:bg-primary/20 transition-all"
                >
                  TOGGLE {mode === "AUTO" ? "MANUAL" : "AUTO"}
                </button>
                <button
                  onClick={() => controlOverride("EMERGENCY_SHUTDOWN")}
                  className="rounded-lg border border-critical bg-critical/20 py-2.5 font-display text-xs font-bold text-critical hover:bg-critical/30 transition-all shadow-[0_0_10px_rgba(255,59,48,0.2)]"
                >
                  KILL SWITCH (HALT)
                </button>
              </div>
            </section>

            {/* Instant Industrial Scenario Injector */}
            <section className="scada-panel flex flex-col p-5">
              <h2 className="panel-title flex items-center gap-2 text-sm">
                <Sliders className="h-4 w-4 text-cyan" />
                Hardware Test Bench &amp; Preset Scenarios
              </h2>

              <p className="text-xs text-muted-foreground mt-1">
                Inject standard industrial effluent scenarios into the backend ingestion pipeline to
                verify automatic safety latching and Gmail alerts.
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  onClick={() => simulatePreset("NORMAL")}
                  className="flex flex-col items-center justify-center rounded-xl border border-safe/40 bg-safe/10 p-3 text-center hover:bg-safe/20 transition-all"
                >
                  <ShieldCheck className="h-5 w-5 text-safe mb-1" />
                  <span className="font-display text-xs font-bold text-safe">NORMAL EFFLUENT</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Compliant / Safe</span>
                </button>

                <button
                  onClick={() => simulatePreset("CRITICAL")}
                  className="flex flex-col items-center justify-center rounded-xl border border-critical/40 bg-critical/10 p-3 text-center hover:bg-critical/20 transition-all"
                >
                  <AlertCircle className="h-5 w-5 text-critical mb-1" />
                  <span className="font-display text-xs font-bold text-critical">ACIDIC SURGE</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">pH 4.1 / Risk 92</span>
                </button>

                <button
                  onClick={() => simulatePreset("EMERGENCY")}
                  className="flex flex-col items-center justify-center rounded-xl border border-critical bg-critical/25 p-3 text-center hover:bg-critical/35 transition-all shadow-[0_0_12px_rgba(255,59,48,0.25)]"
                >
                  <ShieldAlert className="h-5 w-5 text-critical mb-1" />
                  <span className="font-display text-xs font-bold text-critical">
                    EMERGENCY LOCK
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">
                    Full Cutoff Engaged
                  </span>
                </button>
              </div>

              {/* Custom Value Ingestion Form */}
              <div className="mt-3 flex items-center gap-2 pt-2 border-t border-border/40">
                <button
                  onClick={() =>
                    sendManualReading({
                      ph: 7.25,
                      tds: 430,
                      turbidity: 18,
                      temperature: 28.5,
                      flow: 2.1,
                    })
                  }
                  className="flex-1 rounded-lg border border-primary/40 bg-primary/10 py-2 font-display text-xs font-bold text-cyan hover:bg-primary/20"
                >
                  TRANSMIT CALIBRATION PACKET TO /api/sensors/data
                </button>
                <button
                  onClick={reset}
                  className="rounded-lg border border-border bg-secondary px-3 py-2 text-muted-foreground hover:text-foreground"
                  title="Reset System"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            </section>
          </div>

          {/* Live Inbound ESP32 Telemetry Console */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Packet Log */}
            <section className="scada-panel flex flex-col p-5 xl:col-span-2">
              <h2 className="panel-title flex items-center gap-2 text-sm">
                <Cpu className="h-4 w-4 text-cyan" />
                Real-Time Inbound Data Feed ({recentHistory.length} latest packets)
              </h2>

              <div className="mt-4 max-h-[380px] overflow-auto rounded-xl border border-border/70 bg-card/60 font-mono text-xs">
                <div className="sticky top-0 grid grid-cols-7 border-b border-border/80 bg-secondary/80 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                  <span>TIME</span>
                  <span>SOURCE</span>
                  <span>pH</span>
                  <span>TDS</span>
                  <span>TURB</span>
                  <span>TEMP</span>
                  <span>STATUS</span>
                </div>
                <div className="divide-y divide-border/30">
                  {recentHistory.map((r) => (
                    <div
                      key={r.id}
                      className={cn(
                        "grid grid-cols-7 items-center px-3 py-2 transition-colors hover:bg-secondary/40",
                        r.status === "CRITICAL" && "bg-critical/10 text-critical",
                      )}
                    >
                      <span className="font-display font-medium text-cyan">{r.time}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {r.source || "ESP32"}
                      </span>
                      <span>{fmt("ph", r.ph)}</span>
                      <span>{fmt("tds", r.tds)}</span>
                      <span>{fmt("turbidity", r.turbidity)}</span>
                      <span>{fmt("temperature", r.temperature)}°C</span>
                      <span
                        className={cn(
                          "font-display font-bold text-[11px]",
                          r.status === "CRITICAL"
                            ? "text-critical"
                            : r.status === "WARNING"
                              ? "text-warn"
                              : "text-safe",
                        )}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Health & Diagnostic Nodes */}
            <section className="scada-panel flex flex-col p-5">
              <h2 className="panel-title flex items-center gap-2 text-sm">
                <Server className="h-4 w-4 text-cyan" />
                Connection Topology &amp; Hardware Link
              </h2>

              <div className="mt-4 space-y-3 text-sm">
                {/* ESP32 RTU Station Card */}
                <div
                  className={cn(
                    "rounded-xl border p-3 transition-all",
                    isDeviceOffline
                      ? "border-critical/60 bg-critical/10 shadow-[0_0_12px_rgba(255,59,48,0.2)]"
                      : "border-border/60 bg-secondary/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-cyan" />
                      ESP32 RTU Station
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 font-display font-bold text-xs px-2 py-0.5 rounded",
                        isDeviceOffline
                          ? "bg-critical/20 text-critical border border-critical/50 animate-pulse"
                          : "bg-safe/20 text-safe border border-safe/40",
                      )}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          isDeviceOffline ? "bg-critical animate-ping" : "bg-safe animate-pulse",
                        )}
                      />
                      {isDeviceOffline ? "OFFLINE (>30s)" : "ONLINE"}
                    </span>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs text-muted-foreground border-t border-border/40 pt-2 font-mono">
                    <div>
                      <span>Heartbeat: </span>
                      <strong className={isDeviceOffline ? "text-critical" : "text-cyan"}>
                        {secondsSinceHeartbeat}s ago
                      </strong>
                    </div>
                    <div>
                      <span>Timeout: </span>
                      <strong className="text-foreground">30s limit</strong>
                    </div>
                    <div>
                      <span>RSSI: </span>
                      <strong className="text-foreground">{deviceRecord.rssi} dBm</strong>
                    </div>
                    <div>
                      <span>Battery: </span>
                      <strong className="text-foreground">{deviceRecord.batteryVoltage} V</strong>
                    </div>
                    <div>
                      <span>IP: </span>
                      <strong className="text-foreground">{deviceRecord.ipAddress}</strong>
                    </div>
                    <div>
                      <span>Firmware: </span>
                      <strong className="text-foreground">{deviceRecord.firmwareVersion}</strong>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 pt-2 border-t border-border/40">
                    <button
                      onClick={sendHeartbeatPing}
                      className="flex-1 rounded-lg border border-primary/40 bg-primary/10 py-1 font-display text-[11px] font-bold text-cyan hover:bg-primary/20 transition-all"
                    >
                      PING HEARTBEAT
                    </button>
                    {isDeviceOffline ? (
                      <button
                        onClick={simulateRestoreConnection}
                        className="flex-1 rounded-lg border border-safe/50 bg-safe/15 py-1 font-display text-[11px] font-bold text-safe hover:bg-safe/25 transition-all"
                      >
                        RESTORE ONLINE
                      </button>
                    ) : (
                      <button
                        onClick={simulateDropConnection}
                        className="flex-1 rounded-lg border border-critical/40 bg-critical/10 py-1 font-display text-[11px] font-bold text-critical hover:bg-critical/20 transition-all"
                      >
                        SIMULATE DROP (&gt;30s)
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/40 p-3">
                  <span className="text-muted-foreground">ESP32 Ingestion API</span>
                  <span className="flex items-center gap-1.5 font-display font-bold text-safe">
                    <CheckCircle2 className="h-4 w-4" />
                    READY (200 OK)
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/40 p-3">
                  <span className="text-muted-foreground">Server-Sent Events (SSE)</span>
                  <span className="flex items-center gap-1.5 font-display font-bold text-safe">
                    <CheckCircle2 className="h-4 w-4" />
                    STREAMING
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/40 p-3">
                  <span className="text-muted-foreground">Database Storage</span>
                  <span className="flex items-center gap-1.5 font-display font-bold text-safe">
                    <CheckCircle2 className="h-4 w-4" />
                    CONNECTED
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/40 p-3">
                  <span className="text-muted-foreground">Gmail SMTP Dispatcher</span>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 font-display font-bold",
                      systemHealth.gmailConfigured ? "text-safe" : "text-cyan",
                    )}
                  >
                    {systemHealth.gmailConfigured ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" /> CONNECTED
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-4 w-4" /> READY (STANDBY)
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-primary/30 bg-primary/8 p-3 text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">Continuous SCADA Loop Active</p>
                <p className="mt-1">
                  Readings are evaluated in milliseconds against EPA &amp; industrial wastewater
                  standards with automatic emergency cut-off latching.
                </p>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
