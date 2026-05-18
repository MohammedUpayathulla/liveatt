'use strict';

const express = require('express');
const router  = express.Router();
const { query }  = require('../config/db');
const { pushOneEmployeeToDevice } = require('../utils/pushEmployee');

// ── In-memory lock: one worker per job at a time ─────────────────────────────
const runningJobs = new Set();

// ── Background worker ─────────────────────────────────────────────────────────
/**
 * Run sync tasks for a given set of result rows.
 * Groups by camera, processes sequentially per camera, emits Socket.IO progress.
 * Protected by runningJobs lock — duplicate calls for the same job are silently dropped.
 *
 * @param {number}   jobId
 * @param {Array}    rows    - device_sync_results rows with employee+camera details
 * @param {Object}   io      - Socket.IO instance
 */
async function runSyncWorker(jobId, rows, io) {
  if (runningJobs.has(jobId)) {
    console.log(`[Sync] Worker for job ${jobId} already running — skipped duplicate.`);
    return;
  }
  runningJobs.add(jobId);
  try {
  // Group rows by camera_id
  const byCamera = {};
  for (const row of rows) {
    if (!byCamera[row.camera_id]) byCamera[row.camera_id] = [];
    byCamera[row.camera_id].push(row);
  }

  let successCount = 0;
  let failCount    = 0;

  for (const cameraId of Object.keys(byCamera)) {
    const cameraRows = byCamera[cameraId];
    const camera = {
      id:        cameraRows[0].camera_id,
      name:      cameraRows[0].camera_name,
      device_ip: cameraRows[0].device_ip,
      status:    cameraRows[0].cam_status,
    };

    // If camera is offline — fail all its rows immediately
    if (camera.status !== 'active' || !camera.device_ip) {
      for (const row of cameraRows) {
        await query(
          `UPDATE device_sync_results SET status='failed', error_msg=?, attempts=attempts+1, last_attempt=NOW() WHERE id=?`,
          ['Device offline or not configured', row.id]
        );
        await query(`UPDATE device_sync_jobs SET done_tasks=done_tasks+1 WHERE id=?`, [jobId]);
        failCount++;
        io.emit('sync_progress', {
          job_id:        jobId,
          result_id:     row.id,
          camera_id:     camera.id,
          camera_name:   camera.name,
          employee_id:   row.employee_id,
          employee_name: row.employee_name,
          status:        'failed',
          error_msg:     'Device offline or not configured',
        });
      }
      continue;
    }

    // Process each employee for this camera
    for (const row of cameraRows) {
      // Mark in_progress
      await query(
        `UPDATE device_sync_results SET status='in_progress', last_attempt=NOW() WHERE id=?`,
        [row.id]
      );

      const employee = {
        id:            row.employee_id,
        employee_code: row.employee_code,
        name:          row.employee_name,
        department:    row.department,
        image_path:    row.image_path,
        face_enrolled: row.face_enrolled,
      };

      let taskStatus = 'success';
      let errorMsg   = null;

      try {
        await pushOneEmployeeToDevice(employee, camera);
        await query(
          `UPDATE device_sync_results SET status='success', error_msg=NULL, attempts=attempts+1 WHERE id=?`,
          [row.id]
        );

        // Write sync history — close any open entry first, then open a new one
        await query(
          `UPDATE device_sync_history SET unsynced_at = NOW()
           WHERE employee_id = ? AND camera_id = ? AND unsynced_at IS NULL`,
          [row.employee_id, camera.id]
        );
        await query(
          `INSERT INTO device_sync_history (employee_id, camera_id, synced_at) VALUES (?, ?, NOW())`,
          [row.employee_id, camera.id]
        );

        successCount++;
      } catch (err) {
        errorMsg   = err.message || 'Unknown error';
        taskStatus = 'failed';
        await query(
          `UPDATE device_sync_results SET status='failed', error_msg=?, attempts=attempts+1 WHERE id=?`,
          [errorMsg, row.id]
        );
        failCount++;
      }

      // Update job done counter
      await query(`UPDATE device_sync_jobs SET done_tasks=done_tasks+1 WHERE id=?`, [jobId]);

      // Emit per-task progress
      io.emit('sync_progress', {
        job_id:        jobId,
        result_id:     row.id,
        camera_id:     camera.id,
        camera_name:   camera.name,
        employee_id:   row.employee_id,
        employee_name: row.employee_name,
        status:        taskStatus,
        error_msg:     errorMsg,
      });
    }
  }

  // Mark job complete
  await query(
    `UPDATE device_sync_jobs SET status='completed', completed_at=NOW() WHERE id=?`,
    [jobId]
  );

  io.emit('sync_complete', { job_id: jobId, success_count: successCount, fail_count: failCount });
  console.log(`[Sync] Job ${jobId} complete — success=${successCount} fail=${failCount}`);
  } finally {
    runningJobs.delete(jobId);
  }
}

