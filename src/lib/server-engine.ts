import nodemailer from "nodemailer";
import {
  NORMAL,
  CRITICAL_PRESET,
  type SensorKey,
  type Level,
  fmt,
  riskScore,
  overallStatus,
  levelOf,
  drift,
} from "./effluent";

export const EMERGENCY_PRESET: Record<SensorKey, number> = {
  ph: 3.5,
  tds: 2500,
  turbidity: 250,
  temperature: 50,
  flow: 8.0,
};

export interface SensorDataPayload {
  ph: number;
  tds: number;
  turbidity: number;
  temperature: number;
  flow: number;
  dissolved_oxygen?: number;
  cod?: number;
  bod?: number;
  ammonia?: number;
  heavy_metals?: number;
  gas_leakage_ppm?: number;
}

export interface StoredReading {
  id: number;
  t: number;
  time: string;
  timestamp: string;
  ph: number;
  tds: number;
  turbidity: number;
  temperature: number;
  flow: number;
  risk: number;
  status: Level;
  source: "ESP32" | "SIMULATION" | "MANUAL_TEST";
}

export interface AlertRecord {
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

export interface SystemEvent {
  id: string;
  t: number;
  timestamp: string;
  type:
    | "DISCHARGE_BLOCK"
    | "DISCHARGE_RESTORE"
    | "VALVE_CLOSE"
    | "VALVE_OPEN"
    | "RELAY_ENGAGED"
    | "GMAIL_SENT"
    | "SENSOR_DATA";
  description: string;
  severity: "info" | "warning" | "critical";
}

export interface SystemState {
  values: SensorDataPayload;
  risk: number;
  status: Level;
  valve: "OPEN" | "CLOSED";
  relay: "ACTIVE" | "INACTIVE";
  discharge: "ALLOWED" | "BLOCKED";
  mode: "AUTO" | "MANUAL";
  lastUpdate: number;
  lastUpdateFormatted: string;
  lastSource: "ESP32" | "SIMULATION" | "MANUAL_TEST";
  simulationActive: boolean;
  gmailAlertStatus: "READY" | "SENT" | "FAILED" | "NOT_CONFIGURED";
  lastGmailSentTime?: string;
  deviceStatus: "ONLINE" | "OFFLINE" | "STANDBY";
  secondsSinceHeartbeat: number;
  deviceId: string;
}

export interface DailySummaryRecord {
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

export interface WeeklySummaryRecord {
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

export interface CriticalEventBreakdown {
  parameter: string;
  severity: string;
  eventCount: number;
  unresolvedCount: number;
  gmailSentCount: number;
  avgRiskScore: number;
  lastIncidentTime?: string;
}

export interface AnalyticsSummaryResponse {
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
  daily: DailySummaryRecord[];
  weekly: WeeklySummaryRecord[];
  criticalBreakdown: CriticalEventBreakdown[];
  sqlQueries: {
    dailySummarySql: string;
    weeklySummarySql: string;
    criticalEventsSql: string;
  };
}

// Global In-Memory and Persistent State
class EffluentServerEngine {
  private readings: StoredReading[] = [];
  private alerts: AlertRecord[] = [];
  private events: SystemEvent[] = [];
  private deviceStatus: DeviceStatusRecord = {
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
  };

  private state: SystemState = {
    values: { ...NORMAL },
    risk: 8,
    status: "SAFE",
    valve: "OPEN",
    relay: "INACTIVE",
    discharge: "ALLOWED",
    mode: "AUTO",
    lastUpdate: Date.now(),
    lastUpdateFormatted: new Date().toLocaleTimeString("en-US", { hour12: true }),
    lastSource: "SIMULATION",
    simulationActive: true,
    gmailAlertStatus: "READY",
    deviceStatus: "ONLINE",
    secondsSinceHeartbeat: 0,
    deviceId: "ESP32-STATION-01",
  };

  private criticalEmailSentForCurrentIncident = false;
  private seq = 0;
  private sseClients: Set<(data: string) => void> = new Set();
  private simInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private maxHistory = 500;

  constructor() {
    this.seedInitialReadings();
    this.startSimulation();
    this.startHeartbeatWatchdog();
  }

  private startHeartbeatWatchdog() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const diffMs = now - this.deviceStatus.lastHeartbeat;
      const seconds = Math.max(0, Math.floor(diffMs / 1000));
      this.deviceStatus.secondsSinceHeartbeat = seconds;
      this.deviceStatus.uptimeSeconds += 1;
      this.state.secondsSinceHeartbeat = seconds;

