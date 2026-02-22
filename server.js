const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./config/db');

// Import Scheduler (to start it)
const scheduler = require('./services/scheduler');
scheduler.start();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes Placeholder
app.get('/', (req, res) => {
    res.send('11th Hour Disaster Alert System API is running');
});

// Import Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/alerts', require('./routes/alertRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/weather', require('./routes/weatherRoutes'));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
