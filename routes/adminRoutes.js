const express = require('express');
const router = express.Router();
const db = require('../config/db');
const scheduler = require('../services/scheduler');

// Helper to parse coordinates strictly formatted like "23.8041° N, 90.4152° E"
function parseCoordinates(coordString) {
    if (!coordString) return null;
    const regex = /^(\d+(\.\d+)?)°\s*([NS]),\s*(\d+(\.\d+)?)°\s*([EW])$/i;
    const match = coordString.trim().match(regex);
    if (!match) return null;

    let lat = parseFloat(match[1]);
    const latDir = match[3].toUpperCase();
    if (latDir === 'S') lat = -lat;

    let lon = parseFloat(match[4]);
    const lonDir = match[6].toUpperCase();
    if (lonDir === 'W') lon = -lon;

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { latitude: lat, longitude: lon };
}

// --- LOCATIONS ---
router.get('/locations', async (req, res) => {
    try {
        const { search, page = 1, limit = 10, activeOnly } = req.query;
        let query = 'SELECT * FROM locations';
        let countQuery = 'SELECT COUNT(*) as total FROM locations';
        const params = [];
        const countParams = [];

        const conditions = [];

        if (search) {
            conditions.push('name LIKE ?');
            params.push(`%${search}%`);
            countParams.push(`%${search}%`);
        }

        if (activeOnly === 'true') {
            conditions.push('is_active = 1');
        }

        if (conditions.length > 0) {
            const whereClause = ' WHERE ' + conditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ' ORDER BY created_at DESC';

        if (limit !== 'all') {
            const parsedLimit = parseInt(limit, 10);
            const offset = (parseInt(page, 10) - 1) * parsedLimit;
            // Interpoloate safe parsed integers for LIMIT/OFFSET directly
            // 'mysql2' driver sometimes rejects numbers in parameterized prepared statements for LIMIT
            query += ` LIMIT ${parsedLimit} OFFSET ${offset}`;
        }

        const [locations] = await db.execute(query, params);
        const [countResult] = await db.execute(countQuery, countParams);

        res.json({
            data: locations,
            total: countResult[0].total,
            page: parseInt(page, 10),
            limit: limit === 'all' ? 'all' : parseInt(limit, 10),
            totalPages: limit === 'all' ? 1 : Math.ceil(countResult[0].total / parseInt(limit, 10))
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/locations', async (req, res) => {
    const { name, coordinates } = req.body;
    try {
        const parsed = parseCoordinates(coordinates);
        if (!parsed) {
            return res.status(400).json({ error: 'Invalid coordinates format. Expected format: 23.8041° N, 90.4152° E' });
        }
        const [result] = await db.execute('INSERT INTO locations (name, latitude, longitude) VALUES (?, ?, ?)', [name, parsed.latitude, parsed.longitude]);
        res.status(201).json({ id: result.insertId, name });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/locations/:id', async (req, res) => {
    const { name, coordinates } = req.body;
    try {
        const parsed = parseCoordinates(coordinates);
        if (!parsed) {
            return res.status(400).json({ error: 'Invalid coordinates format. Expected format: 23.8041° N, 90.4152° E' });
        }
        await db.execute('UPDATE locations SET name = ?, latitude = ?, longitude = ? WHERE id = ?', [name, parsed.latitude, parsed.longitude, req.params.id]);
        res.json({ message: 'Location updated successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/locations/:id/toggle', async (req, res) => {
    try {
        await db.execute('UPDATE locations SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        res.json({ message: 'Location status updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/locations', async (req, res) => {
    try {
        await db.execute('DELETE FROM locations');
        res.json({ message: 'All locations deleted successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/locations/:id', async (req, res) => {
    try {
        // Also clean up associated alerts manually if cascading deletes aren't set up perfectly or just let DB handle it.
        // Assuming DB foreign keys (ON DELETE CASCADE) handles alerts and weather_logs.
        await db.execute('DELETE FROM locations WHERE id = ?', [req.params.id]);
        res.json({ message: 'Location deleted successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DISASTERS ---
router.get('/disasters', async (req, res) => {
    try {
        const { search, page = 1, limit = 10, activeOnly } = req.query;
        let query = 'SELECT * FROM disasters';
        let countQuery = 'SELECT COUNT(*) as total FROM disasters';
        const params = [];
        const countParams = [];
        const conditions = [];

        if (search) {
            conditions.push('(name LIKE ? OR description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
            countParams.push(`%${search}%`, `%${search}%`);
        }

        if (activeOnly === 'true') {
            conditions.push('is_active = 1');
        }

        if (conditions.length > 0) {
            const whereClause = ' WHERE ' + conditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ' ORDER BY created_at DESC';

        if (limit !== 'all') {
            const parsedLimit = parseInt(limit, 10);
            const offset = (parseInt(page, 10) - 1) * parsedLimit;
            query += ` LIMIT ${parsedLimit} OFFSET ${offset}`;
        }

        const [disasters] = await db.execute(query, params);

        if (limit === 'all') {
            // For legacy compat without refactoring entire UI if limit=all is used
            return res.json({
                data: disasters,
                total: disasters.length,
                page: 1,
                limit: 'all',
                totalPages: 1
            });
        }

        const [countResult] = await db.execute(countQuery, countParams);
        res.json({
            data: disasters,
            total: countResult[0].total,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            totalPages: Math.ceil(countResult[0].total / parseInt(limit, 10))
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/disasters', async (req, res) => {
    const { name, description } = req.body;
    try {
        const [result] = await db.execute('INSERT INTO disasters (name, description) VALUES (?, ?)', [name, description]);
        res.status(201).json({ id: result.insertId, name, description });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/disasters/:id', async (req, res) => {
    const { name, description } = req.body;
    try {
        await db.execute('UPDATE disasters SET name = ?, description = ? WHERE id = ?', [name, description, req.params.id]);
        res.json({ message: 'Disaster updated successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/disasters/:id/toggle', async (req, res) => {
    try {
        await db.execute('UPDATE disasters SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        res.json({ message: 'Disaster status updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/disasters/:id', async (req, res) => {
    try {
        await db.execute('DELETE FROM disasters WHERE id = ?', [req.params.id]);
        res.json({ message: 'Disaster deleted successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- RULES ---
router.get('/rules', async (req, res) => {
    try {
        const { search, location_id, disaster_id, limit = 10, page = 1 } = req.query;
        let query = `
            SELECT ar.*, l.name as location_name, d.name as disaster_name 
            FROM alert_rules ar
            LEFT JOIN locations l ON ar.location_id = l.id
            JOIN disasters d ON ar.disaster_id = d.id
        `;
        let countQuery = `
            SELECT COUNT(*) as total
            FROM alert_rules ar
            LEFT JOIN locations l ON ar.location_id = l.id
            JOIN disasters d ON ar.disaster_id = d.id
        `;
        const params = [];
        const countParams = [];
        const conditions = [];

        if (search) {
            conditions.push('(l.name LIKE ? OR d.name LIKE ? OR ar.message_template LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (location_id) {
            if (location_id === 'global') {
                conditions.push('ar.location_id IS NULL');
            } else {
                conditions.push('ar.location_id = ?');
                params.push(location_id);
                countParams.push(location_id);
            }
        }
        if (disaster_id) {
            conditions.push('ar.disaster_id = ?');
            params.push(disaster_id);
            countParams.push(disaster_id);
        }

        if (conditions.length > 0) {
            const whereClause = ' WHERE ' + conditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ' ORDER BY ar.location_id IS NULL DESC, ar.created_at DESC';

        if (limit !== 'all') {
            const parsedLimit = parseInt(limit, 10);
            const offset = (parseInt(page, 10) - 1) * parsedLimit;
            query += ` LIMIT ${parsedLimit} OFFSET ${offset}`;
        }

        const [rules] = await db.execute(query, params);

        if (limit === 'all') {
            return res.json({ data: rules, total: rules.length, page: 1, limit: 'all', totalPages: 1 });
        }

        const [countResult] = await db.execute(countQuery, countParams);
        res.json({
            data: rules,
            total: countResult[0].total,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            totalPages: Math.ceil(countResult[0].total / parseInt(limit, 10))
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/rules', async (req, res) => {
    const { location_id, disaster_id, weather_condition, threshold_value, operator, message_template, severity_level } = req.body;
    try {
        const locId = location_id ? location_id : null; // null = global
        const [result] = await db.execute(
            'INSERT INTO alert_rules (location_id, disaster_id, weather_condition, threshold_value, operator, message_template, severity_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [locId, disaster_id, weather_condition, threshold_value, operator, message_template, severity_level || 'Medium']
        );
        res.status(201).json({ id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rules/:id/toggle', async (req, res) => {
    try {
        await db.execute('UPDATE alert_rules SET is_active = NOT is_active WHERE id = ?', [req.params.id]);
        res.json({ message: 'Rule status updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rules/:id', async (req, res) => {
    const { location_id, disaster_id, weather_condition, threshold_value, operator, message_template, severity_level } = req.body;
    try {
        const locId = location_id ? location_id : null; // null = global
        await db.execute(
            'UPDATE alert_rules SET location_id=?, disaster_id=?, weather_condition=?, threshold_value=?, operator=?, message_template=?, severity_level=? WHERE id=?',
            [locId, disaster_id, weather_condition, threshold_value, operator, message_template, severity_level || 'Medium', req.params.id]
        );
        res.json({ message: 'Rule updated successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rules/:id', async (req, res) => {
    try {
        await db.execute('DELETE FROM alert_rules WHERE id = ?', [req.params.id]);
        res.json({ message: 'Rule deleted successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SYSTEM ---
router.get('/settings', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT setting_key, setting_value FROM settings');
        const settings = {};
        rows.forEach(r => settings[r.setting_key] = r.setting_value);
        res.json(settings);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings', async (req, res) => {
    try {
        const updates = req.body;
        for (const [key, value] of Object.entries(updates)) {
            // Validate minimums to prevent abuse
            const intVal = parseInt(value, 10);
            if (!isNaN(intVal) && intVal < 30 && key.includes('fetch_interval')) {
                return res.status(400).json({ error: 'Intervals cannot be less than 30 seconds to prevent API rate limits.' });
            }
            await db.execute(
                'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, value, value]
            );
        }
        res.json({ message: 'Settings saved successfully' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/latest-fetch-time', async (req, res) => {
    try {
        const [weatherRows] = await db.execute('SELECT MAX(fetched_at) as max_time FROM weather_logs');
        const [eqRows] = await db.execute('SELECT MAX(fetched_at) as max_time FROM earthquake_logs');

        const wTime = weatherRows[0]?.max_time ? new Date(weatherRows[0].max_time).getTime() : 0;
        const eTime = eqRows[0]?.max_time ? new Date(eqRows[0].max_time).getTime() : 0;
        const latestTimeMs = Math.max(wTime, eTime);

        res.json({ latest_fetch_time: latestTimeMs > 0 ? new Date(latestTimeMs) : null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- WEATHER HISTORY ---
router.get('/weather-logs', async (req, res) => {
    try {
        const { location_id, date_from, date_to, limit = 10, page = 1 } = req.query;
        const params = [];
        const countParams = [];
        const conditions = [];

        let query = `
            SELECT wl.*, l.name as location_name 
            FROM weather_logs wl
            JOIN locations l ON wl.location_id = l.id
        `;
        let countQuery = `SELECT COUNT(*) as total FROM weather_logs wl JOIN locations l ON wl.location_id = l.id`;

        if (location_id) {
            conditions.push('wl.location_id = ?');
            params.push(location_id);
            countParams.push(location_id);
        }
        if (date_from) {
            conditions.push('wl.fetched_at >= ?');
            params.push(date_from);
            countParams.push(date_from);
        }
        if (date_to) {
            // Include the entire end date by going to 23:59:59
            conditions.push('wl.fetched_at <= DATE_ADD(?, INTERVAL 1 DAY)');
            params.push(date_to);
            countParams.push(date_to);
        }

        if (conditions.length > 0) {
            const whereClause = ' WHERE ' + conditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }

        query += ' ORDER BY wl.fetched_at DESC';

        const limitNum = parseInt(limit);
        const pageNum = parseInt(page);
        const offsetNum = (pageNum - 1) * limitNum;
        query += ` LIMIT ${limitNum} OFFSET ${offsetNum}`;

        const [logs] = await db.execute(query, params);
        const [countResult] = await db.execute(countQuery, countParams);
        const total = countResult[0].total;

        res.json({
            data: logs,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
// --- EARTHQUAKE HISTORY ---
router.get('/earthquake-logs', async (req, res) => {
    try {
        const { location_id, date_from, date_to, limit = 10, page = 1 } = req.query;
        const params = [];
        const countParams = [];
        const conditions = [];

        let query = `
            SELECT el.*, l.name as location_name 
            FROM earthquake_logs el
            JOIN locations l ON el.location_id = l.id
        `;
        let countQuery = `SELECT COUNT(*) as total FROM earthquake_logs el JOIN locations l ON el.location_id = l.id`;

        if (location_id) {
            conditions.push('el.location_id = ?');
            params.push(location_id); countParams.push(location_id);
        }
        if (date_from) {
            conditions.push('el.fetched_at >= ?');
            params.push(date_from); countParams.push(date_from);
        }
        if (date_to) {
            conditions.push('el.fetched_at <= DATE_ADD(?, INTERVAL 1 DAY)');
            params.push(date_to); countParams.push(date_to);
        }
        if (conditions.length > 0) {
            const where = ' WHERE ' + conditions.join(' AND ');
            query += where; countQuery += where;
        }

        query += ' ORDER BY el.fetched_at DESC';
        const limitNum = parseInt(limit);
        const pageNum = parseInt(page);
        query += ` LIMIT ${limitNum} OFFSET ${(pageNum - 1) * limitNum}`;

        const [logs] = await db.execute(query, params);
        const [countResult] = await db.execute(countQuery, countParams);
        const total = countResult[0].total;

        res.json({ data: logs, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- MANUAL EARTHQUAKE SIMULATOR ---
router.post('/simulate-earthquake', async (req, res) => {
    try {
        const { latitude, longitude, magnitude } = req.body;
        if (latitude == null || longitude == null || !magnitude) {
            return res.status(400).json({ error: 'latitude, longitude, and magnitude are required' });
        }

        const epicenterLat = parseFloat(latitude);
        const epicenterLon = parseFloat(longitude);
        const mag = parseFloat(magnitude);

        const [locationRows] = await db.execute('SELECT * FROM locations WHERE is_active = 1');
        if (locationRows.length === 0) return res.status(404).json({ error: 'No active locations found' });

        const earthquakeService = require('../services/earthquakeService');
        const { checkRulesAndAlert } = require('../services/scheduler');

        const usgs_id = `test-eq-${Date.now()}`;
        const earthquakeData = {
            magnitude: mag,
            id: usgs_id,
            place: `Simulated event at (${epicenterLat.toFixed(4)}, ${epicenterLon.toFixed(4)})`
        };

        // Mirror real behavior: alert every active location within 500 km (Haversine)
        const RADIUS_KM = 500;
        const affected = [];

        for (const loc of locationRows) {
            const R = 6371;
            const dLat = (loc.latitude - epicenterLat) * Math.PI / 180;
            const dLon = (loc.longitude - epicenterLon) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(epicenterLat * Math.PI / 180) * Math.cos(loc.latitude * Math.PI / 180) *
                Math.sin(dLon / 2) ** 2;
            const distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            if (distanceKm <= RADIUS_KM) {
                affected.push({ name: loc.name, distanceKm: Math.round(distanceKm) });
                await earthquakeService.logEarthquakeData(loc.id, earthquakeData, true);
                await checkRulesAndAlert(loc, null, earthquakeData);
            }
        }

        res.json({
            message: `Earthquake simulated. ${affected.length} location(s) within ${RADIUS_KM} km alerted.`,
            affected_locations: affected,
            earthquakeData
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- MANUAL WEATHER SIMULATOR ---
router.post('/simulate-weather', async (req, res) => {
    try {
        const { location_id, temperature, rain_sum, wind_speed, humidity, aqi } = req.body;
        if (!location_id) return res.status(400).json({ error: 'location_id is required' });

        const [locationRows] = await db.execute('SELECT * FROM locations WHERE id = ?', [location_id]);
        if (locationRows.length === 0) return res.status(404).json({ error: 'Location not found' });
        const location = locationRows[0];

        // Build a synthetic weatherData object using the same field names the scheduler uses
        const weatherData = {
            temperature_2m: parseFloat(temperature) || 0,
            rain: parseFloat(rain_sum) || 0,
            wind_speed_10m: parseFloat(wind_speed) || 0,
            relative_humidity_2m: parseFloat(humidity) || 0,
            us_aqi: aqi != null ? parseFloat(aqi) : null,
        };

        const { checkRulesAndAlert } = require('../services/scheduler');
        await checkRulesAndAlert(location, weatherData, null);

        res.json({ message: 'Weather simulation evaluated successfully', location: location.name, weatherData });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ALERT HISTORY ---
router.get('/alert-logs', async (req, res) => {
    try {
        const { location_id, disaster_id, date_from, date_to, limit = 10, page = 1 } = req.query;
        const params = [];
        const countParams = [];
        const conditions = [];

        let query = `
            SELECT a.*, d.name as disaster_name, l.name as location_name 
            FROM alerts a
            JOIN disasters d ON a.disaster_id = d.id
            JOIN locations l ON a.location_id = l.id
        `;
        let countQuery = `SELECT COUNT(*) as total FROM alerts a JOIN disasters d ON a.disaster_id = d.id JOIN locations l ON a.location_id = l.id`;

        if (location_id) {
            conditions.push('a.location_id = ?');
            params.push(location_id); countParams.push(location_id);
        }
        if (disaster_id) {
            conditions.push('a.disaster_id = ?');
            params.push(disaster_id); countParams.push(disaster_id);
        }
        if (date_from) {
            conditions.push('a.created_at >= ?');
            params.push(date_from); countParams.push(date_from);
        }
        if (date_to) {
            conditions.push('a.created_at <= DATE_ADD(?, INTERVAL 1 DAY)');
            params.push(date_to); countParams.push(date_to);
        }
        if (conditions.length > 0) {
            const where = ' WHERE ' + conditions.join(' AND ');
            query += where; countQuery += where;
        }

        query += ' ORDER BY a.created_at DESC';
        const limitNum = parseInt(limit);
        const pageNum = parseInt(page);
        query += ` LIMIT ${limitNum} OFFSET ${(pageNum - 1) * limitNum}`;

        const [alerts] = await db.execute(query, params);
        const [countResult] = await db.execute(countQuery, countParams);
        const total = countResult[0].total;

        res.json({ data: alerts, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DELETE ALL ALERTS ---
router.delete('/alert-logs', async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM alerts');
        res.json({ message: `Deleted ${result.affectedRows} alert(s) successfully.`, deleted: result.affectedRows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- FULL SYSTEM RESET (runs seed.js) ---
router.post('/reset', async (req, res) => {
    try {
        const { execFile } = require('child_process');
        const path = require('path');
        const seedScript = path.join(__dirname, '../scripts/seed.js');

        execFile(process.execPath, [seedScript], { timeout: 30000, env: process.env }, (err, stdout, stderr) => {
            if (err) {
                console.error('Reset failed:', stderr || err.message);
                return res.status(500).json({ error: 'Reset failed', details: stderr || err.message });
            }
            console.log('Reset output:', stdout);
            res.json({ message: 'System reset complete. Database re-seeded.', output: stdout });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- DELETE ALL ---
router.delete('/rules/all', async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM alert_rules');
        res.json({ message: `Deleted ${result.affectedRows} rule(s) successfully.`, deleted: result.affectedRows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/weather-logs/all', async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM weather_logs');
        res.json({ message: `Deleted ${result.affectedRows} weather log(s) successfully.`, deleted: result.affectedRows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/earthquake-logs/all', async (req, res) => {
    try {
        const [result] = await db.execute('DELETE FROM earthquake_logs');
        res.json({ message: `Deleted ${result.affectedRows} earthquake log(s) successfully.`, deleted: result.affectedRows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ADMIN MANAGEMENT ---
router.get('/admins', async (req, res) => {
    try {
        const [admins] = await db.execute('SELECT id, email, created_at FROM admins ORDER BY created_at ASC');
        res.json({ data: admins });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admins', async (req, res) => {
    const { email, password } = req.body;
    try {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await db.execute('INSERT INTO admins (email, password) VALUES (?, ?)', [email, hashedPassword]);
        res.status(201).json({ id: result.insertId, email });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Admin with this email already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

router.delete('/admins/:id', async (req, res) => {
    try {
        const [adminInfo] = await db.execute('SELECT email FROM admins WHERE id = ?', [req.params.id]);
        if (adminInfo.length === 0) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        if (adminInfo[0].email === 'hstu@gmail.com') {
            return res.status(400).json({ error: 'Cannot delete the master admin account (hstu@gmail.com)' });
        }

        const [result] = await db.execute('DELETE FROM admins WHERE id = ?', [req.params.id]);
        res.json({ message: 'Admin deleted successfully', deleted: result.affectedRows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
