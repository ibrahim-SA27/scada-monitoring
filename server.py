"""
Flask-SocketIO Industrial Effluent SCADA Server
Features:
- Core multi-parameter EPA-weighted pollution risk calculation (pH, TDS, Turbidity, Temp, Flow).
- Automatic threshold evaluation and safety actuation (Discharge Valve & Solenoid Relay).
- Smtplib-based Gmail alert notifications triggered on critical threshold breaches.
- Real-time Flask-SocketIO background telemetry loop & WebSocket emission.
- REST ingestion endpoints for ESP32 and industrial hardware sensors.
"""

import os
import time
import math
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "scada-effluent-socketio-secret-2026")
CORS(app, resources={r"/*": {"origins": "*"}})

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    ping_timeout=20,
    ping_interval=10,
    logger=False,
    engineio_logger=False,
)

# Shared SCADA Master State
scada_state = {
    "values": {
        "ph": 7.20,
        "tds": 420.0,
        "turbidity": 18.0,
        "temperature": 28.5,
        "flow": 2.10,
    },
    "risk": 8,
    "status": "SAFE",
    "valve": "OPEN",
    "relay": "INACTIVE",
    "discharge": "ALLOWED",
    "mode": "AUTO",
    "lastUpdate": int(time.time() * 1000),
    "lastUpdateFormatted": datetime.now().strftime("%I:%M:%S %p"),
    "lastSource": "SIMULATION",
    "simulationActive": True,
    "gmailAlertStatus": "READY",
    "lastGmailSentTime": None,
    "totalAlerts": 0,
    "criticalEvents": 0,
    "blockedEvents": 0,
}

history = []
alerts = []
events = []
background_thread = None
critical_incident_email_sent = False

import threading
thread_stop_event = threading.Event()


def send_gmail_alert(score: int, sensor_data: dict, timestamp: str) -> dict:
    """
    Triggers automated Gmail alert via SMTP SSL/TLS using standard smtplib.
    Uses GMAIL_SENDER / GMAIL_APP_PASSWORD from environment variables.
    """
    sender = os.environ.get("GMAIL_SENDER", "").strip() or os.environ.get("GMAIL_USER", "").strip()
    app_password = os.environ.get("GMAIL_APP_PASSWORD", "").strip() or os.environ.get("GMAIL_PASS", "").strip()
    receiver = os.environ.get("GMAIL_RECEIVER", "").strip() or os.environ.get("ALERT_EMAIL_RECIPIENT", "").strip() or sender

    # Remove any accidental whitespace in Google 16-char app password
    if app_password:
        app_password = "".join(app_password.split())

    plain_body = f"""🚨 CRITICAL INDUSTRIAL EFFLUENT POLLUTION ALERT

Pollution Risk Score: {score}/100
Overall Status: CRITICAL
Discharge Status: BLOCKED
Valve State: CLOSED
Safety Relay: ACTIVE

Current Sensor Parameters:
- pH: {sensor_data.get('ph', 0.0)} (Safe limit: 6.5 - 8.5)
- TDS: {sensor_data.get('tds', 0.0)} ppm (Safe limit: < 500 ppm)
- Turbidity: {sensor_data.get('turbidity', 0.0)} NTU (Safe limit: < 25 NTU)
- Temperature: {sensor_data.get('temperature', 0.0)} °C (Safe limit: < 32 °C)
- Flow Rate: {sensor_data.get('flow', 0.0)} L/min (Safe limit: < 3.0 L/min)

Immediate inspection is required at the industrial discharge outlet.
Timestamp: {timestamp}
"""

    if not sender or not app_password or not receiver:
        print(f"ℹ️ [Gmail Alert Triggered] (SMTP not configured in env, alert logged locally):\n{plain_body}")
        return {
            "sent": False,
            "configured": False,
            "details": "Gmail SMTP credentials (GMAIL_SENDER / GMAIL_APP_PASSWORD) not configured in .env",
        }

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🚨 URGENT: Industrial Pollution Threshold Exceeded (Risk {score}/100)"
        msg["From"] = f"Industrial Effluent SCADA <{sender}>"
        msg["To"] = receiver

        # Plaintext version
        part1 = MIMEText(plain_body, "plain")
        msg.attach(part1)

        # Connect to Gmail SMTP Server (port 587 STARTTLS)
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.starttls()
            server.login(sender, app_password)
            server.send_message(msg)

        print(f"✅ [Gmail Alert] Successfully dispatched email alert to {receiver}")
        return {
            "sent": True,
            "configured": True,
            "details": f"Dispatched successfully to {receiver}",
        }
    except Exception as e:
        err_msg = str(e)
        print(f"❌ [Gmail Alert] SMTP transmission failed: {err_msg}")
        return {
            "sent": False,
            "configured": True,
            "details": f"SMTP transmission error: {err_msg}",
        }


