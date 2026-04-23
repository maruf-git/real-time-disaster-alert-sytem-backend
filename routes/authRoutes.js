const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');



// Admin Login
router.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [admins] = await db.execute('SELECT * FROM admins WHERE email = ?', [email]);
        if (admins.length === 0) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }
        const admin = admins[0];

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        res.json({ authenticated: true, email: admin.email });
    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ message: 'Error logging in as admin' });
    }
});

module.exports = router;
