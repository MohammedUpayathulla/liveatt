'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const { query } = require('../config/db');
const { getSocket } = require('../config/socket');
const cfg  = require('../config/index');

/**
 * Push a single employee to a single Pi device.
 * Calls /register-employee, saves returned embedding to MySQL.
 *
 * @param {Object} employee  - { id, employee_code, name, department, image_path, face_enrolled }
 * @param {Object} camera    - { id, name, device_ip }
 * @param {string} imageAbsPath - Absolute path to face image (optional)
 * @returns {Promise<void>}  - Resolves on success, rejects with Error on failure
 */
async function pushOneEmployeeToDevice(employee, camera, imageAbsPath) {
  const pythonUrl = cfg.PYTHON.urlFor(camera.device_ip);

  // Read image as base64 if path provided and file exists
  let image_base64 = null;
  const imgPath = imageAbsPath || (employee.image_path
    ? require('path').join(__dirname, '..', employee.image_path)
    : null);
  if (imgPath && fs.existsSync(imgPath)) {
    image_base64 = fs.readFileSync(imgPath).toString('base64');
  }

  const payload = {
    employee_code: employee.employee_code,
    name:          employee.name,
    department:    employee.department || null,
    image_base64,
    device_ips:    [camera.device_ip],
  };

  const enrollStart = Date.now();
  let pyRes;
  try {
    pyRes = await axios.post(`${pythonUrl}/register-employee`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: cfg.TIMEOUTS.pythonEnroll,
    });
  } catch (err) {
    const statusCode  = err.response?.status;
    const pythonBody  = err.response?.data;
    const reason = statusCode
      ? `HTTP ${statusCode}: ${JSON.stringify(pythonBody)}`
      : err.message;
    throw new Error(reason);
  }

  const enrollmentMs = Date.now() - enrollStart;
  const data = pyRes.data || {};

  // Save embedding returned by Pi to MySQL
  if (Array.isArray(data.embedding) && data.embedding.length > 0) {
    await query(
      'UPDATE employees SET face_embedding = ?, face_enrolled = 1 WHERE id = ?',
      [JSON.stringify(data.embedding), employee.id]
    );
  } else {
    await query('UPDATE employees SET face_enrolled = 1 WHERE id = ?', [employee.id]);
  }

  console.log(`[Enrollment] ${employee.name} (${employee.employee_code}) enrolled in ${(enrollmentMs / 1000).toFixed(1)}s via ${camera.name}`);

  // Notify frontend (includes timing so UI can show "Enrolled in Xs" toast)
  const io = getSocket();
  if (io) {
    io.emit('employee_updated', { ...employee, face_enrolled: 1, enrollment_time_ms: enrollmentMs });
  }
}

/**
 * Push a single employee to ALL active Pi devices (used on add/edit).
 * Mirrors old pushEmployeeToPython behaviour — used by employees.js route.
 *
 * @param {Object} employee
 * @param {string|string[]} imageAbsPath - single path or array of base64 strings
 * @param {string[]} deviceIds  - location strings (optional filter)
 * @param {string[]} deviceIps  - IP strings (optional filter)
 */