def calculate_risk_and_status(values: dict) -> tuple[int, str]:
    """
    Core EPA-weighted multi-parameter pollution risk score calculation (0 - 100).
    Evaluates pH, TDS, Turbidity, Temperature, and Flow Rate against CPCB/EPA guidelines.
    Returns: (risk_score: int, status: 'SAFE' | 'WARNING' | 'CRITICAL')
    """
    ph = float(values.get("ph", 7.0))
    tds = float(values.get("tds", 400.0))
    turbidity = float(values.get("turbidity", 15.0))
    temp = float(values.get("temperature", 28.0))
    flow = float(values.get("flow", 2.0))

    # 1. pH Sub-score (EPA ideal: 6.5 - 8.5)
    if 6.5 <= ph <= 8.5:
        r_ph = 5.0
    elif (6.0 <= ph < 6.5) or (8.5 < ph <= 9.0):
        r_ph = 35.0
    elif (4.0 <= ph < 6.0) or (9.0 < ph <= 10.0):
        r_ph = 70.0
    else:
        r_ph = 100.0

    # 2. TDS Sub-score (ideal < 500 ppm, critical > 1500 ppm)
    if tds <= 500:
        r_tds = 5.0
    elif tds <= 1000:
        r_tds = 35.0
    elif tds <= 1500:
        r_tds = 70.0
    else:
        r_tds = 100.0

    # 3. Turbidity Sub-score (ideal < 25 NTU, critical > 100 NTU)
    if turbidity <= 25:
        r_turb = 5.0
    elif turbidity <= 50:
        r_turb = 35.0
    elif turbidity <= 100:
        r_turb = 70.0
    else:
        r_turb = 100.0

    # 4. Temperature Sub-score (ideal < 32 °C, critical > 42 °C)
    if temp <= 32:
        r_temp = 5.0
    elif temp <= 36:
        r_temp = 35.0
    elif temp <= 42:
        r_temp = 70.0
    else:
        r_temp = 100.0

    # 5. Flow Rate Sub-score (ideal < 3.0 L/min, critical > 5.0 L/min)
    if flow <= 3.0:
        r_flow = 5.0
    elif flow <= 4.0:
        r_flow = 35.0
    elif flow <= 5.0:
        r_flow = 65.0
    else:
        r_flow = 95.0

    # Weighted aggregate score (0 - 100)
    weighted_score = (
        r_ph * 0.30 +
        r_tds * 0.25 +
        r_turb * 0.20 +
        r_temp * 0.15 +
        r_flow * 0.10
    )
    risk = int(round(min(100, max(0, weighted_score))))

    # Deterministic Status Determination
    is_crit = (
        ph < 4.0 or ph > 10.0 or
        tds > 1500 or
        turbidity > 100 or
        temp > 42 or
        flow > 5.0 or
        risk >= 70
    )
    is_warn = (
        ph < 6.0 or ph > 8.8 or
        tds > 800 or
        turbidity > 50 or
        temp > 36 or
        flow > 3.0 or
        risk >= 35
    )

    if is_crit:
        status = "CRITICAL"
    elif is_warn:
        status = "WARNING"
    else:
        status = "SAFE"

    return risk, status


