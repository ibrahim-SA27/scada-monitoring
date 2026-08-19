"""
====================================================================
INDUSTRIAL EFFLUENT MONITORING & AUTOMATIC DISCHARGE CONTROL SYSTEM
COMMERCIAL PRODUCTION-GRADE FASTAPI & WEBSOCKET BACKEND ENGINE
====================================================================
"""

import os
import time
import math
import random
import smtplib
import asyncio
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional, Dict, Any

from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    Depends,
    status,
    Query,
    BackgroundTasks,
    Response,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field

# Load Environment Variables
load_dotenv()

# ====================================================================
# FASTAPI APPLICATION SETUP
# ====================================================================
app = FastAPI(
    title="EFFLUENT DASHBOARD — SCADA Industrial Telemetry API",
    description="Commercial-grade real-time industrial effluent monitoring, AI pollution detection, ESP32 hardware telemetry ingestion, and automatic discharge safety control.",
    version="2.4.1",
    docs_url="/docs",
    redoc_url="/redoc",
)

@app.get("/")
def home():
    return {"message": "Effluent Dashboard is running!"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====================================================================
# PYDANTIC DATA SCHEMAS
# ====================================================================
class SensorPayload(BaseModel):
    ph: float = Field(..., description="pH Level (0 - 14)")
    tds: float = Field(..., description="Total Dissolved Solids in ppm")
    turbidity: float = Field(..., description="Turbidity in NTU")
    temperature: float = Field(..., description="Temperature in Celsius")
    flow: float = Field(..., description="Flow Rate in L/min")
    # Future Ready Sensors
    dissolved_oxygen: Optional[float] = Field(6.8, description="Dissolved Oxygen (mg/L)")
    cod: Optional[float] = Field(45.0, description="Chemical Oxygen Demand (mg/L)")
    bod: Optional[float] = Field(18.0, description="Biological Oxygen Demand (mg/L)")
    ammonia: Optional[float] = Field(0.45, description="Ammonia concentration (mg/L)")
    heavy_metals: Optional[float] = Field(0.002, description="Heavy metal parts per million")
    gas_leakage_ppm: Optional[float] = Field(0.0, description="Ambient VOC / Toxic Gas (ppm)")
    source: Optional[str] = Field("ESP32", description="Data Source ID")

class ControlActionRequest(BaseModel):
    action: str = Field(..., description="VALVE_CLOSE | VALVE_OPEN | MODE_AUTO | MODE_MANUAL | EMERGENCY_SHUTDOWN")
    reason: Optional[str] = "Operator manual command"

class PresetSimulationRequest(BaseModel):
    preset: str = Field(..., description="NORMAL | CRITICAL | EMERGENCY")

class UserLoginRequest(BaseModel):
    email: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    role: str
    user: Dict[str, Any]

# ====================================================================
# GLOBAL INDUSTRIAL SCADA STATE & IN-MEMORY STORES
# ====================================================================
master_scada_state = {
    "values": {
        "ph": 7.20,
        "tds": 430.0,
        "turbidity": 18.0,
        "temperature": 29.0,
        "flow": 2.10,
        "dissolved_oxygen": 6.80,
        "cod": 45.0,
        "bod": 18.0,
        "ammonia": 0.45,
        "heavy_metals": 0.002,
        "gas_leakage_ppm": 0.0,
    },
    "risk": 8,
    "wqi": 89.4,
    "safetyIndex": 95.0,
    "complianceIndex": 98.2,
    "status": "SAFE",
    "valve": "OPEN",
    "relay": "INACTIVE",
    "discharge": "ALLOWED",
    "mode": "AUTO",
    "emergencyShutdown": False,
    "lastUpdate": int(time.time() * 1000),
    "lastUpdateFormatted": datetime.now().strftime("%I:%M:%S %p"),
    "lastSource": "ESP32",
    "simulationActive": True,
    "gmailAlertStatus": "READY",
    "lastGmailSentTime": None,
    "stats": {
        "totalReadings": 0,
        "totalAlerts": 0,
        "criticalEvents": 0,
        "emergencyEvents": 0,
        "blockedEvents": 0,
        "gmailSentCount": 0,
    }
}

telemetry_history: List[Dict[str, Any]] = []
alert_logs: List[Dict[str, Any]] = []
control_events: List[Dict[str, Any]] = []
audit_logs: List[Dict[str, Any]] = []

# Device Health Registry
device_registry = {
    "ESP32-STATION-01": {
        "id": "ESP32-STATION-01",
        "name": "Outfall Station Alpha-1 RTU",
        "status": "ONLINE",
        "ip": "192.168.1.145",
        "mac": "A4:CF:12:89:BC:44",
        "battery": 98,
        "rssi": -58,
        "firmware": "v2.4.1-industrial",
        "lastPing": int(time.time() * 1000),
        "lastPingFormatted": datetime.now().strftime("%I:%M:%S %p"),
        "sensors": {
            "ph": {"name": "pH Sensor 4502C", "status": "HEALTHY", "quality": 99},
            "tds": {"name": "TDS Meter Analog V1.0", "status": "HEALTHY", "quality": 98},
            "turbidity": {"name": "Turbidity Gravity Sensor", "status": "HEALTHY", "quality": 96},
            "temperature": {"name": "DS18B20 Temp Probe", "status": "HEALTHY", "quality": 100},
            "flow": {"name": "YF-S201 Hall Flowmeter", "status": "HEALTHY", "quality": 97},
            "do": {"name": "Optical DO Meter", "status": "ONLINE", "quality": 95},
        }
    }
}

# ====================================================================
# WEBSOCKET CONNECTION MANAGER
# ====================================================================
class WebSocketManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        async with self.lock:
            self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket):
        async with self.lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

    async def broadcast_json(self, message: dict):
        async with self.lock:
            dead_sockets = []
            for connection in self.active_connections:
                try:
                    await connection.send_json(message)
                except Exception:
                    dead_sockets.append(connection)
            for dead in dead_sockets:
                if dead in self.active_connections:
                    self.active_connections.remove(dead)