async function pushEmployeeToAllDevices(employee, imageAbsPath, deviceIds = [], deviceIps = []) {
  let image_base64 = null;
  let images_base64 = null;

  // Handle both single path and array of base64 strings
  if (typeof imageAbsPath === 'string' && imageAbsPath) {
    // Legacy: single image path
    if (fs.existsSync(imageAbsPath)) {
      image_base64 = fs.readFileSync(imageAbsPath).toString('base64');
    }
  } else if (Array.isArray(imageAbsPath) && imageAbsPath.length > 0) {
    // Multi-angle: array of base64 strings
    images_base64 = imageAbsPath;
    image_base64 = imageAbsPath[0]; // Use first as fallback thumbnail
  }

  // Determine target IPs
  let targets = deviceIps;
  if (!targets.length) {
    const [rows] = await query(
      `SELECT DISTINCT device_ip FROM cameras WHERE device_ip IS NOT NULL AND device_ip != '' AND status = 'active'`
    );
    targets = rows.map((r) => r.device_ip);
  }
  const payload = {
    employee_code: employee.employee_code,
    name:          employee.name,
    department:    employee.department || null,
    device_ips:    targets,
  };

  // Include images_base64 if available (multi-angle), otherwise single image_base64
  if (images_base64 && images_base64.length > 0) {
    payload.images_base64 = images_base64;
  } else if (image_base64) {
    payload.image_base64 = image_base64;
  }

  const enrollStart = Date.now();

  const results = await Promise.allSettled(
    targets.map(async (ip) => {
      const url = cfg.PYTHON.urlFor(ip);
      let pyRes;
      try {
        pyRes = await axios.post(`${url}/register-employee`, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: cfg.TIMEOUTS.pythonEnroll,
        });
      } catch (err) {
        const statusCode = err.response?.status;
        const pythonBody = err.response?.data;
        console.warn(`[PushEmployee] Push failed @ ${url} for ${employee.employee_code}:`);
        console.warn(`  HTTP status : ${statusCode || 'no response (network error)'}`);
        console.warn(`  Error msg   : ${err.message}`);
        if (pythonBody) console.warn(`  Python body :`, JSON.stringify(pythonBody));
        throw err;
      }

      const data = pyRes.data || {};
      if (Array.isArray(data.embedding) && data.embedding.length > 0) {
        await query(
          'UPDATE employees SET face_embedding = ?, face_enrolled = 1 WHERE id = ?',
          [JSON.stringify(data.embedding), employee.id]
        );
      } else {
        await query('UPDATE employees SET face_enrolled = 1 WHERE id = ?', [employee.id]);
      }

      // Record enrollment in device_sync_results so the Employee List "Devices" column reflects it.
      // job_id = NULL means this was a direct add/edit enrollment (not a bulk sync job).
      try {
        const [camRows] = await query(
          `SELECT id FROM cameras WHERE device_ip = ? LIMIT 1`, [ip]
        );
        if (camRows.length) {
          const cameraId = camRows[0].id;
          // Only insert if no success row exists yet for this (employee, camera) pair
          const [existing] = await query(
            `SELECT id FROM device_sync_results WHERE employee_id = ? AND camera_id = ? AND status = 'success' LIMIT 1`,
            [employee.id, cameraId]
          );
          if (!existing.length) {
            await query(
              `INSERT INTO device_sync_results (job_id, employee_id, camera_id, status, attempts, last_attempt)
               VALUES (NULL, ?, ?, 'success', 1, NOW())`,
              [employee.id, cameraId]
            );
            // Write history — close previous open entry then open fresh one
            await query(
              `UPDATE device_sync_history SET unsynced_at = NOW()
               WHERE employee_id = ? AND camera_id = ? AND unsynced_at IS NULL`,
              [employee.id, cameraId]
            );
            await query(
              `INSERT INTO device_sync_history (employee_id, camera_id, synced_at) VALUES (?, ?, NOW())`,
              [employee.id, cameraId]
            );
          }
        }
      } catch (dbErr) {
        console.warn(`[PushEmployee] device_sync_results insert failed for ip=${ip}:`, dbErr.message);
      }
    })
  );

  const enrollmentMs = Date.now() - enrollStart;
  const anySuccess   = results.some((r) => r.status === 'fulfilled');

  if (anySuccess) {
    console.log(`[Enrollment] ${employee.name} (${employee.employee_code}) enrolled in ${(enrollmentMs / 1000).toFixed(1)}s`);
  } else {
    console.warn(`[Enrollment] ${employee.name} (${employee.employee_code}) — all devices failed after ${(enrollmentMs / 1000).toFixed(1)}s`);
  }

  const io = getSocket();
  if (io) {
    io.emit('employee_updated', {
      ...employee,
      face_enrolled:      anySuccess ? 1 : employee.face_enrolled,
      enrollment_time_ms: anySuccess ? enrollmentMs : undefined,
    });
  }
  if (!anySuccess) throw new Error('All Python devices failed to register employee.');
}

/**
 * Push an employee to all active Pi devices using ALL images from a cluster
 * directory. Sends `images_base64` (array) so the Pi can average embeddings
 * across multiple face captures for a more robust enrollment.
 *
 * Falls back gracefully to the caller using pushEmployeeToAllDevices if this
 * function throws (e.g. cluster dir missing).
 */