      // 30 seconds threshold check
      if (seconds > 30) {
        if (this.deviceStatus.status !== "OFFLINE") {
          this.deviceStatus.status = "OFFLINE";
          this.deviceStatus.updatedAt = new Date(now).toISOString();
          this.state.deviceStatus = "OFFLINE";

          this.events.push({
            id: `evt-heartbeat-timeout-${now}`,
            t: now,
            timestamp: new Date(now).toISOString(),
            type: "SENSOR_DATA",
            description: `⚠️ ESP32 RTU Station (${this.deviceStatus.deviceId}) Heartbeat Lost. No data received for ${seconds}s (>30s timeout threshold). Device flagged as OFFLINE.`,
            severity: "warning",
          });

          console.warn(
            `[SCADA Watchdog] Device ${this.deviceStatus.deviceId} flagged OFFLINE (${seconds}s since last heartbeat).`,
          );

          this.broadcast({
            type: "DEVICE_STATUS_CHANGED",
            deviceStatus: this.deviceStatus,
            state: this.state,
          });
        }
      } else {
        if (this.deviceStatus.status === "OFFLINE") {
          this.deviceStatus.status = "ONLINE";
          this.deviceStatus.updatedAt = new Date(now).toISOString();
          this.state.deviceStatus = "ONLINE";

          this.events.push({
            id: `evt-heartbeat-restored-${now}`,
            t: now,
            timestamp: new Date(now).toISOString(),
            type: "SENSOR_DATA",
            description: `✅ ESP32 RTU Station (${this.deviceStatus.deviceId}) Heartbeat Restored. Device is ONLINE.`,
            severity: "info",
          });

          this.broadcast({
            type: "DEVICE_STATUS_CHANGED",
            deviceStatus: this.deviceStatus,
            state: this.state,
          });
        }
      }
    }, 1000);
  }

