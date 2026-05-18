'use strict';

const express   = require('express');
const { spawn } = require('child_process');
const axios     = require('axios');
const net       = require('net');
const router    = express.Router();
const { query } = require('../config/db');

const cfg = require('../config/index');

// Lazy-load triggerAutoRetry to avoid circular dependency
function getAutoRetry() {
  return require('./sync').triggerAutoRetry;
}
const getPythonUrl = () => cfg.PYTHON.fallbackUrl;

// GET /api/cameras - list all cameras with enrolled employee count
router.get('/', async (_req, res) => {
  try {
    const [rows] = await query(
      `SELECT c.id, c.name, c.rtsp_url, c.hls_url, c.location, c.device_ip, c.online_status,
              c.camera_type, c.threshold, c.status, c.roi_x, c.roi_y, c.roi_width, c.roi_height, c.created_at,
              COUNT(DISTINCT dsr.employee_id) AS enrolled_count
       FROM cameras c
       LEFT JOIN device_sync_results dsr ON dsr.camera_id = c.id AND dsr.status = 'success'
       GROUP BY c.id
       ORDER BY c.name ASC`
    );

    // Compute WebRTC WHEP URL from camera ID (no DB lookup needed)
    const mediamtxUrl = process.env.MEDIAMTX_URL || 'http://172.16.1.155:8889';
    rows.forEach(cam => {
      const padded = String(cam.id).padStart(2, '0');
      cam.whep_url = `${mediamtxUrl}/cam_${padded}/whep`;
    });

    res.json({ cameras: rows });
  } catch (err) {
    console.error('[Cameras] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch cameras.' });
  }
});

// ── Device health check helper ────────────────────────────────────────────────
function pingDevice(ip, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port: 5001, timeout });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

// GET /api/cameras/health — ping all devices and update online_status (Legacy TCP Pinger)
router.get('/health', async (_req, res) => {
  try {
    const [cameras] = await query(
      `SELECT id, name, device_ip FROM cameras WHERE device_ip IS NOT NULL AND device_ip != ''`
    );

    const results = await Promise.all(
      cameras.map(async (cam) => {
        const online = await pingDevice(cam.device_ip);
        const status = online ? 'online' : 'offline';
        await query(`UPDATE cameras SET online_status = ? WHERE id = ?`, [status, cam.id]);
        return { id: cam.id, name: cam.name, device_ip: cam.device_ip, online_status: status };
      })
    );

    res.json({ results });
  } catch (err) {
    console.error('[Cameras] Health check error:', err.message);
    res.status(500).json({ error: 'Health check failed.' });
  }
});

