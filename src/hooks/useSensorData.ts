import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import {
  type Level,
  type Reading,
  type SensorKey,
  NORMAL,
  riskScore,
  overallStatus,
} from "@/lib/effluent";

export interface SystemStateSnapshot {
  values: Record<SensorKey, number>;
  risk: number;
  status: Level;
  valve: "OPEN" | "CLOSED";
  relay: "ACTIVE" | "INACTIVE";
  discharge: "ALLOWED" | "BLOCKED";
  mode: "AUTO" | "MANUAL";
  lastUpdate: number;
  lastUpdateFormatted: string;
  lastSource: "ESP32" | "SIMULATION" | "MANUAL_TEST";
  simulationActive?: boolean;
  gmailAlertStatus?: "READY" | "SENT" | "FAILED" | "NOT_CONFIGURED";
}

export interface UseSensorDataOptions {
  endpoint?: string;
  socketUrl?: string;
  protocol?: "auto" | "sse" | "socketio";
  onReading?: (reading: Reading) => void;
  onStateChange?: (state: SystemStateSnapshot) => void;
}

export interface UseSensorDataReturn {
  values: Record<SensorKey, number>;
  risk: number;
  status: Level;
  valve: "OPEN" | "CLOSED";
  relay: "ACTIVE" | "INACTIVE";
  discharge: "ALLOWED" | "BLOCKED";
  mode: "AUTO" | "MANUAL";
  history: Reading[];
  lastUpdate: number;
  lastUpdateFormatted: string;
  lastSource: string;
  isConnected: boolean;
  activeProtocol: "SSE" | "SOCKETIO" | "DISCONNECTED";
  error: Error | null;
  reconnect: () => void;
  emitControlOverride?: (
    action: "VALVE_CLOSE" | "VALVE_OPEN" | "MODE_AUTO" | "MODE_MANUAL",
  ) => void;
}

/**
 * Custom React Hook to consume real-time sensor updates via Flask-SocketIO or SSE.
 * Automatically handles connections, incoming telemetry data points, state snapshots,
 * and maintains continuous UI sync without page reloads.
 */