// ── Helper: fetch enriched pending/failed rows ────────────────────────────────
async function getPendingRows(whereClause, params) {
  const [rows] = await query(`
    SELECT
      dsr.id, dsr.job_id, dsr.employee_id, dsr.camera_id, dsr.status,
      e.employee_code, e.name AS employee_name, e.department, e.image_path, e.face_enrolled,
      c.name AS camera_name, c.device_ip, c.status AS cam_status
    FROM device_sync_results dsr
    JOIN employees e ON e.id = dsr.employee_id
    JOIN cameras   c ON c.id = dsr.camera_id
    WHERE ${whereClause}
  `, params);
  return rows;
}

// ── POST /api/sync/start ──────────────────────────────────────────────────────
// Body: { employee_ids: [1,2,...], camera_ids: [3,4,...] }
router.post('/start', async (req, res) => {
  try {
    const io = req.app.get('io');
    const { employee_ids, camera_ids } = req.body;

    if (!Array.isArray(employee_ids) || !employee_ids.length) {
      return res.status(400).json({ error: 'employee_ids array is required.' });
    }
    if (!Array.isArray(camera_ids) || !camera_ids.length) {
      return res.status(400).json({ error: 'camera_ids array is required.' });
    }

    // Fetch employees
    const empPlaceholders = employee_ids.map(() => '?').join(',');
    const [employees] = await query(
      `SELECT id, employee_code, name, department, image_path, face_enrolled FROM employees WHERE id IN (${empPlaceholders})`,
      employee_ids
    );

    // Fetch cameras
    const camPlaceholders = camera_ids.map(() => '?').join(',');
    const [cameras] = await query(
      `SELECT id, name, device_ip, status FROM cameras WHERE id IN (${camPlaceholders})`,
      camera_ids
    );

    if (!employees.length) return res.status(400).json({ error: 'No valid employees found.' });
    if (!cameras.length)   return res.status(400).json({ error: 'No valid cameras found.' });

    // ── Skip already-enrolled pairs ────────────────────────────────────────────
    const [alreadySynced] = await query(
      `SELECT dsr.employee_id, dsr.camera_id, e.name AS employee_name, c.name AS camera_name
       FROM device_sync_results dsr
       JOIN employees e ON e.id = dsr.employee_id
       JOIN cameras   c ON c.id = dsr.camera_id
       WHERE dsr.status = 'success'
         AND dsr.employee_id IN (${empPlaceholders})
         AND dsr.camera_id   IN (${camPlaceholders})`,
      [...employee_ids, ...camera_ids]
    );
    const skipSet = new Set(alreadySynced.map((r) => `${r.employee_id}_${r.camera_id}`));

    // Build filtered cross-product (exclude already-enrolled pairs)
    const pairsToSync = [];
    for (const cam of cameras) {
      for (const emp of employees) {
        if (!skipSet.has(`${emp.id}_${cam.id}`)) {
          pairsToSync.push({ emp, cam });
        }
      }
    }

    // All selected pairs are already enrolled — return conflict info
    if (pairsToSync.length === 0) {
      return res.status(409).json({
        error: 'All selected employees are already synced to the selected devices.',
        code: 'ALL_ALREADY_SYNCED',
        conflicts: alreadySynced.map((r) => ({ employee_name: r.employee_name, camera_name: r.camera_name })),
      });
    }

    const totalTasks = pairsToSync.length;
    const skippedCount = alreadySynced.length;

    // Create sync job
    const [jobResult] = await query(
      `INSERT INTO device_sync_jobs (status, total_tasks, done_tasks) VALUES ('in_progress', ?, 0)`,
      [totalTasks]
    );
    const jobId = jobResult.insertId;

    // Insert only the non-enrolled pairs
    const resultRows = pairsToSync.map(({ emp, cam }) => [jobId, emp.id, cam.id]);
    await query(
      `INSERT INTO device_sync_results (job_id, employee_id, camera_id, status) VALUES ${resultRows.map(() => '(?,?,?,\'pending\')').join(',')}`,
      resultRows.flat()
    );

    // Respond immediately
    res.json({ success: true, job_id: jobId, total_tasks: totalTasks, skipped_count: skippedCount });

    // Start background worker (fire-and-forget)
    const rows = await getPendingRows('dsr.job_id = ? AND dsr.status = ?', [jobId, 'pending']);
    runSyncWorker(jobId, rows, io).catch((err) => {
      console.error(`[Sync] Worker error for job ${jobId}:`, err.message);
    });

  } catch (err) {
    console.error('[Sync] POST /start error:', err.message);
    res.status(500).json({ error: 'Failed to start sync.' });
  }
});

