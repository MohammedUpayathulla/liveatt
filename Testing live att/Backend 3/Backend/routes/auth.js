'use strict';

const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const JWT_SECRET    = process.env.JWT_SECRET    || 'live-att-secret-2026';
const JWT_EXPIRES   = process.env.JWT_EXPIRES   || '24h';
const ADMIN_USER    = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS    = process.env.ADMIN_PASSWORD || 'admin@123';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  if (username !== ADMIN_USER || password !== ADMIN_PASS) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = jwt.sign({ username, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

  return res.json({ token, username, expiresIn: JWT_EXPIRES });
});

// POST /api/auth/logout  (client-side token drop, server just acks)
router.post('/logout', (_req, res) => {
  res.json({ message: 'Logged out.' });
});

module.exports = router;
