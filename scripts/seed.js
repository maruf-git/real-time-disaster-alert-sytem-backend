/**
 * seed.js — Fresh database setup for 11th Hour Disaster Alert System
 *
 * Creates all tables from schema.sql, then seeds:
 *   - 8 Bangladesh divisions as locations
 *   - 5 disaster types
 *   - Alert rules per disaster with Low/Medium/High/Critical severity tiers
 *
 * Usage:  node scripts/seed.js
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Load dotenv only when run standalone (env already exists when called from server)
if (!process.env.DB_HOST) {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
}

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
};

// ── Bangladesh Divisions ──────────────────────────────────────────────────────
const LOCATIONS = [
    { name: 'Dhaka', latitude: 23.8103, longitude: 90.4125 },
    { name: 'Chittagong', latitude: 22.3569, longitude: 91.7832 },
    { name: 'Rajshahi', latitude: 24.3745, longitude: 88.6042 },
    { name: 'Khulna', latitude: 22.8456, longitude: 89.5403 },
    { name: 'Barishal', latitude: 22.7010, longitude: 90.3535 },
    { name: 'Sylhet', latitude: 24.8949, longitude: 91.8687 },
    { name: 'Rangpur', latitude: 25.7439, longitude: 89.2752 },
    { name: 'Mymensingh', latitude: 24.7471, longitude: 90.4203 },
];

// ── Disaster Types ────────────────────────────────────────────────────────────
const DISASTERS = [
    { name: 'Earthquake', description: 'Seismic activity detected near the location.' },
    { name: 'Flash Flood', description: 'Sudden flooding caused by heavy rainfall or river overflow.' },
    { name: 'Heatwave', description: 'Extreme heat conditions dangerous to health.' },
    { name: 'Cold Wave', description: 'Extreme cold conditions dangerous to health.' },
    { name: 'Air Pollution', description: 'Hazardous air quality index levels affecting public health.' },
];

// ── Alert Rules (global — location_id = NULL) ─────────────────────────────────
const RULES = [
    // Flash Flood — rain_sum (mm)
    { disaster: 'Flash Flood', condition: 'rain_sum', operator: '>=', threshold: 10, severity: 'Low', message: 'Moderate rainfall — flash flood watch' },
    { disaster: 'Flash Flood', condition: 'rain_sum', operator: '>=', threshold: 25, severity: 'Medium', message: 'Heavy rainfall — flash flood advisory' },
    { disaster: 'Flash Flood', condition: 'rain_sum', operator: '>=', threshold: 50, severity: 'High', message: 'Very heavy rain — flash flood warning' },
    { disaster: 'Flash Flood', condition: 'rain_sum', operator: '>=', threshold: 100, severity: 'Critical', message: 'Extreme rainfall — flash flood emergency' },
    // Heatwave — temperature (°C)
    { disaster: 'Heatwave', condition: 'temperature', operator: '>=', threshold: 36, severity: 'Low', message: 'Hot weather — heat advisory' },
    { disaster: 'Heatwave', condition: 'temperature', operator: '>=', threshold: 38, severity: 'Medium', message: 'Heatwave conditions developing' },
    { disaster: 'Heatwave', condition: 'temperature', operator: '>=', threshold: 40, severity: 'High', message: 'Severe heatwave — heat stroke risk' },
    { disaster: 'Heatwave', condition: 'temperature', operator: '>=', threshold: 42, severity: 'Critical', message: 'Extreme heatwave — life-threatening' },
    // Cold Wave — temperature (°C)
    { disaster: 'Cold Wave', condition: 'temperature', operator: '<=', threshold: 15, severity: 'Low', message: 'Cool conditions — cold watch' },
    { disaster: 'Cold Wave', condition: 'temperature', operator: '<=', threshold: 10, severity: 'Medium', message: 'Cold wave — vulnerable groups at risk' },
    { disaster: 'Cold Wave', condition: 'temperature', operator: '<=', threshold: 5, severity: 'High', message: 'Severe cold wave — frost risk' },
    { disaster: 'Cold Wave', condition: 'temperature', operator: '<=', threshold: 2, severity: 'Critical', message: 'Extreme cold — hypothermia risk' },
    // Air Pollution — AQI (US index)
    { disaster: 'Air Pollution', condition: 'aqi', operator: '>=', threshold: 101, severity: 'Low', message: 'Unhealthy for sensitive groups' },
    { disaster: 'Air Pollution', condition: 'aqi', operator: '>=', threshold: 151, severity: 'Medium', message: 'Unhealthy air quality' },
    { disaster: 'Air Pollution', condition: 'aqi', operator: '>=', threshold: 201, severity: 'High', message: 'Very unhealthy air — wear masks' },
    { disaster: 'Air Pollution', condition: 'aqi', operator: '>=', threshold: 301, severity: 'Critical', message: 'Hazardous AQI — stay indoors' },
    // Earthquake — magnitude
    { disaster: 'Earthquake', condition: 'earthquake_magnitude', operator: '>=', threshold: 3.0, severity: 'Low', message: 'Minor seismic activity detected' },
    { disaster: 'Earthquake', condition: 'earthquake_magnitude', operator: '>=', threshold: 4.5, severity: 'Medium', message: 'Moderate earthquake — check for damage' },
    { disaster: 'Earthquake', condition: 'earthquake_magnitude', operator: '>=', threshold: 5.5, severity: 'High', message: 'Strong earthquake — evacuate if unsafe' },
    { disaster: 'Earthquake', condition: 'earthquake_magnitude', operator: '>=', threshold: 6.5, severity: 'Critical', message: 'Major earthquake — emergency response activated' },
];

async function run() {
    let connection;
    try {
        // ── Connect (no DB yet) ───────────────────────────────────────────────
        connection = await mysql.createConnection(DB_CONFIG);
        console.log('✔ Connected to MySQL');

        // ── Create and select database ────────────────────────────────────────
        await connection.query('CREATE DATABASE IF NOT EXISTS disaster_alert_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        await connection.query('USE disaster_alert_db');
        console.log('✔ Using disaster_alert_db');

        // ── Apply schema (CREATE TABLE IF NOT EXISTS — idempotent) ───────────
        const schemaRaw = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
        // Strip CREATE DATABASE and USE lines (already handled above)
        const schemaSql = schemaRaw
            .replace(/CREATE DATABASE IF NOT EXISTS[^;]+;/gi, '')
            .replace(/USE disaster_alert_db\s*;/gi, '')
            .replace(/--[^\n]*/g, '') // strip comments to avoid parser confusion
            .trim();
        await connection.query(schemaSql);
        console.log('✔ Schema applied');

        // ── Add users.location_id FK safely ──────────────────────────────────
        try { await connection.query('ALTER TABLE users DROP FOREIGN KEY fk_user_location'); } catch (_) { }
        await connection.query(
            'ALTER TABLE users ADD CONSTRAINT fk_user_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL'
        );

        // ── Clear all data (FOREIGN_KEY_CHECKS off for safe truncation) ───────
        const TABLES = ['alerts', 'alert_rules', 'earthquake_logs', 'weather_logs', 'disasters', 'locations', 'users', 'admins'];
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const t of TABLES) {
            await connection.query(`TRUNCATE TABLE ${t}`);
        }
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('✔ Tables truncated');

        // ── Seed Locations ────────────────────────────────────────────────────
        for (const loc of LOCATIONS) {
            await connection.query(
                'INSERT INTO locations (name, latitude, longitude, is_active) VALUES (?, ?, ?, 1)',
                [loc.name, loc.latitude, loc.longitude]
            );
        }
        console.log(`✔ Inserted ${LOCATIONS.length} locations`);

        // ── Seed Disasters ────────────────────────────────────────────────────
        for (const dis of DISASTERS) {
            await connection.query(
                'INSERT INTO disasters (name, description, is_active) VALUES (?, ?, 1)',
                [dis.name, dis.description]
            );
        }
        console.log(`✔ Inserted ${DISASTERS.length} disasters`);

        // ── Build disaster name → id map ──────────────────────────────────────
        const [disasterRows] = await connection.query('SELECT id, name FROM disasters');
        const disasterMap = {};
        disasterRows.forEach(d => { disasterMap[d.name] = d.id; });

        // ── Seed global alert rules ───────────────────────────────────────────
        for (const rule of RULES) {
            const disasterId = disasterMap[rule.disaster];
            if (!disasterId) { console.warn(`⚠ Disaster not found: ${rule.disaster}`); continue; }
            await connection.query(
                'INSERT INTO alert_rules (location_id, disaster_id, weather_condition, operator, threshold_value, severity_level, message_template, is_active) VALUES (NULL, ?, ?, ?, ?, ?, ?, 1)',
                [disasterId, rule.condition, rule.operator, rule.threshold, rule.severity, rule.message]
            );
        }
        console.log(`✔ Inserted ${RULES.length} global alert rules`);

        // ── Seed default admin user ───────────────────────────────────────────
        const bcrypt = require('bcryptjs');
        const userHash = await bcrypt.hash('admin123', 10);
        await connection.query(
            'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
            ['admin', userHash, 'admin']
        );
        console.log('✔ Standard Test User: username=admin  password=admin123');

        // ── Seed specific application admin ───────────────────────────────────
        const adminHash = await bcrypt.hash('hstuadmin', 10);
        await connection.query(
            'INSERT INTO admins (email, password) VALUES (?, ?)',
            ['hstu@gmail.com', adminHash]
        );
        console.log('✔ System Admin: email=hstu@gmail.com  password=hstuadmin');

        console.log('\n✅ Seed complete! System is ready.');

    } catch (err) {
        console.error('❌ Seed failed:', err.message);
        process.exit(1);
    } finally {
        if (connection) await connection.end();
    }
}

run();