// ── GET /api/sync/jobs ────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const [jobs] = await query(
      `SELECT id, status, total_tasks, done_tasks, created_at, completed_at
       FROM device_sync_jobs ORDER BY created_at DESC LIMIT 20`
    );
    // Attach per-job counts
    for (const job of jobs) {
      const [[counts]] = await query(
        `SELECT
           SUM(status='success') AS success_count,
           SUM(status='failed')  AS fail_count,
           SUM(status='pending') AS pending_count
         FROM device_sync_results WHERE job_id = ?`,
        [job.id]
      );
      job.success_count = Number(counts.success_count) || 0;
      job.fail_count    = Number(counts.fail_count)    || 0;
      job.pending_count = Number(counts.pending_count) || 0;
      // Derive done_tasks from actual result rows — the DB counter can drift on retries
      job.done_tasks = Math.min(job.success_count + job.fail_count, job.total_tasks);
    }
    res.json({ jobs });
  } catch (err) {
    console.error('[Sync] GET /jobs error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sync jobs.' });
  }
});

// ── GET /api/sync/history ─────────────────────────────────────────────────────
// Returns ONE row per (employee × device) pair — the latest record.
// cycle_count tells how many total sync cycles exist for that pair.
// Query params: employee_id, camera_id, from, to, page, limit
router.get('/history', async (req, res) => {
  try {
    const { employee_id, camera_id, from, to } = req.query;
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const offset = (page - 1) * limit;

    const where  = [];
    const params = [];

    if (employee_id) { where.push('h.employee_id = ?'); params.push(parseInt(employee_id, 10)); }
    if (camera_id)   { where.push('h.camera_id   = ?'); params.push(parseInt(camera_id,   10)); }
    if (from)        { where.push('h.synced_at   >= ?'); params.push(from + ' 00:00:00'); }
    if (to)          { where.push('h.synced_at   <= ?'); params.push(to   + ' 23:59:59'); }

    const whereSQL = where.length ? 'WHERE ' + where.join(' AND ') : '';

    // Total distinct (employee, camera) pairs matching the filter
    const [[{ total }]] = await query(
      `SELECT COUNT(*) AS total FROM (
         SELECT 1 FROM device_sync_history h ${whereSQL}
         GROUP BY h.employee_id, h.camera_id
       ) sub`,
      params
    );

    // One row per pair — latest synced_at, current status, cycle count
    const [rows] = await query(`
      SELECT
        h.employee_id,
        h.camera_id,
        e.name          AS employee_name,
        e.employee_code,
        e.department,
        e.image_path,
        c.name          AS camera_name,
        c.location      AS device_id,
        c.device_ip,
        COUNT(*)                                                         AS cycle_count,
        MAX(h.synced_at)                                                 AS latest_synced_at,
        MAX(CASE WHEN h.unsynced_at IS NULL THEN 1 ELSE 0 END)          AS is_active,
        MAX(CASE WHEN h.unsynced_at IS NULL THEN h.synced_at ELSE NULL END) AS active_since
      FROM device_sync_history h
      JOIN employees e ON e.id = h.employee_id
      JOIN cameras   c ON c.id = h.camera_id
      ${whereSQL}
      GROUP BY h.employee_id, h.camera_id,
               e.name, e.employee_code, e.department, e.image_path,
               c.name, c.location, c.device_ip
      ORDER BY MAX(h.synced_at) DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.json({ history: rows, total, page, limit });
  } catch (err) {
    console.error('[Sync] GET /history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sync history.' });
  }
});

// ── GET /api/sync/history/cycles ──────────────────────────────────────────────
// Returns all sync/unsync cycles for one specific (employee × device) pair.
// Query params: employee_id (required), camera_id (required)
router.get('/history/cycles', async (req, res) => {
  try {
    const { employee_id, camera_id } = req.query;
    if (!employee_id || !camera_id) {
      return res.status(400).json({ error: 'employee_id and camera_id are required.' });
    }
    const [rows] = await query(`
      SELECT id, synced_at, unsynced_at
      FROM device_sync_history
      WHERE employee_id = ? AND camera_id = ?
      ORDER BY synced_at DESC
    `, [parseInt(employee_id, 10), parseInt(camera_id, 10)]);
    res.json({ cycles: rows });
  } catch (err) {
    console.error('[Sync] GET /history/cycles error:', err.message);
    res.status(500).json({ error: 'Failed to fetch cycles.' });
  }
});

// ── GET /api/sync/:jobId ──────────────────────────────────────────────────────
router.get('/:jobId', async (req, res) => {
  try {
    const jobId = parseInt(req.params.jobId, 10);
    const [[job]] = await query(
      `SELECT id, status, total_tasks, done_tasks, created_at, completed_at FROM device_sync_jobs WHERE id = ?`,
      [jobId]
    );
    if (!job) return res.status(404).json({ error: 'Sync job not found.' });

    // Recalculate done_tasks from actual result rows to avoid counter drift
    const [[actualCounts]] = await query(
      `SELECT SUM(status='success') AS s, SUM(status='failed') AS f FROM device_sync_results WHERE job_id = ?`,
      [jobId]
    );
    job.done_tasks = Math.min((Number(actualCounts.s) || 0) + (Number(actualCounts.f) || 0), job.total_tasks);

    const [results] = await query(`
      SELECT
        dsr.id, dsr.employee_id, dsr.camera_id, dsr.status, dsr.error_msg, dsr.attempts, dsr.last_attempt,
        e.name AS employee_name, e.employee_code,
        c.name AS camera_name, c.device_ip
      FROM device_sync_results dsr
      JOIN employees e ON e.id = dsr.employee_id
      JOIN cameras   c ON c.id = dsr.camera_id
      WHERE dsr.job_id = ?
      ORDER BY dsr.camera_id, e.name
    `, [jobId]);

    // Group by camera
    const byCamera = {};
    for (const r of results) {
      const key = r.camera_id;
      if (!byCamera[key]) {
        byCamera[key] = { camera_id: r.camera_id, camera_name: r.camera_name, device_ip: r.device_ip, tasks: [] };
      }
      byCamera[key].tasks.push(r);
    }

    res.json({ job, devices: Object.values(byCamera) });
  } catch (err) {
    console.error('[Sync] GET /:jobId error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sync job.' });
  }
});

// ── POST /api/sync/:jobId/retry ───────────────────────────────────────────────
router.post('/:jobId/retry', async (req, res) => {
  try {
    const io    = req.app.get('io');
    const jobId = parseInt(req.params.jobId, 10);

    const [[job]] = await query(`SELECT id, status FROM device_sync_jobs WHERE id = ?`, [jobId]);
    if (!job) return res.status(404).json({ error: 'Sync job not found.' });

    // Block duplicate retries while a worker is already running for this job
    if (runningJobs.has(jobId)) {
      return res.status(409).json({ error: 'Sync already in progress. Please wait for it to finish.' });
    }

    // Reset failed rows to pending
    const [resetResult] = await query(
      `UPDATE device_sync_results SET status='pending' WHERE job_id = ? AND status = 'failed'`,
      [jobId]
    );
    if (resetResult.affectedRows === 0) {
      return res.json({ success: true, message: 'No failed tasks to retry.' });
    }

    // Reset job: subtract retried rows from done_tasks so progress stays accurate
    await query(
      `UPDATE device_sync_jobs
         SET status='in_progress', completed_at=NULL,
             done_tasks = GREATEST(done_tasks - ?, 0)
       WHERE id=?`,
      [resetResult.affectedRows, jobId]
    );

    res.json({ success: true, retrying: resetResult.affectedRows });

    // Fire background worker for the reset rows
    const rows = await getPendingRows('dsr.job_id = ? AND dsr.status = ?', [jobId, 'pending']);
    runSyncWorker(jobId, rows, io).catch((err) => {
      console.error(`[Sync] Retry worker error for job ${jobId}:`, err.message);
    });

  } catch (err) {
    console.error('[Sync] POST /:jobId/retry error:', err.message);
    res.status(500).json({ error: 'Failed to retry sync.' });
  }
});

// ── Auto-retry helper — called by cameras.js when a device comes online ───────
/**
 * Check if this camera has pending/failed sync tasks and retry them automatically.
 * Called fire-and-forget from the health-update route.
 */
async function triggerAutoRetry(cameraId, cameraName, io) {
  try {
    const rows = await getPendingRows(
      "dsr.camera_id = ? AND dsr.status IN ('pending','failed')",
      [cameraId]
    );
    if (!rows.length) return;

    console.log(`[Sync] Auto-retry triggered for camera ${cameraName} (id=${cameraId}) — ${rows.length} tasks`);
    io.emit('sync_auto_retry', { camera_id: cameraId, camera_name: cameraName, pending_count: rows.length });

    // Group by job and run each
    const byJob = {};
    for (const row of rows) {
      if (!byJob[row.job_id]) byJob[row.job_id] = [];
      byJob[row.job_id].push(row);
    }

    for (const [jobId, jobRows] of Object.entries(byJob)) {
      // Reset to pending before running
      await query(
        `UPDATE device_sync_results SET status='pending' WHERE camera_id=? AND job_id=? AND status IN ('pending','failed')`,
        [cameraId, jobId]
      );
      await query(`UPDATE device_sync_jobs SET status='in_progress', completed_at=NULL WHERE id=?`, [jobId]);
      runSyncWorker(parseInt(jobId, 10), jobRows, io).catch((err) => {
        console.error(`[Sync] Auto-retry worker error job ${jobId}:`, err.message);
      });
    }
  } catch (err) {
    console.error('[Sync] triggerAutoRetry error:', err.message);
  }
}

// ── POST /api/sync/unsync ─────────────────────────────────────────────────────
// Body: { employee_ids: [...], camera_ids: [...] }
// Removes employees from Pi devices and clears their device_sync_results rows.
router.post('/unsync', async (req, res) => {
  try {
    const io = req.app.get('io');
    const { employee_ids, camera_ids } = req.body;

    if (!Array.isArray(employee_ids) || !employee_ids.length)
      return res.status(400).json({ error: 'employee_ids array is required.' });
    if (!Array.isArray(camera_ids) || !camera_ids.length)
      return res.status(400).json({ error: 'camera_ids array is required.' });

    const empPlaceholders = employee_ids.map(() => '?').join(',');
    const camPlaceholders = camera_ids.map(() => '?').join(',');

    // Find rows that are actually enrolled (status=success)
    const [enrolledRows] = await query(`
      SELECT dsr.id AS result_id, dsr.employee_id, dsr.camera_id,
             e.employee_code, e.name AS employee_name,
             c.name AS camera_name, c.device_ip
      FROM device_sync_results dsr
      JOIN employees e ON e.id = dsr.employee_id
      JOIN cameras   c ON c.id = dsr.camera_id
      WHERE dsr.status = 'success'
        AND dsr.employee_id IN (${empPlaceholders})
        AND dsr.camera_id   IN (${camPlaceholders})
    `, [...employee_ids, ...camera_ids]);

    if (!enrolledRows.length) {
      return res.status(409).json({
        error: 'None of the selected employees are enrolled on the selected devices.',
        code:  'NONE_ENROLLED',
      });
    }

    // Respond immediately — run worker in background
    const opId = `unsync_${Date.now()}`;
    res.json({ success: true, operation_id: opId, total_tasks: enrolledRows.length });

    // Fire-and-forget background worker
    runUnsyncWorker(opId, enrolledRows, io).catch((err) => {
      console.error(`[Unsync] Worker error op ${opId}:`, err.message);
    });

  } catch (err) {
    console.error('[Sync] POST /unsync error:', err.message);
    res.status(500).json({ error: 'Failed to start unsync.' });
  }
});

// ── Unsync background worker ──────────────────────────────────────────────────
const axios = require('axios');
const cfg   = require('../config/index');

async function runUnsyncWorker(opId, rows, io) {
  // Group by camera
  const byCamera = {};
  for (const row of rows) {
    if (!byCamera[row.camera_id]) byCamera[row.camera_id] = [];
    byCamera[row.camera_id].push(row);
  }

  let successCount = 0;
  let failCount    = 0;

  for (const cameraRows of Object.values(byCamera)) {
    const { camera_id, camera_name, device_ip } = cameraRows[0];

    for (const row of cameraRows) {
      // ── Step 1: Attempt Pi call (non-blocking — failure does NOT stop DB cleanup) ──
      let piWarning = null;
      if (device_ip) {
        try {
          const pythonUrl = cfg.PYTHON.urlFor(device_ip);
          await axios.post(
            `${pythonUrl}/delete-employee`,
            { employee_code: row.employee_code },
            { headers: { 'Content-Type': 'application/json' }, timeout: cfg.TIMEOUTS.pythonDelete }
          );
        } catch (err) {
          piWarning = err.response?.data?.error || err.message || 'Pi unreachable';
          console.warn(`[Unsync] Pi call failed (still cleaning DB): ${row.employee_name} @ ${camera_name} — ${piWarning}`);
        }
      }

      // ── Step 2: Always clean DB regardless of Pi result ──────────────────────────
      let taskStatus = 'success';
      let errorMsg   = null;
      try {
        // Mark history entry as unsynced
        await query(
          `UPDATE device_sync_history SET unsynced_at = NOW()
           WHERE employee_id = ? AND camera_id = ? AND unsynced_at IS NULL`,
          [row.employee_id, row.camera_id]
        );

        // Remove from device_sync_results
        await query('DELETE FROM device_sync_results WHERE id = ?', [row.result_id]);

        // If employee has no more enrolled devices → reset face_enrolled flag
        const [remaining] = await query(
          `SELECT id FROM device_sync_results WHERE employee_id = ? AND status = 'success' LIMIT 1`,
          [row.employee_id]
        );
        if (!remaining.length) {
          await query('UPDATE employees SET face_enrolled = 0 WHERE id = ?', [row.employee_id]);
        }

        successCount++;
        // Surface Pi warning in error_msg so UI can optionally show it, but keep status='success'
        if (piWarning) errorMsg = `Removed from DB (Pi unreachable: ${piWarning})`;
      } catch (dbErr) {
        // Only truly fail if DB cleanup itself fails
        errorMsg   = dbErr.message || 'DB cleanup failed';
        taskStatus = 'failed';
        failCount++;
        console.error(`[Unsync] DB cleanup failed: ${row.employee_name} @ ${camera_name} — ${errorMsg}`);
      }

      io.emit('unsync_progress', {
        operation_id:  opId,
        camera_id,
        camera_name,
        employee_id:   row.employee_id,
        employee_name: row.employee_name,
        status:        taskStatus,
        error_msg:     errorMsg,
      });
    }
  }

  io.emit('unsync_complete', { operation_id: opId, success_count: successCount, fail_count: failCount });
  console.log(`[Unsync] Op ${opId} complete — success=${successCount} fail=${failCount}`);
}

module.exports = { router, triggerAutoRetry };