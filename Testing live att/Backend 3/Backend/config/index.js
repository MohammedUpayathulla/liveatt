'use strict';

/**
 * Central configuration for the Live Attendance backend.
 * All ports, URLs, timeouts, and service settings are read from .env here.
 * Every other module imports from this file — change .env, reflected everywhere.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const cfg = {
  // ── HTTP / WebSocket server ───────────────────────────────────────────────
  PORT: parseInt(process.env.PORT, 10) || 5000,

  // ── Database ──────────────────────────────────────────────────────────────
  DB: {
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || 'root',
    port:     parseInt(process.env.DB_PORT, 10) || 3306,
    database: process.env.DB_NAME     || 'live_attendance',
  },

  // ── Python AI service ─────────────────────────────────────────────────────
  // PYTHON_SERVICE_URL  = fallback when no per-device IP is known
  // PYTHON_SERVICE_PORT = port that every Pi's Python service listens on
  PYTHON: {
    fallbackUrl: process.env.PYTHON_SERVICE_URL || 'http://localhost:5001',
    port:        parseInt(process.env.PYTHON_SERVICE_PORT, 10) || 5001,
    /** Build URL for a specific device IP, else return the fallback URL. */
    urlFor(deviceIp) {
      return deviceIp ? `http://${deviceIp}:${this.port}` : this.fallbackUrl;
    },
  },

  // ── Security ──────────────────────────────────────────────────────────────
  COM_KEY: process.env.COM_KEY || '',

  // ── File uploads ──────────────────────────────────────────────────────────
  UPLOADS_DIR:   process.env.UPLOADS_DIR || 'uploads',
  MAX_FILE_SIZE: 10 * 1024 * 1024,  // 10 MB

  // ── Socket.IO ─────────────────────────────────────────────────────────────
  SOCKET: {
    cors:       { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  },

  // ── Health watchdog ───────────────────────────────────────────────────────
  WATCHDOG: {
    intervalMs:       15_000,   // check every 15 s
    startDelayMs:     10_000,   // first run 10 s after boot
    offlineThreshold: 40,       // mark offline after 40 s without heartbeat
  },

  // ── HTTP / axios request timeouts ─────────────────────────────────────────
  TIMEOUTS: {
    pythonDefault:  10_000,  // general Python API calls
    pythonEnroll:   60_000,  // embedding extraction (up to 8 images × ~3 s each on Pi)
    pythonDelete:    8_000,  // delete-employee / delete-device
    pythonSnapshot: 10_000,  // ffmpeg snapshot
  },
};

module.exports = cfg;
