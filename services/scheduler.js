
const weatherService = require('./weatherService');
const earthquakeService = require('./earthquakeService');
const db = require('../config/db');

// Severity rank — higher number = more severe
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

async function checkRulesAndAlert(location, weatherData, earthquakeData = null) {
    try {
        // Fetch all matching active rules for this location (location-specific + global)
        const [rules] = await db.execute(`
            SELECT ar.* 
            FROM alert_rules ar
            JOIN disasters d ON d.id = ar.disaster_id
            WHERE (ar.location_id = ? OR ar.location_id IS NULL) AND d.is_active = 1 AND ar.is_active = 1
        `, [location.id]);

        // Track which disaster_ids were triggered this cycle (for auto-deactivation pass)
        const triggeredDisasterIds = new Set();
        // Track which disaster_ids are earthquake-type (handled separately)
        const earthquakeDisasterIds = new Set();

        for (const rule of rules) {
            let triggered = false;
            let currentValue = null;
            let ruleTarget = null;

            // Map condition to current value
            switch (rule.weather_condition) {
                case 'rain_sum': currentValue = weatherData?.rain; ruleTarget = 'weather'; break;
                case 'wind_speed': currentValue = weatherData?.wind_speed_10m; ruleTarget = 'weather'; break;
                case 'temperature': currentValue = weatherData?.temperature_2m; ruleTarget = 'weather'; break;
                case 'humidity': currentValue = weatherData?.relative_humidity_2m; ruleTarget = 'weather'; break;
                case 'aqi': currentValue = weatherData?.us_aqi; ruleTarget = 'weather'; break;
                case 'earthquake_magnitude': currentValue = earthquakeData?.magnitude; ruleTarget = 'earthquake'; break;
            }

            // Skip if data source for this rule wasn't provided this cycle
            if ((ruleTarget === 'weather' && !weatherData) || (ruleTarget === 'earthquake' && !earthquakeData)) {
                if (ruleTarget === 'earthquake') earthquakeDisasterIds.add(rule.disaster_id);
                continue;
            }
            if (ruleTarget === 'earthquake') earthquakeDisasterIds.add(rule.disaster_id);
            if (currentValue === undefined || currentValue === null) continue;

            // Evaluate operator
            if (rule.operator === '>' && currentValue > rule.threshold_value) triggered = true;
            if (rule.operator === '<' && currentValue < rule.threshold_value) triggered = true;
            if (rule.operator === '>=' && currentValue >= rule.threshold_value) triggered = true;
            if (rule.operator === '<=' && currentValue <= rule.threshold_value) triggered = true;

            const newSeverity = (rule.severity_level || 'Medium').toLowerCase();

            if (triggered) {
                console.log(`[ALERT] Triggered for ${location.name}: ${rule.weather_condition} ${rule.operator} ${rule.threshold_value} (value: ${currentValue})`);
                triggeredDisasterIds.add(rule.disaster_id);

                // ── Earthquake: dedup by USGS event ID ──
                if (ruleTarget === 'earthquake') {
                    const [existing] = await db.execute(
                        'SELECT id FROM alerts WHERE external_id = ? AND location_id = ?',
                        [earthquakeData.id, location.id]
                    );
                    if (existing.length > 0) {
                        console.log('[DEDUP] Earthquake alert already exists for this USGS ID.');
                        continue;
                    }
                    // Deactivate any prior earthquake alert for same disaster+location
                    await db.execute(
                        'UPDATE alerts SET is_active = 0 WHERE disaster_id = ? AND location_id = ? AND is_active = 1',
                        [rule.disaster_id, location.id]
                    );
                    const title = `Automated Alert: ${rule.message_template || 'Seismic Event Detected'}`;
                    const description = `Magnitude ${currentValue} detected. Epicenter: ${earthquakeData.place}. Threshold: ${rule.threshold_value}.`;
                    await db.execute(
                        'INSERT INTO alerts (disaster_id, location_id, title, description, severity, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [rule.disaster_id, location.id, title, description, rule.severity_level || 'Medium', 'System', earthquakeData.id]
                    );
                    console.log(`[ALERT] Earthquake alert inserted for ${location.name}`);
                    continue;
                }

                // ── Weather/AQI: check for existing active alert ──
                const [existingRows] = await db.execute(
                    'SELECT id, severity FROM alerts WHERE disaster_id = ? AND location_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
                    [rule.disaster_id, location.id]
                );

                if (existingRows.length > 0) {
                    const existingSeverity = (existingRows[0].severity || 'medium').toLowerCase();
                    // Always deactivate the previous active alert for this disaster+location
                    // and let the system insert a brand new alert record maintaining the full history log
                    await db.execute(
                        'UPDATE alerts SET is_active = 0 WHERE disaster_id = ? AND location_id = ? AND is_active = 1',
                        [rule.disaster_id, location.id]
                    );
                    console.log(`[HISTORY] Deactivated prior alert for ${location.name} to generate updated history log.`);
                }

                // Insert new alert
                const title = `Automated Alert: ${rule.message_template || 'Hazard Detected'}`;
                const description = `${rule.weather_condition} is ${currentValue} (threshold: ${rule.threshold_value}).`;
                await db.execute(
                    'INSERT INTO alerts (disaster_id, location_id, title, description, severity, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [rule.disaster_id, location.id, title, description, rule.severity_level || 'Medium', 'System', null]
                );
                console.log(`[ALERT] Inserted ${newSeverity} alert for ${location.name} (rule ${rule.id})`);

            } else {
                // ── Not triggered: auto-deactivate existing alert if data cleared ──
                // Only do this for the data source that was actually evaluated this cycle
                // (don't deactivate an earthquake alert just because weather data is fine)
                if (ruleTarget === 'weather' && weatherData) {
                    // Will handle after loop — just pass (tracking is done via triggeredDisasterIds)
                }
            }
        }

        // ── Auto-deactivation pass (weather only) ──
        // For any rule whose disaster was NOT triggered this cycle (and we actually had weather data),
        // deactivate any still-active alert for that disaster+location.
        if (weatherData) {
            // Collect all weather disaster_ids that have rules for this location
            const weatherDisasterIds = rules
                .filter(r => r.weather_condition !== 'earthquake_magnitude')
                .map(r => r.disaster_id);

            for (const disasterId of weatherDisasterIds) {
                if (!triggeredDisasterIds.has(disasterId)) {
                    const [activeAlerts] = await db.execute(
                        'SELECT id FROM alerts WHERE disaster_id = ? AND location_id = ? AND is_active = 1',
                        [disasterId, location.id]
                    );
                    if (activeAlerts.length > 0) {
                        await db.execute(
                            'UPDATE alerts SET is_active = 0 WHERE disaster_id = ? AND location_id = ? AND is_active = 1',
                            [disasterId, location.id]
                        );
                        console.log(`[ALL-CLEAR] Deactivated ${activeAlerts.length} alert(s) for disaster ${disasterId} at ${location.name} — condition no longer met.`);
                    }
                }
            }
        }

        // ── Auto-deactivation pass (earthquakes) ──
        // Earthquake alerts should be completely inactive if 30 minutes have passed since their creation.
        // We find any active alerts for earthquake_magnitude disaster types that are > 30 mins old.
        await db.execute(`
            UPDATE alerts a
            JOIN alert_rules ar ON a.disaster_id = ar.disaster_id
            SET a.is_active = 0
            WHERE ar.weather_condition = 'earthquake_magnitude'
              AND a.is_active = 1
              AND a.location_id = ?
              AND a.created_at < NOW() - INTERVAL 30 MINUTE
        `, [location.id]);

    } catch (error) {
        console.error('Error checking rules:', error.message);
    }
}

