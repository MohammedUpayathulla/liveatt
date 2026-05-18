'use strict';

const express = require('express');
const router = express.Router();
const { query, pool } = require('../config/db');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+05:30

// Returns 'YYYY-MM-DD' string in IST for the given Date (defaults to now)
function istDateStr(d = new Date()) {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Parse a 'YYYY-MM-DD HH:MM:SS' string sent by Python devices (local IST time)
function parseIST(str) {
  return new Date(str.replace(' ', 'T') + '+05:30');
}

// GET /api/attendance - list attendance logs with filters
router.get('/', async (req, res) => {
  try {
    const { date, employee_id, camera_id, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const whereClauses = [];
    const params = [];

    if (date) {
      whereClauses.push('al.timestamp BETWEEN ? AND ?');
      params.push(`${date} 00:00:00`, `${date} 23:59:59`);
    }
    if (employee_id) {
      whereClauses.push('al.employee_id = ?');
      params.push(parseInt(employee_id, 10));
    }
    if (camera_id) {
      whereClauses.push('al.camera_id = ?');
      params.push(parseInt(camera_id, 10));
    }
    // Text search on employee name or code (used by the Logs page filter bar)
    if (search) {
      whereClauses.push('(e.name LIKE ? OR e.employee_code LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const whereSQL = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const countSQL = `
      SELECT COUNT(*) AS total
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      ${whereSQL}
    `;

    const dataSQL = `
      SELECT
        al.id,
        al.employee_id,
        al.camera_id,
        al.punch_type,
        al.timestamp,
        al.snapshot_path,
        al.confidence,
        e.name        AS employee_name,
        e.employee_code,
        e.department,
        e.image_path  AS employee_image,
        c.name        AS camera_name,
        c.location    AS camera_location
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      LEFT JOIN cameras   c ON c.id = al.camera_id
      ${whereSQL}
      ORDER BY al.timestamp DESC
      LIMIT ? OFFSET ?
    `;

    const [[countRows], [logs]] = await Promise.all([
      query(countSQL, params),
      query(dataSQL, [...params, limit, offset]),
    ]);
    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({ logs, total, page, totalPages, limit });
  } catch (err) {
    console.error('[Attendance] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch attendance logs.' });
  }
});

// GET /api/attendance/today - today's attendance count and list
router.get('/today', async (req, res) => {
  try {
    const today = istDateStr();

    const [rows] = await query(
      `SELECT
        al.id,
        al.employee_id,
        al.camera_id,
        al.timestamp,
        al.snapshot_path,
        al.confidence,
        e.name        AS employee_name,
        e.employee_code,
        e.department,
        e.image_path  AS employee_image,
        c.name        AS camera_name,
        c.location    AS camera_location
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      LEFT JOIN cameras   c ON c.id = al.camera_id
      WHERE DATE(al.timestamp) = ?
      ORDER BY al.timestamp DESC`,
      [today]
    );

    const uniqueEmployees = new Set(rows.map((r) => r.employee_id)).size;

    res.json({
      date: today,
      count: rows.length,
      unique_employees: uniqueEmployees,
      logs: rows
    });
  } catch (err) {
    console.error('[Attendance] GET /today error:', err.message);
    res.status(500).json({ error: 'Failed to fetch today\'s attendance.' });
  }
});

// GET /api/attendance/stats - aggregate stats
router.get('/stats', async (req, res) => {
  try {
    const today = istDateStr();

    const [[[totalTodayRow]], [[presentRow]], [[activeCamsRow]]] = await Promise.all([
      query(`SELECT COUNT(*) AS total_today FROM attendance_logs WHERE DATE(timestamp) = ?`, [today]),
      query(`SELECT COUNT(DISTINCT employee_id) AS present_employees FROM attendance_logs WHERE DATE(timestamp) = ?`, [today]),
      query(`SELECT COUNT(*) AS active_cameras FROM cameras WHERE status = 'active'`),
    ]);

    res.json({
      total_today: totalTodayRow.total_today,
      present_employees: presentRow.present_employees,
      active_cameras: activeCamsRow.active_cameras
    });
  } catch (err) {
    console.error('[Attendance] GET /stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch attendance stats.' });
  }
});

// GET /api/attendance/daily - per-employee IN/OUT summary for a date
// Returns one row per employee per day with first-IN time and last-OUT time.
// Uses timestamp range (>= start, < next day) so the idx_timestamp index is used.
router.get('/daily', async (req, res) => {
  try {
    const date  = req.query.date || istDateStr();
    const start = `${date} 00:00:00`;
    const end   = `${date} 23:59:59`;
    const { employee_id, search } = req.query;

    const extraClauses = [];
    const extraParams  = [];

    if (employee_id) {
      extraClauses.push('AND al.employee_id = ?');
      extraParams.push(parseInt(employee_id, 10));
    }
    // Text search on name or employee_code from the Logs page filter bar
    if (search) {
      extraClauses.push('AND (e.name LIKE ? OR e.employee_code LIKE ?)');
      extraParams.push(`%${search}%`, `%${search}%`);
    }

    const extraSQL = extraClauses.join(' ');

    // One row per employee: first IN time + camera, last OUT time + camera.
    // Correlated subqueries reuse the same range so they hit the index too.
    const [rows] = await query(
      `SELECT
        e.id              AS employee_id,
        e.name            AS employee_name,
        e.employee_code,
        e.department,
        e.image_path      AS employee_image,
        MIN(CASE WHEN al.punch_type IN ('in','both')  THEN al.timestamp END) AS in_time,
        MAX(CASE WHEN al.punch_type IN ('out','both') THEN al.timestamp END) AS out_time,
        (SELECT c2.name
           FROM attendance_logs al2
           JOIN cameras c2 ON c2.id = al2.camera_id
          WHERE al2.employee_id = e.id
            AND al2.timestamp BETWEEN ? AND ?
            AND al2.punch_type IN ('in','both')
          ORDER BY al2.timestamp ASC  LIMIT 1)          AS in_camera,
        (SELECT c3.name
           FROM attendance_logs al3
           JOIN cameras c3 ON c3.id = al3.camera_id
          WHERE al3.employee_id = e.id
            AND al3.timestamp BETWEEN ? AND ?
            AND al3.punch_type IN ('out','both')
          ORDER BY al3.timestamp DESC LIMIT 1)          AS out_camera,
        COUNT(al.id)      AS total_punches
       FROM employees e
       JOIN attendance_logs al ON al.employee_id = e.id
      WHERE al.timestamp BETWEEN ? AND ? ${extraSQL}
      GROUP BY e.id
      ORDER BY in_time ASC`,
      [start, end, start, end, start, end, ...extraParams]
    );

    res.json({ date, daily: rows });
  } catch (err) {
    console.error('[Attendance] GET /daily error:', err.message);
    res.status(500).json({ error: 'Failed to fetch daily attendance.' });
  }
});

// ── Attendance status calculator ─────────────────────────────────────────────
function calcStatus(firstIn, lastOut, shiftStartStr, shiftEndStr, workingHours) {
  if (!firstIn) return null;

  const inDate     = istDateStr(new Date(firstIn));
  const shiftStart = new Date(`${inDate}T${shiftStartStr || '09:00'}:00+05:30`);
  const isLate     = new Date(firstIn) > shiftStart;
  const baseStatus = isLate ? 'LATE' : 'PRESENT';

  if (!lastOut) return baseStatus;  // only IN recorded — no OUT yet

  const totalMinutes   = Math.max(0, Math.floor((new Date(lastOut) - new Date(firstIn)) / 60000));
  const workingMinutes = Math.round((parseFloat(workingHours) || 8) * 60);
  const halfThreshold  = Math.ceil(workingMinutes / 2);  // 50% of shift duration

  if (totalMinutes > workingMinutes) return 'OT';
  if (totalMinutes < halfThreshold)  return 'HALF_DAY';
  if (totalMinutes < workingMinutes) return 'UT';
  return baseStatus;  // worked full hours — preserve PRESENT or LATE
}

// POST /api/attendance/log — Python calls this after face detection
// Body: { employee_code, time, device_id, device_ip, device_name, camera_mode }
router.post('/log', async (req, res) => {
  try {
    const { employee_code, device_id, device_ip, device_name, camera_mode, time } = req.body;

    console.log('─────────────────────────────────────────');
    console.log('[POST /api/attendance/log] Received from Python');
    console.log(`  employee_code : ${employee_code}`);
    console.log(`  device_id     : ${device_id}`);
    console.log(`  device_ip     : ${device_ip}`);
    console.log(`  device_name   : ${device_name}`);
    console.log(`  camera_mode   : ${camera_mode}`);
    console.log(`  time          : ${time || '(not provided, using now)'}`);
    console.log('─────────────────────────────────────────');

    if (!employee_code) {
      return res.status(400).json({ success: false, error: 'employee_code is required.' });
    }

    // Python sends 'YYYY-MM-DD HH:MM:SS' in IST — parseIST appends +05:30 to avoid UTC misparse
    const detectedAt = time ? parseIST(time) : new Date();
    const ts         = detectedAt.toISOString();
    const today      = istDateStr(detectedAt);

    // ── Look up employee (case-insensitive — Pi may send ru111, RU111, etc.) ──
    const [empRows] = await query(
      `SELECT id, name, name_hindi, employee_code, department, image_path, status FROM employees WHERE UPPER(employee_code) = UPPER(?) LIMIT 1`,
      [employee_code]
    );
    const emp = empRows?.[0] || null;
    if (!emp) {
      console.log(`[attendance/log] ERROR: employee "${employee_code}" not found`);
      return res.status(404).json({ success: false, error: `Employee "${employee_code}" not registered.` });
    }
    if (emp.status === 'inactive') {
      console.log(`[attendance/log] SKIPPED: employee "${emp.name}" (${employee_code}) is inactive`);
      return res.status(403).json({ success: false, error: `Employee "${emp.name}" is inactive.` });
    }
    console.log(`[attendance/log] Employee: ${emp.name} (id=${emp.id})`);

    // ── Look up camera — prefer exact (ip + name) match so two cameras on the
    // same Pi (same device_ip, different names) resolve to the correct row.
    let cam = null;
    if (device_ip && device_name) {
      const [byIpName] = await query(
        `SELECT id, name, camera_type, location, device_ip, status FROM cameras WHERE device_ip = ? AND name = ? LIMIT 1`,
        [device_ip, device_name]
      );
      cam = byIpName?.[0] || null;
    }
    // Skip IP-only fallback when device_name was provided — it would return the wrong
    // camera on a Pi with multiple streams, causing the wrong per-camera IN/OUT state.
    if (!cam && device_ip && !device_name) {
      const [byIp] = await query(
        `SELECT id, name, camera_type, location, device_ip, status FROM cameras WHERE device_ip = ? LIMIT 1`,
        [device_ip]
      );
      cam = byIp?.[0] || null;
    }
    if (!cam && device_name) {
      const [byName] = await query(
        `SELECT id, name, camera_type, location, device_ip, status FROM cameras WHERE name = ? LIMIT 1`,
        [device_name]
      );
      cam = byName?.[0] || null;
    }
    if (!cam && device_id) {
      const [byId] = await query(
        `SELECT id, name, camera_type, location, device_ip, status FROM cameras WHERE location = ? LIMIT 1`,
        [device_id]
      );
      cam = byId?.[0] || null;
    }
    if (cam && cam.status === 'inactive') {
      console.log(`[attendance/log] SKIPPED: camera "${cam.name}" is disabled`);
      return res.status(403).json({ success: false, error: `Device "${cam.name}" is disabled.` });
    }

    // DB camera_type is authoritative (admin configured it in Device Management).
    // Only fall back to payload camera_mode when the camera is not in the DB.
    const cameraMode = (cam?.camera_type || camera_mode || 'both').toLowerCase();
    if (cam) {
      console.log(`[attendance/log] Camera: ${cam.name} (id=${cam.id}) mode=${cameraMode}`);
    } else {
      console.log(`[attendance/log] Camera not found in DB — using payload mode=${cameraMode}, device=${device_name || device_id || device_ip}`);
    }

    // ── Load shift settings ───────────────────────────────────────────────
    const [settingRows] = await query(
      `SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('shift_start_time','shift_end_time','working_hours')`
    );
    const cfg = {};
    settingRows.forEach((r) => { cfg[r.setting_key] = r.setting_value; });
    const shiftStart   = cfg.shift_start_time || '09:00';
    const shiftEnd     = cfg.shift_end_time   || '18:00';
    const workingHours = parseFloat(cfg.working_hours || '8');

    // ── Upsert daily_attendance based on camera mode ──────────────────────
    const [existing] = await query(
      `SELECT id, first_in_time, last_out_time FROM daily_attendance
       WHERE employee_id = ? AND date = ? LIMIT 1`,
      [emp.id, today]
    );

    let record;
    let punchType;

    // Helper: check if arrival is late vs shift start
    function calcInStatus(arrivalDate) {
      const inDate  = istDateStr(arrivalDate);
      const shiftDt = new Date(`${inDate}T${shiftStart}:00+05:30`);
      return arrivalDate > shiftDt ? 'LATE' : 'PRESENT';
    }

    if (cameraMode === 'in') {
      // ── IN-only camera: set first_in_time once, mark LATE if after shift start
      punchType = 'in';
      const inStatus = calcInStatus(detectedAt);

      await query(
        `INSERT INTO daily_attendance (employee_id, date, first_in_time, total_work_minutes, status)
         VALUES (?, ?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE
           first_in_time = IF(first_in_time IS NULL, VALUES(first_in_time), first_in_time),
           status        = IF(first_in_time IS NULL, VALUES(status), status)`,
        [emp.id, today, detectedAt, inStatus]
      );
      console.log(`[attendance/log] IN (mode=in) saved → ${emp.name} @ ${ts} status=${inStatus}`);
      const [r] = await query(`SELECT * FROM daily_attendance WHERE employee_id = ? AND date = ? LIMIT 1`, [emp.id, today]);
      record = r[0];

    } else if (cameraMode === 'out') {
      // ── OUT-only camera: only set last_out_time, never touch first_in_time
      punchType = 'out';
      // Compute status using whatever first_in_time is already in the DB (may be null)
      const outFirstIn  = existing[0]?.first_in_time || null;
      const outTotalMin = outFirstIn ? Math.max(0, Math.floor((detectedAt - new Date(outFirstIn)) / 60000)) : 0;
      const outStatus   = calcStatus(outFirstIn, detectedAt, shiftStart, shiftEnd, workingHours) || 'PRESENT';
      await query(
        `INSERT INTO daily_attendance (employee_id, date, last_out_time, total_work_minutes, status)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           last_out_time       = IF(VALUES(last_out_time) > IFNULL(last_out_time, '1970-01-01'), VALUES(last_out_time), last_out_time),
           total_work_minutes  = VALUES(total_work_minutes),
           status              = VALUES(status)`,
        [emp.id, today, detectedAt, outTotalMin, outStatus]
      );
      console.log(`[attendance/log] OUT (mode=out) saved → ${emp.name} total=${outTotalMin}min status=${outStatus}`);
      const [r] = await query(`SELECT * FROM daily_attendance WHERE employee_id = ? AND date = ? LIMIT 1`, [emp.id, today]);
      record = r[0];

    } else {
      // ── BOTH (in_out): per-camera — first detection by THIS camera = IN, subsequent = OUT.
      // Query attendance_logs (not shared daily_attendance) so two cameras on the same
      // employee independently determine their own IN/OUT status.
      const camIdForPunch = cam?.id || null;

      if (camIdForPunch) {
        // CRITICAL: Wrap in transaction to prevent race condition (both requests reading cnt=0)
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();

          // Get lock on punch-type determination (atomic read)
          const [[{ cnt }]] = await conn.query(
            `SELECT COUNT(*) AS cnt FROM attendance_logs
             WHERE employee_id = ? AND camera_id = ? AND DATE(timestamp) = ? AND punch_type = 'in'
             FOR UPDATE`,
            [emp.id, camIdForPunch, today]
          );
          punchType = cnt > 0 ? 'out' : 'in';

          await conn.commit();
        } catch (err) {
          await conn.rollback();
          throw err;
        } finally {
          await conn.release();
        }
      } else {
        // Camera not found — safe default prevents incorrect OUT marks when
        // a second camera on the same Pi can't be matched to a DB row.
        punchType = 'in';
        console.warn(`[attendance/log] mode=both: no camera_id resolved for "${device_name || device_ip || device_id}" — defaulting to 'in'`);
      }

      if (punchType === 'in') {
        const inStatus = calcInStatus(detectedAt);
        // Use INSERT ... ON DUPLICATE KEY so concurrent IN events from two cameras are safe
        await query(
          `INSERT INTO daily_attendance (employee_id, date, first_in_time, total_work_minutes, status)
           VALUES (?, ?, ?, 0, ?)
           ON DUPLICATE KEY UPDATE
             first_in_time = IF(first_in_time IS NULL OR VALUES(first_in_time) < first_in_time, VALUES(first_in_time), first_in_time),
             status        = IF(first_in_time IS NULL OR VALUES(first_in_time) < first_in_time, VALUES(status), status)`,
          [emp.id, today, detectedAt, inStatus]
        );
        const [r] = await query(`SELECT * FROM daily_attendance WHERE employee_id = ? AND date = ? LIMIT 1`, [emp.id, today]);
        record = r[0];
        console.log(`[attendance/log] IN (mode=both, cam=${cam?.name || 'unknown'}) → ${emp.name} @ ${ts}`);
      } else {
        const bothFirstIn  = existing[0]?.first_in_time || null;
        const bothTotalMin = bothFirstIn ? Math.max(0, Math.floor((detectedAt - new Date(bothFirstIn)) / 60000)) : 0;
        const bothStatus   = calcStatus(bothFirstIn, detectedAt, shiftStart, shiftEnd, workingHours) || 'PRESENT';
        await query(
          `INSERT INTO daily_attendance (employee_id, date, last_out_time, total_work_minutes, status)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             last_out_time      = IF(VALUES(last_out_time) > IFNULL(last_out_time, '1970-01-01'), VALUES(last_out_time), last_out_time),
             total_work_minutes = VALUES(total_work_minutes),
             status             = VALUES(status)`,
          [emp.id, today, detectedAt, bothTotalMin, bothStatus]
        );
        const [r] = await query(`SELECT * FROM daily_attendance WHERE employee_id = ? AND date = ? LIMIT 1`, [emp.id, today]);
        record = r[0];
        console.log(`[attendance/log] OUT (mode=both, cam=${cam?.name || 'unknown'}) → ${emp.name} total=${record?.total_work_minutes || 0}min status=${record?.status}`);
      }
    }

    // Also insert raw log for history
    await query(
      `INSERT INTO attendance_logs (employee_id, camera_id, punch_type, timestamp)
       VALUES (?, ?, ?, ?)`,
      [emp.id, cam?.id || null, punchType, detectedAt]
    );

    // ── Emit real-time update to UI ───────────────────────────────────────
    const totalMin = record.total_work_minutes || 0;
    const uiPayload = {
      employee_id:          emp.id,
      employee_code:        emp.employee_code,
      employee_name:        emp.name,
      employee_name_hindi:  emp.name_hindi  || null,
      employee_image:       emp.image_path  || null,
      camera_id:            cam?.id || null,
      camera_name:          cam?.name || device_name || device_id || device_ip || 'Unknown',
      camera_location:      cam?.location || device_id || device_ip || null,
      device_ip:            device_ip || cam?.device_ip || null,
      timestamp:            ts,
      punch_type:           punchType,
      first_in_time:        record.first_in_time,
      last_out_time:        record.last_out_time || null,
      total_work_minutes:   totalMin,
      total_work_hours:     (totalMin / 60).toFixed(2),
      status:               record.status || 'PRESENT',
    };

    const io = req.app.get('io');
    if (io) {
      io.emit('attendance_marked', uiPayload);
      io.emit('daily_attendance_updated', uiPayload);
      console.log(`[attendance/log] Socket.IO → ${punchType.toUpperCase()} "${emp.name}" status=${uiPayload.status}`);
    }

    return res.json({ success: true, punch_type: punchType, ...uiPayload });
  } catch (err) {
    console.error('[Attendance] POST /log error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to save attendance log.' });
  }
});

// GET /api/attendance/summary — summary with status for all employees (supports range)
// Query: ?date=YYYY-MM-DD OR (?start_date=...&end_date=...) &employee_id=&department=&camera_id=
router.get('/summary', async (req, res) => {
  try {
    const { date, start_date, end_date, employee_id, department, camera_id } = req.query;

    let whereClauses = [];
    let params = [];

    if (start_date && end_date) {
      whereClauses.push('da.date BETWEEN ? AND ?');
      params.push(start_date, end_date);
    } else {
      const targetDate = date || istDateStr();
      whereClauses.push('da.date = ?');
      params.push(targetDate);
    }

    if (employee_id) {
      whereClauses.push('da.employee_id = ?');
      params.push(employee_id);
    }

    if (department) {
      whereClauses.push('e.department = ?');
      params.push(department);
    }

    // Camera/device filter: keep only employees who have at least one log entry
    // for this camera on the matching date(s) — daily_attendance has no camera_id column
    if (camera_id) {
      whereClauses.push(
        `EXISTS (
           SELECT 1 FROM attendance_logs al
           WHERE al.employee_id = da.employee_id
             AND DATE(al.timestamp) = da.date
             AND al.camera_id = ?
         )`
      );
      params.push(parseInt(camera_id, 10));
    }

    const whereSQL = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const [rows] = await query(
      `SELECT
         da.id, da.date,
         da.first_in_time, da.last_out_time,
         da.total_work_minutes, da.status,
         e.id           AS employee_id,
         e.name         AS employee_name,
         e.employee_code,
         e.department,
         e.image_path   AS employee_image,
         (SELECT c.name FROM attendance_logs al
            JOIN cameras c ON c.id = al.camera_id
           WHERE al.employee_id = da.employee_id
             AND DATE(al.timestamp) = da.date
           ORDER BY al.timestamp ASC LIMIT 1) AS camera_name
       FROM daily_attendance da
       JOIN employees e ON e.id = da.employee_id
       ${whereSQL}
       ORDER BY da.date DESC, da.first_in_time ASC`,
      params
    );

    const summary = rows.map((r) => ({
      ...r,
      total_work_hours: r.total_work_minutes
        ? (r.total_work_minutes / 60).toFixed(2)
        : '0.00',
    }));

    res.json({ summary });
  } catch (err) {
    console.error('[Attendance] GET /summary error:', err.message);
    res.status(500).json({ error: 'Failed to fetch attendance summary.' });
  }
});

// DELETE /api/attendance/:id - delete a log entry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await query('SELECT id FROM attendance_logs WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Attendance log not found.' });
    }

    await query('DELETE FROM attendance_logs WHERE id = ?', [id]);
    res.json({ message: 'Attendance log deleted successfully.' });
  } catch (err) {
    console.error('[Attendance] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete attendance log.' });
  }
});

// POST /api/attendance/presence — lightweight heartbeat from Python (no DB write)
// Tells the frontend a recognized face is currently in frame every ~5 s.
// Keeps the Live Attendance card alive without spamming the attendance log.
router.post('/presence', async (req, res) => {
  try {
    const { employee_code, employee_name, employee_name_hindi, employee_image,
            camera_name, device_ip } = req.body;
    if (!employee_code) return res.status(400).json({ error: 'employee_code required' });

    // Enrich with DB photo if not supplied
    let imagePath = employee_image || null;
    let hindiName = employee_name_hindi || null;
    if (!imagePath || !hindiName) {
      try {
        const [rows] = await require('../config/db').pool.query(
          'SELECT image_path, name_hindi FROM employees WHERE employee_code = ? LIMIT 1',
          [employee_code]
        );
        if (rows.length) {
          imagePath = imagePath || rows[0].image_path || null;
          hindiName = hindiName || rows[0].name_hindi || null;
        }
      } catch (_) { /* non-critical */ }
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('face_present', {
        employee_code,
        employee_name:        employee_name  || employee_code,
        employee_name_hindi:  hindiName,
        employee_image:       imagePath,
        camera_name:          camera_name    || null,
        device_ip:            device_ip      || null,
        timestamp:            new Date().toISOString(),
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[attendance/presence] error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
