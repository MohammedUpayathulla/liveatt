'use strict';

const cfg   = require('./index');
const mysql = require('mysql2');

const pool = mysql.createPool({
  host:     cfg.DB.host,
  user:     cfg.DB.user,
  password: cfg.DB.password,
  port:     cfg.DB.port,
  database: cfg.DB.database,
  waitForConnections: true,
  connectionLimit:    15,      // increased from 10 — attendance events can burst
  queueLimit:         0,
  connectTimeout:     10000,   // fail fast if MySQL is unreachable (10 s)
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,
  dateStrings: ['DATE'],       // return DATE columns as 'YYYY-MM-DD' strings, not JS Date objects (prevents IST→UTC shift)
  timezone:    '+05:30',       // explicitly force IST (Asia/Kolkata) — never rely on server OS locale
});

const promisePool = pool.promise();

/**
 * Execute a SQL query using the promise pool.
 * @param {string} sql  - SQL statement
 * @param {Array}  params - Bound parameters
 * @returns {Promise<[rows, fields]>}
 */
async function query(sql, params) {
  return promisePool.query(sql, params);
}

/**
 * Test the DB connection and log the result.
 * @returns {Promise<void>}
 */
async function initDB() {
  try {
    const [rows] = await promisePool.query('SELECT 1 AS connected');
    if (rows && rows[0] && rows[0].connected === 1) {
      console.log('[DB] MySQL connection pool initialised successfully.');
    }
  } catch (err) {
    console.error('[DB] Failed to connect to MySQL:', err.message);
    throw err;
  }

  // ── Migration: employees.status column ──────────────────────────────────
  try {
    const [cols] = await promisePool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'status'`
    );
    if (cols.length === 0) {
      await promisePool.query(
        `ALTER TABLE employees ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'active' AFTER department`
      );
      console.log('[DB] Migration: employees.status column added.');
    }
  } catch (err) { console.warn('[DB] Migration warning (employees.status):', err.message); }

  // ── Migration: cameras.threshold column ─────────────────────────────────
  try {
    const [cols] = await promisePool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cameras' AND COLUMN_NAME = 'threshold'`
    );
    if (cols.length === 0) {
      await promisePool.query(`ALTER TABLE cameras ADD COLUMN threshold FLOAT NULL DEFAULT NULL AFTER camera_type`);
      console.log('[DB] Migration: cameras.threshold added.');
    }
  } catch (err) { console.warn('[DB] Migration warning (threshold):', err.message); }

  // ── Migration: daily_attendance table ────────────────────────────────────
  try {
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS daily_attendance (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        employee_id         INT NOT NULL,
        date                DATE NOT NULL,
        first_in_time       DATETIME NULL,
        last_out_time       DATETIME NULL,
        total_work_minutes  INT NOT NULL DEFAULT 0,
        status              VARCHAR(20) NULL,
        UNIQUE KEY uq_emp_date (employee_id, date),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Migration: daily_attendance table ready.');
  } catch (err) { console.warn('[DB] Migration warning (daily_attendance):', err.message); }

  // ── Seed default shift settings if not present ───────────────────────────
  try {
    const defaults = [
      ['shift_start_time', '09:00'],
      ['shift_end_time',   '18:00'],
      ['working_hours',    '8'],
    ];
    for (const [key, value] of defaults) {
      await promisePool.query(
        `INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)`,
        [key, value]
      );
    }
    console.log('[DB] Shift settings seeded.');
  } catch (err) { console.warn('[DB] Migration warning (shift settings):', err.message); }

  // ── Migration: cameras.device_ip column ─────────────────────────────────
  try {
    const [ipCols] = await promisePool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cameras' AND COLUMN_NAME = 'device_ip'`
    );
    if (ipCols.length === 0) {
      await promisePool.query(`ALTER TABLE cameras ADD COLUMN device_ip VARCHAR(45) NULL DEFAULT NULL AFTER location`);
      console.log('[DB] Migration: cameras.device_ip added.');
    }
  } catch (err) { console.warn('[DB] Migration warning (device_ip):', err.message); }

  // ── Migration: cameras.online_status column ──────────────────────────────
  try {
    const [osCols] = await promisePool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cameras' AND COLUMN_NAME = 'online_status'`
    );
    if (osCols.length === 0) {
      await promisePool.query(`ALTER TABLE cameras ADD COLUMN online_status VARCHAR(10) NOT NULL DEFAULT 'unknown' AFTER device_ip`);
      console.log('[DB] Migration: cameras.online_status added.');
    }
  } catch (err) { console.warn('[DB] Migration warning (online_status):', err.message); }

  // ── Migration: device_sync_results.job_id nullable ──────────────────────
  // job_id = NULL means direct add/edit enrollment (not via bulk sync job)
  try {
    await promisePool.query(
      `ALTER TABLE device_sync_results MODIFY COLUMN job_id INT NULL DEFAULT NULL`
    );
    console.log('[DB] Migration: device_sync_results.job_id is now nullable.');
  } catch (err) { console.warn('[DB] Migration warning (device_sync_results job_id nullable):', err.message); }

  // ── Migration: device_sync_jobs table ────────────────────────────────────
  try {
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS device_sync_jobs (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        status        ENUM('pending','in_progress','completed','failed') NOT NULL DEFAULT 'pending',
        total_tasks   INT      NOT NULL DEFAULT 0,
        done_tasks    INT      NOT NULL DEFAULT 0,
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at  DATETIME NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Migration: device_sync_jobs table ready.');
  } catch (err) { console.warn('[DB] Migration warning (device_sync_jobs):', err.message); }

  // ── Migration: device_sync_results table ─────────────────────────────────
  try {
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS device_sync_results (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        job_id       INT          NULL DEFAULT NULL,
        employee_id  INT          NOT NULL,
        camera_id    INT          NOT NULL,
        status       ENUM('pending','in_progress','success','failed') NOT NULL DEFAULT 'pending',
        error_msg    VARCHAR(500) NULL,
        attempts     INT          NOT NULL DEFAULT 0,
        last_attempt DATETIME     NULL,
        FOREIGN KEY (job_id)      REFERENCES device_sync_jobs(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id)        ON DELETE CASCADE,
        FOREIGN KEY (camera_id)   REFERENCES cameras(id)          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Migration: device_sync_results table ready.');
  } catch (err) { console.warn('[DB] Migration warning (device_sync_results):', err.message); }

  // ── Migration: employee_code case-insensitive collation + unique index ───
  // utf8mb4_unicode_ci treats ru111 = RU111 = Ru111 — blocks duplicates at DB level
  try {
    await promisePool.query(`
      ALTER TABLE employees
        MODIFY COLUMN employee_code VARCHAR(50)
          CHARACTER SET utf8mb4
          COLLATE utf8mb4_unicode_ci
          NOT NULL
    `);
    console.log('[DB] Migration: employee_code collation set to utf8mb4_unicode_ci.');
  } catch (err) { console.warn('[DB] Migration warning (employee_code collation):', err.message); }

  // Ensure a unique index exists on employee_code (DROP first if case-sensitive one exists)
  try {
    await promisePool.query(`ALTER TABLE employees DROP INDEX employee_code`);
  } catch (_) { /* index may not exist or have a different name — ignore */ }
  try {
    await promisePool.query(`ALTER TABLE employees ADD UNIQUE INDEX uq_employee_code (employee_code)`);
    console.log('[DB] Migration: unique index on employee_code ready.');
  } catch (err) { console.warn('[DB] Migration warning (employee_code unique index):', err.message); }

  // ── Migration: device_sync_history table ─────────────────────────────────
  try {
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS device_sync_history (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        employee_id  INT      NOT NULL,
        camera_id    INT      NOT NULL,
        synced_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        unsynced_at  DATETIME NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (camera_id)   REFERENCES cameras(id)   ON DELETE CASCADE,
        INDEX idx_emp   (employee_id),
        INDEX idx_cam   (camera_id),
        INDEX idx_dates (synced_at, unsynced_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Backfill history from existing device_sync_results (currently enrolled = no unsynced_at)
    await promisePool.query(`
      INSERT IGNORE INTO device_sync_history (employee_id, camera_id, synced_at, unsynced_at)
      SELECT dsr.employee_id, dsr.camera_id,
             COALESCE(dsr.last_attempt, NOW()) AS synced_at,
             NULL AS unsynced_at
      FROM device_sync_results dsr
      WHERE dsr.status = 'success'
        AND NOT EXISTS (
          SELECT 1 FROM device_sync_history h
          WHERE h.employee_id = dsr.employee_id
            AND h.camera_id   = dsr.camera_id
            AND h.unsynced_at IS NULL
        )
    `);
    console.log('[DB] Migration: device_sync_history table ready.');
  } catch (err) { console.warn('[DB] Migration warning (device_sync_history):', err.message); }

  // ── Migration: employees.registered_via column ──────────────────────────
  try {
    const [rvCols] = await promisePool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'registered_via'`
    );
    if (rvCols.length === 0) {
      await promisePool.query(
        `ALTER TABLE employees ADD COLUMN registered_via VARCHAR(10) NOT NULL DEFAULT 'web' AFTER status`
      );
      // Backfill: any row that already has registered_at_device set came from a device
      await promisePool.query(
        `UPDATE employees SET registered_via = 'device' WHERE registered_at_device IS NOT NULL`
      );
      console.log('[DB] Migration: employees.registered_via column added and backfilled.');
    }
  } catch (err) { console.warn('[DB] Migration warning (employees.registered_via):', err.message); }

  // ── Migration: unknown_faces table ──────────────────────────────────────────
  try {
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS unknown_faces (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        cluster_id  VARCHAR(64)  NOT NULL,
        camera_id   INT          NULL,
        device_ip   VARCHAR(45)  NULL,
        device_name VARCHAR(255) NULL,
        image_path  VARCHAR(500) NOT NULL DEFAULT '',
        captured_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cluster  (cluster_id),
        INDEX idx_camera   (camera_id),
        INDEX idx_captured (captured_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('[DB] Migration: unknown_faces table ready.');
  } catch (err) { console.warn('[DB] Migration warning (unknown_faces):', err.message); }

  // ── Migration: unknown_faces.status column ───────────────────────────────────
  // Use ALTER TABLE directly — MySQL throws ER_DUP_FIELDNAME (errno 1060) if
  // the column already exists, which we silently ignore.
  try {
    await promisePool.query(
      `ALTER TABLE unknown_faces
       ADD COLUMN status ENUM('new','reviewed','registered') NOT NULL DEFAULT 'new'`
    );
    console.log('[DB] Migration: unknown_faces.status column added.');
  } catch (err) {
    if (err.errno !== 1060) { // 1060 = Duplicate column name — already exists, fine
      console.warn('[DB] Migration warning (unknown_faces.status):', err.message);
    }
  }
  try {
    await promisePool.query(`ALTER TABLE unknown_faces ADD INDEX idx_status (status)`);
  } catch (_) {} // ignore if index already exists

  // ── Migration: employees.image_blob column ──────────────────────────────
  try {
    const [blobCols] = await promisePool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'image_blob'`
    );
    if (blobCols.length === 0) {
      await promisePool.query(
        `ALTER TABLE employees ADD COLUMN image_blob LONGBLOB DEFAULT NULL AFTER image_path`
      );
      console.log('[DB] Migration: employees.image_blob column added.');
    }
  } catch (err) { console.warn('[DB] Migration warning (employees.image_blob):', err.message); }

  // ── Migration: employees.name_hindi column ──────────────────────────────
  try {
    const [hindiCols] = await promisePool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'name_hindi'`
    );
    if (hindiCols.length === 0) {
      await promisePool.query(
        `ALTER TABLE employees ADD COLUMN name_hindi VARCHAR(255) DEFAULT NULL AFTER name`
      );
      console.log('[DB] Migration: employees.name_hindi column added.');
    }
  } catch (err) { console.warn('[DB] Migration warning (employees.name_hindi):', err.message); }

  console.log('[DB] Auto-migrations applied.');
}

module.exports = { pool: promisePool, query, initDB };
