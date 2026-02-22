-- Database: disaster_alert_db
-- Schema Version: 2.0 (fully synchronized with application code)

CREATE DATABASE IF NOT EXISTS disaster_alert_db;
USE disaster_alert_db;

-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    location_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1b. Admins
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Locations
CREATE TABLE IF NOT EXISTS locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Disasters
-- is_active: allows disabling a disaster type without deleting rules
CREATE TABLE IF NOT EXISTS disasters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Alert Rules
-- location_id NULL = global rule (applies to every location)
-- severity_level: the alert severity this rule produces
-- weather_condition includes aqi and earthquake_magnitude
CREATE TABLE IF NOT EXISTS alert_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NULL,
    disaster_id INT NOT NULL,
    weather_condition ENUM(
        'rain_sum',
        'wind_speed',
        'temperature',
        'humidity',
        'aqi',
        'earthquake_magnitude'
    ) NOT NULL,
    threshold_value FLOAT NOT NULL,
    operator ENUM('>', '<', '>=', '<=') NOT NULL,
    severity_level ENUM('Low', 'Medium', 'High', 'Critical') NOT NULL DEFAULT 'Medium',
    message_template VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    FOREIGN KEY (disaster_id) REFERENCES disasters(id) ON DELETE CASCADE
);

-- 5. Weather Logs
-- aqi, earthquake_magnitude, earthquake_id: added to support co-logged context
CREATE TABLE IF NOT EXISTS weather_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    data JSON,
    temperature FLOAT,
    humidity FLOAT,
    rain_sum FLOAT,
    wind_speed FLOAT,
    aqi FLOAT,
    earthquake_magnitude FLOAT,
    earthquake_id VARCHAR(100),
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

-- 6. Earthquake Logs
-- usgs_id: USGS unique event ID; is_manual: true if triggered via admin simulate
-- UNIQUE(location_id, usgs_id) prevents logging the same quake twice per location
CREATE TABLE IF NOT EXISTS earthquake_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    magnitude FLOAT NOT NULL,
    usgs_id VARCHAR(100) NOT NULL,
    is_manual BOOLEAN DEFAULT FALSE,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    UNIQUE KEY uq_location_usgs (location_id, usgs_id)
);

-- 7. Alerts
-- external_id: USGS event ID for earthquake alerts (null for weather alerts)
-- source: 'System' = auto-generated, 'Admin' = manually created
-- severity stored as VARCHAR so comparisons are case-insensitive in app code
CREATE TABLE IF NOT EXISTS alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    disaster_id INT NOT NULL,
    location_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(50) NOT NULL DEFAULT 'Medium',
    source VARCHAR(50) NOT NULL DEFAULT 'System',
    is_active BOOLEAN DEFAULT TRUE,
    external_id VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,
    FOREIGN KEY (disaster_id) REFERENCES disasters(id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);


-- Note: users.location_id FK is added programmatically by seed.js to support re-runs.