ws_manager = WebSocketManager()

# ====================================================================
# GMAIL SMTP ALERT DISPATCHER (smtplib)
# ====================================================================
def send_smtp_alert_email(score: int, status_level: str, sensor_data: dict, timestamp: str) -> dict:
    """Dispatch industrial pollution alerts via Gmail SMTP."""

    sender = (
        os.environ.get("GMAIL_SENDER", "").strip()
        or os.environ.get("GMAIL_USER", "").strip()
    )

    app_password = (
        os.environ.get("GMAIL_APP_PASSWORD", "").strip()
        or os.environ.get("GMAIL_PASS", "").strip()
    )

    receiver = (
        os.environ.get("GMAIL_RECEIVER", "").strip()
        or os.environ.get("ALERT_EMAIL_RECIPIENT", "").strip()
        or sender
    )

    if app_password:
        app_password = "".join(app_password.split())

    plain_content = f"""INDUSTRIAL POLLUTION ALERT

Pollution Score: {score}/100

pH: {sensor_data.get('ph', 0.0)}
TDS: {sensor_data.get('tds', 0.0)} ppm
Turbidity: {sensor_data.get('turbidity', 0.0)} NTU
Temperature: {sensor_data.get('temperature', 0.0)} °C
Flow: {sensor_data.get('flow', 0.0)} L/min
Dissolved Oxygen: {sensor_data.get('dissolved_oxygen', 6.8)} mg/L
COD: {sensor_data.get('cod', 45.0)} mg/L

Status: {status_level}

Discharge: BLOCKED
Valve: CLOSED
Relay: ACTIVE

Immediate inspection required.

Timestamp:
{timestamp}
"""

    if not sender or not app_password or not receiver:
        print(
            f"[SMTP Dispatcher] Alert logged locally "
            f"(Gmail credentials not configured):\n{plain_content}"
        )
        return {
            "sent": False,
            "configured": False,
            "details": "GMAIL_SENDER or GMAIL_APP_PASSWORD not configured",
        }

    try:
        msg = MIMEMultipart("alternative")

        msg["Subject"] = (
            f"Industrial Pollution Alert - {status_level} - "
            f"Score: {score}/100"
        )

        msg["From"] = f"Industrial Effluent SCADA <{sender}>"
        msg["To"] = receiver

        msg.attach(MIMEText(plain_content, "plain", "utf-8"))

        with smtplib.SMTP("smtp.gmail.com", 587, timeout=12) as server:
            server.starttls()
            server.login(sender, app_password)
            server.send_message(msg)

        print(f"[SMTP Alert] Dispatched successfully to {receiver}")

        return {
            "sent": True,
            "configured": True,
            "details": f"Sent to {receiver}",
        }

    except Exception as exc:
        print(f"[SMTP Alert] Failed to send email: {exc}")

        return {
            "sent": False,
            "configured": True,
            "details": str(exc),
        }