def process_sensor_data(input_values: dict, source: str = "ESP32") -> dict:
    """
    Primary processing pipeline for sensor data:
    1. Validates and normalizes parameters.
    2. Calculates risk score and status.
    3. Handles safety cutoffs (Discharge Valve & Relay).
    4. Triggers Gmail notification on critical threshold violations.
    5. Updates SCADA master state & records history.
    6. Emits real-time WebSocket events.
    """
    global critical_incident_email_sent

    ph = round(float(input_values.get("ph", 7.0)), 2)
    tds = round(float(input_values.get("tds", 400.0)), 1)
    turbidity = round(float(input_values.get("turbidity", 15.0)), 1)
    temperature = round(float(input_values.get("temperature", 28.0)), 1)
    flow = round(float(input_values.get("flow", 2.0)), 2)

    normalized_values = {
        "ph": ph,
        "tds": tds,
        "turbidity": turbidity,
        "temperature": temperature,
        "flow": flow,
    }

    # Calculate Risk Score and Overall Safety Status
    risk, status = calculate_risk_and_status(normalized_values)
    is_critical = (status == "CRITICAL")

    now = datetime.now()
    now_ms = int(time.time() * 1000)
    time_str = now.strftime("%I:%M:%S %p")
    iso_time = now.isoformat()

    prev_status = scada_state["status"]

    # Automated Discharge Cutoff Actuation
    if scada_state.get("mode") != "MANUAL":
        valve = "CLOSED" if is_critical else "OPEN"
        relay = "ACTIVE" if is_critical else "INACTIVE"
        discharge = "BLOCKED" if is_critical else "ALLOWED"
    else:
        valve = scada_state["valve"]
        relay = scada_state["relay"]
        discharge = scada_state["discharge"]

    # Handle Incident Transitions and Gmail Alert Dispatch
    email_status = scada_state.get("gmailAlertStatus", "READY")
    if is_critical:
        if prev_status != "CRITICAL":
            # New Critical Incident Detected
            events.append({
                "id": f"evt-{now_ms}",
                "t": now_ms,
                "timestamp": iso_time,
                "type": "DISCHARGE_BLOCK",
                "description": f"Critical pollution breach (Risk: {risk}/100). Valve CLOSED, Relay ACTIVE, Discharge BLOCKED.",
                "severity": "critical",
            })
            scada_state["criticalEvents"] += 1
            scada_state["blockedEvents"] += 1

            # Dispatch Gmail Alert with anti-spam check
            if not critical_incident_email_sent:
                critical_incident_email_sent = True
                email_res = send_gmail_alert(risk, normalized_values, iso_time)
                email_status = "SENT" if email_res["sent"] else ("FAILED" if email_res["configured"] else "NOT_CONFIGURED")
                scada_state["lastGmailSentTime"] = time_str

                alerts.append({
                    "id": f"alt-{now_ms}",
                    "t": now_ms,
                    "timestamp": iso_time,
                    "time": time_str,
                    "riskScore": risk,
                    "severity": "CRITICAL",
                    "message": "Critical pollution exceeded safe thresholds. Discharge automatically blocked.",
                    "gmailStatus": email_status,
                    "resolved": False,
                })
    else:
        if prev_status == "CRITICAL":
            # Safety Restored
            critical_incident_email_sent = False
            email_status = "READY"
            events.append({
                "id": f"evt-{now_ms}",
                "t": now_ms,
                "timestamp": iso_time,
                "type": "DISCHARGE_RESTORE",
                "description": f"Effluent parameters restored to {status}. Discharge permitted (Valve OPEN).",
                "severity": "info",
            })

    # Update SCADA State
    scada_state.update({
        "values": normalized_values,
        "risk": risk,
        "status": status,
        "valve": valve,
        "relay": relay,
        "discharge": discharge,
        "lastUpdate": now_ms,
        "lastUpdateFormatted": time_str,
        "lastSource": source,
        "gmailAlertStatus": email_status,
    })

    reading = {
        "id": len(history) + 1,
        "t": now_ms,
        "time": time_str,
        "timestamp": iso_time,
        "ph": ph,
        "tds": tds,
        "turbidity": turbidity,
        "temperature": temperature,
        "flow": flow,
        "risk": risk,
        "status": status,
        "source": source,
    }

    history.append(reading)
    if len(history) > 500:
        history.pop(0)

    # Real-Time WebSocket Emission
    socketio.emit("sensor_data", {"reading": reading, "state": scada_state})
    socketio.emit("telemetry_update", {"reading": reading, "state": scada_state})

    return {
        "success": True,
        "riskScore": risk,
        "status": status,
        "dischargeAllowed": discharge == "ALLOWED",
        "valve": valve,
        "relay": relay,
        "gmailStatus": email_status,
        "reading": reading,
    }