// Global cache for earthquakes to avoid re-fetching in the same minute loop
let cachedEarthquakes = null;
let earthquakeFetchTime = null;

async function runWeatherCheck() {
    console.log('Running adaptive weather check...');
    try {
        const [locations] = await db.execute('SELECT * FROM locations WHERE is_active = 1');

        for (const location of locations) {
            const weatherData = await weatherService.fetchWeatherData(location.latitude, location.longitude);
            // Optional: Also check earthquake right now so we log it together if requested
            let earthquakeData = null;
            if (cachedEarthquakes) {
                earthquakeData = earthquakeService.checkEarthquakesNearLocation(cachedEarthquakes, location.latitude, location.longitude);
            }

            if (weatherData) {
                await weatherService.logWeatherData(location.id, weatherData, earthquakeData);
                await checkRulesAndAlert(location, weatherData, null); // Evaluate weather rules
            }
        }
    } catch (error) { console.error('Error in weather scheduler:', error.message); }
}

async function runEarthquakeCheck() {
    console.log(`Running adaptive earthquake check...`);
    try {

        const earthquakes = await earthquakeService.fetchRecentEarthquakes();
        cachedEarthquakes = earthquakes;
        earthquakeFetchTime = Date.now();

        const [locations] = await db.execute('SELECT * FROM locations WHERE is_active = 1');

        for (const location of locations) {
            const earthquakeData = earthquakeService.checkEarthquakesNearLocation(earthquakes, location.latitude, location.longitude);

            if (earthquakeData) {
                await earthquakeService.logEarthquakeData(location.id, earthquakeData);
                await checkRulesAndAlert(location, null, earthquakeData); // Evaluate earthquake rules
            }
        }
    } catch (error) { console.error('Error in earthquake scheduler:', error.message); }
}


let weatherTimer = null;
let earthquakeTimer = null;

async function getSetting(key, defaultValue) {
    try {
        const [rows] = await db.execute('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
        if (rows.length > 0) return parseInt(rows[0].setting_value, 10);
    } catch (err) { console.error('Error fetching setting:', err.message); }
    return defaultValue;
}

async function weatherLoop() {
    await runWeatherCheck();
    // Fetch dynamic interval every loop (default 300s)
    const intervalSecs = await getSetting('weather_fetch_interval', 300);
    weatherTimer = setTimeout(weatherLoop, Math.max(30, intervalSecs) * 1000);
}

async function earthquakeLoop() {
    await runEarthquakeCheck();
    // Fetch dynamic interval every loop (default 60s)
    const intervalSecs = await getSetting('earthquake_fetch_interval', 60);
    earthquakeTimer = setTimeout(earthquakeLoop, Math.max(30, intervalSecs) * 1000);
}

module.exports = {
    start: () => {
        console.log('Automated dynamic schedulers started.');
        weatherLoop();
        earthquakeLoop();
    },
    runCheck: runWeatherCheck, // Expose for testing UI if needed
    runEqCheck: runEarthquakeCheck,
    checkRulesAndAlert
};
