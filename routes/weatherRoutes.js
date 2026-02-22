const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { fetchWeatherData } = require('../services/weatherService');

// GET /api/weather/current?location_id=X
// Fetches live weather for a specific location
router.get('/current', async (req, res) => {
    const { location_id } = req.query;
    if (!location_id) {
        return res.status(400).json({ error: 'location_id is required' });
    }
    try {
        const [rows] = await db.execute('SELECT * FROM locations WHERE id = ?', [location_id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Location not found' });

        const location = rows[0];

        // Fetch weather + AQI
        const weather = await fetchWeatherData(location.latitude, location.longitude);
        if (!weather) return res.status(503).json({ error: 'Unable to fetch weather data from external API' });

        // Try fetching latest eq data directly for dashboard view
        // 1. Check if there is currently an ACTIVE earthquake alert for this location
        const [activeEqs] = await db.execute(`
            SELECT a.description, a.created_at 
            FROM alerts a
            JOIN alert_rules ar ON a.disaster_id = ar.disaster_id
            WHERE ar.weather_condition = 'earthquake_magnitude'
              AND a.is_active = 1
              AND a.location_id = ?
            ORDER BY a.created_at DESC LIMIT 1
        `, [location.id]);

        let localEq = null;

        if (activeEqs.length > 0) {
            const eqAlert = activeEqs[0];
            const magMatch = eqAlert.description.match(/Magnitude ([\d.]+)/);
            const placeMatch = eqAlert.description.match(/Epicenter: (.*?)\. Threshold/);

            localEq = {
                magnitude: magMatch ? parseFloat(magMatch[1]) : 0,
                place: placeMatch ? placeMatch[1] : 'Unknown Location',
                time: eqAlert.created_at,
                // If it's simulated, it might say "Simulated event at ...". If it's real, it has a place name.
                // We don't have exact distance in alerts describing, so we assign a placeholder or 0.
                distance: null
            };
        } else {
            // 2. Fallback to USGS live feed if no active alert exists
            const { fetchRecentEarthquakes, checkEarthquakesNearLocation } = require('../services/earthquakeService');
            const eqFeed = await fetchRecentEarthquakes();
            localEq = checkEarthquakesNearLocation(eqFeed, location.latitude, location.longitude);
        }

        res.json({
            location: { id: location.id, name: location.name, latitude: location.latitude, longitude: location.longitude },
            weather: {
                temperature: weather.temperature_2m,
                humidity: weather.relative_humidity_2m,
                rain: weather.rain,
                wind_speed: weather.wind_speed_10m,
                aqi: weather.us_aqi,
                time: weather.time,
            },
            earthquake: localEq
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
