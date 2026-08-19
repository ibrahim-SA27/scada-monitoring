-- ====================================================================
-- SUPABASE POSTGRESQL SCHEMA: SENSOR READINGS TABLE
-- Optimized for High-Frequency Industrial Telemetry & Real-Time Analytics
-- ====================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Create the sensor_readings table
CREATE TABLE IF NOT EXISTS public.sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL DEFAULT 'ESP32-STATION-01',
    ph NUMERIC(5, 2) NOT NULL,
    tds NUMERIC(8, 2) NOT NULL,
    turbidity NUMERIC(8, 2) NOT NULL,
    temperature NUMERIC(5, 2) NOT NULL,
    flow NUMERIC(6, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ====================================================================
-- 3. HIGH-PERFORMANCE INDEXES FOR REAL-TIME ANALYTICS
-- ====================================================================

-- Index on created_at (descending) for fast real-time telemetry queries and pagination
CREATE INDEX IF NOT EXISTS idx_sensor_readings_created_at 
ON public.sensor_readings (created_at DESC);

-- Composite index on device_id and created_at for multi-station fleet filtering
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_created 
ON public.sensor_readings (device_id, created_at DESC);

-- Covering index with INCLUDE clause to accelerate time-series aggregation without table heap lookups
CREATE INDEX IF NOT EXISTS idx_sensor_readings_analytics_covering
ON public.sensor_readings (created_at DESC) 
INCLUDE (ph, tds, turbidity, temperature, flow);

-- Block Range Index (BRIN) for efficient long-term historical storage and data scaling
CREATE INDEX IF NOT EXISTS idx_sensor_readings_brin_created_at 
ON public.sensor_readings USING BRIN (created_at);

-- ====================================================================
-- 4. SUPABASE REALTIME & SECURITY (RLS) POLICIES
-- ====================================================================

-- Enable Row Level Security (RLS)
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;

-- Allow read access for dashboard monitoring clients
CREATE POLICY "Allow public read access for real-time monitoring"
ON public.sensor_readings
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow authenticated clients or edge functions / backend to insert new sensor readings
CREATE POLICY "Allow sensor telemetry ingestion"
ON public.sensor_readings
FOR INSERT
TO anon, authenticated, service_role
WITH CHECK (true);

-- Enable Supabase Realtime replication for instant WebSocket updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;

-- ====================================================================
-- 5. CONTINUOUS ANALYTICS HELPER VIEW (HOURLY SUMMARY)
-- ====================================================================
CREATE OR REPLACE VIEW public.sensor_readings_hourly_summary AS
SELECT 
    date_trunc('hour', created_at) AS hour_bucket,
    device_id,
    COUNT(*) AS sample_count,
    ROUND(AVG(ph)::numeric, 2) AS avg_ph,
    ROUND(MIN(ph)::numeric, 2) AS min_ph,
    ROUND(MAX(ph)::numeric, 2) AS max_ph,
    ROUND(AVG(tds)::numeric, 2) AS avg_tds,
    ROUND(MAX(tds)::numeric, 2) AS max_tds,
    ROUND(AVG(turbidity)::numeric, 2) AS avg_turbidity,
    ROUND(MAX(turbidity)::numeric, 2) AS max_turbidity,
    ROUND(AVG(temperature)::numeric, 2) AS avg_temperature,
    ROUND(AVG(flow)::numeric, 2) AS avg_flow,
    ROUND(SUM(flow * (2.0 / 60.0))::numeric, 2) AS estimated_effluent_volume_liters
FROM public.sensor_readings
GROUP BY 1, 2
ORDER BY 1 DESC;