// POST /api/cameras/health-update - Python devices report their heartbeat here
router.post('/health-update', async (req, res) => {
  try {
    // — Com Key Authentication —
    const incomingKey = req.headers['x-com-key'];
    const expectedKey = cfg.COM_KEY;
    if (!incomingKey || incomingKey !== expectedKey) {
      console.warn('[Cameras] Unauthorized health-update attempt from:', req.ip);
      return res.status(401).json({ error: 'Unauthorized: Invalid communication key.' });
    }

    const { device_id, device_ip, status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status is required' });

    console.log('─────────────────────────────────────────');
    console.log('[Health Update] Received from Pi');
    console.log(`  device_id  : ${device_id || '(not provided)'}`);
    console.log(`  device_ip  : ${device_ip || '(not provided)'}`);
    console.log(`  status     : ${status}`);
    console.log(`  time       : ${new Date().toLocaleString()}`);
    console.log('─────────────────────────────────────────');

    // Update by ID or IP
    let updateQuery;
    let params;
    let fetchQuery;
    let fetchParams;
    
    // Build SET clause — always update status + heartbeat; also sync device_ip if Pi reported one
    const ipSet    = device_ip ? ', device_ip = ?' : '';

    if (device_id) {
      // If device_id contains letters (like "Device_001"), do not query INT id column
      const isNumeric = !isNaN(device_id) && !isNaN(parseFloat(device_id));

      if (isNumeric) {
        updateQuery  = `UPDATE cameras SET online_status = ?, last_heartbeat = NOW()${ipSet} WHERE (location = ? OR name = ? OR id = ?) AND status = 'active'`;
        params       = device_ip ? [status, device_ip, device_id, device_id, device_id] : [status, device_id, device_id, device_id];
        fetchQuery   = `SELECT id, name, device_ip FROM cameras WHERE (location = ? OR name = ? OR id = ?) AND status = 'active'`;
        fetchParams  = [device_id, device_id, device_id];
      } else {
        updateQuery  = `UPDATE cameras SET online_status = ?, last_heartbeat = NOW()${ipSet} WHERE (location = ? OR name = ?) AND status = 'active'`;
        params       = device_ip ? [status, device_ip, device_id, device_id] : [status, device_id, device_id];
        fetchQuery   = `SELECT id, name, device_ip FROM cameras WHERE (location = ? OR name = ?) AND status = 'active'`;
        fetchParams  = [device_id, device_id];
      }
    } else if (device_ip) {
      updateQuery  = `UPDATE cameras SET online_status = ?, last_heartbeat = NOW(), device_ip = ? WHERE device_ip = ? AND status = 'active'`;
      params       = [status, device_ip, device_ip];
      fetchQuery   = `SELECT id, name, device_ip FROM cameras WHERE device_ip = ? AND status = 'active'`;
      fetchParams  = [device_ip];
    } else {
      return res.status(400).json({ error: 'device_id or device_ip required' });
    }

    let [result] = await query(updateQuery, params);

    // Fallback: if device_id-based match found nothing but we have an IP, try matching by IP alone.
    // This handles the case where a camera was deleted and re-added with a different location value.
    if (result.affectedRows === 0 && device_ip && device_id) {
      const ipQuery  = `UPDATE cameras SET online_status = ?, last_heartbeat = NOW(), device_ip = ? WHERE device_ip = ? AND status = 'active'`;
      const ipParams = [status, device_ip, device_ip];
      [result] = await query(ipQuery, ipParams);
      if (result.affectedRows > 0) {
        fetchQuery  = `SELECT id, name, device_ip FROM cameras WHERE device_ip = ? AND status = 'active'`;
        fetchParams = [device_ip];
        console.log(`[Health Update] ✓ DB updated via IP fallback — device_ip=${device_ip} status=${status}`);
      }
    }

    // Always mark ALL cameras at the same device_ip with the same status.
    // A single Pi hosts multiple RTSP streams; one heartbeat should bring all online.
    if (device_ip) {
      await query(
        `UPDATE cameras SET online_status = ?, last_heartbeat = NOW() WHERE device_ip = ? AND status = 'active'`,
        [status, device_ip]
      );
      fetchQuery  = `SELECT id, name, device_ip FROM cameras WHERE device_ip = ? AND status = 'active'`;
      fetchParams = [device_ip];
    }

    if (result.affectedRows > 0) {
      console.log(`[Health Update] ✓ DB updated — device_ip=${device_ip || device_id} status=${status}`);
    } else {
      console.warn(`[Health Update] ✗ No camera found in DB for device_ip=${device_ip} device_id=${device_id}`);
    }

    // Inform active clients via websocket
    if (req.app.get('io')) {
      const io = req.app.get('io');
      const [cams] = await query(fetchQuery, fetchParams);
      cams.forEach(cam => {
        io.emit('device_health_update', {
          camera_id:     cam.id,
          online_status: status,
          device_ip:     cam.device_ip,
        });
      });

      if (status === 'online' && cams.length > 0) {
        const triggerAutoRetry = getAutoRetry();
        cams.forEach(cam => {
          triggerAutoRetry(cam.id, cam.name || device_id || device_ip, io).catch(() => {});
        });
      }
    }

    res.json({ success: true, message: 'Health updated' });
  } catch (err) {
    console.error('[Cameras] Health update error:', err.message);
    res.status(500).json({ error: 'Health update failed.' });
  }
});

// POST /api/cameras/bbox-frame - Python sends bounding box coordinates for canvas overlay
// This is a lightweight, real-time endpoint that relays face detection boxes to web clients
router.post('/bbox-frame', (req, res) => {
  try {
    const { stream, frame_w, frame_h, faces } = req.body;
    if (!stream || !frame_w || !frame_h || !Array.isArray(faces)) {
      return res.status(400).json({ error: 'Missing required fields: stream, frame_w, frame_h, faces' });
    }

    // Relay detection data to all connected web clients via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to('web_clients').emit('detection_frame', {
        stream,
        frame_w,
        frame_h,
        faces,
        ts: Date.now()
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Cameras] bbox-frame error:', err.message);
    res.status(500).json({ error: 'bbox-frame processing failed.' });
  }
});

