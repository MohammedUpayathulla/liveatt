'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');

const { pool }  = require('../config/db');   // raw promise pool so we can getConnection()
const cfg       = require('../config/index');

// POST /api/admin/reset
// Clears all data except cameras and settings.
// Uses a dedicated connection so FK_CHECKS toggle applies to every statement.
router.post('/reset', async (req, res) => {
  const results = {};

  // ── 1. MySQL: get ONE dedicated connection so SET FK_CHECKS sticks ─────────
  let conn;
  try {
    conn = await pool.getConnection();
  } catch (err) {
    return res.status(500).json({ error: `DB connection failed: ${err.message}` });
  }

  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    // Delete in child→parent order so even without FK toggle it would work
    const tables = [
      'device_sync_results',   // FK → employees, cameras, device_sync_jobs
      'device_sync_history',   // FK → employees, cameras
      'device_sync_jobs',      // FK → (nothing pointing in now)
      'attendance_logs',        // FK → employees, cameras
      'daily_attendance',       // FK → employees
      'unknown_faces',          // no FK
      'employees',              // parent — must be last
    ];

    for (const t of tables) {
      try {
        await conn.query(`TRUNCATE TABLE \`${t}\``);
        results[t] = 'truncated';
        console.log(`[Admin] TRUNCATE ${t} — OK`);
      } catch (err) {
        results[t] = `skipped: ${err.message}`;
        console.warn(`[Admin] TRUNCATE ${t} — ${err.message}`);
      }
    }

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }

  // ── 2. Delete uploaded image files ─────────────────────────────────────────
  const deleteDirContents = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
        else fs.unlinkSync(full);
      } catch (_) {}
    }
  };

  deleteDirContents(path.join(__dirname, '..', 'uploads', 'faces'));
  deleteDirContents(path.join(__dirname, '..', 'uploads', 'unknown-faces'));
  results['uploads/faces']         = 'cleared';
  results['uploads/unknown-faces'] = 'cleared';

  // ── 3. Clear face embeddings on every Pi ───────────────────────────────────
  try {
    const [ipRows] = await pool.query(
      `SELECT DISTINCT device_ip FROM cameras WHERE device_ip IS NOT NULL AND device_ip != ''`
    );
    const piSettled = await Promise.allSettled(
      ipRows.map(async ({ device_ip }) => {
        await axios.post(`${cfg.PYTHON.urlFor(device_ip)}/clear-all-faces`, {},
          { headers: { 'Content-Type': 'application/json' }, timeout: 8000 });
        return device_ip;
      })
    );
    results['pi_sqlite'] = piSettled.map((r) =>
      r.status === 'fulfilled' ? `${r.value}: cleared` : `failed: ${r.reason?.message}`
    );
  } catch (err) {
    results['pi_sqlite'] = `failed: ${err.message}`;
  }

  // ── 4. Notify UI ───────────────────────────────────────────────────────────
  const io = req.app.get('io');
  if (io) io.emit('data_reset', { message: 'All data has been reset.' });

  console.log('[Admin] Reset complete:', results);
  res.json({ success: true, results });
});

module.exports = router;
