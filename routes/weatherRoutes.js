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
        const { fetchRecentEarthquakes, checkEarthquakesNearLocation } = require('../services/earthquakeService');
        const eqFeed = await fetchRecentEarthquakes();
        const localEq = checkEarthquakesNearLocation(eqFeed, location.latitude, location.longitude);

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