// GET /api/cameras/:id - get single camera
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT id, name, rtsp_url, hls_url, location, device_ip, online_status, camera_type, threshold, status, roi_x, roi_y, roi_width, roi_height, created_at
       FROM cameras WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Camera not found.' });
    }
    res.json({ camera: rows[0] });
  } catch (err) {
    console.error('[Cameras] GET /:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch camera.' });
  }
});

// POST /api/cameras - add new camera
router.post('/', async (req, res) => {
  try {
    const { name, rtsp_url, hls_url, location, device_ip, camera_type, threshold, status } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required.' });
    }

    const validTypes = ['in', 'out', 'both'];
    const type = validTypes.includes(camera_type) ? camera_type : 'in';
    const thresholdVal = (threshold !== undefined && threshold !== null && threshold !== '')
      ? parseFloat(threshold) : null;
    const statusVal = status === 'active' ? 'active' : 'inactive';
    const deviceIpVal = (device_ip && device_ip.trim()) ? device_ip.trim() : null;
    const hlsUrlVal = (hls_url && hls_url.trim()) ? hls_url.trim() : null;

    const [result] = await query(
      `INSERT INTO cameras (name, rtsp_url, hls_url, location, device_ip, camera_type, threshold, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, rtsp_url, hlsUrlVal, location || null, deviceIpVal, type, thresholdVal, statusVal]
    );

    const [rows] = await query(
      `SELECT id, name, rtsp_url, hls_url, location, device_ip, online_status, camera_type, threshold, status, roi_x, roi_y, roi_width, roi_height, created_at
       FROM cameras WHERE id = ?`,
      [result.insertId]
    );

    const camera = rows[0];
    res.status(201).json({ camera });

    // Notify all clients so they refresh their camera lists immediately
    const io = req.app.get('io');
    if (io) io.emit('cameras_updated', { action: 'created', camera });

    // Push full stream list for this device so config.yaml matches MySQL exactly
    if (camera.device_ip && camera.status === 'active') {
      syncStreamsForDevice(camera.device_ip).catch(() => {});
    }
  } catch (err) {
    console.error('[Cameras] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to add camera.' });
  }
});

// PUT /api/cameras/:id - update camera settings
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, rtsp_url, hls_url, location, device_ip, camera_type, threshold, status } = req.body;

    const [existing] = await query(
      'SELECT id, name, device_ip FROM cameras WHERE id = ?', [id]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Camera not found.' });
    }
    const oldName     = existing[0].name;
    const oldDeviceIp = existing[0].device_ip;

    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (rtsp_url !== undefined) { fields.push('rtsp_url = ?'); values.push(rtsp_url); }
    if (hls_url !== undefined) {
      fields.push('hls_url = ?');
      values.push((hls_url && hls_url.trim()) ? hls_url.trim() : null);
    }
    if (location !== undefined) { fields.push('location = ?'); values.push(location); }
    if (device_ip !== undefined) {
      fields.push('device_ip = ?');
      values.push((device_ip && device_ip.trim()) ? device_ip.trim() : null);
    }
    if (status !== undefined) {
      fields.push('status = ?');
      values.push(status);
      // When disabling, immediately mark as offline so it doesn't show Online
      if (status === 'inactive') {
        fields.push('online_status = ?');
        values.push('offline');
      }
    }
    if (camera_type !== undefined) {
      const validTypes = ['in', 'out', 'both'];
      fields.push('camera_type = ?');
      values.push(validTypes.includes(camera_type) ? camera_type : 'in');
    }
    if (threshold !== undefined) {
      // null or '' means "use global threshold" (remove override)
      const tval = (threshold !== null && threshold !== '') ? parseFloat(threshold) : null;
      fields.push('threshold = ?');
      values.push(isNaN(tval) ? null : tval);
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(id);
    await query(`UPDATE cameras SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await query(
      `SELECT id, name, rtsp_url, hls_url, location, device_ip, online_status, camera_type, threshold, status, roi_x, roi_y, roi_width, roi_height, created_at
       FROM cameras WHERE id = ?`,
      [id]
    );

    const camera = rows[0];

    // Notify all clients so they refresh their camera lists immediately
    const io = req.app.get('io');
    if (io) io.emit('cameras_updated', { action: 'updated', camera });

    // When disabling, push enable_device=false to Pi so it stops recognition immediately
    if (status === 'inactive' && camera.device_ip) {
      const pythonUrl = cfg.PYTHON.urlFor(camera.device_ip);
      pushConfigWithRetry(pythonUrl, {
        device_id:     camera.location,
        device_ip:     camera.device_ip,
        device_name:   camera.name,
        mode:          camera.camera_type || 'in',
        rtsp_url:      camera.rtsp_url || '',
        threshold:     camera.threshold,
        enable_device: false,
      }, 1, 0).catch(() => {});
      // Also notify frontend immediately
      const io = req.app.get('io');
      if (io) io.emit('device_health_update', { camera_id: camera.id, online_status: 'offline' });
    }

    // When re-enabling, immediately ping the Pi to get live online_status
    if (status === 'active' && camera.device_ip) {
      const pythonUrl = cfg.PYTHON.urlFor(camera.device_ip);
      checkPythonHealth(pythonUrl).then(async (alive) => {
        const onlineStatus = alive ? 'online' : 'offline';
        await query('UPDATE cameras SET online_status = ? WHERE id = ?', [onlineStatus, id]);
        console.log(`[Cameras] Re-enable ping ${camera.device_ip} → ${onlineStatus}`);
        // Notify frontend via socket
        const io = req.app.get('io');
        if (io) io.emit('device_health_update', { camera_id: camera.id, online_status: onlineStatus });
      }).catch(() => {});
    }

    res.json({ camera });

    // Always do a full sync after any change — replaces entire streams dict on the Pi
    // so config.yaml always exactly matches MySQL (no stale entries ever).
    const targetIp = camera.device_ip || oldDeviceIp;
    if (targetIp) {
      // If device_ip changed, also sync the old Pi to remove this camera from it
      if (device_ip !== undefined && oldDeviceIp && oldDeviceIp !== camera.device_ip) {
        syncStreamsForDevice(oldDeviceIp).catch(() => {});
      }
      syncStreamsForDevice(targetIp).catch(() => {});
    }

    // When disabling, also mark offline in UI immediately
    if (status === 'inactive') {
      const io = req.app.get('io');
      if (io) io.emit('device_health_update', { camera_id: camera.id, online_status: 'offline' });
    }
    // When re-enabling, ping to get live status
    if (status === 'active' && camera.device_ip) {
      checkPythonHealth(cfg.PYTHON.urlFor(camera.device_ip)).then(async (alive) => {
        const onlineStatus = alive ? 'online' : 'offline';
        await query('UPDATE cameras SET online_status = ? WHERE id = ?', [onlineStatus, id]);
        const io = req.app.get('io');
        if (io) io.emit('device_health_update', { camera_id: camera.id, online_status: onlineStatus });
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[Cameras] PUT /:id error:', err.message);
    res.status(500).json({ error: 'Failed to update camera.' });
  }
});

// POST /api/cameras/:id/push-roi — save ROI to MySQL + push directly to Python /set-roi
router.post('/:id/push-roi', async (req, res) => {
  const { id } = req.params;
  const { x, y, width, height, clear } = req.body;

  try {
    const [rows] = await query(
      'SELECT name, device_ip FROM cameras WHERE id = ?', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Camera not found.' });
    const { name: camName, device_ip } = rows[0];

    if (clear) {
      // Clear ROI in MySQL
      await query(
        'UPDATE cameras SET roi_x=NULL, roi_y=NULL, roi_width=NULL, roi_height=NULL WHERE id=?', [id]
      );
      // Push clear to Python
      if (device_ip) {
        const pythonUrl = cfg.PYTHON.urlFor(device_ip);
        axios.post(`${pythonUrl}/set-roi`, { stream_name: camName, roi: null }, { timeout: 5000 }).catch(() => {});
      }
      return res.json({ success: true, roi: null });
    }

    if (x == null || y == null || width == null || height == null) {
      return res.status(400).json({ error: 'x, y, width, height required' });
    }

    // Save to MySQL
    await query(
      'UPDATE cameras SET roi_x=?, roi_y=?, roi_width=?, roi_height=? WHERE id=?',
      [x, y, width, height, id]
    );

    // Push directly to Python as [x1,y1,x2,y2]
    if (device_ip) {
      const pythonUrl = cfg.PYTHON.urlFor(device_ip);
      const roi = [x, y, x + width, y + height];
      axios.post(`${pythonUrl}/set-roi`, { stream_name: camName, roi }, { timeout: 5000 }).catch(() => {});
    }

    res.json({ success: true, roi: { x, y, width, height } });
  } catch (err) {
    console.error('[Cameras] push-roi error:', err.message);
    res.status(500).json({ error: 'Failed to update ROI.' });
  }
});

// PUT /api/cameras/:id/roi - update ROI
router.put('/:id/roi', async (req, res) => {
  try {
    const { id } = req.params;
    const { x, y, width, height } = req.body;

    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      return res.status(400).json({ error: 'x, y, width, and height are required.' });
    }

    const [existing] = await query('SELECT id FROM cameras WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    await query(
      `UPDATE cameras SET roi_x = ?, roi_y = ?, roi_width = ?, roi_height = ? WHERE id = ?`,
      [x, y, width, height, id]
    );

    const [rows] = await query(
      `SELECT id, name, rtsp_url, location, device_ip, online_status, camera_type, threshold, status, roi_x, roi_y, roi_width, roi_height, created_at
       FROM cameras WHERE id = ?`,
      [id]
    );

    const camera = rows[0];
    res.json({ camera, message: 'ROI updated successfully.' });

    if (camera.device_ip) {
      syncStreamsForDevice(camera.device_ip).catch(() => {});
    }
  } catch (err) {
    console.error('[Cameras] PUT /:id/roi error:', err.message);
    res.status(500).json({ error: 'Failed to update ROI.' });
  }
});

// DELETE /api/cameras/:id - delete camera
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await query(
      'SELECT id, name, location, device_ip FROM cameras WHERE id = ?',
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Camera not found.' });
    }

    const { name, location: device_id, device_ip } = existing[0];

    await query('DELETE FROM cameras WHERE id = ?', [id]);

    res.json({ message: 'Camera deleted successfully.' });

    // Notify all clients so they refresh their camera lists immediately
    const io = req.app.get('io');
    if (io) io.emit('cameras_updated', { action: 'deleted', camera_id: id });

    // Push the remaining streams for this Pi — config.yaml will no longer contain
    // the deleted camera. syncStreamsForDevice queries AFTER deletion so the result
    // is exactly the remaining active cameras.
    if (device_ip) {
      syncStreamsForDevice(device_ip).catch(() => {});
    }
  } catch (err) {
    console.error('[Cameras] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete camera.' });
  }
});


