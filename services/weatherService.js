const axios = require('axios');
const db = require('../config/db');

async function fetchWeatherData(lat, lon) {
    try {
        // Fetch Weather
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,rain,wind_speed_10m&timezone=auto`;
        const weatherResponse = await axios.get(weatherUrl);
        const weatherData = weatherResponse.data.current;

        // Fetch AQI
        const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`;
        const aqiResponse = await axios.get(aqiUrl);
        const aqiData = aqiResponse.data.current;

        // Combine
        return {
            ...weatherData,
            us_aqi: aqiData.us_aqi
        };
    } catch (error) {
        console.error('Error fetching weather/AQI data:', error.message);
        return null;
    }
}

async function logWeatherData(locationId, data, earthquakeData = null) {
    if (!data) return;
    try {
        const [existing] = await db.execute(
            'SELECT id FROM weather_logs WHERE location_id = ? AND fetched_at > NOW() - INTERVAL 25 SECOND',
            [locationId]
        );

        if (existing.length > 0) {
            return; // Skip duplicate logging
        }

        const query = `
            INSERT INTO weather_logs (location_id, data, temperature, humidity, rain_sum, wind_speed, aqi, earthquake_magnitude, earthquake_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const combinedData = {
            weather: data,
            earthquake: earthquakeData
        };

        const values = [
            locationId,
            JSON.stringify(combinedData),
            data.temperature_2m,
            data.relative_humidity_2m,
            data.rain,
            data.wind_speed_10m,
            data.us_aqi || null,
            earthquakeData ? earthquakeData.magnitude : null,
            earthquakeData ? earthquakeData.id : null
        ];

        await db.execute(query, values);
        console.log(`Weather/AQI logged for location ${locationId}`);
    } catch (error) {
        console.error('Error logging weather data:', error.message);
    }
}

module.exports = {
    fetchWeatherData,
    logWeatherData
};