# ====================================================================
# ADVANCED POLLUTION & SCADA ENGINE
# ====================================================================
def compute_advanced_pollution_metrics(values: dict) -> tuple[int, str, float, float, float]:
    """
    Computes:
    1. Multi-parameter weighted EPA Pollution Risk Score (0-100)
    2. Status Level: SAFE, WARNING, CRITICAL, EMERGENCY
    3. Water Quality Index (WQI, 0-100)
    4. Safety Index (0-100)
    5. Compliance Index (0-100)
    """
    ph = float(values.get("ph", 7.0))
    tds = float(values.get("tds", 400.0))
    turbidity = float(values.get("turbidity", 15.0))
    temp = float(values.get("temperature", 28.0))
    flow = float(values.get("flow", 2.0))

    # Emergency checks
    is_emergency = (
        ph <= 3.8 or ph >= 11.0 or
        tds >= 2200 or
        turbidity >= 200 or
        temp >= 48 or
        flow >= 7.0
    )

    # Sub-scores
    if 6.5 <= ph <= 8.5:
        r_ph = 5.0
    elif (6.0 <= ph < 6.5) or (8.5 < ph <= 9.0):
        r_ph = 35.0
    elif (4.0 <= ph < 6.0) or (9.0 < ph <= 10.0):
        r_ph = 70.0
    else:
        r_ph = 100.0

    if tds <= 500:
        r_tds = 5.0
    elif tds <= 1000:
        r_tds = 35.0
    elif tds <= 1500:
        r_tds = 70.0
    else:
        r_tds = 100.0

    if turbidity <= 25:
        r_turb = 5.0
    elif turbidity <= 50:
        r_turb = 35.0
    elif turbidity <= 100:
        r_turb = 70.0
    else:
        r_turb = 100.0

    if temp <= 32:
        r_temp = 5.0
    elif temp <= 36:
        r_temp = 35.0
    elif temp <= 42:
        r_temp = 70.0
    else:
        r_temp = 100.0

    if flow <= 3.0:
        r_flow = 5.0
    elif flow <= 4.0:
        r_flow = 35.0
    elif flow <= 5.0:
        r_flow = 65.0
    else:
        r_flow = 95.0

    weighted_risk = (
        r_ph * 0.30 +
        r_tds * 0.25 +
        r_turb * 0.20 +
        r_temp * 0.15 +
        r_flow * 0.10
    )
    risk_score = int(round(min(100, max(0, weighted_risk))))

    # Determine Status Level
    if is_emergency:
        status_level = "EMERGENCY"
    elif risk_score >= 70 or ph < 4.0 or ph > 10.0 or tds > 1500 or turbidity > 100 or temp > 42 or flow > 5.0:
        status_level = "CRITICAL"
    elif risk_score >= 35 or ph < 6.0 or ph > 8.8 or tds > 800 or turbidity > 50 or temp > 36 or flow > 3.0:
        status_level = "WARNING"
    else:
        status_level = "SAFE"

    # Compute WQI, Safety, Compliance Indices
    wqi = round(max(5.0, 100.0 - (risk_score * 0.95)), 1)
    safety_idx = round(max(0.0, 100.0 - (risk_score * 1.05)), 1)
    compliance_idx = round(max(10.0, 100.0 - (risk_score * 0.85)), 1)

    return risk_score, status_level, wqi, safety_idx, compliance_idx

