const express = require("express");
const cors = require("cors");
require("dotenv").config();
const db = require("./config/db");

// Import Scheduler (to start it)
const scheduler = require("./services/scheduler");
scheduler.start();

// Ensure default admin exists
async function ensureDefaultAdmin() {
  try {
    const bcrypt = require("bcryptjs");
    const [rows] = await db.execute("SELECT id FROM admins WHERE email = ?", [
      "hstu@gmail.com",
    ]);
    if (rows.length === 0) {
      const hashedPassword = await bcrypt.hash("hstuadmin", 10);
      await db.execute("INSERT INTO admins (email, password) VALUES (?, ?)", [
        "hstu@gmail.com",
        hashedPassword,
      ]);
      console.log("Default admin (hstu@gmail.com) automatically created.");
    }
  } catch (err) {
    console.error("Error ensuring default admin:", err.message);
  }
}
ensureDefaultAdmin();

const app = express();

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());

// Routes Placeholder
app.get("/", (req, res) => {
  res.send("Real-time Disaster Alert System API is running");
});

// Import Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/alerts", require("./routes/alertRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/weather", require("./routes/weatherRoutes"));

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
