-- ====================================================================
-- INDUSTRIAL EFFLUENT SCADA — ANALYTICS SQL QUERIES & VIEWS
-- Supabase / PostgreSQL Production Query Suite
-- Provides Daily/Weekly Sensor Averages, Critical Event Counts, and Compliance Metrics
-- ====================================================================

-- ====================================================================
-- 1. DAILY SENSOR AVERAGES & CRITICAL EVENT COUNTS (LAST 30 DAYS)
-- Computes daily average, min, and max for pH, TDS, Turbidity, Temperature, Flow,
-- counts for critical/warning events, discharge shutoffs, and estimated volume.
-- ====================================================================
SELECT 
    date_trunc('day', r.created_at)::date AS day,
    r.device_id,
    COUNT(*) AS total_samples,
    ROUND(AVG(r.ph)::numeric, 2) AS avg_ph,
    ROUND(MIN(r.ph)::numeric, 2) AS min_ph,
    ROUND(MAX(r.ph)::numeric, 2) AS max_ph,
    ROUND(AVG(r.tds)::numeric, 2) AS avg_tds,
    ROUND(MIN(r.tds)::numeric, 2) AS min_tds,
    ROUND(MAX(r.tds)::numeric, 2) AS max_tds,
    ROUND(AVG(r.turbidity)::numeric, 2) AS avg_turbidity,
    ROUND(MIN(r.turbidity)::numeric, 2) AS min_turbidity,
    ROUND(MAX(r.turbidity)::numeric, 2) AS max_turbidity,
    ROUND(AVG(r.temperature)::numeric, 2) AS avg_temperature,
    ROUND(AVG(r.flow)::numeric, 2) AS avg_flow,
    ROUND(AVG(r.risk_score)::numeric, 1) AS avg_risk_score,
    ROUND(MAX(r.risk_score)::numeric, 0) AS max_risk_score,
    -- Critical & Warning Event Counts
    COUNT(CASE WHEN r.status IN ('CRITICAL', 'EMERGENCY') THEN 1 END) AS critical_events_count,
    COUNT(CASE WHEN r.status = 'WARNING' THEN 1 END) AS warning_events_count,
    COUNT(CASE WHEN r.status = 'SAFE' THEN 1 END) AS safe_events_count,
    COUNT(CASE WHEN r.discharge_state = 'BLOCKED' THEN 1 END) AS discharge_blocked_count,
    -- Volume & Compliance Rate
    ROUND(SUM(r.flow * (2.0 / 60.0))::numeric, 2) AS estimated_volume_liters,
    ROUND((COUNT(CASE WHEN r.status = 'SAFE' THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2) AS compliance_rate_pct
FROM public.sensor_readings r
WHERE r.created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC;

-- ====================================================================
-- 2. WEEKLY SENSOR AVERAGES & CRITICAL EVENT TRENDS (LAST 12 WEEKS)
-- Computes weekly aggregates with ISO week start timestamps.
-- ====================================================================
SELECT 
    date_trunc('week', r.created_at)::date AS week_start,
    TO_CHAR(date_trunc('week', r.created_at), '"W"IW YYYY') AS week_label,
    r.device_id,
    COUNT(*) AS total_samples,
    ROUND(AVG(r.ph)::numeric, 2) AS avg_ph,
    ROUND(AVG(r.tds)::numeric, 2) AS avg_tds,
    ROUND(AVG(r.turbidity)::numeric, 2) AS avg_turbidity,
    ROUND(AVG(r.temperature)::numeric, 2) AS avg_temperature,
    ROUND(AVG(r.flow)::numeric, 2) AS avg_flow,
    ROUND(AVG(r.risk_score)::numeric, 1) AS avg_risk_score,
    ROUND(MAX(r.risk_score)::numeric, 0) AS max_risk_score,
    -- Weekly Critical Totals
    COUNT(CASE WHEN r.status IN ('CRITICAL', 'EMERGENCY') THEN 1 END) AS critical_events_count,
    COUNT(CASE WHEN r.status = 'WARNING' THEN 1 END) AS warning_events_count,
    COUNT(CASE WHEN r.discharge_state = 'BLOCKED' THEN 1 END) AS discharge_blocked_count,
    -- Estimated weekly volume in KiloLiters (m3)
    ROUND((SUM(r.flow * (2.0 / 60.0)) / 1000.0)::numeric, 2) AS volume_kiloliters,
    ROUND((COUNT(CASE WHEN r.status = 'SAFE' THEN 1 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2) AS compliance_rate_pct
FROM public.sensor_readings r
WHERE r.created_at >= NOW() - INTERVAL '12 weeks'
GROUP BY 1, 2, 3
ORDER BY 1 DESC;

-- ====================================================================
-- 3. CRITICAL EVENTS BREAKDOWN BY PARAMETER (ALERTS TABLE)
-- Counts total critical incidents categorized by violated sensor parameter.
-- ====================================================================
SELECT 
    a.parameter,
    a.severity,
    COUNT(*) AS event_count,
    COUNT(CASE WHEN a.resolved = FALSE THEN 1 END) AS unresolved_count,
    COUNT(CASE WHEN a.gmail_status = 'SENT' THEN 1 END) AS email_dispatches_count,
    ROUND(AVG(a.risk_score)::numeric, 1) AS avg_risk_score,
    MAX(a.created_at) AS last_incident_time
FROM public.alerts a
WHERE a.severity IN ('CRITICAL', 'EMERGENCY')
  AND a.created_at >= NOW() - INTERVAL '30 days'
GROUP BY a.parameter, a.severity
ORDER BY event_count DESC;

-- ====================================================================
-- 4. AUTOMATIC SAFETY ACTUATOR (VALVE / RELAY) CUT-OFF SUMMARY
-- Summarizes emergency solenoid valve closes and relay actions.
-- ====================================================================
SELECT 
    c.event_type,
    c.triggered_by,
    COUNT(*) AS total_triggers,
    MAX(c.created_at) AS last_triggered_at
FROM public.control_events c
WHERE c.created_at >= NOW() - INTERVAL '30 days'
GROUP BY c.event_type, c.triggered_by
ORDER BY total_triggers DESC;

-- ====================================================================
-- 5. PRODUCTION VIEWS FOR SUPABASE
-- ====================================================================

-- 5A. Daily Summary View
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

-- 5B. Weekly Summary View
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

-- ====================================================================
-- 6. RPC STORED PROCEDURE: GET COMPLETE ANALYTICS SUMMARY JSON
-- Exposes full daily, weekly, and critical counts payload for /api/analytics/summary
-- ====================================================================
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
    -- 1. Daily summaries
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

    -- 2. Weekly summaries
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

    -- 3. Critical events breakdown by parameter
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

    -- 4. Overall Totals
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
