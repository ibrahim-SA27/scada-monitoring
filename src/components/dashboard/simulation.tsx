import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CRITICAL_PRESET,
  NORMAL,
  type Level,
  type Reading,
  type SensorKey,
  riskScore,
  overallStatus,
} from "@/lib/effluent";

export interface AlertItem {
  id: string;
  t: number;
  timestamp: string;
  time: string;
  parameter: string;
  value: string;
  riskScore: number;
  severity: Level;
  message: string;
  gmailStatus: "SENT" | "FAILED" | "READY" | "NOT_CONFIGURED";
  gmailDetails?: string;
  resolved: boolean;
}

export interface SystemHealth {
  apiServer: "CONNECTED" | "OFFLINE";
  database: "CONNECTED" | "OFFLINE";
  liveStream: "RECEIVING" | "OFFLINE" | "ONLINE";
  deviceStatus: "ONLINE" | "OFFLINE" | "STANDBY";
  gmailService: "READY" | "CONNECTED" | "ALERT SENT" | "NOT_CONFIGURED";
  gmailConfigured: boolean;
  activeClients?: number;
  secondsSinceHeartbeat?: number;
}

export interface DeviceStatusRecord {
  deviceId: string;
  status: "ONLINE" | "OFFLINE" | "STANDBY";
  lastHeartbeat: number;
  lastHeartbeatFormatted: string;
  secondsSinceHeartbeat: number;
  heartbeatIntervalSec: number;
  timeoutThresholdSec: number;
  ipAddress: string;
  firmwareVersion: string;
  rssi: number;
  batteryVoltage: number;
  uptimeSeconds: number;
  updatedAt: string;
}

export interface Stats {
  totalAlerts: number;
  criticalEvents: number;
  blockedEvents: number;
  gmailSentCount: number;
}

export type Ctx = {
  values: Record<SensorKey, number>;
  risk: number;
  status: Level;
  valve: "OPEN" | "CLOSED";
  relay: "ACTIVE" | "INACTIVE";
  discharge: "ALLOWED" | "BLOCKED";
  mode: "AUTO" | "MANUAL";
  history: Reading[];
  alerts: AlertItem[];
  stats: Stats;
  systemHealth: SystemHealth;
  deviceRecord: DeviceStatusRecord;
  deviceStatus: "ONLINE" | "OFFLINE" | "STANDBY";
  secondsSinceHeartbeat: number;
  isDeviceOffline: boolean;
  simulationActive: boolean;
  lastUpdate: number;
  lastUpdateFormatted: string;
  lastSource: "ESP32" | "SIMULATION" | "MANUAL_TEST";
  simulateCritical: () => Promise<void>;
  simulateEmergency: () => Promise<void>;
  simulatePreset: (preset: "NORMAL" | "CRITICAL" | "EMERGENCY") => Promise<void>;
  controlOverride: (
    action: "VALVE_CLOSE" | "VALVE_OPEN" | "MODE_AUTO" | "MODE_MANUAL" | "EMERGENCY_SHUTDOWN",
  ) => Promise<void>;
  reset: () => Promise<void>;
  toggleSimulation: (active: boolean) => Promise<void>;
  sendTestEmail: () => Promise<{ sent: boolean; configured: boolean; details: string }>;
  acknowledgeAlert: (id: string) => Promise<void>;
  resolveAlert: (id: string) => Promise<void>;
  sendManualReading: (payload: Record<SensorKey, number>) => Promise<void>;
  sendHeartbeatPing: () => Promise<void>;
  simulateDropConnection: () => Promise<void>;
  simulateRestoreConnection: () => Promise<void>;
  refreshHistory: () => Promise<void>;
};

const SimulationContext = createContext<Ctx | null>(null);

