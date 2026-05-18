'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { query } = require('../config/db');

// Ensure uploads/unknown-faces directory exists
const UNKNOWN_DIR = path.join(__dirname, '..', 'uploads', 'unknown-faces');
if (!fs.existsSync(UNKNOWN_DIR)) fs.mkdirSync(UNKNOWN_DIR, { recursive: true });

// ── Column existence check (lazy, cached) ─────────────────────────────────────
// If the DB migration hasn't run yet (e.g. backend started before the code change
// was applied), queries referencing `status` would crash. We detect this once and
// use safe fallback queries until the column is available.
let _statusColReady = null; // null = unchecked, true/false after first check

async function hasStatusCol() {
  if (_statusColReady !== null) return _statusColReady;
  try {
    const [rows] = await query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'unknown_faces'
         AND COLUMN_NAME  = 'status'
       LIMIT 1`
    );
    _statusColReady = rows.length > 0;
  } catch (_) {
    _statusColReady = false;
  }
  return _statusColReady;
}

// ── POST /api/unknown-faces/log — called by Python device ─────────────────────
router.post('/log', async (req, res) => {
  const { cluster_id, face_image, device_ip, device_name, captured_at } = req.body;

  if (!cluster_id || !face_image) {
    return res.status(400).json({ error: 'cluster_id and face_image are required' });
  }

  try {
    // Find camera_id by device_ip
    let camera_id = null;
    if (device_ip) {
      const [cams] = await query('SELECT id FROM cameras WHERE device_ip = ? LIMIT 1', [device_ip]);
      if (cams.length > 0) camera_id = cams[0].id;
    }

    const ts = captured_at || new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Save image file: uploads/unknown-faces/<cluster_id>/<timestamp_random>.jpg
    const clusterDir = path.join(UNKNOWN_DIR, cluster_id);
    if (!fs.existsSync(clusterDir)) fs.mkdirSync(clusterDir, { recursive: true });

    const imgId   = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const imgFile = `${imgId}.jpg`;
    const imgPath = path.join(clusterDir, imgFile);
    const b64     = face_image.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(imgPath, Buffer.from(b64, 'base64'));
    const relPath = `unknown-faces/${cluster_id}/${imgFile}`;

    // Reset column cache so the next list request re-checks after migration may have run
    _statusColReady = null;

    const [result] = await query(
      `INSERT INTO unknown_faces (cluster_id, camera_id, device_ip, device_name, image_path, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [cluster_id, camera_id, device_ip || null, device_name || null, relPath, ts]
    );

    // Get updated cluster capture count
    const [[{ capture_count }]] = await query(
      'SELECT COUNT(*) AS capture_count FROM unknown_faces WHERE cluster_id = ?',
      [cluster_id]
    );

    // Broadcast real-time event to web clients
    const io = req.app.get('io');
    if (io) {
      io.to('web_clients').emit('unknown_face_detected', {
        id: result.insertId,
        cluster_id,
        camera_id,
        device_name: device_name || null,
        image_path: relPath,
        captured_at: ts,
        capture_count,
      });
    }

    res.json({ success: true, id: result.insertId, cluster_id });
  } catch (err) {
    console.error('[UnknownFaces] log error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/unknown-faces/stats — sidebar badge count ────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const hasStatus = await hasStatusCol();
    if (!hasStatus) return res.json({ new_count: 0 });
    const [[{ new_count }]] = await query(
      `SELECT COUNT(DISTINCT cluster_id) AS new_count FROM unknown_faces WHERE status = 'new'`
    );
    res.json({ new_count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/unknown-faces/mark-all-reviewed — bulk clear new badge ───────────
router.put('/mark-all-reviewed', async (req, res) => {
  try {
    const hasStatus = await hasStatusCol();
    if (!hasStatus) return res.json({ success: true, updated: 0 });
    const [result] = await query(
      `UPDATE unknown_faces SET status = 'reviewed' WHERE status = 'new'`
    );
    res.json({ success: true, updated: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/unknown-faces/devices — all registered cameras + unknown counts ────
// Always includes every camera from the cameras table so the dropdown is
// populated even when a camera hasn't detected any unknowns yet.
router.get('/devices', async (req, res) => {
  try {
    // Counts from unknown_faces keyed by device_name
    const [ufRows] = await query(
      `SELECT device_name, COUNT(DISTINCT cluster_id) AS cluster_count
       FROM unknown_faces
       WHERE device_name IS NOT NULL AND device_name != ''
       GROUP BY device_name`
    );
    const countMap = {};
    for (const r of ufRows) countMap[r.device_name] = r.cluster_count;

    // All registered camera names
    const [camRows] = await query(
      `SELECT name FROM cameras WHERE name IS NOT NULL AND name != '' ORDER BY name`
    );

    // Union: registered cameras + any extra device_names present in unknown_faces
    const allNames = new Set(camRows.map((c) => c.name));
    for (const r of ufRows) allNames.add(r.device_name);

    const devices = Array.from(allNames)
      .map((name) => ({ device_name: name, cluster_count: countMap[name] || 0 }))
      .sort((a, b) => b.cluster_count - a.cluster_count || a.device_name.localeCompare(b.device_name));

    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/unknown-faces — list clusters (one per cluster_id) ────────────────
router.get('/', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit, 10) || 24);
  const offset = (page - 1) * limit;
  const status = req.query.status;      // 'new' | 'reviewed' | 'registered' | undefined
  const device = req.query.device_name; // filter by which device detected the unknown

  try {
    const hasStatus = await hasStatusCol();

    // Build WHERE conditions for aliased (uf.) and unaliased (unknown_faces.) contexts
    const condA = [], condU = [], whereParams = [];
    if (status && hasStatus) {
      condA.push('uf.status = ?');
      condU.push('unknown_faces.status = ?');
      whereParams.push(status);
    }
    if (device) {
      condA.push('uf.device_name = ?');
      condU.push('unknown_faces.device_name = ?');
      whereParams.push(device);
    }
    const whereAliased   = condA.length ? `WHERE ${condA.join(' AND ')}` : '';
    const whereUnaliased = condU.length ? `WHERE ${condU.join(' AND ')}` : '';

    const statusSelect = hasStatus ? ', MAX(uf.status) AS status' : ", 'new' AS status";

    const [clusters] = await query(
      `SELECT
         uf.cluster_id,
         COUNT(*)            AS capture_count,
         MAX(uf.captured_at) AS last_seen,
         MIN(uf.captured_at) AS first_seen,
         (SELECT u2.image_path FROM unknown_faces u2
          WHERE u2.cluster_id = uf.cluster_id
          ORDER BY u2.captured_at DESC LIMIT 1) AS latest_image,
         MAX(uf.camera_id)   AS camera_id,
         MAX(c.name)         AS camera_name,
         MAX(uf.device_name) AS device_name
         ${statusSelect}
       FROM unknown_faces uf
       LEFT JOIN cameras c ON c.id = uf.camera_id
       ${whereAliased}
       GROUP BY uf.cluster_id
       ORDER BY last_seen DESC
       LIMIT ? OFFSET ?`,
      [...whereParams, limit, offset]
    );

    const [[{ total }]] = await query(
      `SELECT COUNT(DISTINCT cluster_id) AS total FROM unknown_faces ${whereUnaliased}`,
      whereParams
    );

    let new_count = 0;
    if (hasStatus) {
      const [[row]] = await query(
        `SELECT COUNT(DISTINCT cluster_id) AS new_count FROM unknown_faces WHERE status = 'new'`
      );
      new_count = row.new_count;
    }

    res.json({
      clusters,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      new_count,
    });
  } catch (err) {
    console.error('[UnknownFaces] list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/unknown-faces/cluster/:clusterId — all captures for one cluster ──
router.get('/cluster/:clusterId', async (req, res) => {
  try {
    const hasStatus  = await hasStatusCol();
    const statusSel  = hasStatus ? 'uf.status,' : "'new' AS status,";
    const [faces] = await query(
      `SELECT uf.id, uf.cluster_id, uf.image_path, uf.captured_at, ${statusSel}
              c.name AS camera_name, uf.device_name, uf.camera_id
       FROM unknown_faces uf
       LEFT JOIN cameras c ON c.id = uf.camera_id
       WHERE uf.cluster_id = ?
       ORDER BY uf.captured_at DESC`,
      [req.params.clusterId]
    );
    res.json({ faces });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/unknown-faces/cluster/:clusterId/status ──────────────────────────
router.put('/cluster/:clusterId/status', async (req, res) => {
  const { status } = req.body;
  if (!['new', 'reviewed', 'registered'].includes(status)) {
    return res.status(400).json({ error: 'status must be new | reviewed | registered' });
  }
  try {
    const hasStatus = await hasStatusCol();
    if (!hasStatus) return res.json({ success: true }); // column not yet added, no-op
    await query(
      'UPDATE unknown_faces SET status = ? WHERE cluster_id = ?',
      [status, req.params.clusterId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/unknown-faces/cluster/:clusterId — delete entire cluster ───────
router.delete('/cluster/:clusterId', async (req, res) => {
  try {
    const clusterDir = path.join(UNKNOWN_DIR, req.params.clusterId);
    if (fs.existsSync(clusterDir)) {
      fs.rmSync(clusterDir, { recursive: true, force: true });
    }
    await query('DELETE FROM unknown_faces WHERE cluster_id = ?', [req.params.clusterId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/unknown-faces — delete ALL clusters (optional ?status= filter) ──
router.delete('/', async (req, res) => {
  try {
    const statusFilter = req.query.status || null;
    const useStatus    = statusFilter && await hasStatusCol();

    // Fetch distinct cluster_ids to remove their directories
    let clusterRows;
    if (useStatus) {
      [clusterRows] = await query(
        `SELECT DISTINCT cluster_id FROM unknown_faces WHERE status = ?`,
        [statusFilter]
      );
    } else {
      [clusterRows] = await query(`SELECT DISTINCT cluster_id FROM unknown_faces`);
    }

    // Remove files for each cluster
    for (const { cluster_id } of clusterRows) {
      const clusterDir = path.join(UNKNOWN_DIR, cluster_id);
      if (fs.existsSync(clusterDir)) {
        try { fs.rmSync(clusterDir, { recursive: true, force: true }); } catch (_) {}
      }
    }

    // Delete DB rows
    if (useStatus) {
      await query(`DELETE FROM unknown_faces WHERE status = ?`, [statusFilter]);
    } else {
      await query(`DELETE FROM unknown_faces`);
    }

    res.json({ success: true, deleted: clusterRows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/unknown-faces/:id — delete single capture ─────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [[face]] = await query('SELECT image_path FROM unknown_faces WHERE id = ?', [req.params.id]);
    if (face?.image_path) {
      const fullPath = path.join(__dirname, '..', 'uploads', face.image_path);
      try { fs.unlinkSync(fullPath); } catch (_) {}
    }
    await query('DELETE FROM unknown_faces WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
