-- ====================================================================
-- EFFLUENT SCADA — SUPABASE POSTGRESQL PRODUCTION MIGRATION SCRIPT
-- Tables: sensor_readings, alerts, control_events
-- Features: Real-Time Analytics Indexes, RLS Policies, Realtime Pubs
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS & DOMAINS
DO $$ BEGIN
    CREATE TYPE sensor_status_enum AS ENUM ('SAFE', 'WARNING', 'CRITICAL', 'EMERGENCY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE valve_state_enum AS ENUM ('OPEN', 'CLOSED', 'PARTIAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE relay_state_enum AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE discharge_state_enum AS ENUM ('ALLOWED', 'RESTRICTED', 'BLOCKED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ====================================================================
-- 3. SENSOR READINGS TABLE (HIGH-FREQUENCY TIME-SERIES TELEMETRY)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL DEFAULT 'ESP32-STATION-01',
    ph NUMERIC(5, 2) NOT NULL CHECK (ph >= 0.0 AND ph <= 14.0),
    tds NUMERIC(8, 2) NOT NULL CHECK (tds >= 0.0),
    turbidity NUMERIC(8, 2) NOT NULL CHECK (turbidity >= 0.0),
    temperature NUMERIC(5, 2) NOT NULL,
    flow NUMERIC(6, 2) NOT NULL CHECK (flow >= 0.0),
    -- Extended SCADA & Safety Telemetry
    dissolved_oxygen NUMERIC(5, 2) DEFAULT 6.80,
    cod NUMERIC(8, 2) DEFAULT 45.0,
    bod NUMERIC(8, 2) DEFAULT 18.0,
    ammonia NUMERIC(6, 2) DEFAULT 0.45,
    heavy_metals NUMERIC(6, 4) DEFAULT 0.0020,
    gas_leakage_ppm NUMERIC(6, 2) DEFAULT 0.0,
    risk_score INT NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
    status sensor_status_enum NOT NULL DEFAULT 'SAFE',
    valve_state valve_state_enum NOT NULL DEFAULT 'OPEN',
    relay_state relay_state_enum NOT NULL DEFAULT 'INACTIVE',
    discharge_state discharge_state_enum NOT NULL DEFAULT 'ALLOWED',
    source VARCHAR(50) DEFAULT 'ESP32-RTU',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Comments on Columns
COMMENT ON TABLE public.sensor_readings IS 'High-frequency continuous industrial effluent sensor stream';
COMMENT ON COLUMN public.sensor_readings.risk_score IS 'Computed EPA compliance risk score (0-100)';
COMMENT ON COLUMN public.sensor_readings.discharge_state IS 'SCADA gate status (ALLOWED | RESTRICTED | BLOCKED)';

-- ====================================================================
-- 4. ALERTS TABLE (INCIDENTS, EPA BREACHES & GMAIL DISPATCH LOGS)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.alerts (
    id VARCHAR(100) PRIMARY KEY DEFAULT ('ALT-' || to_char(timezone('utc'::text, now()), 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 6)),
    reading_id BIGINT REFERENCES public.sensor_readings(id) ON DELETE SET NULL,
    device_id VARCHAR(50) NOT NULL DEFAULT 'ESP32-STATION-01',
    severity sensor_status_enum NOT NULL,
    risk_score INT NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    parameter VARCHAR(50) NOT NULL,
    value VARCHAR(50) NOT NULL,
    threshold_limit VARCHAR(50),
    message TEXT NOT NULL,
    location VARCHAR(100) DEFAULT 'Outfall Station Alpha-1',
    gmail_status VARCHAR(20) DEFAULT 'QUEUED' CHECK (gmail_status IN ('QUEUED', 'SENT', 'FAILED', 'NOT_REQUIRED')),
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by VARCHAR(100),
    acknowledged_at TIMESTAMPTZ,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.alerts IS 'Pollution threshold violations, emergency hazard alarms, and email dispatch status';

-- ====================================================================
-- 5. CONTROL EVENTS TABLE (VALVE, RELAY & OPERATOR AUDIT TRAIL)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.control_events (
    id VARCHAR(100) PRIMARY KEY DEFAULT ('EVT-' || to_char(timezone('utc'::text, now()), 'YYYYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 6)),
    device_id VARCHAR(50) NOT NULL DEFAULT 'ESP32-STATION-01',
    event_type VARCHAR(50) NOT NULL, -- 'VALVE_CLOSE', 'VALVE_OPEN', 'RELAY_ENGAGE', 'RELAY_DISENGAGE', 'EMERGENCY_SHUTDOWN'
    triggered_by VARCHAR(50) NOT NULL DEFAULT 'SYSTEM_AUTO', -- 'SYSTEM_AUTO' | 'OPERATOR_OVERRIDE' | 'SAFETY_INTERLOCK'
    previous_state VARCHAR(50),
    new_state VARCHAR(50),
    risk_score INT DEFAULT 0,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.control_events IS 'SCADA actuator actions, solenoid valve triggers, and operator manual overrides';

-- ====================================================================
-- 5B. DEVICE STATUS & HEARTBEAT MONITOR TABLE
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.device_status (
    device_id VARCHAR(50) PRIMARY KEY DEFAULT 'ESP32-STATION-01',
    status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'STANDBY')),
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    heartbeat_interval_sec INT NOT NULL DEFAULT 2,
    timeout_threshold_sec INT NOT NULL DEFAULT 30,
    ip_address VARCHAR(45) DEFAULT '192.168.1.105',
    firmware_version VARCHAR(20) DEFAULT 'v2.4.1',
    rssi INT DEFAULT -65,
    battery_voltage NUMERIC(4, 2) DEFAULT 3.30,
    uptime_seconds BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE public.device_status IS 'Real-time ESP32 RTU connectivity, heartbeat timestamps, and offline watchdog tracking';

-- ====================================================================
-- 6. HIGH-PERFORMANCE INDEXES FOR REAL-TIME ANALYTICS
-- ====================================================================

-- SENSOR_READINGS INDEXES
-- 1. Descending time index for instant real-time telemetry streaming
CREATE INDEX IF NOT EXISTS idx_sensor_readings_created_at 
ON public.sensor_readings (created_at DESC);

-- 2. Multi-station fleet filter index
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_created 
ON public.sensor_readings (device_id, created_at DESC);

-- 3. Covering Index (Index-Only Scan) for real-time aggregate charts without heap lookups
CREATE INDEX IF NOT EXISTS idx_sensor_readings_analytics_covering 
ON public.sensor_readings (created_at DESC) 
INCLUDE (ph, tds, turbidity, temperature, flow, risk_score, status);

-- 4. Status filter index
CREATE INDEX IF NOT EXISTS idx_sensor_readings_status 
ON public.sensor_readings (status, created_at DESC);

-- 5. Block Range Index (BRIN) for long-term historical scalability
CREATE INDEX IF NOT EXISTS idx_sensor_readings_brin_created_at 
ON public.sensor_readings USING BRIN (created_at);

-- ALERTS INDEXES
CREATE INDEX IF NOT EXISTS idx_alerts_created_at 
ON public.alerts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_unresolved 
ON public.alerts (resolved, created_at DESC) 
WHERE resolved = FALSE;

CREATE INDEX IF NOT EXISTS idx_alerts_severity 
ON public.alerts (severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_device 
ON public.alerts (device_id, created_at DESC);

-- CONTROL_EVENTS INDEXES
CREATE INDEX IF NOT EXISTS idx_control_events_created_at 
ON public.control_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_events_device 
ON public.control_events (device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_control_events_type 
ON public.control_events (event_type, created_at DESC);

-- ====================================================================
-- 7. SUPABASE ROW LEVEL SECURITY (RLS) POLICIES
-- ====================================================================

-- Enable RLS
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_status ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------
-- POLICIES: device_status
-- --------------------------------------------------------------------
CREATE POLICY "device_status_select_policy"
ON public.device_status
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "device_status_insert_policy"
ON public.device_status
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

CREATE POLICY "device_status_update_policy"
ON public.device_status
FOR UPDATE
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

-- --------------------------------------------------------------------
-- POLICIES: sensor_readings
-- --------------------------------------------------------------------
-- Allow public & authenticated read access for dashboard monitoring
CREATE POLICY "sensor_readings_select_policy"
ON public.sensor_readings
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow backend service role, edge functions, and authenticated devices to insert telemetry
CREATE POLICY "sensor_readings_insert_policy"
ON public.sensor_readings
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

-- --------------------------------------------------------------------
-- POLICIES: alerts
-- --------------------------------------------------------------------
-- Allow reading alerts for dashboard notification feeds
CREATE POLICY "alerts_select_policy"
ON public.alerts
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow alert creation by system and edge workers
CREATE POLICY "alerts_insert_policy"
ON public.alerts
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

-- Allow operators to acknowledge and resolve alerts
CREATE POLICY "alerts_update_policy"
ON public.alerts
FOR UPDATE
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

-- --------------------------------------------------------------------
-- POLICIES: control_events
-- --------------------------------------------------------------------
-- Allow viewing control events audit log
CREATE POLICY "control_events_select_policy"
ON public.control_events
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow logging control & valve state changes
CREATE POLICY "control_events_insert_policy"
ON public.control_events
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

-- ====================================================================
-- 8. SUPABASE REALTIME REPLICATION CONFIGURATION
-- ====================================================================
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.control_events;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_status;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ====================================================================
-- 9. CONTINUOUS REAL-TIME ANALYTICS VIEWS & HELPERS
-- ====================================================================

-- Hourly Aggregates View for High-Performance Charting
CREATE OR REPLACE VIEW public.sensor_readings_hourly_analytics AS
SELECT 
    date_trunc('hour', created_at) AS time_bucket,
    device_id,
    COUNT(*) AS total_samples,
    ROUND(AVG(ph)::numeric, 2) AS avg_ph,
    ROUND(MIN(ph)::numeric, 2) AS min_ph,
    ROUND(MAX(ph)::numeric, 2) AS max_ph,
    ROUND(AVG(tds)::numeric, 2) AS avg_tds,
    ROUND(MAX(tds)::numeric, 2) AS max_tds,
    ROUND(AVG(turbidity)::numeric, 2) AS avg_turbidity,
    ROUND(MAX(turbidity)::numeric, 2) AS max_turbidity,
    ROUND(AVG(temperature)::numeric, 2) AS avg_temperature,
    ROUND(AVG(flow)::numeric, 2) AS avg_flow,
    ROUND(AVG(risk_score)::numeric, 1) AS avg_risk_score,
    ROUND(MAX(risk_score)::numeric, 0) AS peak_risk_score,
    COUNT(CASE WHEN status IN ('CRITICAL', 'EMERGENCY') THEN 1 END) AS critical_events_count,
    COUNT(CASE WHEN discharge_state = 'BLOCKED' THEN 1 END) AS blocked_discharge_count,
    ROUND(SUM(flow * (2.0 / 60.0))::numeric, 2) AS estimated_volume_liters
FROM public.sensor_readings
GROUP BY 1, 2
ORDER BY 1 DESC;

-- Stored Procedure to get latest SCADA system snapshot
CREATE OR REPLACE FUNCTION public.get_latest_scada_snapshot(p_device_id VARCHAR DEFAULT 'ESP32-STATION-01')
RETURNS TABLE (
    reading_id BIGINT,
    device_id VARCHAR,
    ph NUMERIC,
    tds NUMERIC,
    turbidity NUMERIC,
    temperature NUMERIC,
    flow NUMERIC,
    risk_score INT,
    status sensor_status_enum,
    valve_state valve_state_enum,
    relay_state relay_state_enum,
    discharge_state discharge_state_enum,
    active_alerts_count BIGINT,
    created_at TIMESTAMPTZ
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.device_id,
        r.ph,
        r.tds,
        r.turbidity,
        r.temperature,
        r.flow,
        r.risk_score,
        r.status,
        r.valve_state,
        r.relay_state,
        r.discharge_state,
        (SELECT COUNT(*) FROM public.alerts a WHERE a.resolved = FALSE AND a.device_id = p_device_id) AS active_alerts_count,
        r.created_at
    FROM public.sensor_readings r
    WHERE r.device_id = p_device_id
    ORDER BY r.created_at DESC
    LIMIT 1;
END;
$$;

-- ====================================================================
-- 10. DAILY & WEEKLY ANALYTICS SUMMARY VIEWS
-- ====================================================================

-- 10A. Daily Analytics View (Daily Averages & Critical Event Counts)
CREATE OR REPLACE VIEW public.sensor_readings_daily_summary AS
SELECT 
    date_trunc('day', created_at)::date AS day,
    device_id,
    COUNT(*) AS total_samples,
    ROUND(AVG(ph)::numeric, 2) AS avg_ph,
    ROUND(MIN(ph)::numeric, 2) AS min_ph,
    ROUND(MAX(ph)::numeric, 2) AS max_ph,
    ROUND(AVG(tds)::numeric, 2) AS avg_tds,
    ROUND(MIN(tds)::numeric, 2) AS min_tds,
    ROUND(MAX(tds)::numeric, 2) AS max_tds,
    ROUND(AVG(turbidity)::numeric, 2) AS avg_turbidity,
    ROUND(MIN(turbidity)::numeric, 2) AS min_turbidity,
    ROUND(MAX(turbidity)::numeric, 2) AS max_turbidity,
    ROUND(AVG(temperature)::numeric, 2) AS avg_temperature,
    ROUND(AVG(flow)::numeric, 2) AS avg_flow,
    ROUND(AVG(risk_score)::numeric, 1) AS avg_risk_score,
    ROUND(MAX(risk_score)::numeric, 0) AS max_risk_score,
    COUNT(CASE WHEN status IN ('CRITICAL', 'EMERGENCY') THEN 1 END) AS critical_events_count,
    COUNT(CASE WHEN status = 'WARNING' THEN 1 END) AS warning_events_count,
    COUNT(CASE WHEN status = 'SAFE' THEN 1 END) AS safe_events_count,
    COUNT(CASE WHEN discharge_state = 'BLOCKED' THEN 1 END) AS discharge_blocked_count,
    ROUND(SUM(flow * (2.0 / 60.0))::numeric, 2) AS estimated_volume_liters,
    ROUND((COUNT(CASE WHEN status = 'SAFE' THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2) AS compliance_rate_pct
FROM public.sensor_readings
GROUP BY 1, 2
ORDER BY 1 DESC;

-- 10B. Weekly Analytics View
CREATE OR REPLACE VIEW public.sensor_readings_weekly_summary AS
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
    ROUND(MAX(risk_score)::numeric, 0) AS max_risk_score,
    COUNT(CASE WHEN status IN ('CRITICAL', 'EMERGENCY') THEN 1 END) AS critical_events_count,
    COUNT(CASE WHEN status = 'WARNING' THEN 1 END) AS warning_events_count,
    COUNT(CASE WHEN discharge_state = 'BLOCKED' THEN 1 END) AS discharge_blocked_count,
    ROUND((SUM(flow * (2.0 / 60.0)) / 1000.0)::numeric, 2) AS volume_kiloliters,
    ROUND((COUNT(CASE WHEN status = 'SAFE' THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2) AS compliance_rate_pct
FROM public.sensor_readings
GROUP BY 1, 2, 3
ORDER BY 1 DESC;

-- 10C. Stored Function for /api/analytics/summary
CREATE OR REPLACE FUNCTION public.get_analytics_summary(
    p_device_id VARCHAR DEFAULT 'ESP32-STATION-01',
    p_days INT DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_daily JSONB;
    v_weekly JSONB;
    v_critical_breakdown JSONB;
    v_totals JSONB;
BEGIN
    SELECT COALESCE(jsonb_agg(d ORDER BY d.day DESC), '[]'::jsonb)
    INTO v_daily
    FROM (
        SELECT 
            day,
            total_samples,
            avg_ph,
            min_ph,
            max_ph,
            avg_tds,
            max_tds,
            avg_turbidity,
            max_turbidity,
            avg_temperature,
            avg_flow,
            avg_risk_score,
            max_risk_score,
            critical_events_count,
            warning_events_count,
            safe_events_count,
            discharge_blocked_count,
            estimated_volume_liters,
            compliance_rate_pct
        FROM public.sensor_readings_daily_summary
        WHERE device_id = p_device_id
          AND day >= (CURRENT_DATE - p_days)
        LIMIT 30
    ) d;

    SELECT COALESCE(jsonb_agg(w ORDER BY w.week_start DESC), '[]'::jsonb)
    INTO v_weekly
    FROM (
        SELECT 
            week_start,
            week_label,
            total_samples,
            avg_ph,
            avg_tds,
            avg_turbidity,
            avg_temperature,
            avg_flow,
            avg_risk_score,
            max_risk_score,
            critical_events_count,
            warning_events_count,
            discharge_blocked_count,
            volume_kiloliters,
            compliance_rate_pct
        FROM public.sensor_readings_weekly_summary
        WHERE device_id = p_device_id
        LIMIT 12
    ) w;

    SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
    INTO v_critical_breakdown
    FROM (
        SELECT 
            parameter,
            severity,
            COUNT(*) AS event_count,
            COUNT(CASE WHEN resolved = FALSE THEN 1 END) AS unresolved_count,
            COUNT(CASE WHEN gmail_status = 'SENT' THEN 1 END) AS gmail_sent_count,
            ROUND(AVG(risk_score)::numeric, 1) AS avg_risk_score
        FROM public.alerts
        WHERE device_id = p_device_id
          AND severity IN ('CRITICAL', 'EMERGENCY')
        GROUP BY parameter, severity
        ORDER BY event_count DESC
    ) c;

    SELECT jsonb_build_object(
        'totalSamples', COUNT(*),
        'avgPh', ROUND(AVG(ph)::numeric, 2),
        'avgTds', ROUND(AVG(tds)::numeric, 2),
        'avgTurbidity', ROUND(AVG(turbidity)::numeric, 2),
        'avgTemperature', ROUND(AVG(temperature)::numeric, 2),
        'avgFlow', ROUND(AVG(flow)::numeric, 2),
        'totalCriticalEvents', COUNT(CASE WHEN status IN ('CRITICAL', 'EMERGENCY') THEN 1 END),
        'totalWarningEvents', COUNT(CASE WHEN status = 'WARNING' THEN 1 END),
        'totalDischargeBlocked', COUNT(CASE WHEN discharge_state = 'BLOCKED' THEN 1 END),
        'overallComplianceRate', ROUND((COUNT(CASE WHEN status = 'SAFE' THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2)
    )
    INTO v_totals
    FROM public.sensor_readings
    WHERE device_id = p_device_id;

    RETURN jsonb_build_object(
        'success', true,
        'deviceId', p_device_id,
        'generatedAt', timezone('utc'::text, now()),
        'totals', v_totals,
        'daily', v_daily,
        'weekly', v_weekly,
        'criticalBreakdown', v_critical_breakdown
    );
END;
$$;