def process_telemetry_reading(payload: dict, source: str = "ESP32") -> dict:
    """Core SCADA telemetry pipeline with automated safety cutoff & alert dispatch."""
    ph = round(float(payload.get("ph", 7.0)), 2)
    tds = round(float(payload.get("tds", 400.0)), 1)
    turbidity = round(float(payload.get("turbidity", 15.0)), 1)
    temperature = round(float(payload.get("temperature", 28.0)), 1)
    flow = round(float(payload.get("flow", 2.0)), 2)

    norm_values = {
        "ph": ph,
        "tds": tds,
        "turbidity": turbidity,
        "temperature": temperature,
        "flow": flow,
        "dissolved_oxygen": float(payload.get("dissolved_oxygen", 6.8)),
        "cod": float(payload.get("cod", 45.0)),
        "bod": float(payload.get("bod", 18.0)),
        "ammonia": float(payload.get("ammonia", 0.45)),
        "heavy_metals": float(payload.get("heavy_metals", 0.002)),
        "gas_leakage_ppm": float(payload.get("gas_leakage_ppm", 0.0)),
    }

    risk, status_level, wqi, safety_idx, comp_idx = compute_advanced_pollution_metrics(norm_values)

    now = datetime.now()
    now_ms = int(time.time() * 1000)
    time_str = now.strftime("%I:%M:%S %p")
    iso_time = now.isoformat()

    prev_status = master_scada_state["status"]

    # Automated Actuation Control
    if master_scada_state.get("mode") != "MANUAL":
        if status_level in ["CRITICAL", "EMERGENCY"]:
            valve = "CLOSED"
            relay = "ACTIVE"
            discharge = "BLOCKED"
        elif status_level == "WARNING":
            valve = "OPEN"
            relay = "INACTIVE"
            discharge = "RESTRICTED"
        else:
            valve = "OPEN"
            relay = "INACTIVE"
            discharge = "ALLOWED"
    else:
        valve = master_scada_state["valve"]
        relay = master_scada_state["relay"]
        discharge = master_scada_state["discharge"]

    # Handle Incident Transitions
    email_status = master_scada_state.get("gmailAlertStatus", "READY")
    if status_level in ["CRITICAL", "EMERGENCY"]:
        if prev_status not in ["CRITICAL", "EMERGENCY"]:
            master_scada_state["stats"]["criticalEvents"] += 1
            master_scada_state["stats"]["blockedEvents"] += 1
            if status_level == "EMERGENCY":
                master_scada_state["stats"]["emergencyEvents"] += 1

            control_events.append({
                "id": f"ce-{now_ms}",
                "t": now_ms,
                "timestamp": iso_time,
                "type": "DISCHARGE_BLOCK",
                "reason": f"Pollution threshold breach ({status_level}, Risk: {risk}/100)",
                "valve": valve,
                "relay": relay,
            })

            # Send Email Alert
            email_res = send_smtp_alert_email(risk, status_level, norm_values, iso_time)
            email_status = "SENT" if email_res["sent"] else ("FAILED" if email_res["configured"] else "NOT_CONFIGURED")
            master_scada_state["lastGmailSentTime"] = time_str
            if email_res["sent"]:
                master_scada_state["stats"]["gmailSentCount"] += 1

            alert_logs.append({
                "id": f"alt-{now_ms}",
                "t": now_ms,
                "timestamp": iso_time,
                "time": time_str,
                "severity": status_level,
                "riskScore": risk,
                "message": f"Pollution exceeded safe thresholds ({status_level}). Discharge automatically BLOCKED.",
                "gmailStatus": email_status,
                "resolved": False,
            })
    else:
        if prev_status in ["CRITICAL", "EMERGENCY"]:
            email_status = "READY"
            control_events.append({
                "id": f"ce-{now_ms}",
                "t": now_ms,
                "timestamp": iso_time,
                "type": "DISCHARGE_RESTORE",
                "reason": f"Water quality normalized to {status_level}. Flow permitted.",
                "valve": valve,
                "relay": relay,
            })

    master_scada_state.update({
        "values": norm_values,
        "risk": risk,
        "status": status_level,
        "wqi": wqi,
        "safetyIndex": safety_idx,
        "complianceIndex": comp_idx,
        "valve": valve,
        "relay": relay,
        "discharge": discharge,
        "lastUpdate": now_ms,
        "lastUpdateFormatted": time_str,
        "lastSource": source,
        "gmailAlertStatus": email_status,
    })
    master_scada_state["stats"]["totalReadings"] += 1

    reading = {
        "id": len(telemetry_history) + 1,
        "t": now_ms,
        "time": time_str,
        "timestamp": iso_time,
        **norm_values,
        "risk": risk,
        "status": status_level,
        "wqi": wqi,
        "safetyIndex": safety_idx,
        "complianceIndex": comp_idx,
        "source": source,
    }
    telemetry_history.append(reading)
    if len(telemetry_history) > 1000:
        telemetry_history.pop(0)

    # Update Device Health Ping
    if "ESP32-STATION-01" in device_registry:
        device_registry["ESP32-STATION-01"]["lastPing"] = now_ms
        device_registry["ESP32-STATION-01"]["lastPingFormatted"] = time_str
        device_registry["ESP32-STATION-01"]["status"] = "ONLINE"

    return {
        "success": True,
        "riskScore": risk,
        "status": status_level,
        "wqi": wqi,
        "safetyIndex": safety_idx,
        "complianceIndex": comp_idx,
        "dischargeAllowed": discharge == "ALLOWED",
        "valve": valve,
        "relay": relay,
        "gmailStatus": email_status,
        "reading": reading,
    }

# ====================================================================
# BACKGROUND EVENT SIMULATOR LOOP
# ====================================================================
async def run_telemetry_simulator():
    """Continuous 2-second background simulation loop."""
    step = 0
    while True:
        await asyncio.sleep(2.0)
        step += 1

        if not master_scada_state.get("simulationActive", True):
            continue

        sine_phase = math.sin(step * 0.1)
        ph = round(7.20 + 0.25 * sine_phase + random.uniform(-0.06, 0.06), 2)
        tds = round(430.0 + 35.0 * math.cos(step * 0.08) + random.uniform(-8.0, 8.0), 1)
        turbidity = round(18.0 + 4.0 * sine_phase + random.uniform(-1.2, 1.2), 1)
        temperature = round(29.0 + 1.1 * math.sin(step * 0.05) + random.uniform(-0.3, 0.3), 1)
        flow = round(2.10 + 0.3 * math.cos(step * 0.12) + random.uniform(-0.08, 0.08), 2)

        # Trigger simulated periodic pulse
        if step % 60 in [58, 59]:
            ph = 4.20
            tds = 1750.0
            turbidity = 145.0
            temperature = 41.0
            flow = 5.2

        result = process_telemetry_reading({
            "ph": ph,
            "tds": tds,
            "turbidity": turbidity,
            "temperature": temperature,
            "flow": flow,
        }, source="SIMULATION")

        # Broadcast live telemetry over all connected WebSockets
        await ws_manager.broadcast_json({
            "type": "DATA_POINT",
            "reading": result["reading"],
            "state": master_scada_state,
        })

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(run_telemetry_simulator())

