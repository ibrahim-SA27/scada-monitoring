"""
Flask Industrial Effluent Monitoring Backend with Flask-SocketIO
Supports real-time ESP32 sensor telemetry ingestion, automated pollution risk scoring,
automatic discharge cutoff control, smtplib Gmail alerts, and live WebSocket & SSE streaming.
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
from flask import Flask, Response, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit

load_dotenv()

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "effluent-scada-secret-key-2026")
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

# SCADA State
system_state = {
    "values": {
        "ph": 7.20,
        "tds": 430.0,
        "turbidity": 18.0,
        "temperature": 29.0,
        "flow": 2.1,
    },
    "risk": 8,
    "status": "SAFE",
    "valve": "OPEN",
    "relay": "INACTIVE",
    "discharge": "ALLOWED",
    "mode": "AUTO",
    "lastUpdate": int(time.time() * 1000),
    "lastUpdateFormatted": datetime.now().strftime("%I:%M:%S %p"),
    "lastSource": "ESP32",
    "simulationActive": True,
    "gmailAlertStatus": "READY",
    "lastGmailSentTime": None,
}

history = []
alerts = []
critical_incident_email_sent = False


def send_gmail_alert(score: int, sensor_data: dict, timestamp: str) -> dict:
    """Dispatches automated Gmail alerts via SMTP."""
    sender = os.environ.get("GMAIL_SENDER", "").strip() or os.environ.get("GMAIL_USER", "").strip()
    app_password = os.environ.get("GMAIL_APP_PASSWORD", "").strip() or os.environ.get("GMAIL_PASS", "").strip()
    receiver = os.environ.get("GMAIL_RECEIVER", "").strip() or os.environ.get("ALERT_EMAIL_RECIPIENT", "").strip() or sender

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
            "details": "Gmail SMTP credentials not configured in environment",
        }

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🚨 URGENT: Industrial Pollution Threshold Exceeded (Risk {score}/100)"
        msg["From"] = f"Industrial Effluent SCADA <{sender}>"
        msg["To"] = receiver
        msg.attach(MIMEText(plain_body, "plain"))

        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.starttls()
            server.login(sender, app_password)
            server.send_message(msg)

        print(f"✅ [Gmail Alert] Successfully sent alert email to {receiver}")
        return {"sent": True, "configured": True, "details": f"Sent to {receiver}"}
    except Exception as e:
        print(f"❌ [Gmail Alert] SMTP error: {e}")
        return {"sent": False, "configured": True, "details": str(e)}


def calculate_risk(values: dict) -> tuple[int, str]:
    """EPA-weighted multi-parameter pollution risk score calculation (0 - 100)."""
    ph = float(values.get("ph", 7.0))
    tds = float(values.get("tds", 400.0))
    turbidity = float(values.get("turbidity", 15.0))
    temp = float(values.get("temperature", 28.0))
    flow = float(values.get("flow", 2.0))

    # pH score
    if 6.5 <= ph <= 8.5:
        r_ph = 5.0
    elif (6.0 <= ph < 6.5) or (8.5 < ph <= 9.0):
        r_ph = 35.0
    elif (4.0 <= ph < 6.0) or (9.0 < ph <= 10.0):
        r_ph = 70.0
    else:
        r_ph = 100.0

    # TDS score
    if tds <= 500:
        r_tds = 5.0
    elif tds <= 1000:
        r_tds = 35.0
    elif tds <= 1500:
        r_tds = 70.0
    else:
        r_tds = 100.0

    # Turbidity score
    if turbidity <= 25:
        r_turb = 5.0
    elif turbidity <= 50:
        r_turb = 35.0
    elif turbidity <= 100:
        r_turb = 70.0
    else:
        r_turb = 100.0

    # Temperature score
    if temp <= 32:
        r_temp = 5.0
    elif temp <= 36:
        r_temp = 35.0
    elif temp <= 42:
        r_temp = 70.0
    else:
        r_temp = 100.0

    # Flow rate score
    if flow <= 3.0:
        r_flow = 5.0
    elif flow <= 4.0:
        r_flow = 35.0
    elif flow <= 5.0:
        r_flow = 65.0
    else:
        r_flow = 95.0

    weighted_score = (
        r_ph * 0.30 +
        r_tds * 0.25 +
        r_turb * 0.20 +
        r_temp * 0.15 +
        r_flow * 0.10
    )
    risk = int(round(min(100, max(0, weighted_score))))

    is_critical = (
        ph < 4.0 or ph > 10.0 or
        tds > 1500 or
        turbidity > 100 or
        temp > 42 or
        flow > 5.0 or
        risk >= 70
    )
    is_warning = (
        ph < 6.0 or ph > 8.8 or
        tds > 800 or
        turbidity > 50 or
        temp > 36 or
        flow > 3.0 or
        risk >= 35
    )

    if is_critical:
        return risk, "CRITICAL"
    elif is_warning:
        return risk, "WARNING"
    return risk, "SAFE"


@app.route("/api/sensors/data", methods=["POST"])
def ingest_sensor_data():
    """Endpoint for ESP32 and industrial hardware telemetry ingestion."""
    global critical_incident_email_sent

    payload = request.get_json() or {}
    ph = float(payload.get("ph", system_state["values"]["ph"]))
    tds = float(payload.get("tds", system_state["values"]["tds"]))
    turbidity = float(payload.get("turbidity", system_state["values"]["turbidity"]))
    temperature = float(payload.get("temperature", system_state["values"]["temperature"]))
    flow = float(payload.get("flow", system_state["values"]["flow"]))

    values = {
        "ph": round(ph, 2),
        "tds": round(tds, 1),
        "turbidity": round(turbidity, 1),
        "temperature": round(temperature, 1),
        "flow": round(flow, 2),
    }
    risk, status = calculate_risk(values)

    now = datetime.now()
    now_ms = int(time.time() * 1000)
    time_str = now.strftime("%I:%M:%S %p")
    iso_time = now.isoformat()

    prev_status = system_state["status"]
    is_crit = (status == "CRITICAL")

    email_status = system_state.get("gmailAlertStatus", "READY")
    if is_crit:
        if prev_status != "CRITICAL":
            # Send alert email if threshold exceeded
            if not critical_incident_email_sent:
                critical_incident_email_sent = True
                res = send_gmail_alert(risk, values, iso_time)
                email_status = "SENT" if res["sent"] else ("FAILED" if res["configured"] else "NOT_CONFIGURED")
                system_state["lastGmailSentTime"] = time_str
    else:
        if prev_status == "CRITICAL":
            critical_incident_email_sent = False
            email_status = "READY"

    if system_state.get("mode") != "MANUAL":
        system_state.update({
            "values": values,
            "risk": risk,
            "status": status,
            "valve": "CLOSED" if is_crit else "OPEN",
            "relay": "ACTIVE" if is_crit else "INACTIVE",
            "discharge": "BLOCKED" if is_crit else "ALLOWED",
            "lastUpdate": now_ms,
            "lastUpdateFormatted": time_str,
            "lastSource": payload.get("source", "ESP32"),
            "gmailAlertStatus": email_status,
        })
    else:
        system_state.update({
            "values": values,
            "risk": risk,
            "status": status,
            "lastUpdate": now_ms,
            "lastUpdateFormatted": time_str,
            "lastSource": payload.get("source", "ESP32"),
            "gmailAlertStatus": email_status,
        })

    reading = {
        "id": len(history) + 1,
        "t": now_ms,
        "time": time_str,
        "ph": ph,
        "tds": tds,
        "turbidity": turbidity,
        "temperature": temperature,
        "flow": flow,
        "risk": risk,
        "status": status,
        "source": payload.get("source", "ESP32"),
    }
    history.append(reading)

    socketio.emit("sensor_data", {"reading": reading, "state": system_state})

    return jsonify({
        "success": True,
        "riskScore": risk,
        "status": status,
        "dischargeAllowed": system_state["discharge"] == "ALLOWED",
        "valve": system_state["valve"],
        "relay": system_state["relay"],
        "gmailStatus": email_status,
    })


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "Flask-SocketIO Effluent SCADA Engine",
        "lastUpdate": system_state["lastUpdateFormatted"]
    })


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