function timeLabel(d: Date) {
  return d.toLocaleTimeString("en-US", {
    hour12: true,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const [values, setValues] = useState<Record<SensorKey, number>>({ ...NORMAL });
  const [risk, setRisk] = useState<number>(8);
  const [status, setStatus] = useState<Level>("SAFE");
  const [valve, setValve] = useState<"OPEN" | "CLOSED">("OPEN");
  const [relay, setRelay] = useState<"ACTIVE" | "INACTIVE">("INACTIVE");
  const [discharge, setDischarge] = useState<"ALLOWED" | "BLOCKED">("ALLOWED");
  const [history, setHistory] = useState<Reading[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [simulationActive, setSimulationActive] = useState<boolean>(true);
  const [lastSource, setLastSource] = useState<"ESP32" | "SIMULATION" | "MANUAL_TEST">(
    "SIMULATION",
  );
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [lastUpdateFormatted, setLastUpdateFormatted] = useState<string>("");
  const [deviceRecord, setDeviceRecord] = useState<DeviceStatusRecord>({
    deviceId: "ESP32-STATION-01",
    status: "ONLINE",
    lastHeartbeat: Date.now(),
    lastHeartbeatFormatted: new Date().toLocaleTimeString("en-US", { hour12: true }),
    secondsSinceHeartbeat: 0,
    heartbeatIntervalSec: 2,
    timeoutThresholdSec: 30,
    ipAddress: "192.168.1.105",
    firmwareVersion: "v2.4.1",
    rssi: -58,
    batteryVoltage: 3.3,
    uptimeSeconds: 120,
    updatedAt: new Date().toISOString(),
  });

  const isDeviceOffline =
    deviceRecord.status === "OFFLINE" || deviceRecord.secondsSinceHeartbeat > 30;

  const [stats, setStats] = useState<Stats>({
    totalAlerts: 0,
    criticalEvents: 0,
    blockedEvents: 0,
    gmailSentCount: 0,
  });
  const [systemHealth, setSystemHealth] = useState<SystemHealth>({
    apiServer: "CONNECTED",
    database: "CONNECTED",
    liveStream: "RECEIVING",
    deviceStatus: "ONLINE",
    gmailService: "READY",
    gmailConfigured: false,
    secondsSinceHeartbeat: 0,
  });

  const lastStatusRef = useRef<Level>("SAFE");
  const lastOfflineRef = useRef<boolean>(false);

  const [mode, setMode] = useState<"AUTO" | "MANUAL">("AUTO");

  // Real-time 1-second interval ticker for heartbeat countdown & offline watchdog
  useEffect(() => {
    const ticker = setInterval(() => {
      setDeviceRecord((prev) => {
        const now = Date.now();
        const diffMs = now - prev.lastHeartbeat;
        const seconds = Math.max(0, Math.floor(diffMs / 1000));
        const shouldBeOffline = seconds > 30;
        const newStatus = shouldBeOffline ? "OFFLINE" : "ONLINE";

        if (shouldBeOffline && !lastOfflineRef.current) {
          lastOfflineRef.current = true;
          toast.warning("⚠️ ESP32 Telemetry Lost (>30s)", {
            description: `No data received for ${seconds}s from ${prev.deviceId}. Flagged as OFFLINE.`,
            duration: 7000,
          });
        } else if (!shouldBeOffline && lastOfflineRef.current) {
          lastOfflineRef.current = false;
        }

        setSystemHealth((h) => ({
          ...h,
          deviceStatus: newStatus,
          secondsSinceHeartbeat: seconds,
        }));

        return {
          ...prev,
          secondsSinceHeartbeat: seconds,
          status: newStatus,
        };
      });
    }, 1000);

    return () => clearInterval(ticker);
  }, []);

  // Fetch Initial Data
  const fetchInitial = useCallback(async () => {
    try {
      const [currRes, histRes, altRes, statsRes, healthRes, devRes] = await Promise.allSettled([
        fetch("/api/sensors/current").then((r) => r.json()),
        fetch("/api/sensors/history?limit=120").then((r) => r.json()),
        fetch("/api/alerts?limit=20").then((r) => r.json()),
        fetch("/api/analytics").then((r) => r.json()),
        fetch("/api/system/status").then((r) => r.json()),
        fetch("/api/devices/status").then((r) => r.json()),
      ]);

      if (currRes.status === "fulfilled" && currRes.value?.state) {
        const s = currRes.value.state;
        setValues(s.values || { ...NORMAL });
        setRisk(s.risk ?? riskScore(s.values || NORMAL));
        setStatus(s.status ?? overallStatus(s.values || NORMAL));
        setValve(s.valve ?? (s.status === "CRITICAL" ? "CLOSED" : "OPEN"));
        setRelay(s.relay ?? (s.status === "CRITICAL" ? "ACTIVE" : "INACTIVE"));
        setDischarge(s.discharge ?? (s.status === "CRITICAL" ? "BLOCKED" : "ALLOWED"));
        setMode(s.mode || "AUTO");
        setSimulationActive(Boolean(s.simulationActive));
        setLastSource(s.lastSource || "SIMULATION");
        lastStatusRef.current = s.status;
      }

      if (devRes.status === "fulfilled" && devRes.value?.deviceStatus) {
        setDeviceRecord(devRes.value.deviceStatus);
      }

      if (histRes.status === "fulfilled" && Array.isArray(histRes.value?.readings)) {
        setHistory(histRes.value.readings.reverse());
      }

      if (altRes.status === "fulfilled" && Array.isArray(altRes.value?.alerts)) {
        setAlerts(altRes.value.alerts);
      }

      if (statsRes.status === "fulfilled" && statsRes.value?.stats) {
        setStats(statsRes.value.stats);
      }

      if (healthRes.status === "fulfilled" && healthRes.value) {
        const h = healthRes.value;
        setSystemHealth({
          apiServer: h.apiServer || "CONNECTED",
          database: h.database || "CONNECTED",
          liveStream: "RECEIVING",
          deviceStatus: h.deviceStatus || "ONLINE",
          gmailService: h.gmailConfigured ? "CONNECTED" : "READY",
          gmailConfigured: Boolean(h.gmailConfigured),
          activeClients: h.activeClients,
        });
      }
    } catch (err) {
      console.warn("Error loading initial data from backend:", err);
    }
  }, []);

  // Connect to SSE Stream
  useEffect(() => {
    fetchInitial();

    if (typeof window === "undefined") return;

    let eventSource: EventSource | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connectSSE = () => {
      try {
        eventSource = new EventSource("/api/stream");

        eventSource.onopen = () => {
          setSystemHealth((h) => ({
            ...h,
            apiServer: "CONNECTED",
            liveStream: "RECEIVING",
          }));
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === "SNAPSHOT") {
              if (data.state) {
                const s = data.state;
                setValues(s.values);
                setRisk(s.risk);
                setStatus(s.status);
                setValve(s.valve);
                setRelay(s.relay);
                setDischarge(s.discharge);
                setSimulationActive(s.simulationActive);
                setLastSource(s.lastSource);
                setLastUpdate(s.lastUpdate || Date.now());
                setLastUpdateFormatted(s.lastUpdateFormatted || timeLabel(new Date()));
              }
              if (data.deviceStatus) {
                setDeviceRecord(data.deviceStatus);
              }
              if (Array.isArray(data.recentReadings)) {
                setHistory(data.recentReadings);
              }
              if (Array.isArray(data.recentAlerts)) {
                setAlerts(data.recentAlerts);
              }
            } else if (data.type === "DEVICE_STATUS_CHANGED") {
              if (data.deviceStatus) {
                setDeviceRecord(data.deviceStatus);
              }
            } else if (data.type === "DATA_POINT") {
              const reading = data.reading as Reading;
              const nextState = data.state;

              // Telemetry received = refresh heartbeat
              const now = Date.now();
              setDeviceRecord((prev) => ({
                ...prev,
                lastHeartbeat: now,
                lastHeartbeatFormatted: timeLabel(new Date(now)),
                secondsSinceHeartbeat: 0,
                status: "ONLINE",
                ...(data.deviceStatus || {}),
              }));

              if (reading) {
                setValues({
                  ph: reading.ph,
                  tds: reading.tds,
                  turbidity: reading.turbidity,
                  temperature: reading.temperature,
                  flow: reading.flow,
                });
                setRisk(reading.risk);
                setStatus(reading.status);
                setHistory((prev) => [...prev.slice(-300), reading]);
                setLastUpdate(reading.t);
                setLastUpdateFormatted(reading.time);
              }

              if (nextState) {
                setValve(nextState.valve);
                setRelay(nextState.relay);
                setDischarge(nextState.discharge);
                setLastSource(nextState.lastSource);
                if (nextState.status === "CRITICAL" && nextState.gmailAlertStatus === "SENT") {
                  setSystemHealth((h) => ({ ...h, gmailService: "ALERT SENT" }));
                } else if (nextState.status === "SAFE") {
                  setSystemHealth((h) => ({
                    ...h,
                    gmailService: h.gmailConfigured ? "CONNECTED" : "READY",
                  }));
                }
              }

              // Trigger UI Alert if transition to CRITICAL
              if (reading?.status === "CRITICAL" && lastStatusRef.current !== "CRITICAL") {
                setStats((s) => ({
                  ...s,
                  totalAlerts: s.totalAlerts + 1,
                  criticalEvents: s.criticalEvents + 1,
                  blockedEvents: s.blockedEvents + 1,
                }));
                toast.error("🚨 CRITICAL POLLUTION DETECTED", {
                  description: `Risk Score: ${reading.risk}/100 — Discharge automatically blocked. Gmail alert triggered.`,
                  duration: 8000,
                });
                // Fetch fresh alerts
                fetch("/api/alerts?limit=10")
                  .then((r) => r.json())
                  .then((d) => {
                    if (Array.isArray(d.alerts)) setAlerts(d.alerts);
                  })
                  .catch(() => {});
              }

              if (reading?.status) {
                lastStatusRef.current = reading.status;
              }
            } else if (data.type === "ALERT_RESOLVED") {
              setAlerts((list) =>
                list.map((a) => (a.id === data.alertId ? { ...a, resolved: true } : a)),
              );
            } else if (data.type === "SIMULATION_TOGGLE") {
              setSimulationActive(data.active);
            }
          } catch (e) {
            console.error("Error parsing SSE data:", e);
          }
        };

        eventSource.onerror = () => {
          setSystemHealth((h) => ({ ...h, liveStream: "OFFLINE" }));
          eventSource?.close();
          reconnectTimeout = setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        console.warn("EventSource setup error:", err);
      }
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [fetchInitial]);

  const simulateCritical = useCallback(async () => {
    try {
      const res = await fetch("/api/simulation/critical", { method: "POST" });
      const data = await res.json();
      if (data.state) {
        setValues(data.state.values);
        setRisk(data.state.risk);
        setStatus(data.state.status);
        setValve(data.state.valve);
        setRelay(data.state.relay);
        setDischarge(data.state.discharge);
      }
    } catch (err) {
      console.error("Critical simulation error:", err);
      // Fallback
      setValues({ ...CRITICAL_PRESET });
      setRisk(92);
      setStatus("CRITICAL");
      setValve("CLOSED");
      setRelay("ACTIVE");
      setDischarge("BLOCKED");
    }
  }, []);

  const simulateEmergency = useCallback(async () => {
    try {
      const res = await fetch("/api/simulation/emergency", { method: "POST" });
      const data = await res.json();
      if (data.state) {
        setValues(data.state.values);
        setRisk(data.state.risk);
        setStatus(data.state.status);
        setValve(data.state.valve);
        setRelay(data.state.relay);
        setDischarge(data.state.discharge);
      }
      toast.error("🚨 EMERGENCY POLLUTION SHUTDOWN", {
        description: "Severe hazard thresholds exceeded. Complete discharge lock engaged.",
        duration: 8000,
      });
    } catch (err) {
      console.error("Emergency simulation error:", err);
      setValues({ ph: 3.5, tds: 2500, turbidity: 250, temperature: 50, flow: 8.0 });
      setRisk(99);
      setStatus("CRITICAL");
      setValve("CLOSED");
      setRelay("ACTIVE");
      setDischarge("BLOCKED");
    }
  }, []);

  const reset = useCallback(async () => {
    try {
      const res = await fetch("/api/simulation/reset", { method: "POST" });
      const data = await res.json();
      if (data.state) {
        setValues(data.state.values);
        setRisk(data.state.risk);
        setStatus(data.state.status);
        setValve(data.state.valve);
        setRelay(data.state.relay);
        setDischarge(data.state.discharge);
      }
      toast.success("System Restored to Normal", {
        description: "Safety controls disengaged. Valve OPEN, Relay INACTIVE, Discharge ALLOWED.",
      });
    } catch (err) {
      console.error("Reset error:", err);
      setValues({ ...NORMAL });
      setRisk(8);
      setStatus("SAFE");
      setValve("OPEN");
      setRelay("INACTIVE");
      setDischarge("ALLOWED");
    }
  }, []);

  const toggleSimulation = useCallback(async (active: boolean) => {
    try {
      const res = await fetch("/api/simulation/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      setSimulationActive(data.simulationActive);
      toast.info(
        active ? "Simulation Mode Active" : "Simulation Paused (Awaiting Hardware Stream)",
      );
    } catch (err) {
      console.error("Toggle simulation error:", err);
    }
  }, []);

  const sendTestEmail = useCallback(async () => {
    try {
      const res = await fetch("/api/email/test", { method: "POST" });
      const data = await res.json();
      if (data.sent) {
        toast.success("Gmail Alert Sent!", {
          description: data.details,
        });
      } else {
        toast.warning(data.configured ? "Gmail Send Failed" : "Gmail Not Configured", {
          description: data.details,
        });
      }
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reach server";
      toast.error("Email Test Failed", { description: msg });
      return { sent: false, configured: false, details: msg };
    }
  }, []);

  const simulatePreset = useCallback(
    async (preset: "NORMAL" | "CRITICAL" | "EMERGENCY") => {
      try {
        const res = await fetch("/api/control/simulate-preset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset }),
        });
        const data = await res.json();
        if (data.state) {
          setValues(data.state.values);
          setRisk(data.state.risk);
          setStatus(data.state.status);
          setValve(data.state.valve);
          setRelay(data.state.relay);
          setDischarge(data.state.discharge);
          setMode(data.state.mode || "AUTO");
        }
        toast.info(`SCADA Preset Activated: ${preset}`);
      } catch (err) {
        console.error("Simulate preset error:", err);
        if (preset === "EMERGENCY") simulateEmergency();
        else if (preset === "CRITICAL") simulateCritical();
        else reset();
      }
    },
    [simulateCritical, simulateEmergency, reset],
  );

  const controlOverride = useCallback(
    async (
      action: "VALVE_CLOSE" | "VALVE_OPEN" | "MODE_AUTO" | "MODE_MANUAL" | "EMERGENCY_SHUTDOWN",
    ) => {
      try {
        const res = await fetch("/api/control/override", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json();
        if (data.state) {
          setValve(data.state.valve);
          setRelay(data.state.relay);
          setDischarge(data.state.discharge);
          setMode(data.state.mode);
        }
        toast.success(`Actuator Command Executed: ${action}`);
      } catch (err) {
        console.error("Control override error:", err);
        if (action === "VALVE_CLOSE") {
          setValve("CLOSED");
          setDischarge("BLOCKED");
        } else if (action === "VALVE_OPEN") {
          setValve("OPEN");
          setDischarge("ALLOWED");
        } else if (action === "MODE_AUTO") {
          setMode("AUTO");
        } else if (action === "MODE_MANUAL") {
          setMode("MANUAL");
        } else if (action === "EMERGENCY_SHUTDOWN") {
          setValve("CLOSED");
          setRelay("ACTIVE");
          setDischarge("BLOCKED");
        }
        toast.info(`Local Actuator State Updated: ${action}`);
      }
    },
    [],
  );

  const acknowledgeAlert = useCallback(async (id: string) => {
    try {
      await fetch(`/api/alerts/${id}/acknowledge`, { method: "POST" });
      setAlerts((list) =>
        list.map((a) => (a.id === id ? { ...a, message: `${a.message} [ACKNOWLEDGED]` } : a)),
      );
      toast.success("Alert Acknowledged by Operator");
    } catch (err) {
      console.error("Acknowledge error:", err);
    }
  }, []);

  const resolveAlert = useCallback(async (id: string) => {
    try {
      await fetch(`/api/alerts/${id}/resolve`, { method: "POST" });
      setAlerts((list) => list.map((a) => (a.id === id ? { ...a, resolved: true } : a)));
      toast.success("Alert Marked Resolved");
    } catch (err) {
      console.error("Resolve error:", err);
    }
  }, []);

  const sendManualReading = useCallback(async (payload: Record<SensorKey, number>) => {
    try {
      const res = await fetch("/api/sensors/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Sensor Data Ingested", {
          description: `Status: ${data.status} | Risk: ${data.riskScore}/100`,
        });
      }
    } catch (err) {
      console.error("Manual reading intake error:", err);
    }
  }, []);

  const sendHeartbeatPing = useCallback(async () => {
    try {
      const res = await fetch("/api/devices/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "ESP32-STATION-01",
          rssi: -58,
          batteryVoltage: 3.3,
        }),
      });
      const data = await res.json();
      if (data.deviceStatus) {
        setDeviceRecord(data.deviceStatus);
      }
      toast.success("ESP32 Heartbeat Ping Sent", {
        description: "Connection refreshed & status confirmed ONLINE (0s latency).",
      });
    } catch (err) {
      console.error("Heartbeat ping error:", err);
    }
  }, []);

  const simulateDropConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/devices/simulate-offline", { method: "POST" });
      const data = await res.json();
      if (data.deviceStatus) {
        setDeviceRecord(data.deviceStatus);
      }
      toast.warning("Simulated ESP32 Connection Drop", {
        description: "Heartbeat timer forced past 30-second threshold. Status set to OFFLINE.",
      });
    } catch (err) {
      console.error("Simulate drop error:", err);
    }
  }, []);

  const simulateRestoreConnection = useCallback(async () => {
    try {
      const res = await fetch("/api/devices/simulate-online", { method: "POST" });
      const data = await res.json();
      if (data.deviceStatus) {
        setDeviceRecord(data.deviceStatus);
      }
      toast.success("ESP32 Connection Restored", {
        description: "Device heartbeat resumed. Status set to ONLINE.",
      });
    } catch (err) {
      console.error("Simulate restore error:", err);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/sensors/history?limit=300");
      const data = await res.json();
      if (Array.isArray(data.readings)) {
        setHistory(data.readings.reverse());
      }
    } catch (err) {
      console.error("Refresh history error:", err);
    }
  }, []);

  return (
    <SimulationContext.Provider
      value={{
        values,
        risk,
        status,
        valve,
        relay,
        discharge,
        mode,
        history,
        alerts,
        stats,
        systemHealth,
        deviceRecord,
        deviceStatus: deviceRecord.status,
        secondsSinceHeartbeat: deviceRecord.secondsSinceHeartbeat,
        isDeviceOffline,
        simulationActive,
        lastUpdate,
        lastUpdateFormatted,
        lastSource,
        simulateCritical,
        simulateEmergency,
        simulatePreset,
        controlOverride,
        reset,
        toggleSimulation,
        sendTestEmail,
        acknowledgeAlert,
        resolveAlert,
        sendManualReading,
        sendHeartbeatPing,
        simulateDropConnection,
        simulateRestoreConnection,
        refreshHistory,
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within SimulationProvider");
  return ctx;
}