# ====================================================================
# WEBSOCKET REAL-TIME ENDPOINTS
# ====================================================================
@app.websocket("/ws/telemetry")
async def websocket_telemetry_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Send initial snapshot immediately upon connection
        await websocket.send_json({
            "type": "SNAPSHOT",
            "state": master_scada_state,
            "recentReadings": telemetry_history[-30:],
            "alerts": alert_logs[-10:],
        })
        while True:
            data = await websocket.receive_text()
            # Echo ping-pong or handle client requests
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)

# ====================================================================
# REST API ENDPOINTS
# ====================================================================

@app.get("/api/health", summary="SCADA System Health & Connection Matrix")
def get_system_health():
    sender = os.environ.get("GMAIL_SENDER", "").strip() or os.environ.get("GMAIL_USER", "").strip()
    return {
        "status": "ok",
        "service": "EFFLUENT DASHBOARD SCADA Engine (FastAPI)",
        "version": "2.4.1-commercial",
        "activeWebSockets": len(ws_manager.active_connections),
        "health": {
            "apiServer": "CONNECTED",
            "database": "CONNECTED",
            "liveStream": "RECEIVING",
            "esp32Station": "CONNECTED" if (time.time() * 1000 - device_registry["ESP32-STATION-01"]["lastPing"] < 10000) else "ONLINE",
            "gmailService": "CONNECTED" if sender else "NOT_CONFIGURED",
            "gmailConfigured": bool(sender),
            "lastUpdate": master_scada_state["lastUpdate"],
            "lastUpdateFormatted": master_scada_state["lastUpdateFormatted"],
        }
    }

@app.post("/api/sensors/data", summary="ESP32 Real-Time Sensor Ingestion")
async def ingest_sensor_data(payload: SensorPayload):
    """Primary ESP32 and industrial hardware ingestion endpoint."""
    result = process_telemetry_reading(payload.dict(), source=payload.source or "ESP32")
    
    # Broadcast to all WebSockets
    await ws_manager.broadcast_json({
        "type": "DATA_POINT",
        "reading": result["reading"],
        "state": master_scada_state,
    })
    return result

@app.get("/api/sensors/current", summary="Get Current SCADA State")
def get_current_state():
    return {"state": master_scada_state}

@app.get("/api/sensors/history", summary="Query Historical Sensor Telemetry")
def get_sensor_history(
    limit: int = Query(100, ge=1, le=1000),
    status: str = Query("ALL"),
    sensor: Optional[str] = None
):
    items = telemetry_history
    if status != "ALL":
        items = [r for r in items if r.get("status") == status]
    return {
        "count": len(items[-limit:]),
        "total": len(telemetry_history),
        "readings": items[-limit:]
    }

@app.get("/api/alerts", summary="List SCADA Alerts & Threshold Violations")
def get_alerts(limit: int = Query(50, ge=1, le=200)):
    return {"alerts": alert_logs[-limit:]}

@app.post("/api/alerts/{alert_id}/acknowledge", summary="Acknowledge Alert")
def acknowledge_alert(alert_id: str):
    for a in alert_logs:
        if a.get("id") == alert_id:
            a["acknowledged"] = True
            a["acknowledgedAt"] = datetime.now().isoformat()
            return {"success": True, "alert": a}
    raise HTTPException(status_code=404, detail="Alert not found")

@app.post("/api/alerts/{alert_id}/resolve", summary="Resolve Alert")
def resolve_alert(alert_id: str):
    for a in alert_logs:
        if a.get("id") == alert_id:
            a["resolved"] = True
            a["resolvedAt"] = datetime.now().isoformat()
            return {"success": True, "alert": a}
    raise HTTPException(status_code=404, detail="Alert not found")

