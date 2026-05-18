'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const cfg   = require('../config/index');
const { query } = require('../config/db');
const { upload } = require('../middleware/upload');
const { getSocket } = require('../config/socket');

const { pushEmployeeToAllDevices, pushEmployeeWithClusterImages } = require('../utils/pushEmployee');
const { generateAvatar } = require('../utils/avatarize');

// Alias for backward compat within this file
const pushEmployeeToPython = pushEmployeeToAllDevices;

// GET /api/employees - list all employees with their enrolled devices
router.get('/', async (req, res) => {
  try {
    const [empRows] = await query(
      `SELECT e.id, e.name, e.employee_code, e.department, e.status, e.image_path,
              e.face_enrolled, e.created_at, e.registered_via, e.registered_at_device,
              c.name AS registered_device_name
       FROM employees e
       LEFT JOIN cameras c ON c.location = e.registered_at_device
       ORDER BY e.name ASC`
    );

    // Get all successful sync assignments grouped by employee
    const [deviceRows] = await query(
      `SELECT dsr.employee_id, c.id AS camera_id, c.name AS camera_name, c.device_ip
       FROM device_sync_results dsr
       JOIN cameras c ON c.id = dsr.camera_id
       WHERE dsr.status = 'success'`
    );

    // Build map: employee_id → [{ camera_id, camera_name, device_ip }]
    const deviceMap = {};
    for (const d of deviceRows) {
      if (!deviceMap[d.employee_id]) deviceMap[d.employee_id] = [];
      // Avoid duplicate camera entries per employee
      if (!deviceMap[d.employee_id].some((x) => x.camera_id === d.camera_id)) {
        deviceMap[d.employee_id].push({ camera_id: d.camera_id, camera_name: d.camera_name, device_ip: d.device_ip });
      }
    }

    const employees = empRows.map((e) => ({ ...e, enrolled_devices: deviceMap[e.id] || [] }));
    res.json({ employees });
  } catch (err) {
    console.error('[Employees] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch employees.' });
  }
});

// GET /api/employees/:id - get single employee
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT id, name, name_hindi, employee_code, department, image_path, face_enrolled, created_at
       FROM employees WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Employee not found.' });
    }
    res.json({ employee: rows[0] });
  } catch (err) {
    console.error('[Employees] GET /:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch employee.' });
  }
});