export function useSensorData(options?: string | UseSensorDataOptions): UseSensorDataReturn {
  const opts: UseSensorDataOptions =
    typeof options === "string" ? { endpoint: options } : options || {};
  const sseEndpoint = opts.endpoint || "/api/stream";
  const socketUrl = opts.socketUrl || "";
  const preferredProtocol = opts.protocol || "auto";

  const onReadingRef = useRef(opts.onReading);
  const onStateChangeRef = useRef(opts.onStateChange);
  useEffect(() => {
    onReadingRef.current = opts.onReading;
    onStateChangeRef.current = opts.onStateChange;
  }, [opts.onReading, opts.onStateChange]);

  const [values, setValues] = useState<Record<SensorKey, number>>({ ...NORMAL });
  const [risk, setRisk] = useState<number>(8);
  const [status, setStatus] = useState<Level>("SAFE");
  const [valve, setValve] = useState<"OPEN" | "CLOSED">("OPEN");
  const [relay, setRelay] = useState<"ACTIVE" | "INACTIVE">("INACTIVE");
  const [discharge, setDischarge] = useState<"ALLOWED" | "BLOCKED">("ALLOWED");
  const [mode, setMode] = useState<"AUTO" | "MANUAL">("AUTO");
  const [history, setHistory] = useState<Reading[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [lastUpdateFormatted, setLastUpdateFormatted] = useState<string>("");
  const [lastSource, setLastSource] = useState<string>("SIMULATION");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [activeProtocol, setActiveProtocol] = useState<"SSE" | "SOCKETIO" | "DISCONNECTED">(
    "DISCONNECTED",
  );
  const [error, setError] = useState<Error | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronize SCADA snapshot
  const applySnapshot = useCallback((s: SystemStateSnapshot, recentReadings?: Reading[]) => {
    if (s) {
      if (s.values) setValues(s.values);
      setRisk(s.risk ?? riskScore(s.values || NORMAL));
      setStatus(s.status ?? overallStatus(s.values || NORMAL));
      setValve(s.valve || (s.status === "CRITICAL" ? "CLOSED" : "OPEN"));
      setRelay(s.relay || (s.status === "CRITICAL" ? "ACTIVE" : "INACTIVE"));
      setDischarge(s.discharge || (s.status === "CRITICAL" ? "BLOCKED" : "ALLOWED"));
      if (s.mode) setMode(s.mode);
      if (s.lastSource) setLastSource(s.lastSource);
      if (s.lastUpdate) setLastUpdate(s.lastUpdate);
      if (s.lastUpdateFormatted) setLastUpdateFormatted(s.lastUpdateFormatted);
      onStateChangeRef.current?.(s);
    }
    if (Array.isArray(recentReadings) && recentReadings.length > 0) {
      setHistory(recentReadings);
    }
  }, []);

  // Apply single reading data point
  const applyReading = useCallback((reading: Reading, nextState?: SystemStateSnapshot) => {
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
      if (reading.source) setLastSource(reading.source);
      onReadingRef.current?.(reading);
    }

    if (nextState) {
      setValve(nextState.valve);
      setRelay(nextState.relay);
      setDischarge(nextState.discharge);
      if (nextState.mode) setMode(nextState.mode);
      onStateChangeRef.current?.(nextState);
    }
  }, []);

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;

    // Cleanup previous connections
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Determine connection method (Socket.IO if socketUrl is specified or protocol is socketio; otherwise SSE)
    if (preferredProtocol === "socketio" || socketUrl) {
      try {
        const socket = io(socketUrl || window.location.origin, {
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 2000,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
          setIsConnected(true);
          setActiveProtocol("SOCKETIO");
          setError(null);
          socket.emit("subscribe_sensors", { channel: "telemetry" });
        });

        socket.on("system_snapshot", (data) => {
          applySnapshot(data.state, data.recentReadings);
        });

        socket.on("sensor_data", (data) => {
          applyReading(data.reading, data.state);
        });

        socket.on("telemetry_update", (data) => {
          applyReading(data.reading, data.state);
        });

        socket.on("state_change", (data) => {
          applySnapshot(data);
        });

        socket.on("disconnect", () => {
          setIsConnected(false);
          setActiveProtocol("DISCONNECTED");
        });

        socket.on("connect_error", (err) => {
          setIsConnected(false);
          setActiveProtocol("DISCONNECTED");
          setError(err);
        });
        return;
      } catch (err: unknown) {
        console.warn("Socket.IO initialization error, falling back to SSE:", err);
      }
    }

    // Default: Connect to SSE stream
    try {
      const es = new EventSource(sseEndpoint);
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setActiveProtocol("SSE");
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "SNAPSHOT") {
            applySnapshot(data.state, data.recentReadings);
          } else if (data.type === "DATA_POINT") {
            applyReading(data.reading, data.state);
          }
        } catch (e) {
          console.error("Error parsing SSE data:", e);
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        setActiveProtocol("DISCONNECTED");
        setError(new Error("Live telemetry stream disconnected. Reconnecting..."));
        es.close();
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };
    } catch (err: unknown) {
      setIsConnected(false);
      setActiveProtocol("DISCONNECTED");
      setError(err instanceof Error ? err : new Error("Failed to initialize SSE EventSource"));
    }
  }, [preferredProtocol, socketUrl, sseEndpoint, applySnapshot, applyReading]);

  const emitControlOverride = useCallback(
    (action: "VALVE_CLOSE" | "VALVE_OPEN" | "MODE_AUTO" | "MODE_MANUAL") => {
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit("control_override", { action });
      } else {
        // REST fallback
        fetch("/api/control/override", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }).catch(console.error);
      }
    },
    [],
  );

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return {
    values,
    risk,
    status,
    valve,
    relay,
    discharge,
    mode,
    history,
    lastUpdate,
    lastUpdateFormatted,
    lastSource,
    isConnected,
    activeProtocol,
    error,
    reconnect: connect,
    emitControlOverride,
  };
}