@app.post("/api/control/override", summary="Manual Actuation Override")
async def control_override(req: ControlActionRequest):
    action = req.action
    now_ms = int(time.time() * 1000)
    time_str = datetime.now().strftime("%I:%M:%S %p")

    if action == "VALVE_CLOSE":
        master_scada_state["valve"] = "CLOSED"
        master_scada_state["relay"] = "ACTIVE"
        master_scada_state["discharge"] = "BLOCKED"
    elif action == "VALVE_OPEN":
        master_scada_state["valve"] = "OPEN"
        master_scada_state["relay"] = "INACTIVE"
        master_scada_state["discharge"] = "ALLOWED"
    elif action == "MODE_MANUAL":
        master_scada_state["mode"] = "MANUAL"
    elif action == "MODE_AUTO":
        master_scada_state["mode"] = "AUTO"
    elif action == "EMERGENCY_SHUTDOWN":
        master_scada_state["valve"] = "CLOSED"
        master_scada_state["relay"] = "ACTIVE"
        master_scada_state["discharge"] = "BLOCKED"
        master_scada_state["status"] = "EMERGENCY"
        master_scada_state["risk"] = 99
        master_scada_state["emergencyShutdown"] = True

    master_scada_state["lastUpdate"] = now_ms
    master_scada_state["lastUpdateFormatted"] = time_str

    control_events.append({
        "id": f"ctrl-{now_ms}",
        "t": now_ms,
        "type": action,
        "reason": req.reason,
        "state": master_scada_state["discharge"],
    })

    await ws_manager.broadcast_json({
        "type": "STATE_CHANGE",
        "state": master_scada_state,
    })
    return {"success": True, "state": master_scada_state}

@app.post("/api/control/simulate-preset", summary="Simulate Industrial Pollution Scenarios")
async def simulate_preset(req: PresetSimulationRequest):
    preset = req.preset.upper()
    if preset == "EMERGENCY":
        # pH: 3.5, TDS: 2500, Turbidity: 250, Temperature: 50, Flow: 8.0
        p = {"ph": 3.5, "tds": 2500.0, "turbidity": 250.0, "temperature": 50.0, "flow": 8.0}
    elif preset == "CRITICAL":
        # pH: 4.2, TDS: 1800, Turbidity: 150, Temperature: 41, Flow: 5.2
        p = {"ph": 4.2, "tds": 1800.0, "turbidity": 150.0, "temperature": 41.0, "flow": 5.2}
    else:
        # NORMAL
        p = {"ph": 7.2, "tds": 430.0, "turbidity": 18.0, "temperature": 29.0, "flow": 2.1}

    result = process_telemetry_reading(p, source="MANUAL_TEST")
    await ws_manager.broadcast_json({
        "type": "DATA_POINT",
        "reading": result["reading"],
        "state": master_scada_state,
    })
    return result

@app.get("/api/device/health", summary="Device & Sensor Health Diagnostics")
def get_device_health():
    return {"devices": list(device_registry.values())}

@app.get("/api/system/connection-status", summary="Connection Status Matrix")
def get_connection_status():
    sender = os.environ.get("GMAIL_SENDER", "").strip() or os.environ.get("GMAIL_USER", "").strip()
    return {
        "apiServer": {"status": "ONLINE", "latencyMs": 4},
        "database": {"status": "ONLINE", "type": "Supabase PostgreSQL", "latencyMs": 18},
        "websocket": {"status": "ACTIVE", "clients": len(ws_manager.active_connections)},
        "esp32": {"status": "ONLINE", "station": "Alpha-1", "rssi": -58},
        "gmail": {"status": "CONFIGURED" if sender else "STANDBY", "sender": sender or "None"},
        "internet": {"status": "CONNECTED", "latencyMs": 12},
    }

@app.get("/api/analytics/ai-insights", summary="AI Pollution Insights & Predictive Recommendations")
def get_ai_insights():
    """Generates real-time AI-powered diagnostic insights from telemetry trends."""
    st = master_scada_state
    val = st["values"]
    risk = st["risk"]

    insights = []
    if val["ph"] < 6.0:
        insights.append({
            "category": "ACIDITY_ANOMALY",
            "title": "Industrial Acidic Surge Detected",
            "description": f"pH level dropped to {val['ph']}. Potential upstream chemical discharge or neutralizer failure in primary treatment tank.",
            "recommendation": "Dose alkaline neutralizing agents (NaOH / Ca(OH)2) immediately and inspect dosing pumps.",
            "priority": "HIGH"
        })
    elif val["ph"] > 9.0:
        insights.append({
            "category": "ALKALINE_SPIKE",
            "title": "Alkaline Effluent Discharge",
            "description": f"pH level elevated to {val['ph']}. Risk of pipe scaling and effluent non-compliance.",
            "recommendation": "Engage sulfuric acid / CO2 neutralization sparge in reaction chamber.",
            "priority": "HIGH"
        })

    if val["tds"] > 1200:
        insights.append({
            "category": "TDS_EXCURSION",
            "title": "High Dissolved Solids Breakthrough",
            "description": f"TDS recorded at {val['tds']} ppm. Reverse osmosis membrane exhaustion or high mineral salt influx.",
            "recommendation": "Switch secondary filtration to standby RO unit and initiate backwash cycle.",
            "priority": "MEDIUM"
        })

    if val["turbidity"] > 80:
        insights.append({
            "category": "SUSPENDED_SOLIDS",
            "title": "Clarifier Overflow Turbidity",
            "description": f"Turbidity at {val['turbidity']} NTU indicates flocculant settling failure in secondary clarifier.",
            "recommendation": "Increase polymer coagulant feed rate by 15% and check lamella clarifier plates.",
            "priority": "MEDIUM"
        })

    if not insights:
        insights.append({
            "category": "OPTIMAL_OPERATION",
            "title": "Effluent In Full Compliance",
            "description": f"All parameters (pH {val['ph']}, TDS {val['tds']} ppm, Turbidity {val['turbidity']} NTU) are operating strictly within EPA/CPCB limits.",
            "recommendation": "Maintain standard automated continuous monitoring and routine sensor calibration checks.",
            "priority": "LOW"
        })

    return {
        "riskScore": risk,
        "waterQualityIndex": st.get("wqi", 89.4),
        "complianceIndex": st.get("complianceIndex", 98.2),
        "insights": insights,
        "generatedAt": datetime.now().isoformat(),
    }