async function pushEmployeeWithClusterImages(employee, clusterId, deviceIds = [], deviceIps = []) {
  const CLUSTER_DIR = path.join(__dirname, '..', 'uploads', 'unknown-faces', clusterId);
  const MAX = 8;

  if (!fs.existsSync(CLUSTER_DIR)) {
    throw new Error(`Cluster directory not found: ${clusterId}`);
  }

  // Sort alphabetically (names are {timestamp}_{random}.jpg → chronological order).
  // Take the last MAX (most recent captures).
  const files = fs.readdirSync(CLUSTER_DIR)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
    .sort()
    .slice(-MAX);

  if (!files.length) throw new Error(`No images in cluster: ${clusterId}`);

  const images_base64 = files.map((f) =>
    fs.readFileSync(path.join(CLUSTER_DIR, f)).toString('base64')
  );

  // Determine target IPs
  let targets = deviceIps;
  if (!targets.length) {
    const [rows] = await query(
      `SELECT DISTINCT device_ip FROM cameras WHERE device_ip IS NOT NULL AND device_ip != '' AND status = 'active'`
    );
    targets = rows.map((r) => r.device_ip);
  }

  const payload = {
    employee_code: employee.employee_code,
    name:          employee.name,
    department:    employee.department || null,
    images_base64,   // array — Pi server averages these embeddings
  };

  const enrollStart = Date.now();

  const results = await Promise.allSettled(
    targets.map(async (ip) => {
      const url = cfg.PYTHON.urlFor(ip);
      let pyRes;
      try {
        pyRes = await axios.post(`${url}/register-employee`, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: cfg.TIMEOUTS.pythonEnroll,
        });
      } catch (err) {
        const statusCode = err.response?.status;
        const pythonBody = err.response?.data;
        console.warn(`[ClusterPush] Push failed @ ${url} for ${employee.employee_code}: HTTP ${statusCode || 'no response'}`);
        if (pythonBody) console.warn('  Python body:', JSON.stringify(pythonBody));
        throw err;
      }

      const data = pyRes.data || {};
      if (Array.isArray(data.embedding) && data.embedding.length > 0) {
        await query(
          'UPDATE employees SET face_embedding = ?, face_enrolled = 1 WHERE id = ?',
          [JSON.stringify(data.embedding), employee.id]
        );
      } else {
        await query('UPDATE employees SET face_enrolled = 1 WHERE id = ?', [employee.id]);
      }

      // Record in device_sync_results / device_sync_history (same as pushEmployeeToAllDevices)
      try {
        const [camRows] = await query(`SELECT id FROM cameras WHERE device_ip = ? LIMIT 1`, [ip]);
        if (camRows.length) {
          const cameraId = camRows[0].id;
          const [existing] = await query(
            `SELECT id FROM device_sync_results WHERE employee_id = ? AND camera_id = ? AND status = 'success' LIMIT 1`,
            [employee.id, cameraId]
          );
          if (!existing.length) {
            await query(
              `INSERT INTO device_sync_results (job_id, employee_id, camera_id, status, attempts, last_attempt)
               VALUES (NULL, ?, ?, 'success', 1, NOW())`,
              [employee.id, cameraId]
            );
            await query(
              `UPDATE device_sync_history SET unsynced_at = NOW()
               WHERE employee_id = ? AND camera_id = ? AND unsynced_at IS NULL`,
              [employee.id, cameraId]
            );
            await query(
              `INSERT INTO device_sync_history (employee_id, camera_id, synced_at) VALUES (?, ?, NOW())`,
              [employee.id, cameraId]
            );
          }
        }
      } catch (dbErr) {
        console.warn(`[ClusterPush] device_sync_results insert failed for ip=${ip}:`, dbErr.message);
      }

      console.log(
        `[ClusterPush] ${employee.name} enrolled (${files.length} images sent, ${data.images_processed ?? '?'} used) ` +
        `via ${ip} in ${((Date.now() - enrollStart) / 1000).toFixed(1)}s`
      );
    })
  );

  const anySuccess = results.some((r) => r.status === 'fulfilled');
  const io = getSocket();
  if (io) {
    io.emit('employee_updated', {
      ...employee,
      face_enrolled:      anySuccess ? 1 : employee.face_enrolled,
      enrollment_time_ms: anySuccess ? Date.now() - enrollStart : undefined,
    });
  }
  if (!anySuccess) throw new Error('All Python devices failed cluster-image registration.');
}

module.exports = { pushOneEmployeeToDevice, pushEmployeeToAllDevices, pushEmployeeWithClusterImages };