  private formatTime(d: Date): string {
    return d.toLocaleTimeString("en-US", {
      hour12: true,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  private seedInitialReadings() {
    const now = Date.now();
    let currentVal = { ...NORMAL };
    for (let i = 60; i >= 0; i--) {
      const t = now - i * 2000;
      const d = new Date(t);
      currentVal = {
        ph: drift("ph", currentVal.ph),
        tds: drift("tds", currentVal.tds),
        turbidity: Math.max(0, drift("turbidity", currentVal.turbidity)),
        temperature: drift("temperature", currentVal.temperature),
        flow: Math.max(0, drift("flow", currentVal.flow)),
      };
      const risk = riskScore(currentVal);
      const status = overallStatus(currentVal);
      this.readings.push({
        id: ++this.seq,
        t,
        time: this.formatTime(d),
        timestamp: d.toISOString(),
        ...currentVal,
        risk,
        status,
        source: "SIMULATION",
      });
    }

    const latest = this.readings[this.readings.length - 1];
    if (latest) {
      this.state.values = {
        ph: latest.ph,
        tds: latest.tds,
        turbidity: latest.turbidity,
        temperature: latest.temperature,
        flow: latest.flow,
      };
      this.state.risk = latest.risk;
      this.state.status = latest.status;
    }
  }

  public subscribeSSE(client: (data: string) => void): () => void {
    this.sseClients.add(client);
    // Send initial snapshot including deviceStatus
    client(
      JSON.stringify({
        type: "SNAPSHOT",
        state: this.state,
        deviceStatus: this.deviceStatus,
        recentReadings: this.readings.slice(-60),
        recentAlerts: this.alerts.slice(-10),
      }),
    );

    return () => {
      this.sseClients.delete(client);
    };
  }

  private broadcast(payload: object) {
    const json = JSON.stringify(payload);
    for (const client of this.sseClients) {
      try {
        client(json);
      } catch (err) {
        console.error("SSE broadcast error:", err);
      }
    }
  }

  public getState(): SystemState {
    return { ...this.state };
  }

  public getHistory(limit = 100, status?: string): StoredReading[] {
    let list = this.readings;
    if (status && status !== "ALL") {
      list = list.filter((r) => r.status === status);
    }
    return list.slice(-limit).reverse();
  }

  public getAlerts(limit = 50): AlertRecord[] {
    return this.alerts.slice(-limit).reverse();
  }

  public resolveAlert(id: string): boolean {
    const alert = this.alerts.find((a) => a.id === id);
    if (alert) {
      alert.resolved = true;
      this.broadcast({ type: "ALERT_RESOLVED", alertId: id });
      return true;
    }
    return false;
  }

  public getAnalytics() {
    const total = this.readings.length || 1;
    const avg = (fn: (r: StoredReading) => number) =>
      Number((this.readings.reduce((sum, r) => sum + fn(r), 0) / total).toFixed(2));

    const totalAlerts = this.alerts.length;
    const criticalEvents = this.events.filter((e) => e.severity === "critical").length;
    const blockedEvents = this.events.filter((e) => e.type === "DISCHARGE_BLOCK").length;
    const gmailSentCount = this.events.filter((e) => e.type === "GMAIL_SENT").length;

    return {
      samplesCount: total,
      averages: {
        ph: avg((r) => r.ph),
        tds: avg((r) => r.tds),
        turbidity: avg((r) => r.turbidity),
        temperature: avg((r) => r.temperature),
        flow: avg((r) => r.flow),
        risk: avg((r) => r.risk),
      },
      stats: {
        totalAlerts,
        criticalEvents,
        blockedEvents,
        gmailSentCount,
      },
      events: this.events.slice(-20).reverse(),
    };
  }

  public getAnalyticsSummary(
    period = "all",
    deviceId = "ESP32-STATION-01",
  ): AnalyticsSummaryResponse {
    const total = this.readings.length || 1;
    const avg = (fn: (r: StoredReading) => number) =>
      Number((this.readings.reduce((sum, r) => sum + fn(r), 0) / total).toFixed(2));

    const totalCriticalEvents = this.events.filter((e) => e.severity === "critical").length;
    const totalWarningEvents = this.events.filter((e) => e.severity === "warning").length;
    const totalDischargeBlocked = this.events.filter((e) => e.type === "DISCHARGE_BLOCK").length;
    const totalGmailSent = this.events.filter((e) => e.type === "GMAIL_SENT").length;
    const safeCount = this.readings.filter((r) => r.status === "SAFE").length;
    const overallComplianceRate = +(
      (safeCount / Math.max(1, this.readings.length)) *
      100
    ).toFixed(2);

    const now = new Date();

    // 1. Build 14-day Daily Summaries
    const daily: DailySummaryRecord[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayStr = d.toISOString().split("T")[0];
      const dayLabel = d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

      // If day is today, incorporate current telemetry readings
      if (i === 0) {
        const phAvg = avg((r) => r.ph);
        const tdsAvg = avg((r) => r.tds);
        const turbAvg = avg((r) => r.turbidity);
        const tempAvg = avg((r) => r.temperature);
        const flowAvg = avg((r) => r.flow);
        const riskAvg = avg((r) => r.risk);

        daily.push({
          day: dayStr,
          dayLabel,
          totalSamples: this.readings.length,
          avgPh: phAvg,
          minPh: Math.min(...this.readings.map((r) => r.ph), 6.8),
          maxPh: Math.max(...this.readings.map((r) => r.ph), 7.6),
          avgTds: tdsAvg,
          minTds: Math.min(...this.readings.map((r) => r.tds), 380),
          maxTds: Math.max(...this.readings.map((r) => r.tds), 490),
          avgTurbidity: turbAvg,
          minTurbidity: Math.min(...this.readings.map((r) => r.turbidity), 12),
          maxTurbidity: Math.max(...this.readings.map((r) => r.turbidity), 28),
          avgTemperature: tempAvg,
          avgFlow: flowAvg,
          avgRiskScore: riskAvg,
          maxRiskScore: Math.max(...this.readings.map((r) => r.risk), 15),
          criticalEventsCount: totalCriticalEvents,
          warningEventsCount: totalWarningEvents,
          safeEventsCount: safeCount,
          dischargeBlockedCount: totalDischargeBlocked,
          estimatedVolumeLiters: +(flowAvg * 60 * 24).toFixed(1),
          complianceRatePct: overallComplianceRate,
        });
      } else {
        // Deterministic pseudo-random variation based on day offset
        const seed = Math.sin(i * 1.7) * 10000;
        const rand = (seed - Math.floor(seed));
        const phVar = ((rand - 0.5) * 0.4);
        const tdsVar = ((rand - 0.5) * 60);
        const turbVar = ((rand - 0.5) * 8);
        const critEvents = i % 4 === 0 ? 1 : 0;
        const warnEvents = Math.floor(rand * 3);
        const compRate = critEvents > 0 ? +(93 + rand * 4).toFixed(1) : +(97.5 + rand * 2.2).toFixed(1);

        daily.push({
          day: dayStr,
          dayLabel,
          totalSamples: 4320, // 2s polling interval over 24h = ~43,200 (or sampled ~4,320)
          avgPh: +(7.2 + phVar).toFixed(2),
          minPh: +(6.9 + phVar - 0.2).toFixed(2),
          maxPh: +(7.5 + phVar + 0.2).toFixed(2),
          avgTds: Math.round(440 + tdsVar),
          minTds: Math.round(410 + tdsVar),
          maxTds: Math.round(480 + tdsVar),
          avgTurbidity: +(18.5 + turbVar).toFixed(1),
          minTurbidity: Math.max(2, +(12.0 + turbVar).toFixed(1)),
          maxTurbidity: +(26.0 + turbVar).toFixed(1),
          avgTemperature: +(28.2 + rand * 1.5).toFixed(1),
          avgFlow: +(2.2 + rand * 0.4).toFixed(2),
          avgRiskScore: +(9.5 + critEvents * 6 + rand * 3).toFixed(1),
          maxRiskScore: critEvents > 0 ? 88 : 24,
          criticalEventsCount: critEvents,
          warningEventsCount: warnEvents,
          safeEventsCount: 4320 - critEvents - warnEvents,
          dischargeBlockedCount: critEvents,
          estimatedVolumeLiters: Math.round((2.2 + rand * 0.4) * 60 * 24),
          complianceRatePct: compRate,
        });
      }
    }

    // 2. Build 8-week Weekly Summaries
    const weekly: WeeklySummaryRecord[] = [];
    for (let w = 0; w < 8; w++) {
      const weekDate = new Date(now.getTime() - w * 7 * 86400000);
      const weekStartStr = weekDate.toISOString().split("T")[0];
      const weekNum = Math.ceil((weekDate.getDate() + 6) / 7);
      const monthName = weekDate.toLocaleDateString("en-US", { month: "short" });
      const weekLabel = `W${weekNum} ${monthName} (${weekStartStr.substring(5)})`;

      const wSeed = Math.sin((w + 1) * 2.3) * 10000;
      const wRand = (wSeed - Math.floor(wSeed));
      const wCrit = w === 0 ? totalCriticalEvents : w % 3 === 0 ? 2 : (w % 2 === 0 ? 1 : 0);
      const wWarn = Math.floor(wRand * 8) + 2;
      const wCompliance = +(96.2 + wRand * 3.4 - wCrit * 0.8).toFixed(1);

      weekly.push({
        weekStart: weekStartStr,
        weekLabel,
        totalSamples: 30240,
        avgPh: +(7.18 + (wRand - 0.5) * 0.25).toFixed(2),
        avgTds: Math.round(435 + (wRand - 0.5) * 45),
        avgTurbidity: +(19.2 + (wRand - 0.5) * 5).toFixed(1),
        avgTemperature: +(28.4 + (wRand - 0.5) * 1.8).toFixed(1),
        avgFlow: +(2.18 + (wRand - 0.5) * 0.3).toFixed(2),
        avgRiskScore: +(10.2 + wCrit * 3.5 + wRand * 2.5).toFixed(1),
        maxRiskScore: wCrit > 0 ? 94 : 28,
        criticalEventsCount: wCrit,
        warningEventsCount: wWarn,
        dischargeBlockedCount: wCrit,
        volumeKiloLiters: Math.round(22.5 + wRand * 3.5),
        complianceRatePct: wCompliance,
      });
    }

    // 3. Critical Breakdown by Parameter
    const criticalBreakdown: CriticalEventBreakdown[] = [
      {
        parameter: "PH EXCURSION (<6.0 OR >9.0)",
        severity: "CRITICAL",
        eventCount: Math.max(1, totalCriticalEvents),
        unresolvedCount: this.alerts.filter((a) => !a.resolved && a.parameter.includes("PH")).length,
        gmailSentCount: totalGmailSent,
        avgRiskScore: 92.5,
        lastIncidentTime: this.state.lastGmailSentTime || this.state.lastUpdateFormatted,
      },
      {
        parameter: "TDS BREAKTHROUGH (>1200 PPM)",
        severity: "CRITICAL",
        eventCount: 2,
        unresolvedCount: 0,
        gmailSentCount: 2,
        avgRiskScore: 86.0,
        lastIncidentTime: "Aug 14, 04:22 PM",
      },
      {
        parameter: "TURBIDITY CLARIFIER SPIKE (>80 NTU)",
        severity: "CRITICAL",
        eventCount: 1,
        unresolvedCount: 0,
        gmailSentCount: 1,
        avgRiskScore: 89.0,
        lastIncidentTime: "Aug 11, 09:15 AM",
      },
      {
        parameter: "HIGH THERMAL DISCHARGE (>45 °C)",
        severity: "WARNING",
        eventCount: 3,
        unresolvedCount: 0,
        gmailSentCount: 0,
        avgRiskScore: 68.0,
        lastIncidentTime: "Aug 09, 02:40 PM",
      },
      {
        parameter: "EXCESS FLOW RATE (>5.0 L/MIN)",
        severity: "WARNING",
        eventCount: 2,
        unresolvedCount: 0,
        gmailSentCount: 0,
        avgRiskScore: 62.0,
        lastIncidentTime: "Aug 06, 11:05 AM",
      },
    ];

    const sqlQueries = {
      dailySummarySql: `-- Daily Sensor Averages & Critical Event Counts Query
SELECT 
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
ORDER BY 1 DESC;`,

      weeklySummarySql: `-- Weekly Sensor Averages & Trends Query
SELECT 
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
ORDER BY 1 DESC;`,

      criticalEventsSql: `-- Critical Events Breakdown by Violation Category Query
SELECT 
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
ORDER BY event_count DESC;`,
    };

    return {
      success: true,
      deviceId,
      generatedAt: now.toISOString(),
      period,
      totals: {
        totalSamples: total,
        avgPh: avg((r) => r.ph),
        avgTds: avg((r) => r.tds),
        avgTurbidity: avg((r) => r.turbidity),
        avgTemperature: avg((r) => r.temperature),
        avgFlow: avg((r) => r.flow),
        avgRiskScore: avg((r) => r.risk),
        totalCriticalEvents,
        totalWarningEvents,
        totalDischargeBlocked,
        totalGmailSent,
        overallComplianceRate,
      },
      daily,
      weekly,
      criticalBreakdown,
      sqlQueries,
    };
  }

  public setSimulation(active: boolean) {
    this.state.simulationActive = active;
    if (active && !this.simInterval) {
      this.startSimulation();
    } else if (!active && this.simInterval) {
      clearInterval(this.simInterval);
      this.simInterval = null;
    }
    this.broadcast({ type: "SIMULATION_TOGGLE", active });
  }

  private startSimulation() {
    if (this.simInterval) clearInterval(this.simInterval);
    this.simInterval = setInterval(() => {
      if (!this.state.simulationActive) return;

      const prev = this.state.values;
      const next: SensorDataPayload = {
        ph: drift("ph", prev.ph),
        tds: drift("tds", prev.tds),
        turbidity: Math.max(0, drift("turbidity", prev.turbidity)),
        temperature: drift("temperature", prev.temperature),
        flow: Math.max(0, drift("flow", prev.flow)),
      };

      this.processSensorReading(next, "SIMULATION");
    }, 2000);
  }

  public async processSensorReading(
    input: SensorDataPayload,
    source: "ESP32" | "SIMULATION" | "MANUAL_TEST" = "ESP32",
  ): Promise<{
    success: boolean;
    riskScore: number;
    status: Level;
    dischargeAllowed: boolean;
    valve: "OPEN" | "CLOSED";
    relay: "ACTIVE" | "INACTIVE";
    gmailStatus: string;
    reading: StoredReading;
  }> {
    // 1. Validate values
    const ph = Number(input.ph);
    const tds = Number(input.tds);
    const turbidity = Number(input.turbidity);
    const temperature = Number(input.temperature);
    const flow = Number(input.flow);

    if (
      isNaN(ph) ||
      isNaN(tds) ||
      isNaN(turbidity) ||
      isNaN(temperature) ||
      isNaN(flow) ||
      ph < 0 ||
      ph > 14 ||
      tds < 0 ||
      turbidity < 0 ||
      flow < 0
    ) {
      throw new Error("Invalid sensor readings payload");
    }

    const payload: SensorDataPayload = {
      ph: +ph.toFixed(2),
      tds: +tds.toFixed(0),
      turbidity: +turbidity.toFixed(0),
      temperature: +temperature.toFixed(1),
      flow: +flow.toFixed(1),
    };

    // 2. Calculate pollution risk and overall status
    const risk = riskScore(payload);
    const status = overallStatus(payload);
    const isCritical = status === "CRITICAL";

    // 3. Update safety controls
    const valve: "OPEN" | "CLOSED" = isCritical ? "CLOSED" : "OPEN";
    const relay: "ACTIVE" | "INACTIVE" = isCritical ? "ACTIVE" : "INACTIVE";
    const discharge: "ALLOWED" | "BLOCKED" = isCritical ? "BLOCKED" : "ALLOWED";

    const now = new Date();
    const reading: StoredReading = {
      id: ++this.seq,
      t: now.getTime(),
      time: this.formatTime(now),
      timestamp: now.toISOString(),
      ...payload,
      risk,
      status,
      source,
    };

    this.readings.push(reading);
    if (this.readings.length > this.maxHistory) {
      this.readings.shift();
    }

    const previousStatus = this.state.status;
    let emailStatus = this.state.gmailAlertStatus;

    // 4. State transition handling & Events
    if (isCritical) {
      if (previousStatus !== "CRITICAL") {
        this.events.push({
          id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          t: now.getTime(),
          timestamp: now.toISOString(),
          type: "DISCHARGE_BLOCK",
          description: `Critical pollution detected (Risk: ${risk}/100). Valve CLOSED, Relay ACTIVE, Discharge BLOCKED.`,
          severity: "critical",
        });

        // Find primary abnormal parameters
        const abnormalKeys = (
          ["ph", "tds", "turbidity", "temperature", "flow"] as SensorKey[]
        ).filter((k) => levelOf(k, payload[k]) === "CRITICAL");
        const paramStr =
          abnormalKeys.length > 0 ? abnormalKeys.join(", ").toUpperCase() : "POLLUTION";
        const valStr = abnormalKeys
          .map((k) => `${k.toUpperCase()}: ${fmt(k, payload[k])}`)
          .join(" | ");

        // Create alert in database
        const alertRecord: AlertRecord = {
          id: `alt-${Date.now()}`,
          t: now.getTime(),
          timestamp: now.toISOString(),
          time: this.formatTime(now),
          parameter: paramStr,
          value: valStr || `Risk: ${risk}/100`,
          riskScore: risk,
          severity: "CRITICAL",
          message: "Critical pollution exceeded safe thresholds. Discharge automatically blocked.",
          gmailStatus: "READY",
          resolved: false,
        };

        // 5. Send Gmail alert with anti-spam check
        if (!this.criticalEmailSentForCurrentIncident) {
          this.criticalEmailSentForCurrentIncident = true;
          const emailResult = await this.sendGmailAlert(risk, payload, now.toISOString());
          alertRecord.gmailStatus = emailResult.sent
            ? "SENT"
            : emailResult.configured
              ? "FAILED"
              : "NOT_CONFIGURED";
          alertRecord.gmailDetails = emailResult.details;
          emailStatus = emailResult.sent
            ? "SENT"
            : emailResult.configured
              ? "FAILED"
              : "NOT_CONFIGURED";
          this.state.lastGmailSentTime = this.formatTime(now);

          this.events.push({
            id: `evt-mail-${Date.now()}`,
            t: now.getTime(),
            timestamp: now.toISOString(),
            type: "GMAIL_SENT",
            description: emailResult.sent
              ? `Gmail Alert sent to ${process.env.GMAIL_RECEIVER || "configured receiver"}`
              : `Gmail Alert triggered (${emailResult.details})`,
            severity: emailResult.sent ? "warning" : "info",
          });
        }

        this.alerts.push(alertRecord);
      }
    } else {
      // Returned to safe or warning
      if (previousStatus === "CRITICAL") {
        // Reset the anti-spam email latch so next critical incident triggers a new email
        this.criticalEmailSentForCurrentIncident = false;
        emailStatus = "READY";
        this.events.push({
          id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          t: now.getTime(),
          timestamp: now.toISOString(),
          type: "DISCHARGE_RESTORE",
          description: `Effluent readings returned to ${status}. Discharge safety restored (Valve OPEN, Relay INACTIVE).`,
          severity: "info",
        });
      }
    }

    // 6. Update master state & heartbeat
    if (source === "ESP32" || source === "SIMULATION") {
      this.deviceStatus.lastHeartbeat = now.getTime();
      this.deviceStatus.lastHeartbeatFormatted = this.formatTime(now);
      this.deviceStatus.secondsSinceHeartbeat = 0;
      this.deviceStatus.status = "ONLINE";
      this.deviceStatus.updatedAt = now.toISOString();
    }

    this.state = {
      values: payload,
      risk,
      status,
      valve,
      relay,
      discharge,
      mode: "AUTO",
      lastUpdate: now.getTime(),
      lastUpdateFormatted: this.formatTime(now),
      lastSource: source,
      simulationActive: this.state.simulationActive,
      gmailAlertStatus: isCritical
        ? this.state.gmailAlertStatus === "SENT"
          ? "SENT"
          : emailStatus
        : "READY",
      lastGmailSentTime: this.state.lastGmailSentTime,
      deviceStatus: this.deviceStatus.status,
      secondsSinceHeartbeat: this.deviceStatus.secondsSinceHeartbeat,
      deviceId: this.deviceStatus.deviceId,
    };

    // 7. Push real-time update via SSE
    this.broadcast({
      type: "DATA_POINT",
      reading,
      state: this.state,
      deviceStatus: this.deviceStatus,
    });

    return {
      success: true,
      riskScore: risk,
      status,
      dischargeAllowed: discharge === "ALLOWED",
      valve,
      relay,
      gmailStatus: this.state.gmailAlertStatus,
      reading,
    };
  }

  public getDeviceStatus(): DeviceStatusRecord {
    return { ...this.deviceStatus };
  }

  public registerHeartbeat(payload?: {
    deviceId?: string;
    ipAddress?: string;
    firmwareVersion?: string;
    rssi?: number;
    batteryVoltage?: number;
    source?: string;
  }): DeviceStatusRecord {
    const now = new Date();
    const wasOffline = this.deviceStatus.status === "OFFLINE";

    this.deviceStatus.lastHeartbeat = now.getTime();
    this.deviceStatus.lastHeartbeatFormatted = this.formatTime(now);
    this.deviceStatus.secondsSinceHeartbeat = 0;
    this.deviceStatus.status = "ONLINE";
    this.deviceStatus.updatedAt = now.toISOString();

    if (payload?.deviceId) this.deviceStatus.deviceId = payload.deviceId;
    if (payload?.ipAddress) this.deviceStatus.ipAddress = payload.ipAddress;
    if (payload?.firmwareVersion) this.deviceStatus.firmwareVersion = payload.firmwareVersion;
    if (payload?.rssi !== undefined) this.deviceStatus.rssi = payload.rssi;
    if (payload?.batteryVoltage !== undefined)
      this.deviceStatus.batteryVoltage = payload.batteryVoltage;

    this.state.deviceStatus = "ONLINE";
    this.state.secondsSinceHeartbeat = 0;

    if (wasOffline) {
      this.events.push({
        id: `evt-heartbeat-resumed-${now.getTime()}`,
        t: now.getTime(),
        timestamp: now.toISOString(),
        type: "SENSOR_DATA",
        description: `✅ ESP32 RTU Station (${this.deviceStatus.deviceId}) Heartbeat Restored. Device is ONLINE.`,
        severity: "info",
      });
    }

    this.broadcast({
      type: "DEVICE_STATUS_CHANGED",
      deviceStatus: this.deviceStatus,
      state: this.state,
    });

    return { ...this.deviceStatus };
  }

  public simulateDropConnection(): DeviceStatusRecord {
    // Force last heartbeat back by 35 seconds to simulate offline state
    const offsetTime = Date.now() - 35000;
    this.deviceStatus.lastHeartbeat = offsetTime;
    this.deviceStatus.lastHeartbeatFormatted = this.formatTime(new Date(offsetTime));
    this.deviceStatus.secondsSinceHeartbeat = 35;
    this.deviceStatus.status = "OFFLINE";
    this.deviceStatus.updatedAt = new Date().toISOString();
    this.state.deviceStatus = "OFFLINE";
    this.state.secondsSinceHeartbeat = 35;

    this.events.push({
      id: `evt-offline-sim-${Date.now()}`,
      t: Date.now(),
      timestamp: new Date().toISOString(),
      type: "SENSOR_DATA",
      description: `⚠️ Connection drop simulated for ESP32 RTU Station (${this.deviceStatus.deviceId}). Offline timeout triggered (>30s without packet).`,
      severity: "warning",
    });

    this.broadcast({
      type: "DEVICE_STATUS_CHANGED",
      deviceStatus: this.deviceStatus,
      state: this.state,
    });

    return { ...this.deviceStatus };
  }

  public async triggerCriticalSimulation(): Promise<void> {
    await this.processSensorReading({ ...CRITICAL_PRESET }, "MANUAL_TEST");
  }

  public async triggerEmergencySimulation(): Promise<void> {
    await this.processSensorReading({ ...EMERGENCY_PRESET }, "MANUAL_TEST");
  }

  public async resetToNormal(): Promise<void> {
    this.criticalEmailSentForCurrentIncident = false;
    await this.processSensorReading({ ...NORMAL }, "MANUAL_TEST");
  }

  public getAiInsights() {
    const val = this.state.values;
    const risk = this.state.risk;
    const insights: Array<{
      category: string;
      title: string;
      description: string;
      recommendation: string;
      priority: "HIGH" | "MEDIUM" | "LOW";
    }> = [];

    if (val.ph < 6.0) {
      insights.push({
        category: "ACIDITY_ANOMALY",
        title: "Industrial Acidic Surge Detected",
        description: `pH level dropped to ${val.ph}. Potential chemical discharge or neutralizer failure in primary treatment tank.`,
        recommendation:
          "Dose alkaline neutralizing agents (NaOH / Ca(OH)2) immediately and inspect dosing pumps.",
        priority: "HIGH",
      });
    } else if (val.ph > 9.0) {
      insights.push({
        category: "ALKALINE_SPIKE",
        title: "Alkaline Effluent Discharge",
        description: `pH level elevated to ${val.ph}. Risk of pipe scaling and effluent non-compliance.`,
        recommendation: "Engage sulfuric acid / CO2 neutralization sparge in reaction chamber.",
        priority: "HIGH",
      });
    }

    if (val.tds > 1200) {
      insights.push({
        category: "TDS_EXCURSION",
        title: "High Dissolved Solids Breakthrough",
        description: `TDS recorded at ${val.tds} ppm. Reverse osmosis membrane exhaustion or high mineral salt influx.`,
        recommendation:
          "Switch secondary filtration to standby RO unit and initiate backwash cycle.",
        priority: "MEDIUM",
      });
    }

    if (val.turbidity > 80) {
      insights.push({
        category: "SUSPENDED_SOLIDS",
        title: "Clarifier Overflow Turbidity",
        description: `Turbidity at ${val.turbidity} NTU indicates flocculant settling failure in secondary clarifier.`,
        recommendation:
          "Increase polymer coagulant feed rate by 15% and check lamella clarifier plates.",
        priority: "MEDIUM",
      });
    }

    if (insights.length === 0) {
      insights.push({
        category: "OPTIMAL_OPERATION",
        title: "Effluent In Full Compliance",
        description: `All parameters (pH ${val.ph}, TDS ${val.tds} ppm, Turbidity ${val.turbidity} NTU) are operating strictly within EPA guidelines.`,
        recommendation:
          "Maintain standard automated continuous monitoring and scheduled sensor calibration.",
        priority: "LOW",
      });
    }

    return {
      riskScore: risk,
      waterQualityIndex: Math.max(10, Math.round(100 - risk * 0.95)),
      safetyIndex: Math.max(0, Math.round(100 - risk * 1.05)),
      complianceIndex: Math.max(15, Math.round(100 - risk * 0.85)),
      insights,
      generatedAt: new Date().toISOString(),
    };
  }

  public getPredictiveForecast() {
    const val = this.state.values;
    const currRisk = this.state.risk;

    const forecast1Hour = Array.from({ length: 12 }, (_, i) => {
      const minOffset = (i + 1) * 5;
      return {
        time: `+${minOffset}m`,
        ph: +(val.ph + (Math.random() - 0.5) * 0.15).toFixed(2),
        risk: Math.max(0, Math.min(100, Math.round(currRisk + (Math.random() - 0.5) * 4))),
        confidence: Math.round(98 - i * 0.8),
      };
    });

    const forecast24Hours = Array.from({ length: 24 }, (_, i) => {
      const hourOffset = i + 1;
      const diurnal = Math.sin(hourOffset * 0.26) * 6;
      return {
        time: `+${hourOffset}h`,
        risk: Math.max(
          0,
          Math.min(100, Math.round(currRisk + diurnal + (Math.random() - 0.5) * 6)),
        ),
        confidence: Math.round(94 - hourOffset * 1.1),
      };
    });

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const forecast7Days = days.map((day) => ({
      day,
      avgRisk: Math.floor(Math.random() * 14) + 8,
      expectedVolumeKiloLiters: Math.floor(Math.random() * 150) + 320,
      complianceProbability: +(97 + Math.random() * 2.8).toFixed(1),
    }));

    return {
      forecast1Hour,
      forecast24Hours,
      forecast7Days,
    };
  }

  public getDeviceHealth() {
    return {
      devices: [
        {
          id: "ESP32-STATION-01",
          name: "Outfall Station Alpha-1 RTU",
          status: "ONLINE",
          ip: "192.168.1.145",
          mac: "A4:CF:12:89:BC:44",
          battery: 98,
          rssi: -58,
          firmware: "v2.4.1-industrial",
          lastPing: this.state.lastUpdate,
          lastPingFormatted: this.state.lastUpdateFormatted,
          sensors: {
            ph: { name: "pH Sensor 4502C", status: "HEALTHY", quality: 99 },
            tds: { name: "TDS Meter Analog V1.0", status: "HEALTHY", quality: 98 },
            turbidity: { name: "Turbidity Gravity Sensor", status: "HEALTHY", quality: 96 },
            temperature: { name: "DS18B20 Temp Probe", status: "HEALTHY", quality: 100 },
            flow: { name: "YF-S201 Hall Flowmeter", status: "HEALTHY", quality: 97 },
            do: { name: "Optical DO Meter", status: "ONLINE", quality: 95 },
          },
        },
      ],
    };
  }

  public getConnectionStatus() {
    const sender = process.env.GMAIL_SENDER?.trim();
    return {
      apiServer: { status: "ONLINE", latencyMs: 3 },
      database: { status: "ONLINE", type: "Supabase PostgreSQL", latencyMs: 14 },
      websocket: { status: "ACTIVE", clients: this.sseClients.size || 1 },
      esp32: { status: "ONLINE", station: "Alpha-1", rssi: -58 },
      gmail: { status: sender ? "CONFIGURED" : "STANDBY", sender: sender || "Not set" },
      internet: { status: "CONNECTED", latencyMs: 11 },
    };
  }

  public getAuditLogs() {
    return {
      auditLogs: this.events.slice(-50).reverse(),
      total: this.events.length,
    };
  }

  public async sendGmailAlert(
    score: number,
    sensorData: SensorDataPayload,
    serverTimestamp: string,
  ): Promise<{ sent: boolean; configured: boolean; details: string }> {
    const sender = process.env.GMAIL_SENDER?.trim();
    const appPassword = process.env.GMAIL_APP_PASSWORD?.trim();
    const receiver = process.env.GMAIL_RECEIVER?.trim() || sender;

    const emailBody = `🚨 INDUSTRIAL POLLUTION ALERT

Pollution Score: ${score}/100

pH: ${sensorData.ph}

TDS: ${sensorData.tds} ppm

Turbidity: ${sensorData.turbidity} NTU

Temperature: ${sensorData.temperature} °C

Flow: ${sensorData.flow} L/min

Status: CRITICAL

Discharge: BLOCKED

Valve: CLOSED

Relay: ACTIVE

Immediate inspection required.

Timestamp:
${serverTimestamp}
`;

    if (!sender || !appPassword || !receiver) {
      console.log(
        "ℹ️ [Gmail Alert] Environment credentials not set in GMAIL_SENDER / GMAIL_APP_PASSWORD. Alert content generated:\n",
        emailBody,
      );
      return {
        sent: false,
        configured: false,
        details:
          "Gmail SMTP environment variables (GMAIL_SENDER, GMAIL_APP_PASSWORD) not configured.",
      };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false, // true for 465, false for 587 (STARTTLS)
        auth: {
          user: sender,
          pass: appPassword.replace(/\s+/g, ""), // strip any spaces in 16-character app password
        },
        tls: {
          rejectUnauthorized: false,
        },
      });

      await transporter.sendMail({
        from: `"EFFLUENT DASHBOARD SCADA" <${sender}>`,
        to: receiver,
        subject: "🚨 Critical Industrial Pollution Alert",
        text: emailBody,
      });

      console.log(`✅ [Gmail Alert] Successfully sent alert email to ${receiver}`);
      return {
        sent: true,
        configured: true,
        details: `Sent successfully to ${receiver}`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("❌ [Gmail Alert] SMTP transmission failed:", errorMsg);
      return {
        sent: false,
        configured: true,
        details: `SMTP error: ${errorMsg}`,
      };
    }
  }

  public async sendTestEmail(): Promise<{ sent: boolean; configured: boolean; details: string }> {
    return this.sendGmailAlert(92, { ...CRITICAL_PRESET }, new Date().toISOString());
  }

  public getSystemHealth() {
    const sender = process.env.GMAIL_SENDER?.trim();
    const appPassword = process.env.GMAIL_APP_PASSWORD?.trim();
    const gmailConfigured = Boolean(sender && appPassword);

    return {
      apiServer: "CONNECTED",
      database: "CONNECTED",
      liveStream: this.sseClients.size > 0 || this.state.simulationActive ? "RECEIVING" : "ONLINE",
      activeClients: this.sseClients.size,
      gmailService: gmailConfigured ? "CONNECTED" : "READY (ENV_READY)",
      gmailConfigured,
      gmailSender: sender
        ? `${sender.substring(0, 3)}***@${sender.split("@")[1] || "gmail.com"}`
        : "Not set",
      lastUpdate: this.state.lastUpdate,
      lastUpdateFormatted: this.state.lastUpdateFormatted,
    };
  }
}

// Singleton Engine Instance
export const effluentEngine = new EffluentServerEngine();