// POST /api/employees - create employee (multipart: name, employee_code, department, camera_ids[] + optional image or images_base64)
// After saving to DB, pushes to Python with image + selected device_ids.
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { name, employee_code, department, cluster_id, name_hindi, images_base64 } = req.body;
    // camera_ids can be a single value or array (multipart sends repeated fields)
    const rawIds = req.body.camera_ids
      ? (Array.isArray(req.body.camera_ids) ? req.body.camera_ids : [req.body.camera_ids])
      : [];

    // Parse images_base64 if provided (from frontend multi-angle)
    let imagesBase64Array = [];
    if (images_base64) {
      try {
        imagesBase64Array = JSON.parse(images_base64);
      } catch (_) {}
    }

    if (!name || !employee_code) {
      return res.status(400).json({ error: 'name and employee_code are required.' });
    }

    // Normalize code — always store/compare as uppercase so ru111 = RU111 = Ru111
    const normalizedCode = employee_code.trim().toUpperCase();

    // Case-insensitive duplicate check before insert
    const [existing_code] = await query(
      'SELECT id FROM employees WHERE UPPER(employee_code) = ?', [normalizedCode]
    );
    if (existing_code.length) {
      if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
      return res.status(409).json({ error: `Employee code '${normalizedCode}' already exists.` });
    }

    // Rename uploaded file to {employee_code}.jpg and read it as buffer for BLOB storage
    let imagePath = null;
    let imageBuffer = null;
    let finalFilePath = null;
    if (req.file) {
      const codeFilename = normalizedCode + '.jpg';
      finalFilePath = path.join(__dirname, '..', 'uploads', 'faces', codeFilename);
      fs.renameSync(req.file.path, finalFilePath);
      imagePath = 'uploads/faces/' + codeFilename;
      imageBuffer = fs.readFileSync(finalFilePath);
    } else if (imagesBase64Array.length > 0) {
      // Use first multi-angle image as thumbnail for DB
      const firstImgBase64 = imagesBase64Array[0];
      const buf = Buffer.from(firstImgBase64, 'base64');
      const codeFilename = normalizedCode + '.jpg';
      finalFilePath = path.join(__dirname, '..', 'uploads', 'faces', codeFilename);
      fs.writeFileSync(finalFilePath, buf);
      imagePath = 'uploads/faces/' + codeFilename;
      imageBuffer = buf;
    }

    // Save employee to DB immediately
    const [result] = await query(
      `INSERT INTO employees (name, name_hindi, employee_code, department, image_path, image_blob, face_embedding, face_enrolled, registered_via)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 'web')`,
      [name, name_hindi || null, normalizedCode, department || null, imagePath, imageBuffer]
    );

    const [rows] = await query(
      `SELECT id, name, name_hindi, employee_code, department, image_path, face_enrolled, created_at
       FROM employees WHERE id = ?`,
      [result.insertId]
    );

    const employee = rows[0];

    // Resolve camera DB ids → device_id strings (cameras.location column) & device_ips
    let deviceIds = [];
    let deviceIps = [];
    if (rawIds.length > 0) {
      const placeholders = rawIds.map(() => '?').join(',');
      const [camRows] = await query(
        `SELECT id, location, device_ip FROM cameras WHERE id IN (${placeholders})`,
        rawIds
      );
      deviceIds = camRows.map((r) => r.location).filter(Boolean);
      deviceIps = camRows.map((r) => r.device_ip).filter(Boolean);

      // Pre-insert device_sync_results BEFORE responding so the list refreshes immediately
      for (const cam of camRows) {
        await query(
          `INSERT INTO device_sync_results (job_id, employee_id, camera_id, status, attempts, last_attempt)
           VALUES (NULL, ?, ?, 'success', 0, NOW())`,
          [employee.id, cam.id]
        );
      }
    }

    // Respond immediately — Python push runs in the background.
    // Frontend gets notified via Socket.IO 'employee_updated' when enrolled.
    res.status(201).json({ employee });

    if (finalFilePath || imagesBase64Array.length > 0) {
      if (cluster_id) {
        // Registration from Unknown Persons — use all cluster images for a richer embedding
        pushEmployeeWithClusterImages(employee, cluster_id, deviceIds, deviceIps)
          .catch((err) => {
            console.warn('[Employees] Cluster push failed, falling back to single-image:', err.message);
            const imagesToPush = imagesBase64Array.length > 0 ? imagesBase64Array : finalFilePath;
            pushEmployeeToPython(employee, imagesToPush, deviceIds, deviceIps).catch(() => {});
          });
      } else {
        // Use multi-angle images if provided, otherwise use single image path
        const imagesToPush = imagesBase64Array.length > 0 ? imagesBase64Array : finalFilePath;
        pushEmployeeToPython(employee, imagesToPush, deviceIds, deviceIps).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Employees] POST / error:', err.message);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Employee code already exists.' });
    }
    res.status(500).json({ error: 'Failed to create employee.' });
  }
});