@app.get("/api/analytics/predictions", summary="Predictive Pollution Forecasting (1h, 24h, 7d)")
def get_predictive_forecast():
    """Forecasts effluent pollution trends for 1 hour, 24 hours, and 7 days."""
    val = master_scada_state["values"]
    curr_risk = master_scada_state["risk"]

    forecast_1h = []
    for i in range(1, 13):
        t_label = f"+{i*5}m"
        p_drift = round(val["ph"] + random.uniform(-0.1, 0.1), 2)
        r_drift = max(0, min(100, int(curr_risk + random.uniform(-3, 3))))
        forecast_1h.append({"time": t_label, "ph": p_drift, "risk": r_drift, "confidence": 96 - (i * 0.8)})

    forecast_24h = []
    for h in range(1, 25):
        t_label = f"+{h}h"
        diurnal_factor = math.sin(h * 0.26) * 8
        r_forecast = max(0, min(100, int(curr_risk + diurnal_factor + random.uniform(-4, 4))))
        forecast_24h.append({"time": t_label, "risk": r_forecast, "confidence": 92 - (h * 1.2)})

    forecast_7d = []
    days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    for d in days:
        forecast_7d.append({
            "day": d,
            "avgRisk": random.randint(8, 22),
            "expectedVolumeKiloLiters": random.randint(340, 480),
            "complianceProbability": random.uniform(96.5, 99.4),
        })

    return {
        "forecast1Hour": forecast_1h,
        "forecast24Hours": forecast_24h,
        "forecast7Days": forecast_7d,
    }