// GET /api/cameras/:id/snapshot - single JPEG frame
router.get('/:id/snapshot', async (req, res) => {
  let camera;
  try {
    const [rows] = await query(
      'SELECT id, name, rtsp_url FROM cameras WHERE id = ?',
      [req.params.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Camera not found.' });
    }
    camera = rows[0];
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch camera.' });
  }

  const ffmpegArgs = [
    '-rtsp_transport', 'udp',
    '-buffer_size', '1024000',
    '-i', camera.rtsp_url,
    '-vframes', '1',
    '-f', 'image2',
    '-vcodec', 'mjpeg',
    'pipe:1'
  ];

  let ffmpeg;
  try {
    ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (spawnErr) {
    return res.status(500).json({ error: 'Failed to capture snapshot. Is FFmpeg installed?' });
  }

  const chunks = [];

  ffmpeg.stdout.on('data', (chunk) => {
    chunks.push(chunk);
  });

  ffmpeg.on('close', () => {
    if (chunks.length > 0) {
      const frame = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', frame.length);
      res.send(frame);
    } else {
      if (!res.headersSent) {
        res.status(502).json({ error: 'No snapshot data received from camera.' });
      }
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('[Cameras] Snapshot FFmpeg error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Snapshot capture failed: ' + err.message });
    }
  });

  // Timeout after 10 seconds
  setTimeout(() => {
    try { ffmpeg.kill('SIGKILL'); } catch (_) {}
    if (!res.headersSent) {
      res.status(504).json({ error: 'Snapshot timed out.' });
    }
  }, 10000);
});

// GET /api/cameras/:id/stream — REMOVED (video streaming now via MediaMTX HLS)
// Frontend connects directly to HLS URL from hls_url column in cameras table

// ── Full stream sync ──────────────────────────────────────────────────────────
// After ANY camera add/update/delete, query all active cameras for that device_ip
// and push the complete streams dict to the Pi.  This is the authoritative source
// of truth — config.yaml will always exactly match what's in MySQL.
async function syncStreamsForDevice(device_ip) {
  if (!device_ip) return;

  const [cams] = await query(
    `SELECT name, rtsp_url, camera_type, threshold,
            roi_x, roi_y, roi_width, roi_height
     FROM cameras
     WHERE device_ip = ? AND status = 'active' AND rtsp_url IS NOT NULL AND rtsp_url != ''`,
    [device_ip]
  );

  const streams = {};
  let hasBoth = false;

  for (const cam of cams) {
    const entry = {
      rtsp_url:  cam.rtsp_url,
      mode:      cam.camera_type || 'in',
      threshold: cam.threshold   || 0.5,
    };
    // Include ROI only if all four values are set
    if (cam.roi_x != null && cam.roi_y != null && cam.roi_width != null && cam.roi_height != null) {
      entry.roi = [cam.roi_x, cam.roi_y, cam.roi_x + cam.roi_width, cam.roi_y + cam.roi_height];
    }
    streams[cam.name] = entry;
    if (cam.camera_type === 'both') hasBoth = true;
  }

  const cooldown = hasBoth ? 60 : 300;
  const pythonUrl = cfg.PYTHON.urlFor(device_ip);

  try {
    await axios.post(
      `${pythonUrl}/sync-streams`,
      { streams, punch_cooldown_seconds: cooldown },
      { headers: { 'Content-Type': 'application/json' }, timeout: cfg.TIMEOUTS.pythonDefault }
    );
    console.log(`[Cameras] sync-streams → ${device_ip} streams=[${Object.keys(streams).join(', ')}]`);
  } catch (err) {
    console.warn(`[Cameras] sync-streams failed @ ${device_ip}: ${err.message}`);
  }
}

// ── Helper: health check Python before pushing config ─────────────────────────
async function checkPythonHealth(pythonUrl) {
  const healthUrl = `${pythonUrl}/health`;
  try {
    await axios.get(healthUrl, { timeout: 3000 });
    console.log(`[Cameras] Health check passed — ${healthUrl}`);
    return true;
  } catch (err) {
    const reason = err.code === 'ECONNABORTED' ? 'timeout' : (err.code || err.message);
    console.error(`[Cameras] Health check failed — ${healthUrl} — ${reason}`);
    return false;
  }
}

// ── Helper: push config with retry (up to 3 attempts) ────────────────────────
async function pushConfigWithRetry(pythonUrl, payload, retries = 3, delayMs = 4000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Cameras] push-config attempt ${attempt}/${retries} → ${pythonUrl}/device-config`);
      const pyRes = await axios.post(
        `${pythonUrl}/device-config`,
        payload,
        { headers: { 'Content-Type': 'application/json' }, timeout: cfg.TIMEOUTS.pythonDefault }
      );
      console.log(`[Cameras] Python responded (attempt ${attempt}): ${pyRes.status}`, JSON.stringify(pyRes.data));
      return pyRes.data;
    } catch (err) {
      const reason = err.code === 'ECONNABORTED' ? 'timeout' : (err.code || err.message);
      console.warn(`[Cameras] push-config attempt ${attempt} failed — ${pythonUrl}/device-config — ${reason}`);
      if (attempt < retries) {
        console.log(`[Cameras] Retrying in ${delayMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
}

// POST /api/cameras/push-config — send device config to Python service
// Body: { device_id, device_ip, device_name, rtsp_url, mode, threshold, enable_device }
router.post('/push-config', async (req, res) => {
  const { device_id, device_ip, device_name, rtsp_url, mode, threshold, enable_device } = req.body;

  if (!device_id || !device_name) {
    return res.status(400).json({ success: false, error: 'device_id and device_name are required.' });
  }

  const validModes = ['in', 'out', 'both'];
  const payload = {
    device_id:     device_id.trim(),
    device_ip:     device_ip ? device_ip.trim() : null,
    device_name:   device_name.trim(),
    mode:          validModes.includes(mode) ? mode : 'in',
    rtsp_url:      (rtsp_url || '').trim(),
    threshold:     threshold != null ? parseFloat(threshold) : null,
    enable_device: enable_device !== false,
  };

  const pythonUrl = cfg.PYTHON.urlFor(payload.device_ip);

  console.log('─────────────────────────────────────────');
  console.log('[Cameras] push-config request');
  console.log(`  Target URL : ${pythonUrl}/device-config`);
  console.log(`  Device IP  : ${payload.device_ip}`);
  console.log(`  Port       : ${cfg.PYTHON.port}`);
  console.log('─────────────────────────────────────────');

  // ── Step 1: Health check ──────────────────────────────────────────────────
  const isAlive = await checkPythonHealth(pythonUrl);
  if (!isAlive) {
    return res.status(502).json({
      success: false,
      error: `Python service is not reachable at ${pythonUrl}. Please ensure the service is running and accessible on the network.`,
    });
  }

  // ── Step 2: Push config with retry ───────────────────────────────────────
  try {
    const pyData = await pushConfigWithRetry(pythonUrl, payload);
    return res.json({ success: true, python_response: pyData });
  } catch (err) {
    const reason  = err.code === 'ECONNABORTED' ? 'timeout' : (err.response?.data?.error || err.message);
    const status  = err.response?.status || 'no response';
    console.error(`[Cameras] push-config failed after all retries — status=${status} reason=${reason}`);
    return res.status(502).json({ success: false, error: `Python push failed at ${pythonUrl}: ${reason}` });
  }
});

module.exports = { router, pingDevice };

