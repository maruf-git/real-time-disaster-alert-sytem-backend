const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Get Active Alerts (Optional: Filter by Location)
router.get('/', async (req, res) => {
    const { location_id } = req.query;
    try {
        let query = `
            SELECT a.*, d.name as disaster_name, l.name as location_name 
            FROM alerts a
            JOIN disasters d ON a.disaster_id = d.id
            JOIN locations l ON a.location_id = l.id
            WHERE l.is_active = 1
        `;
        const params = [];

        if (location_id) {
            query += ' AND a.location_id = ?';
            params.push(location_id);
        }

        query += ' ORDER BY a.is_active DESC, a.created_at DESC';

        const [alerts] = await db.execute(query, params);
        res.json(alerts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get Alert Metrics/Stats
router.get('/stats', async (req, res) => {
    try {
        const [stats] = await db.execute(`
            SELECT COUNT(*) as total, a.disaster_id 
            FROM alerts a
            JOIN locations l ON a.location_id = l.id
            WHERE l.is_active = 1
            GROUP BY a.disaster_id
        `);
        res.json(stats);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
