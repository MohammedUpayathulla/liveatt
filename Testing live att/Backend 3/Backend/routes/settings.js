'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

// GET /api/settings - get all settings as key-value object
router.get('/', async (req, res) => {
  try {
    const [rows] = await query('SELECT setting_key, setting_value FROM settings');
    const settings = {};
    rows.forEach((r) => {
      const num = Number(r.setting_value);
      settings[r.setting_key] = isNaN(num) ? r.setting_value : num;
    });
    res.json({ settings });
  } catch (err) {
    console.error('[Settings] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch settings.' });
  }
});

// POST /api/settings - upsert settings
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object.' });
    }

    const entries = Object.entries(body);
    if (!entries.length) {
      return res.status(400).json({ error: 'No settings provided.' });
    }

    await Promise.all(
      entries.map(([key, value]) =>
        query(
          `INSERT INTO settings (setting_key, setting_value)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [String(key), String(value)]
        )
      )
    );

    // Return updated settings
    const [rows] = await query('SELECT setting_key, setting_value FROM settings');
    const settings = {};
    rows.forEach((r) => {
      const num = Number(r.setting_value);
      settings[r.setting_key] = isNaN(num) ? r.setting_value : num;
    });

    res.json({ settings, message: 'Settings saved.' });
  } catch (err) {
    console.error('[Settings] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to save settings.' });
  }
});

module.exports = router;