// PUT /api/employees/:id - update employee (all fields + optional new photo)
// Accepts multipart/form-data: name, employee_code, department, camera_ids[], image(optional)
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, employee_code, department, name_hindi } = req.body;
    const rawIds = req.body.camera_ids
      ? (Array.isArray(req.body.camera_ids) ? req.body.camera_ids : [req.body.camera_ids])
      : [];
    const devicesUpdated = req.body.devices_updated === '1';

    const [existing] = await query(
      'SELECT id, image_path, employee_code FROM employees WHERE id = ?', [id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Employee not found.' });

    // Normalize code to uppercase; check case-insensitive duplicate (only if changed)
    const normalizedCode = employee_code ? employee_code.trim().toUpperCase() : null;
    if (normalizedCode && normalizedCode !== existing[0].employee_code.toUpperCase()) {
      const [dup] = await query(
        'SELECT id FROM employees WHERE UPPER(employee_code) = ? AND id != ?', [normalizedCode, id]
      );
      if (dup.length) return res.status(409).json({ error: `Employee code '${normalizedCode}' already exists.` });
    }

    const fields = [];
    const values = [];

    if (name)                     { fields.push('name = ?');            values.push(name); }
    if (name_hindi !== undefined) { fields.push('name_hindi = ?');      values.push(name_hindi || null); }
    if (normalizedCode)           { fields.push('employee_code = ?');   values.push(normalizedCode); }
    if (department !== undefined) { fields.push('department = ?');      values.push(department || null); }

    // New photo uploaded
    if (req.file) {
      if (existing[0].image_path) {
        const oldPath = path.join(__dirname, '..', existing[0].image_path);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      fields.push('image_path = ?');
      values.push('uploads/faces/' + req.file.filename);
      fields.push('face_embedding = NULL'); // clear old embedding; push will set new one without flashing Unenrolled
    }

    if (fields.length) {
      values.push(id);
      await query(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    const [rows] = await query(
      `SELECT id, name, name_hindi, employee_code, department, image_path, face_enrolled, created_at
       FROM employees WHERE id = ?`, [id]
    );
    const employee = rows[0];

    // Resolve device_ids & device_ips for newly selected cameras
    let deviceIds = [];
    let deviceIps = [];
    let newCameraIds = rawIds.map(String); // string IDs from the form

    if (rawIds.length > 0) {
      const placeholders = rawIds.map(() => '?').join(',');
      const [camRows] = await query(
        `SELECT id, location, device_ip FROM cameras WHERE id IN (${placeholders})`, rawIds
      );
      deviceIds = camRows.map((r) => r.location).filter(Boolean);
      deviceIps = camRows.map((r) => r.device_ip).filter(Boolean);
    }

    // ── Sync device assignments when the user explicitly changed device selection ──
    // Find which cameras were previously enrolled (success rows in device_sync_results)
    let removedCameraIps = [];
    if (devicesUpdated) {
      const [prevRows] = await query(
        `SELECT dsr.camera_id, c.device_ip
         FROM device_sync_results dsr
         JOIN cameras c ON c.id = dsr.camera_id
         WHERE dsr.employee_id = ? AND dsr.status = 'success'`,
        [id]
      );
      const prevCameraIds = prevRows.map((r) => String(r.camera_id));

      // Cameras removed from selection → delete their sync records
      const removedIds = prevCameraIds.filter((cid) => !newCameraIds.includes(cid));
      if (removedIds.length) {
        const ph = removedIds.map(() => '?').join(',');
        await query(
          `DELETE FROM device_sync_results WHERE employee_id = ? AND camera_id IN (${ph})`,
          [id, ...removedIds]
        );
        removedCameraIps = prevRows
          .filter((r) => removedIds.includes(String(r.camera_id)))
          .map((r) => r.device_ip)
          .filter(Boolean);
      }

      // Cameras already enrolled that are still selected → no re-push needed
      // Only push to cameras that are newly added (not previously enrolled)
      const addedIds = newCameraIds.filter((cid) => !prevCameraIds.includes(cid));
      if (addedIds.length > 0) {
        const ph = addedIds.map(() => '?').join(',');
        const [addedCams] = await query(
          `SELECT id, location, device_ip FROM cameras WHERE id IN (${ph})`, addedIds
        );
        deviceIds = addedCams.map((r) => r.location).filter(Boolean);
        deviceIps = addedCams.map((r) => r.device_ip).filter(Boolean);

        // Pre-insert device_sync_results BEFORE responding so the list refreshes immediately
        for (const cam of addedCams) {
          const [existing] = await query(
            `SELECT id FROM device_sync_results WHERE employee_id = ? AND camera_id = ? AND status = 'success' LIMIT 1`,
            [id, cam.id]
          );
          if (!existing.length) {
            await query(
              `INSERT INTO device_sync_results (job_id, employee_id, camera_id, status, attempts, last_attempt)
               VALUES (NULL, ?, ?, 'success', 0, NOW())`,
              [id, cam.id]
            );
          }
        }
      } else {
        // No new cameras to push to
        deviceIds = [];
        deviceIps = [];
      }
    }

    // Respond immediately — Python push runs in the background.
    res.json({ employee });

    const imageAbsPath = req.file
      ? req.file.path
      : (employee.image_path ? path.join(__dirname, '..', employee.image_path) : null);

    // Push to newly added devices (photo change or new camera assignment)
    if (deviceIps.length > 0 && imageAbsPath && fs.existsSync(imageAbsPath)) {
      pushEmployeeToPython(employee, imageAbsPath, deviceIds, deviceIps).catch(() => {});
    }

    // Name / department changed without a photo swap → re-push to ALL currently
    // enrolled devices so the Pi's SQLite name stays in sync with MySQL.
    if (!req.file && (name !== undefined || department !== undefined) && imageAbsPath && fs.existsSync(imageAbsPath)) {
      const [enrolledRows] = await query(
        `SELECT DISTINCT c.device_ip FROM device_sync_results dsr
         JOIN cameras c ON c.id = dsr.camera_id
         WHERE dsr.employee_id = ? AND dsr.status = 'success'
           AND c.device_ip IS NOT NULL AND c.device_ip != ''`,
        [id]
      );
      if (enrolledRows.length > 0) {
        const enrolledIps = enrolledRows.map((r) => r.device_ip)
          .filter((ip) => !deviceIps.includes(ip)); // skip already-pushed IPs
        if (enrolledIps.length > 0) {
          pushEmployeeToPython(employee, imageAbsPath, [], enrolledIps).catch(() => {});
        }
      }
    }

    // Notify removed devices to delete this employee from their face store
    if (removedCameraIps.length > 0) {
      Promise.allSettled(
        removedCameraIps.map((ip) =>
          axios.post(`${cfg.PYTHON.urlFor(ip)}/delete-employee`,
            { employee_code: employee.employee_code },
            { headers: { 'Content-Type': 'application/json' }, timeout: cfg.TIMEOUTS.pythonDelete }
          ).catch((err) => console.warn(`[Employees] Python delete failed @ ${ip}:`, err.message))
        )
      );
    }
  } catch (err) {
    console.error('[Employees] PUT /:id error:', err.message);
    res.status(500).json({ error: 'Failed to update employee.' });
  }
});

// PUT /api/employees/:id/face - update face image and re-extract embedding
router.put('/:id/face', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await query(
      'SELECT id, image_path FROM employees WHERE id = ?',
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required.' });
    }

    // Delete old image if present
    if (existing[0].image_path) {
      const oldPath = path.join(__dirname, '..', existing[0].image_path);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const imagePath = 'uploads/faces/' + req.file.filename;

    // Clear old embedding but keep face_enrolled=1 so the UI doesn't flash "Unenrolled".
    // The push will update the embedding; if it fails the socket event will correct the status.
    await query(
      `UPDATE employees SET image_path = ?, face_embedding = NULL WHERE id = ?`,
      [imagePath, id]
    );

    const [rows] = await query(
      `SELECT id, name, name_hindi, employee_code, department, image_path, face_enrolled, created_at
       FROM employees WHERE id = ?`,
      [id]
    );

    const employee = rows[0];
    res.json({ employee });
    pushEmployeeToPython(employee, req.file.path).catch(() => {});
  } catch (err) {
    console.error('[Employees] PUT /:id/face error:', err.message);
    res.status(500).json({ error: 'Failed to update employee face.' });
  }
});

// DELETE /api/employees/:id — soft-delete (status = 'inactive')
// Optional query param: ?camera_id=X  → remove from that device only
// No query param               → remove from ALL active devices
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const camera_id = req.query.camera_id || null;

    const [existing] = await query(
      'SELECT id, employee_code FROM employees WHERE id = ?', [id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Employee not found.' });

    const { employee_code } = existing[0];

    // Soft-delete: mark inactive (keep all data intact)
    await query('UPDATE employees SET status = ? WHERE id = ?', ['inactive', id]);

    if (camera_id) {
      // ── Remove from ONE specific device ────────────────────────────────
      await query(
        'DELETE FROM device_sync_results WHERE employee_id = ? AND camera_id = ?',
        [id, camera_id]
      );
      const [camRows] = await query(
        'SELECT device_ip FROM cameras WHERE id = ? LIMIT 1', [camera_id]
      );
      if (camRows.length && camRows[0].device_ip) {
        const url = cfg.PYTHON.urlFor(camRows[0].device_ip);
        axios.post(`${url}/delete-employee`, { employee_code }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: cfg.TIMEOUTS.pythonDelete,
        }).then(() => console.log(`[Employees] Removed from Python @ ${url}: ${employee_code}`))
          .catch((err) => console.warn(`[Employees] Python remove failed @ ${url}:`, err.message));
      }
    } else {
      // ── Remove from ALL active devices ─────────────────────────────────
      await query('DELETE FROM device_sync_results WHERE employee_id = ?', [id]);
      const [ipRows] = await query(
        `SELECT DISTINCT device_ip FROM cameras WHERE device_ip IS NOT NULL AND device_ip != '' AND status = 'active'`
      );
      const urls = ipRows.length
        ? ipRows.map((r) => cfg.PYTHON.urlFor(r.device_ip))
        : [cfg.PYTHON.fallbackUrl];
      Promise.allSettled(
        urls.map((url) =>
          axios.post(`${url}/delete-employee`, { employee_code }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: cfg.TIMEOUTS.pythonDelete,
          }).then(() => console.log(`[Employees] Removed from Python @ ${url}: ${employee_code}`))
            .catch((err) => console.warn(`[Employees] Python remove failed @ ${url}:`, err.message))
        )
      );
    }

    res.json({ message: 'Employee deactivated successfully.', employee_code });
  } catch (err) {
    console.error('[Employees] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Failed to deactivate employee.' });
  }
});

