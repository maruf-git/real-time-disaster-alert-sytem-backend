const axios = require('axios');
const db = require('../config/db');

// Function to calculate distance between two lat/lon points in km (Haversine formula)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

// Fetch the USGS all_hour feed
async function fetchRecentEarthquakes() {
    try {
        const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson';
        const response = await axios.get(url);
        return response.data.features; // Array of earthquake events
    } catch (error) {
        console.error('Error fetching earthquake data:', error.message);
        return [];
    }
}

// Check if any recent earthquakes occurred within a radius of a location
// Returns the highest magnitude earthquake within that radius, or null
function checkEarthquakesNearLocation(earthquakes, lat, lon, radiusKm = 500) {
    let maxEq = null;

    for (const eq of earthquakes) {
        const eqLon = eq.geometry.coordinates[0];
        const eqLat = eq.geometry.coordinates[1];
        const magnitude = eq.properties.mag;
        const id = eq.id; // Unique USGS event ID

        const distance = getDistanceFromLatLonInKm(lat, lon, eqLat, eqLon);

        if (distance <= radiusKm) {
            if (!maxEq || magnitude > maxEq.magnitude) {
                maxEq = {
                    id: id,
                    magnitude: magnitude,
                    distance: distance,
                    place: eq.properties.place,
                    time: eq.properties.time
                };
            }
        }
    }
    return maxEq;
}

/**
 * Logs an earthquake instance to the earthquake_logs table
 * We only log if checking against recently logged quakes avoids duplicates
 */
async function logEarthquakeData(locationId, earthquakeData) {
    if (!earthquakeData) return;
    try {
        const query = `
            INSERT INTO earthquake_logs (location_id, magnitude, usgs_id)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE fetched_at=CURRENT_TIMESTAMP
        `;
        const values = [locationId, earthquakeData.magnitude, earthquakeData.id];
        await db.execute(query, values);
    } catch (error) {
        console.error('Error logging earthquake:', error.message);
    }
}

module.exports = {
    fetchRecentEarthquakes,
    checkEarthquakesNearLocation,
    logEarthquakeData
};
