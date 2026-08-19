import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { effluentEngine } from "./lib/server-engine";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

async function handleApiRequest(request: Request, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const pathname = url.pathname;

  // 1. SSE Stream for Real-time telemetry
  if (pathname === "/api/stream") {
    let unsubscribe: (() => void) | null = null;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        unsubscribe = effluentEngine.subscribeSSE((data) => {
          try {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            // Client closed connection
          }
        });
      },
      cancel() {
        if (unsubscribe) unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // 2. ESP32 / External Sensor Data Ingestion
  if (pathname === "/api/sensors/data" && request.method === "POST") {
    try {
      const body = await request.json();
      const result = await effluentEngine.processSensorReading(body, "ESP32");
      return jsonResponse({
        success: true,
        riskScore: result.riskScore,
        status: result.status,
        dischargeAllowed: result.dischargeAllowed,
        valve: result.valve,
        relay: result.relay,
        gmailStatus: result.gmailStatus,
        reading: result.reading,
        deviceStatus: effluentEngine.getDeviceStatus(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid sensor payload";
      return jsonResponse({ success: false, error: msg }, 400);
    }
  }

  // 2B. ESP32 Dedicated Heartbeat Ping
  if (pathname === "/api/devices/heartbeat" && request.method === "POST") {
    try {
      const body = (await request.json().catch(() => ({}))) as {
        device_id?: string;
        deviceId?: string;
        rssi?: number;
        battery_voltage?: number;
        batteryVoltage?: number;
        firmware_version?: string;
        firmwareVersion?: string;
        ip_address?: string;
        ipAddress?: string;
      };
      const updated = effluentEngine.registerHeartbeat({
        deviceId: body.device_id || body.deviceId || "ESP32-STATION-01",
        rssi: body.rssi,
        batteryVoltage: body.battery_voltage ?? body.batteryVoltage,
        firmwareVersion: body.firmware_version || body.firmwareVersion,
        ipAddress: body.ip_address || body.ipAddress,
        source: "ESP32_HEARTBEAT",
      });
      return jsonResponse({
        success: true,
        deviceStatus: updated,
        message: "ESP32 heartbeat registered successfully",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to register heartbeat";
      return jsonResponse({ success: false, error: msg }, 400);
    }
  }

  // 2C. Device Status & Heartbeat Monitor
  if (
    (pathname === "/api/devices/status" || pathname === "/api/device/status") &&
    request.method === "GET"
  ) {
    const status = effluentEngine.getDeviceStatus();
    return jsonResponse({
      success: true,
      deviceStatus: status,
      isOffline: status.status === "OFFLINE",
      secondsSinceHeartbeat: status.secondsSinceHeartbeat,
      thresholdSeconds: status.timeoutThresholdSec,
    });
  }

  // 2D. Simulation helper to test >30s connection loss
  if (pathname === "/api/devices/simulate-offline" && request.method === "POST") {
    const status = effluentEngine.simulateDropConnection();
    return jsonResponse({
      success: true,
      message: "ESP32 connection drop simulated (35s timeout elapsed)",
      deviceStatus: status,
    });
  }

  if (pathname === "/api/devices/simulate-online" && request.method === "POST") {
    const status = effluentEngine.registerHeartbeat();
    return jsonResponse({
      success: true,
      message: "ESP32 heartbeat resumed and status set to ONLINE",
      deviceStatus: status,
    });
  }

  // 3. Current Sensor State
  if (
    (pathname === "/api/sensors/current" || pathname === "/api/state") &&
    request.method === "GET"
  ) {
    return jsonResponse({ state: effluentEngine.getState() });
  }

  if (pathname === "/api/health" && request.method === "GET") {
    return jsonResponse({
      status: "ok",
      service: "EFFLUENT DASHBOARD SCADA Engine",
      health: effluentEngine.getSystemHealth(),
    });
  }

  // 4. Historical Sensor Readings
  if (pathname === "/api/sensors/history" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit")) || 100;
    const status = url.searchParams.get("status") || "ALL";
    const readings = effluentEngine.getHistory(limit, status);
    return jsonResponse({ count: readings.length, readings });
  }

  // 5. System Alerts List
  if (pathname === "/api/alerts" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit")) || 50;
    const alerts = effluentEngine.getAlerts(limit);
    return jsonResponse({ alerts });
  }

  // 6. Resolve Alert
  if (
    pathname.startsWith("/api/alerts/") &&
    pathname.endsWith("/resolve") &&
    request.method === "POST"
  ) {
    const parts = pathname.split("/");
    const alertId = parts[3];
    if (alertId) {
      const ok = effluentEngine.resolveAlert(alertId);
      return jsonResponse({ success: ok });
    }
    return jsonResponse({ success: false, error: "Missing alert ID" }, 400);
  }

  // 7. System Analytics & Aggregates
  if (pathname === "/api/analytics" && request.method === "GET") {
    return jsonResponse(effluentEngine.getAnalytics());
  }

  // 7B. Analytics Summary (Daily/Weekly Sensor Averages & Critical Event Counts)
  if (pathname === "/api/analytics/summary" && request.method === "GET") {
    const period = url.searchParams.get("period") || "all";
    const deviceId =
      url.searchParams.get("device_id") ||
      url.searchParams.get("deviceId") ||
      "ESP32-STATION-01";
    const summary = effluentEngine.getAnalyticsSummary(period, deviceId);
    return jsonResponse(summary);
  }

  // 8. Simulation Controls
  if (pathname === "/api/simulation/toggle" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { active?: boolean };
    effluentEngine.setSimulation(Boolean(body.active));
    return jsonResponse({
      success: true,
      simulationActive: effluentEngine.getState().simulationActive,
    });
  }

  if (pathname === "/api/simulation/critical" && request.method === "POST") {
    await effluentEngine.triggerCriticalSimulation();
    return jsonResponse({ success: true, state: effluentEngine.getState() });
  }

  if (pathname === "/api/simulation/reset" && request.method === "POST") {
    await effluentEngine.resetToNormal();
    return jsonResponse({ success: true, state: effluentEngine.getState() });
  }

  if (pathname === "/api/simulation/emergency" && request.method === "POST") {
    await effluentEngine.triggerEmergencySimulation();
    return jsonResponse({ success: true, state: effluentEngine.getState() });
  }

  if (pathname === "/api/control/simulate-preset" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { preset?: string };
    const p = body.preset?.toUpperCase();
    if (p === "EMERGENCY") {
      await effluentEngine.triggerEmergencySimulation();
    } else if (p === "CRITICAL") {
      await effluentEngine.triggerCriticalSimulation();
    } else {
      await effluentEngine.resetToNormal();
    }
    return jsonResponse({ success: true, state: effluentEngine.getState() });
  }

  if (pathname === "/api/analytics/ai-insights" && request.method === "GET") {
    return jsonResponse(effluentEngine.getAiInsights());
  }

  if (pathname === "/api/analytics/predictions" && request.method === "GET") {
    return jsonResponse(effluentEngine.getPredictiveForecast());
  }

  if (pathname === "/api/device/health" && request.method === "GET") {
    return jsonResponse(effluentEngine.getDeviceHealth());
  }

  if (pathname === "/api/system/connection-status" && request.method === "GET") {
    return jsonResponse(effluentEngine.getConnectionStatus());
  }

  if (pathname === "/api/audit-logs" && request.method === "GET") {
    return jsonResponse(effluentEngine.getAuditLogs());
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { email?: string };
    const role = body.email?.includes("admin")
      ? "ADMIN"
      : body.email?.includes("operator")
        ? "OPERATOR"
        : "VIEWER";
    return jsonResponse({
      access_token: `jwt-industrial-token-${Date.now()}`,
      token_type: "bearer",
      role,
      user: {
        email: body.email || "operator@industry.com",
        role,
        station: "Outfall Station Alpha-1",
      },
    });
  }

  // 9. Gmail Test Email
  if (
    (pathname === "/api/email/test" || pathname === "/api/alerts/test-email") &&
    request.method === "POST"
  ) {
    const res = await effluentEngine.sendTestEmail();
    return jsonResponse(res);
  }

  // 10. System Health & Connectivity
  if (pathname === "/api/system/status" && request.method === "GET") {
    return jsonResponse(effluentEngine.getSystemHealth());
  }

  return jsonResponse({ error: "Endpoint not found" }, 404);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        return await handleApiRequest(request, url);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
