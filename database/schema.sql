-- ====================================================================
-- INDUSTRIAL EFFLUENT MONITORING & AUTOMATIC SAFETY CONTROL SYSTEM
-- SUPABASE / POSTGRESQL PRODUCTION DATABASE SCHEMA
-- ====================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS
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

DO $$ BEGIN
    CREATE TYPE user_role_enum AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. USERS & ROLES
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(150),
    role user_role_enum DEFAULT 'VIEWER',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- 4. DEVICE STATUS & SENSOR HEALTH
CREATE TABLE IF NOT EXISTS device_status (
    id VARCHAR(50) PRIMARY KEY,
    device_name VARCHAR(100) NOT NULL,
    device_type VARCHAR(50) DEFAULT 'ESP32-RTU',
    ip_address VARCHAR(45),
    mac_address VARCHAR(17),
    firmware_version VARCHAR(20) DEFAULT 'v2.4.1-industrial',
    battery_level INT DEFAULT 100,
    signal_strength INT DEFAULT -58, -- RSSI in dBm
    status VARCHAR(20) DEFAULT 'ONLINE',
    last_communication TIMESTAMPTZ DEFAULT NOW(),
    uptime_seconds BIGINT DEFAULT 864000,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id VARCHAR(50) REFERENCES device_status(id) ON DELETE CASCADE,
    sensor_key VARCHAR(50) NOT NULL,
    sensor_name VARCHAR(100) NOT NULL,
    calibration_offset NUMERIC(10, 4) DEFAULT 0.0,
    last_calibrated TIMESTAMPTZ DEFAULT NOW(),
    health_status VARCHAR(20) DEFAULT 'HEALTHY',
    quality_score INT DEFAULT 98,
    error_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SENSOR READINGS (CORE TIME-SERIES TELEMETRY)
CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(50) NOT NULL DEFAULT 'ESP32-STATION-01',
    ph NUMERIC(5, 2) NOT NULL,
    tds NUMERIC(8, 2) NOT NULL,
    turbidity NUMERIC(8, 2) NOT NULL,
    temperature NUMERIC(5, 2) NOT NULL,
    flow NUMERIC(6, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Optional extended fields
    timestamp_ms BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    risk_score INT DEFAULT 0,
    status sensor_status_enum DEFAULT 'SAFE',
    valve_state valve_state_enum DEFAULT 'OPEN',
    relay_state relay_state_enum DEFAULT 'INACTIVE',
    discharge_state discharge_state_enum DEFAULT 'ALLOWED',
    source VARCHAR(50) DEFAULT 'ESP32'
);

CREATE INDEX IF NOT EXISTS idx_readings_created_at ON sensor_readings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_device_created ON sensor_readings(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_analytics_covering ON sensor_readings(created_at DESC) INCLUDE (ph, tds, turbidity, temperature, flow);
CREATE INDEX IF NOT EXISTS idx_readings_status ON sensor_readings(status);
CREATE INDEX IF NOT EXISTS idx_readings_device ON sensor_readings(device_id);

-- 6. ALERTS & INCIDENT LOGS
CREATE TABLE IF NOT EXISTS alerts (
    id VARCHAR(100) PRIMARY KEY,
    reading_id BIGINT REFERENCES sensor_readings(id) ON DELETE SET NULL,
    severity sensor_status_enum NOT NULL,
    risk_score INT NOT NULL,
    parameter VARCHAR(50) NOT NULL,
    value VARCHAR(50) NOT NULL,
    threshold_limit VARCHAR(50),
    message TEXT NOT NULL,
    location VARCHAR(100) DEFAULT 'Outfall Station Alpha-1',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

-- 7. EMAIL & NOTIFICATION LOGS
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_id VARCHAR(100) REFERENCES alerts(id) ON DELETE SET NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'SENT', 'FAILED', 'QUEUED'
    smtp_response TEXT,
    payload_snapshot JSONB,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. CONTROL EVENTS & AUDIT LOGS
CREATE TABLE IF NOT EXISTS control_events (
    id VARCHAR(100) PRIMARY KEY,
    device_id VARCHAR(50) DEFAULT 'ESP32-STATION-01',
    event_type VARCHAR(50) NOT NULL, -- 'VALVE_CLOSE', 'VALVE_OPEN', 'RELAY_ENGAGED', 'DISCHARGE_BLOCKED'
    triggered_by VARCHAR(50) DEFAULT 'SYSTEM_AUTO', -- 'SYSTEM_AUTO' or User ID
    previous_state VARCHAR(50),
    new_state VARCHAR(50),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_events (
    id VARCHAR(100) PRIMARY KEY,
    event_category VARCHAR(50) NOT NULL, -- 'COMMUNICATION', 'CALIBRATION', 'POWER', 'NETWORK'
    description TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100),
    ip_address VARCHAR(45),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. ANALYTICS & HOURLY ROLLUPS
CREATE TABLE IF NOT EXISTS analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    avg_ph NUMERIC(5, 2),
    avg_tds NUMERIC(8, 2),
    avg_turbidity NUMERIC(8, 2),
    avg_temp NUMERIC(5, 2),
    avg_flow NUMERIC(6, 2),
    avg_risk NUMERIC(5, 2),
    max_risk INT,
    critical_count INT DEFAULT 0,
    emergency_count INT DEFAULT 0,
    blocked_count INT DEFAULT 0,
    email_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. SYSTEM SETTINGS
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. SEED INITIAL DATA
INSERT INTO device_status (id, device_name, ip_address, mac_address, status, battery_level, signal_strength)
VALUES ('ESP32-STATION-01', 'Effluent RTU Station Alpha-1', '192.168.1.145', 'A4:CF:12:89:BC:44', 'ONLINE', 98, -58)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sensor_health (device_id, sensor_key, sensor_name, quality_score, health_status)
VALUES 
    ('ESP32-STATION-01', 'ph', 'Industrial pH Probe 4502C', 99, 'HEALTHY'),
    ('ESP32-STATION-01', 'tds', 'Analog TDS Meter V1.0', 98, 'HEALTHY'),
    ('ESP32-STATION-01', 'turbidity', 'Gravity Turbidity Sensor', 96, 'HEALTHY'),
    ('ESP32-STATION-01', 'temperature', 'DS18B20 Waterproof Probe', 100, 'HEALTHY'),
    ('ESP32-STATION-01', 'flow', 'YF-S201 Hall Flowmeter', 97, 'HEALTHY')
ON CONFLICT DO NOTHING;

INSERT INTO settings (key, value, description)
VALUES 
    ('thresholds', '{"ph_min": 6.5, "ph_max": 8.5, "tds_max": 800, "turbidity_max": 50, "temp_max": 35, "flow_max": 3.0}', 'Safety limits for effluent quality'),
    ('email_config', '{"enabled": true, "receiver": "safety-officer@industry.com", "send_on_warning": false, "send_on_critical": true}', 'Email alert configuration'),
    ('simulation', '{"active": true, "interval_sec": 2, "fluctuation_rate": 0.05}', 'Telemetry simulation parameters')
ON CONFLICT (key) DO NOTHING;