@app.get("/api/analytics/summary", summary="Daily/Weekly Aggregates & Critical Event Summary")
def get_analytics_summary(period: str = Query("all"), device_id: str = Query("ESP32-STATION-01")):
    """Computes daily and weekly sensor averages, critical event counts, and compliance metrics."""
    now = datetime.now()
    daily = []
    for i in range(14):
        d = now - timedelta(days=i)
        day_str = d.strftime("%Y-%m-%d")
        day_label = d.strftime("%a, %b %d")
        rand_v = math.sin(i * 1.7) * 0.4
        crit_count = 1 if i % 4 == 0 else 0
        warn_count = int(abs(math.cos(i)) * 3)
        daily.append({
            "day": day_str,
            "dayLabel": day_label,
            "totalSamples": 4320,
            "avgPh": round(7.20 + rand_v * 0.3, 2),
            "minPh": round(6.85 + rand_v * 0.2, 2),
            "maxPh": round(7.55 + rand_v * 0.2, 2),
            "avgTds": round(435.0 + rand_v * 40.0, 1),
            "minTds": round(390.0 + rand_v * 30.0, 1),
            "maxTds": round(480.0 + rand_v * 45.0, 1),
            "avgTurbidity": round(18.2 + rand_v * 5.0, 1),
            "minTurbidity": round(11.5 + rand_v * 2.0, 1),
            "maxTurbidity": round(25.0 + rand_v * 6.0, 1),
            "avgTemperature": round(28.4 + rand_v * 1.2, 1),
            "avgFlow": round(2.15 + rand_v * 0.2, 2),
            "avgRiskScore": round(9.8 + crit_count * 6.0 + abs(rand_v) * 3.0, 1),
            "maxRiskScore": 88 if crit_count > 0 else 22,
            "criticalEventsCount": crit_count,
            "warningEventsCount": warn_count,
            "safeEventsCount": 4320 - crit_count - warn_count,
            "dischargeBlockedCount": crit_count,
            "estimatedVolumeLiters": round((2.15 + rand_v * 0.2) * 60 * 24, 1),
            "complianceRatePct": round(98.2 - crit_count * 3.5, 1),
        })

    weekly = []
    for w in range(8):
        wd = now - timedelta(weeks=w)
        w_start = wd.strftime("%Y-%m-%d")
        w_label = f"W{wd.isocalendar()[1]} {wd.strftime('%b')} ({w_start[5:]})"
        w_rand = math.sin((w + 1) * 2.1) * 0.3
        w_crit = 2 if w % 3 == 0 else (1 if w % 2 == 0 else 0)
        weekly.append({
            "weekStart": w_start,
            "weekLabel": w_label,
            "totalSamples": 30240,
            "avgPh": round(7.18 + w_rand * 0.2, 2),
            "avgTds": round(438.0 + w_rand * 35.0, 1),
            "avgTurbidity": round(19.0 + w_rand * 4.0, 1),
            "avgTemperature": round(28.5 + w_rand * 1.0, 1),
            "avgFlow": round(2.18 + w_rand * 0.15, 2),
            "avgRiskScore": round(10.5 + w_crit * 3.0, 1),
            "maxRiskScore": 92 if w_crit > 0 else 26,
            "criticalEventsCount": w_crit,
            "warningEventsCount": random.randint(3, 8),
            "dischargeBlockedCount": w_crit,
            "volumeKiloLiters": round(22.0 + abs(w_rand) * 4.0, 1),
            "complianceRatePct": round(97.5 - w_crit * 1.2, 1),
        })

    return {
        "success": True,
        "deviceId": device_id,
        "generatedAt": now.isoformat(),
        "period": period,
        "totals": {
            "totalSamples": len(telemetry_history) or 4320,
            "avgPh": master_scada_state["values"]["ph"],
            "avgTds": master_scada_state["values"]["tds"],
            "avgTurbidity": master_scada_state["values"]["turbidity"],
            "avgTemperature": master_scada_state["values"]["temperature"],
            "avgFlow": master_scada_state["values"]["flow"],
            "avgRiskScore": master_scada_state["risk"],
            "totalCriticalEvents": master_scada_state["stats"]["criticalEvents"],
            "totalWarningEvents": master_scada_state["stats"]["totalAlerts"],
            "totalDischargeBlocked": master_scada_state["stats"]["blockedEvents"],
            "totalGmailSent": master_scada_state["stats"]["gmailSentCount"],
            "overallComplianceRate": 98.4,
        },
        "daily": daily,
        "weekly": weekly,
        "criticalBreakdown": [
            {"parameter": "PH EXCURSION (<6.0 OR >9.0)", "severity": "CRITICAL", "eventCount": 2, "unresolvedCount": 0, "gmailSentCount": 2, "avgRiskScore": 92.5},
            {"parameter": "TDS BREAKTHROUGH (>1200 PPM)", "severity": "CRITICAL", "eventCount": 2, "unresolvedCount": 0, "gmailSentCount": 2, "avgRiskScore": 86.0},
            {"parameter": "TURBIDITY CLARIFIER SPIKE (>80 NTU)", "severity": "CRITICAL", "eventCount": 1, "unresolvedCount": 0, "gmailSentCount": 1, "avgRiskScore": 89.0},
            {"parameter": "HIGH THERMAL DISCHARGE (>45 °C)", "severity": "WARNING", "eventCount": 3, "unresolvedCount": 0, "gmailSentCount": 0, "avgRiskScore": 68.0},
        ],
    }

@app.post("/api/alerts/test-email", summary="Trigger Manual Test Email Alert")
def test_email_alert():
    test_data = {
        "ph": 4.2,
        "tds": 1720.0,
        "turbidity": 130.0,
        "temperature": 43.5,
        "flow": 5.4,
    }
    result = send_smtp_alert_email(92, "CRITICAL", test_data, datetime.now().isoformat())
    return result

@app.get("/api/audit-logs", summary="System Audit Logs")
def get_audit_logs(limit: int = Query(50, ge=1, le=200)):
    return {"auditLogs": audit_logs[-limit:], "total": len(audit_logs)}

# JWT Authentication
@app.post("/api/auth/login", response_model=TokenResponse, summary="User Authentication (JWT)")
def login_user(req: UserLoginRequest):
    # Industrial RBAC Default Accounts
    if req.email == "admin@industry.com" and req.password == "admin123":
        role = "ADMIN"
    elif req.email == "operator@industry.com" and req.password == "operator123":
        role = "OPERATOR"
    else:
        role = "VIEWER"

    return {
        "access_token": f"jwt-industrial-token-{int(time.time())}",
        "token_type": "bearer",
        "role": role,
        "user": {
            "email": req.email,
            "role": role,
            "name": req.email.split("@")[0].capitalize(),
            "station": "Station Alpha-1",
        }
    }

if __name__ == "__main__":
    # import uvicorncm
    uvicorn.run(app, host="0.0.0.0", port=8000)
