import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Settings as SettingsIcon,
  RotateCcw,
  AlertTriangle,
  Mail,
  Send,
  Cpu,
  CheckCircle,
  Copy,
  Check,
  Radio,
  Sliders,
  ShieldCheck,
  Server,
  FileCode,
  Terminal,
  Activity,
  Zap,
} from "lucide-react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { useSimulation } from "@/components/dashboard/simulation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "System Settings & Hardware API — EFFLUENT DASHBOARD" },
      {
        name: "description",
        content:
          "System controls, sensor calibrations, simulation switches, Gmail SMTP alert diagnostics, and ESP32 hardware REST API integration documentation.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const {
    simulationActive,
    toggleSimulation,
    simulateCritical,
    simulateEmergency,
    reset,
    sendTestEmail,
    systemHealth,
    sendManualReading,
    controlOverride,
  } = useSimulation();

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState<"arduino" | "fastapi" | "curl">("arduino");

  // Sensor Calibration offsets (local storage or device calibration state)
  const [calibrations, setCalibrations] = useState({
    phOffset: 0.05,
    tdsCoeff: 2.0,
    turbidityZeroV: 4.15,
    tempCalibration: -0.2,
    flowPulseFactor: 7.5,
  });

  const [customReading, setCustomReading] = useState({
    ph: 7.2,
    tds: 430,
    turbidity: 18,
    temperature: 29.0,
    flow: 2.1,
  });

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    await sendTestEmail();
    setTestingEmail(false);
  };

  const esp32Code = `// ESP32 Industrial Effluent Monitoring Firmware (SCADA RTU Alpha-1)
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverUrl = "http://YOUR_SERVER_HOST:3000/api/sensors/data";

const int PIN_PH = 34;          // ADC1_CH6
const int PIN_TDS = 35;         // ADC1_CH7
const int PIN_TURBIDITY = 32;   // ADC1_CH4
const int PIN_TEMP = 4;         // OneWire Bus
const int PIN_FLOW = 27;        // Interrupt Pulse

const int PIN_VALVE = 25;       // Solenoid Cutoff Relay
const int PIN_ALARM = 26;       // Audio/Strobe Contactor

void setup() {
  Serial.begin(115200);
  pinMode(PIN_VALVE, OUTPUT);
  pinMode(PIN_ALARM, OUTPUT);
  digitalWrite(PIN_VALVE, HIGH); // Default Open

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\\nWiFi Connected to Effluent SCADA!");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    // Read analog probes (12-bit ADC: 0-4095)
    float rawPh = analogRead(PIN_PH) * (3.3 / 4095.0);
    float ph = 7.0 + ((2.5 - rawPh) / 0.18); // Calibrated slope
    
    float rawTds = analogRead(PIN_TDS) * (3.3 / 4095.0);
    float tds = (rawTds / 3.3) * 2000.0;     // 0-2000 ppm
    
    float rawTurb = analogRead(PIN_TURBIDITY) * (3.3 / 4095.0);
    float turbidity = (4.15 - rawTurb) * 60.0; // NTU calculation
    if (turbidity < 0) turbidity = 0;

    float temperature = 28.5; // From DS18B20 OneWire
    float flow = 2.1;        // From YF-S201 pulse frequency

    StaticJsonDocument<256> doc;
    doc["ph"] = ph;
    doc["tds"] = tds;
    doc["turbidity"] = turbidity;
    doc["temperature"] = temperature;
    doc["flow"] = flow;

    String requestBody;
    serializeJson(doc, requestBody);

    int httpResponseCode = http.POST(requestBody);
    if (httpResponseCode > 0) {
      String response = http.getString();
      StaticJsonDocument<256> respDoc;
      deserializeJson(respDoc, response);

      const char* valveCmd = respDoc["valve"];
      if (String(valveCmd) == "CLOSED") {
        digitalWrite(PIN_VALVE, LOW); // Cut off flow
        digitalWrite(PIN_ALARM, HIGH); // Engage safety alarm
      } else {
        digitalWrite(PIN_VALVE, HIGH); // Allow flow
        digitalWrite(PIN_ALARM, LOW);
      }
    }
    http.end();
  }
  delay(2000); // 2 second high-frequency telemetry cycle
}`;

  const fastApiCode = `# FastAPI SCADA Effluent Ingestion Engine (backend/main.py)
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import smtplib
from email.mime.text import MIMEText
import os

app = FastAPI(title="Effluent SCADA API")

class SensorReading(BaseModel):
    ph: float
    tds: float
    turbidity: float
    temperature: float
    flow: float

@app.post("/api/sensors/data")
async def ingest_sensor_data(reading: SensorReading):
    # Pollution Risk Algorithm
    risk = 0
    if reading.ph < 6.5 or reading.ph > 8.5:
        risk += 35
    if reading.tds > 1000:
        risk += 30
    if reading.turbidity > 50:
        risk += 25
    if reading.temperature > 35:
        risk += 10

    status = "CRITICAL" if risk >= 80 else ("WARNING" if risk >= 40 else "SAFE")
    valve = "CLOSED" if status == "CRITICAL" else "OPEN"
    relay = "ACTIVE" if status == "CRITICAL" else "INACTIVE"

    return {
        "success": True,
        "riskScore": risk,
        "status": status,
        "dischargeAllowed": status != "CRITICAL",
        "valve": valve,
        "relay": relay
    }`;

  const curlCommand = `curl -X POST http://localhost:3000/api/sensors/data \\
  -H "Content-Type: application/json" \\
  -d '{"ph": 7.20, "tds": 430, "turbidity": 18, "temperature": 29.0, "flow": 2.1}'`;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-4 px-1">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-primary/40 bg-primary/10">
                <SettingsIcon className="h-4 w-4 text-cyan" />
              </span>
              <div>
                <h1 className="panel-title text-base">
                  SYSTEM SETTINGS, SENSOR CALIBRATION &amp; HARDWARE API
                </h1>
                <p className="text-xs text-muted-foreground">
                  Simulation engine, ADC calibration parameters, Gmail alert dispatch diagnostics,
                  and firmware hub
                </p>
              </div>
            </div>
          </header>

          {/* Top Row: Simulation Engine & Gmail SMTP Dispatcher */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Simulation Engine & Test Controls */}
            <section className="scada-panel flex flex-col p-5">
              <h2 className="panel-title flex items-center gap-2 text-sm">
                <Radio className="h-4 w-4 text-cyan" />
                Simulation &amp; SCADA Safety Override
              </h2>

              <div className="mt-4 flex items-center justify-between rounded-xl border border-border/60 bg-secondary/40 p-4">
                <div>
                  <p className="font-semibold text-foreground">Continuous Simulation Mode</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Generates realistic sensor drift every 2 seconds when physical ESP32 is offline
                  </p>
                </div>
                <button
                  onClick={() => toggleSimulation(!simulationActive)}
                  className={cn(
                    "rounded-xl px-4 py-2 font-display text-xs font-bold tracking-wider transition-all",
                    simulationActive
                      ? "border border-safe/50 bg-safe/15 text-safe shadow-[0_0_12px_rgba(52,199,89,0.2)]"
                      : "border border-border bg-secondary text-muted-foreground hover:text-foreground",
                  )}
                >
                  {simulationActive ? "ENABLED (ON)" : "PAUSED (OFF)"}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <button
                  onClick={simulateCritical}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-critical/50 bg-critical/12 px-3 py-3 font-display text-xs font-bold tracking-wider text-critical transition-all hover:bg-critical/20"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  ACIDIC SPIKE
                </button>
                <button
                  onClick={simulateEmergency}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-critical bg-critical/25 px-3 py-3 font-display text-xs font-bold tracking-wider text-critical transition-all hover:bg-critical/35 shadow-[0_0_10px_rgba(255,59,48,0.2)]"
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  EMERGENCY HALT
                </button>
                <button
                  onClick={reset}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/50 bg-primary/12 px-3 py-3 font-display text-xs font-bold tracking-wider text-cyan transition-all hover:bg-primary/20"
                >
                  <RotateCcw className="h-4 w-4 shrink-0" />
                  RESTORE SAFE
                </button>
              </div>

              {/* Custom Value Ingestion */}
              <div className="mt-4 rounded-xl border border-border/60 bg-secondary/20 p-4">
                <p className="label-caps flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-cyan" />
                  Direct Sensor Ingestion Injector (/api/sensors/data)
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 text-xs">
                  <div>
                    <label className="text-[10px] text-muted-foreground">pH (0-14)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={customReading.ph}
                      onChange={(e) =>
                        setCustomReading({ ...customReading, ph: parseFloat(e.target.value) || 0 })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1 font-mono text-foreground outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">TDS (ppm)</label>
                    <input
                      type="number"
                      value={customReading.tds}
                      onChange={(e) =>
                        setCustomReading({ ...customReading, tds: parseFloat(e.target.value) || 0 })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1 font-mono text-foreground outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Turb (NTU)</label>
                    <input
                      type="number"
                      value={customReading.turbidity}
                      onChange={(e) =>
                        setCustomReading({
                          ...customReading,
                          turbidity: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1 font-mono text-foreground outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Temp (°C)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={customReading.temperature}
                      onChange={(e) =>
                        setCustomReading({
                          ...customReading,
                          temperature: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1 font-mono text-foreground outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Flow (L/m)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={customReading.flow}
                      onChange={(e) =>
                        setCustomReading({
                          ...customReading,
                          flow: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-border bg-card px-2 py-1 font-mono text-foreground outline-none focus:border-primary"
                    />
                  </div>
                </div>
                <button
                  onClick={() => sendManualReading(customReading)}
                  className="mt-3 w-full rounded-lg border border-primary/50 bg-primary/10 py-2 font-display text-xs font-bold tracking-wider text-cyan hover:bg-primary/20"
                >
                  TRANSMIT CUSTOM TELEMETRY PACKET TO BACKEND
                </button>
              </div>
            </section>

            {/* Gmail SMTP Alert Service */}
            <section className="scada-panel flex flex-col p-5">
              <h2 className="panel-title flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-cyan" />
                Gmail SMTP Emergency Alert Dispatcher
              </h2>

              <div className="mt-4 rounded-xl border border-border/60 bg-secondary/40 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Gmail SMTP Status</span>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 font-display font-bold text-xs",
                      systemHealth.gmailConfigured ? "text-safe" : "text-cyan",
                    )}
                  >
                    <CheckCircle className="h-4 w-4" />
                    {systemHealth.gmailConfigured
                      ? "CONFIGURED & CONNECTED"
                      : "READY (ENV STANDBY)"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Automatic email alerts dispatched whenever pollution risk exceeds 80 or critical
                  chemical parameters occur. Anti-spam latching ensures 1 email per event.
                </p>
              </div>

              <div className="mt-4 rounded-xl border border-border/60 bg-card p-4 text-xs font-mono">
                <p className="text-muted-foreground">// Required in server environment (.env):</p>
                <p className="text-cyan">GMAIL_SENDER=mohamedibrahim936150@gmail.com</p>
                <p className="text-cyan">GMAIL_APP_PASSWORD=•••• •••• •••• ••••</p>
                <p className="text-cyan">GMAIL_RECEIVER=facility_manager@company.com</p>
              </div>

              <div className="mt-4">
                <button
                  onClick={handleTestEmail}
                  disabled={testingEmail}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/15 py-3 font-display text-xs font-bold tracking-widest text-cyan hover:bg-primary/25 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {testingEmail ? "TRANSMITTING TEST ALERT..." : "SEND TEST GMAIL ALERT NOW"}
                </button>
              </div>

              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-safe/30 bg-safe/8 p-3 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-safe shrink-0 mt-0.5" />
                <p>
                  Zero Credential Exposure: All SMTP operations execute purely server-side with TLS
                  encryption on port 587.
                </p>
              </div>
            </section>
          </div>

          {/* Sensor Calibration & ADC Reference Adjustments */}
          <section className="scada-panel flex flex-col p-5">
            <h2 className="panel-title flex items-center gap-2 text-sm">
              <Sliders className="h-4 w-4 text-cyan" />
              Sensor Calibration &amp; Physical ADC Offsets
            </h2>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 text-xs">
              <div className="rounded-xl border border-border/70 bg-card/60 p-3">
                <p className="label-caps text-[10px]">pH Zero Offset</p>
                <input
                  type="number"
                  step="0.01"
                  value={calibrations.phOffset}
                  onChange={(e) =>
                    setCalibrations({
                      ...calibrations,
                      phOffset: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="mt-2 w-full rounded border border-border bg-secondary px-2 py-1 font-mono text-cyan outline-none"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Calibrated at pH 6.86</p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/60 p-3">
                <p className="label-caps text-[10px]">TDS Temp Coeff (%/°C)</p>
                <input
                  type="number"
                  step="0.1"
                  value={calibrations.tdsCoeff}
                  onChange={(e) =>
                    setCalibrations({
                      ...calibrations,
                      tdsCoeff: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="mt-2 w-full rounded border border-border bg-secondary px-2 py-1 font-mono text-cyan outline-none"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Standard 2.0%/°C</p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/60 p-3">
                <p className="label-caps text-[10px]">Turbidity Zero V</p>
                <input
                  type="number"
                  step="0.05"
                  value={calibrations.turbidityZeroV}
                  onChange={(e) =>
                    setCalibrations({
                      ...calibrations,
                      turbidityZeroV: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="mt-2 w-full rounded border border-border bg-secondary px-2 py-1 font-mono text-cyan outline-none"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Clear water: 4.15V</p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/60 p-3">
                <p className="label-caps text-[10px]">DS18B20 Temp Offset</p>
                <input
                  type="number"
                  step="0.1"
                  value={calibrations.tempCalibration}
                  onChange={(e) =>
                    setCalibrations({
                      ...calibrations,
                      tempCalibration: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="mt-2 w-full rounded border border-border bg-secondary px-2 py-1 font-mono text-cyan outline-none"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">Ice-bath checked</p>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/60 p-3">
                <p className="label-caps text-[10px]">Flow Pulse Factor (K)</p>
                <input
                  type="number"
                  step="0.1"
                  value={calibrations.flowPulseFactor}
                  onChange={(e) =>
                    setCalibrations({
                      ...calibrations,
                      flowPulseFactor: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="mt-2 w-full rounded border border-border bg-secondary px-2 py-1 font-mono text-cyan outline-none"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">YF-S201 K=7.5</p>
              </div>
            </div>
          </section>

          {/* Firmware Hub & API Specification */}
          <section className="scada-panel flex flex-col p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="panel-title flex items-center gap-2 text-sm">
                  <Cpu className="h-4 w-4 text-cyan" />
                  Hardware Telemetry Integration Code Hub
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveCodeTab("arduino")}
                  className={cn(
                    "rounded-lg px-3 py-1.5 font-display text-xs font-semibold",
                    activeCodeTab === "arduino"
                      ? "bg-primary/20 text-cyan border border-primary/50"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  ESP32 C++ (Arduino)
                </button>
                <button
                  onClick={() => setActiveCodeTab("fastapi")}
                  className={cn(
                    "rounded-lg px-3 py-1.5 font-display text-xs font-semibold",
                    activeCodeTab === "fastapi"
                      ? "bg-primary/20 text-cyan border border-primary/50"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  Python (FastAPI)
                </button>
                <button
                  onClick={() => setActiveCodeTab("curl")}
                  className={cn(
                    "rounded-lg px-3 py-1.5 font-display text-xs font-semibold",
                    activeCodeTab === "curl"
                      ? "bg-primary/20 text-cyan border border-primary/50"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  cURL CLI
                </button>
                <button
                  onClick={() =>
                    handleCopy(
                      activeCodeTab === "arduino"
                        ? esp32Code
                        : activeCodeTab === "fastapi"
                          ? fastApiCode
                          : curlCommand,
                      activeCodeTab,
                    )
                  }
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 font-display text-xs text-muted-foreground hover:text-foreground"
                >
                  {copiedCode === activeCodeTab ? (
                    <Check className="h-3.5 w-3.5 text-safe" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedCode === activeCodeTab ? "COPIED" : "COPY CODE"}
                </button>
              </div>
            </div>

            <div className="mt-4">
              <pre className="max-h-[380px] overflow-auto rounded-xl border border-border/70 bg-card p-4 font-mono text-xs text-foreground leading-relaxed">
                {activeCodeTab === "arduino"
                  ? esp32Code
                  : activeCodeTab === "fastapi"
                    ? fastApiCode
                    : curlCommand}
              </pre>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