def telemetry_event_loop():
    """Background simulator event loop that generates continuous telemetry."""
    step = 0
    while not thread_stop_event.is_set():
        socketio.sleep(2.0)
        step += 1

        if not scada_state.get("simulationActive", True):
            continue

        sine_phase = math.sin(step * 0.1)
        ph = round(7.20 + 0.25 * sine_phase + random.uniform(-0.08, 0.08), 2)
        tds = round(420.0 + 35.0 * math.cos(step * 0.08) + random.uniform(-10.0, 10.0), 1)
        turbidity = round(18.0 + 4.0 * sine_phase + random.uniform(-1.5, 1.5), 1)
        temperature = round(28.5 + 1.2 * math.sin(step * 0.05) + random.uniform(-0.3, 0.3), 1)
        flow = round(2.10 + 0.3 * math.cos(step * 0.12) + random.uniform(-0.1, 0.1), 2)

        # Periodic pulse to demonstrate critical cutoff
        if step % 50 in [48, 49]:
            ph = 4.20
            tds = 1450.0
            turbidity = 92.0
            temperature = 39.5

        process_sensor_data({
            "ph": ph,
            "tds": tds,
            "turbidity": turbidity,
            "temperature": temperature,
            "flow": flow,
        }, source="SIMULATION")


# -------------------------------------------------------------
# Socket.IO Event Handlers
# -------------------------------------------------------------

@socketio.on("connect")
def handle_connect():
    global background_thread
    if background_thread is None:
        thread_stop_event.clear()
        background_thread = socketio.start_background_task(target=telemetry_event_loop)

    emit("system_snapshot", {
        "state": scada_state,
        "recentReadings": history[-30:],
        "alerts": alerts[-10:],
    })
    emit("connection_ack", {
        "status": "connected",
        "service": "Flask-SocketIO Industrial Effluent Engine",
        "timestamp": int(time.time() * 1000)
    })


@socketio.on("subscribe_sensors")
def handle_subscribe_sensors(data=None):
    emit("system_snapshot", {
        "state": scada_state,
        "recentReadings": history[-30:],
        "alerts": alerts[-10:],
    })


@socketio.on("control_override")
def handle_control_override(data):
    action = data.get("action")
    if action == "VALVE_CLOSE":
        scada_state["valve"] = "CLOSED"
        scada_state["relay"] = "ACTIVE"
        scada_state["discharge"] = "BLOCKED"
    elif action == "VALVE_OPEN":
        scada_state["valve"] = "OPEN"
        scada_state["relay"] = "INACTIVE"
        scada_state["discharge"] = "ALLOWED"
    elif action == "MODE_MANUAL":
        scada_state["mode"] = "MANUAL"
    elif action == "MODE_AUTO":
        scada_state["mode"] = "AUTO"

    scada_state["lastUpdate"] = int(time.time() * 1000)
    scada_state["lastUpdateFormatted"] = datetime.now().strftime("%I:%M:%S %p")

    socketio.emit("state_change", scada_state)
    return {"success": True, "state": scada_state}


# -------------------------------------------------------------
@app.route("/")
def home():
    return "Effluent Dashboard is running!"


@app.route("/api/health", methods=["GET"])
def health():
    sender = os.environ.get("GMAIL_SENDER", "").strip() or os.environ.get("GMAIL_USER", "").strip()
    return jsonify({
        "status": "ok",
        "service": "Flask-SocketIO SCADA Server",
        "telemetryLoopActive": background_thread is not None,
        "gmailConfigured": bool(sender),
        "lastUpdate": scada_state["lastUpdateFormatted"]
    })


@app.route("/api/sensors/data", methods=["POST"])
def ingest_sensor_data():
    """ESP32 Hardware Ingestion & Risk Scoring Endpoint."""
    payload = request.get_json() or {}
    source = payload.get("source", "ESP32")
    result = process_sensor_data(payload, source=source)
    return jsonify(result)


@app.route("/api/sensors/current", methods=["GET"])
def get_current_sensors():
    return jsonify({"state": scada_state})


@app.route("/api/sensors/history", methods=["GET"])
def get_sensor_history():
    limit = int(request.args.get("limit", 100))
    return jsonify({"history": history[-limit:], "total": len(history)})


@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    return jsonify({"alerts": alerts[-50:]})


@app.route("/api/alerts/test-email", methods=["POST"])
def test_email():
    """Trigger manual test email."""
    test_values = {
        "ph": 3.8,
        "tds": 1680.0,
        "turbidity": 125.0,
        "temperature": 44.0,
        "flow": 5.4,
    }
    result = send_gmail_alert(94, test_values, datetime.now().isoformat())
    return jsonify(result)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
