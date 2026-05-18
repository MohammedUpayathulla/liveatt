'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDateStr(d = new Date()) {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// GET /api/dashboard/stats
router.get('/stats', async (req, res) => {
  try {
    const today = istDateStr();

    const [
      [[empRow]],
      [[presentRow]],
      [[camRow]],
      [recentLogs],
      [hourlyRows],
    ] = await Promise.all([
      // 1. Total registered employees
      query('SELECT COUNT(*) AS total_employees FROM employees'),

      // 2. Distinct employees present today — use daily_attendance.date (local date)
      query(
        `SELECT COUNT(DISTINCT employee_id) AS present_today
         FROM daily_attendance
         WHERE date = ?`,
        [today]
      ),

      // 3. Active cameras
      query(`SELECT COUNT(*) AS active_cameras FROM cameras WHERE status = 'active'`),

      // 4. Last 10 attendance events
      query(
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
        ORDER BY al.timestamp DESC
        LIMIT 10`
      ),

      // 5. Hourly attendance counts for today (local date via MySQL session timezone)
      query(
        `SELECT HOUR(timestamp) AS hour, COUNT(*) AS count
         FROM attendance_logs
         WHERE DATE(timestamp) = ?
         GROUP BY HOUR(timestamp)
         ORDER BY hour ASC`,
        [today]
      ),
    ]);

    const hourlyCounts = Array.from({ length: 24 }, (_, h) => {
      const found = hourlyRows.find((r) => r.hour === h);
      return { hour: h, count: found ? found.count : 0 };
    });

    res.json({
      total_employees: empRow.total_employees,
      present_today:   presentRow.present_today,
      active_cameras:  camRow.active_cameras,
      recent_logs:     recentLogs,
      hourly_counts:   hourlyCounts,
    });
  } catch (err) {
    console.error('[Dashboard] GET /stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch dashboard stats.' });
  }
});

// GET /api/dashboard/weekly  – last 7 days attendance counts
router.get('/weekly', async (req, res) => {
  try {
    // Current week in IST: Sunday → Saturday
    // Shift into IST space so date arithmetic uses IST midnight boundaries
    const nowIST     = new Date(Date.now() + IST_OFFSET_MS);
    const dayOfWeek  = nowIST.getUTCDay(); // 0=Sun, 6=Sat in IST
    const sundayIST  = new Date(nowIST);
    sundayIST.setUTCDate(nowIST.getUTCDate() - dayOfWeek);

    const toISTDate = (d) => d.toISOString().slice(0, 10); // d is already IST-shifted

    const sundayStr    = toISTDate(sundayIST);
    const saturdayDate = new Date(sundayIST);
    saturdayDate.setUTCDate(sundayIST.getUTCDate() + 6);
    const saturdayStr  = toISTDate(saturdayDate);

    // Use daily_attendance.date — stored as local date, no timezone issues
    const [rows] = await query(
      `SELECT date, COUNT(DISTINCT employee_id) AS count
       FROM daily_attendance
       WHERE date BETWEEN ? AND ?
       GROUP BY date
       ORDER BY date ASC`,
      [sundayStr, saturdayStr]
    );

    const days   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = [];

    for (let i = 0; i <= 6; i++) {
      const d = new Date(sundayIST);
      d.setUTCDate(sundayIST.getUTCDate() + i);
      const dateStr  = toISTDate(d);
      const dayLabel = days[d.getUTCDay()];
      const found    = rows.find((r) => {
        let rd;
        if (typeof r.date === 'string') {
          rd = r.date.slice(0, 10);
        } else if (r.date instanceof Date) {
          // Use local date parts — avoid toISOString() UTC shift
          rd = `${r.date.getFullYear()}-${String(r.date.getMonth()+1).padStart(2,'0')}-${String(r.date.getDate()).padStart(2,'0')}`;
        } else {
          rd = String(r.date).slice(0, 10);
        }
        return rd === dateStr;
      });
      result.push({ date: dateStr, day: dayLabel, count: found ? Number(found.count) : 0 });
    }
    res.json({ weekly: result });
  } catch (err) {
    console.error('[Dashboard] GET /weekly error:', err.message);
    res.status(500).json({ error: 'Failed to fetch weekly stats.' });
  }
});

// GET /api/dashboard/departments – attendance by department today
router.get('/departments', async (req, res) => {
  try {
    const today = istDateStr();
    // Get present count per department today + total employees per department
    const [rows] = await query(
      `SELECT
         COALESCE(e.department, 'Unknown') AS department,
         COUNT(DISTINCT e.id)              AS total,
         COUNT(DISTINCT da.employee_id)    AS present
       FROM employees e
       LEFT JOIN daily_attendance da
         ON da.employee_id = e.id AND da.date = ?
       GROUP BY e.department
       ORDER BY present DESC
       LIMIT 8`,
      [today]
    );
    res.json({ departments: rows });
  } catch (err) {
    console.error('[Dashboard] GET /departments error:', err.message);
    res.status(500).json({ error: 'Failed to fetch department stats.' });
  }
});

module.exports = router;