// PATCH /api/employees/:id/status — reactivate (or toggle) employee status
// Body (JSON): { status: 'active' | 'inactive' }
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'inactive'." });
    }
    const [existing] = await query('SELECT id FROM employees WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ error: 'Employee not found.' });

    await query('UPDATE employees SET status = ? WHERE id = ?', [status, id]);
    const [rows] = await query(
      `SELECT id, name, employee_code, department, status, image_path, face_enrolled, created_at
       FROM employees WHERE id = ?`, [id]
    );
    res.json({ employee: rows[0] });
  } catch (err) {
    console.error('[Employees] PATCH /:id/status error:', err.message);
    res.status(500).json({ error: 'Failed to update employee status.' });
  }
});

// POST /api/employees/:id/enroll-from-camera - capture live frame from RTSP camera and enroll
router.post('/:id/enroll-from-camera', async (req, res) => {
  try {
    const { id } = req.params;
    const { rtsp_url } = req.body;

    if (!rtsp_url) {
      return res.status(400).json({ error: 'rtsp_url is required.' });
    }

    const [existing] = await query('SELECT id, name FROM employees WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    // Ask Python service to grab a live frame and extract embedding
    let pyResponse;
    try {
      pyResponse = await axios.post(
        `${cfg.PYTHON.fallbackUrl}/capture-from-camera`,
        { rtsp_url },
        { headers: { 'Content-Type': 'application/json' }, timeout: cfg.TIMEOUTS.pythonEnroll }
      );
    } catch (err) {
      return res.status(502).json({ error: `Python service error: ${err.message}` });
    }

    const { success, embedding, snapshot_b64, error: pyErr } = pyResponse.data;

    if (!success || !embedding) {
      return res.status(422).json({ error: pyErr || 'No face detected in camera frame.' });
    }

    // Save the face crop snapshot as the employee profile image
    let imagePath = null;
    if (snapshot_b64) {
      try {
        const { v4: uuidv4 } = require('uuid');
        const filename = `${Date.now()}-${uuidv4()}.jpg`;
        const savePath = path.join(__dirname, '..', 'uploads', 'faces', filename);
        fs.writeFileSync(savePath, Buffer.from(snapshot_b64, 'base64'));
        imagePath = `uploads/faces/${filename}`;
      } catch (e) {
        console.warn('[Employees] Could not save snapshot:', e.message);
      }
    }

    const updateFields = ['face_embedding = ?', 'face_enrolled = 1'];
    const updateValues = [JSON.stringify(embedding)];
    if (imagePath) { updateFields.push('image_path = ?'); updateValues.push(imagePath); }
    updateValues.push(id);

    await query(`UPDATE employees SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);

    const [rows] = await query(
      `SELECT id, name, employee_code, department, image_path, face_enrolled, created_at FROM employees WHERE id = ?`,
      [id]
    );

    res.json({ employee: rows[0], message: `Face enrolled from camera for ${existing[0].name}.` });
  } catch (err) {
    console.error('[Employees] POST /:id/enroll-from-camera error:', err.message);
    res.status(500).json({ error: 'Failed to enroll from camera.' });
  }
});

// POST /api/employees/:id/enroll - re-enroll face (re-extract embedding from existing image)
router.post('/:id/enroll', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await query(
      'SELECT id, name, image_path FROM employees WHERE id = ?',
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    let targetImagePath;

    if (req.file) {
      // New image was uploaded for re-enrollment
      if (existing[0].image_path) {
        const oldPath = path.join(__dirname, '..', existing[0].image_path);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const newRelPath = 'uploads/faces/' + req.file.filename;
      await query('UPDATE employees SET image_path = ? WHERE id = ?', [newRelPath, id]);
      targetImagePath = req.file.path;
    } else if (existing[0].image_path) {
      targetImagePath = path.join(__dirname, '..', existing[0].image_path);
    } else {
      return res.status(400).json({ error: 'No image available for enrollment. Upload an image.' });
    }

    if (!fs.existsSync(targetImagePath)) {
      return res.status(400).json({ error: 'Image file not found on disk.' });
    }

    // Reset enrollment flag — Python will call back via /register
    await query(
      'UPDATE employees SET face_embedding = NULL, face_enrolled = 0 WHERE id = ?',
      [id]
    );

    const [rows] = await query(
      `SELECT id, name, name_hindi, employee_code, department, image_path, face_enrolled, created_at
       FROM employees WHERE id = ?`,
      [id]
    );

    const employee = rows[0];
    try {
      await pushEmployeeToPython(employee, targetImagePath);
      employee.face_enrolled = 1;
    } catch (_) {}
    res.json({ employee });
  } catch (err) {
    console.error('[Employees] POST /:id/enroll error:', err.message);
    res.status(500).json({ error: 'Failed to enroll face.' });
  }
});

// POST /api/employees/:id/avatar — generate cartoon avatar from employee's current photo
// Saves as uploads/faces/<code>_avatar.jpg  and stores path in avatar_path (returned in response)
router.post('/:id/avatar', async (req, res) => {
  try {
    const [rows] = await query(
      'SELECT id, name, employee_code, image_path FROM employees WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Employee not found.' });

    const emp = rows[0];
    if (!emp.image_path) return res.status(400).json({ error: 'Employee has no photo uploaded.' });

    const srcPath = path.join(__dirname, '..', emp.image_path);
    if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'Photo file not found on disk.' });

    const avatarRelPath = await generateAvatar(srcPath);
    if (!avatarRelPath) {
      return res.status(500).json({ error: 'Avatar generation failed. Make sure Python and OpenCV are installed.' });
    }

    res.json({ ok: true, avatar_path: avatarRelPath, employee_code: emp.employee_code });
  } catch (err) {
    console.error('[Employees] POST /:id/avatar error:', err.message);
    res.status(500).json({ error: 'Failed to generate avatar.' });
  }
});

// POST /api/employees/bulk - create multiple employees from images + metadata JSON
//
// Request: multipart/form-data
//   images    – one or more image files (field name 'images', repeatable)
//   metadata  – JSON string: [{ name, employee_code, department? }, ...]
//               Array order must match the order of uploaded files.
//
// Response:
//   { results: [{ employee_code, success, error?, employee? }, ...] }
//
router.post('/bulk', upload.array('images', 100), async (req, res) => {
  const files    = req.files || [];
  let   metadata = [];

  try {
    metadata = JSON.parse(req.body.metadata || '[]');
  } catch (_) {
    // clean up uploaded files
    for (const f of files) {
      try { fs.unlinkSync(f.path); } catch (_) {}
    }
    return res.status(400).json({ error: 'Invalid metadata JSON.' });
  }

  if (files.length === 0) {
    return res.status(400).json({ error: 'No images uploaded.' });
  }

  if (metadata.length !== files.length) {
    for (const f of files) {
      try { fs.unlinkSync(f.path); } catch (_) {}
    }
    return res.status(400).json({
      error: `metadata length (${metadata.length}) must match number of images (${files.length}).`
    });
  }

  const results = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const meta = metadata[i] || {};
    const { name, employee_code, department } = meta;

    if (!name || !employee_code) {
      try { fs.unlinkSync(file.path); } catch (_) {}
      results.push({ employee_code: employee_code || `row_${i+1}`, success: false, error: 'name and employee_code are required.' });
      continue;
    }

    // Normalize to uppercase for case-insensitive uniqueness
    const normalizedCode = employee_code.trim().toUpperCase();

    try {
      // Case-insensitive duplicate check
      const [dup] = await query('SELECT id FROM employees WHERE UPPER(employee_code) = ?', [normalizedCode]);
      if (dup.length) {
        try { fs.unlinkSync(file.path); } catch (_) {}
        results.push({ employee_code: normalizedCode, success: false, error: `Employee code '${normalizedCode}' already exists.` });
        continue;
      }

      const imagePath = 'uploads/faces/' + file.filename;

      const [result] = await query(
        `INSERT INTO employees (name, employee_code, department, image_path, face_embedding, face_enrolled)
         VALUES (?, ?, ?, ?, NULL, 0)`,
        [name.trim(), normalizedCode, (department || '').trim(), imagePath]
      );

      const [rows] = await query(
        `SELECT id, name, employee_code, department, image_path, face_enrolled FROM employees WHERE id = ?`,
        [result.insertId]
      );

      results.push({ employee_code: normalizedCode, success: true, employee: rows[0] });

      // Push to Python for embedding extraction (non-blocking)
      pushEmployeeToPython(rows[0], file.path);
    } catch (err) {
      try { fs.unlinkSync(file.path); } catch (_) {}
      results.push({ employee_code: normalizedCode, success: false, error: err.message });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  res.status(207).json({
    results,
    summary: { total: files.length, succeeded, failed: files.length - succeeded }
  });
});

// POST /api/employees/delete — device-facing soft-delete endpoint
// Python/Pi calls this to deactivate an employee from a specific device.
// Body (JSON): { employee_code, device_id }
// Marks employee status = 'inactive', removes device_sync_results for that device,
// emits Socket.IO 'employee_updated' so the UI reflects the change in real-time.
router.post('/delete', async (req, res) => {
  try {
    const { employee_code, device_id } = req.body;
    if (!employee_code) {
      return res.status(400).json({ success: false, error: 'employee_code is required.' });
    }

    // Case-insensitive lookup
    const [empRows] = await query(
      `SELECT id, name, employee_code, department, status, image_path, face_enrolled
       FROM employees WHERE UPPER(employee_code) = UPPER(?) LIMIT 1`,
      [employee_code]
    );
    if (!empRows.length) {
      return res.status(404).json({ success: false, error: `Employee "${employee_code}" not found.` });
    }
    const emp = empRows[0];

    // Resolve camera from device_id (matches cameras.location) or device_ip
    let cameraId = null;
    if (device_id) {
      const [camRows] = await query(
        `SELECT id FROM cameras WHERE location = ? OR device_ip = ? LIMIT 1`,
        [device_id, device_id]
      );
      if (camRows.length) cameraId = camRows[0].id;
    }

    // Soft-delete: mark inactive
    await query('UPDATE employees SET status = ? WHERE id = ?', ['inactive', emp.id]);

    // Remove device_sync_results for this device (or all if device not identified)
    if (cameraId) {
      await query(
        'DELETE FROM device_sync_results WHERE employee_id = ? AND camera_id = ?',
        [emp.id, cameraId]
      );
    } else {
      await query('DELETE FROM device_sync_results WHERE employee_id = ?', [emp.id]);
    }

    // Push real-time update to UI
    const io = getSocket();
    if (io) {
      io.emit('employee_updated', { ...emp, status: 'inactive' });
    }

    console.log(`[Employees] /delete: ${emp.name} (${emp.employee_code}) deactivated by device "${device_id || 'unknown'}"`);
    res.json({
      success: true,
      message: `Employee ${emp.name} deactivated${device_id ? ` from ${device_id}` : ''}.`,
    });
  } catch (err) {
    console.error('[Employees] POST /delete error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to deactivate employee.' });
  }
});

// POST /api/employees/register — Python registration endpoint
// Body (JSON): { employee_code, name, embedding: [...], image: "<base64>", device_id, device_ip }
// NOTE: department is intentionally NOT accepted here — device registrations do not set department.
router.post('/register', async (req, res) => {
  try {
    const { employee_code, name, embedding, image, device_id, device_ip } = req.body;

    // ... (validation trimmed)
    const embeddingJson = Array.isArray(embedding) && embedding.length > 0
      ? JSON.stringify(embedding)
      : null;
    const faceEnrolled = embeddingJson ? 1 : 0;

    // Save image from base64 if provided
    let imagePath = null;
    if (image) {
      try {
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'faces');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const filename  = `${employee_code}_${Date.now()}.jpg`;
        const filePath  = path.join(uploadsDir, filename);
        // If it starts with data:image/jpeg;base64, remove the prefix
        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        imagePath = `uploads/faces/${filename}`;
      } catch (imgErr) {
        console.warn('[Employees] Image save error:', imgErr.message);
      }
    }

    // Upsert: update if employee_code exists, insert if not
    const [existing] = await query(
      `SELECT id FROM employees WHERE employee_code = ? LIMIT 1`,
      [employee_code]
    );

    let employeeId;
    if (existing.length > 0) {
      employeeId = existing[0].id;
      const fields = ['name = ?', 'face_enrolled = ?', 'registered_via = ?'];
      const values = [name, faceEnrolled, 'device'];
      if (embeddingJson)  { fields.push('face_embedding = ?');        values.push(embeddingJson); }
      if (imagePath)      { fields.push('image_path = ?');            values.push(imagePath); }
      if (device_id)      { fields.push('registered_at_device = ?'); values.push(device_id); }
      if (device_ip)      { fields.push('registered_at_ip = ?');      values.push(device_ip); }
      values.push(employeeId);
      await query(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`, values);
      console.log(`[Employees] /register updated: ${name} (${employee_code}) from ${device_id || 'unknown'}`);
    } else {
      const [result] = await query(
        `INSERT INTO employees (employee_code, name, image_path, face_embedding, face_enrolled, registered_via, registered_at_device, registered_at_ip)
         VALUES (?, ?, ?, ?, ?, 'device', ?, ?)`,
        [employee_code, name, imagePath, embeddingJson, faceEnrolled, device_id || null, device_ip || null]
      );
      employeeId = result.insertId;
      console.log(`[Employees] /register created: ${name} (${employee_code}) id=${employeeId}`);
    }

    const [rows] = await query(
      `SELECT id, name, name_hindi, employee_code, department, image_path, face_enrolled, created_at
       FROM employees WHERE id = ?`,
      [employeeId]
    );

    res.status(existing.length > 0 ? 200 : 201).json({
      success: true,
      action:  existing.length > 0 ? 'updated' : 'created',
      employee: rows[0],
    });

    // Notify frontend via websocket
    const io = getSocket();
    if (io) {
      io.emit('employee_updated', rows[0]);
    }

  } catch (err) {
    console.error('[Employees] POST /register error:', err.message);
    res.status(500).json({ success: false, error: 'Registration failed: ' + err.message });
  }
});

module.exports = router;
