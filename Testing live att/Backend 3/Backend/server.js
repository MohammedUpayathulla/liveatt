'use strict';

// ─── Central config (loads .env internally) ───────────────────────────────────
const cfg = require('./config/index');

const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');


const { initSocket } = require('./config/socket');
const { initDB }     = require('./config/db');


// ─── Auth ─────────────────────────────────────────────────────────────────────
const authRouter       = require('./routes/auth');
const authMiddleware   = require('./middleware/authMiddleware');

// ─── Route modules ────────────────────────────────────────────────────────────
const employeesRouter              = require('./routes/employees');
const { router: camerasRouter,
        pingDevice }               = require('./routes/cameras');
const attendanceRouter             = require('./routes/attendance');
const dashboardRouter              = require('./routes/dashboard');
const settingsRouter               = require('./routes/settings');
const { router: syncRouter }       = require('./routes/sync');
const unknownFacesRouter           = require('./routes/unknownFaces');
const adminRouter                  = require('./routes/admin');
const streamingRouter              = require('./routes/streaming');

// ─── Ensure upload directories exist ─────────────────────────────────────────
const uploadsBase      = path.join(__dirname, 'uploads');
const uploadsFaces     = path.join(uploadsBase, 'faces');
const uploadsSnapshots = path.join(uploadsBase, 'snapshots');

[uploadsBase, uploadsFaces, uploadsSnapshots].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[Server] Created directory: ${dir}`);
  }
});

// ─── Express app ─────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = initSocket(server);

app.set('io', io);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(uploadsBase));

// HLS streams from FFmpeg — served with no caching for live updates
const hlsBase = path.join(__dirname, '..', '..', 'hls_stream');
app.use('/hls', express.static(hlsBase));

// Disable caching for all API responses — always return fresh data
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ─── Routes (no auth required) ────────────────────────────────────────────────
app.use('/api/auth',       authRouter);
app.use('/api/streaming',  streamingRouter);
app.use('/api/cameras',    camerasRouter);

// ─── Auth middleware (all /api routes except exemptions) ─────────────────────
app.use('/api', authMiddleware);

// ─── Routes (auth required) ───────────────────────────────────────────────────
app.use('/api/employees',  employeesRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/dashboard',  dashboardRouter);
app.use('/api/settings',   settingsRouter);
app.use('/api/sync',          syncRouter);
app.use('/api/unknown-faces', unknownFacesRouter);
app.use('/api/admin',         adminRouter);

// ─── WebRTC WHEP Proxy (RFC 8830) ───────────────────────────────────────────
const axios = require('axios');
const { query: dbQuery } = require('./config/db');

app.post('/api/webrtc/offer/:cameraId', async (req, res) => {
  try {
    const { cameraId } = req.params;
    const { sdp, type } = req.body;

    if (!sdp || type !== 'offer') {
      return res.status(400).json({ error: 'Invalid SDP offer' });
    }

    const [cameras] = await dbQuery(
      'SELECT id, name, status FROM cameras WHERE id = ?',
      [cameraId]
    );
    if (!cameras.length) {
      return res.status(404).json({ error: 'Camera not found' });
    }
    if (cameras[0].status !== 'active') {
      return res.status(503).json({ error: 'Camera is inactive' });
    }

    const padded = String(cameraId).padStart(2, '0');
    const mediamtxUrl = process.env.MEDIAMTX_URL || 'http://172.16.1.155:8889';
    const whepUrl = `${mediamtxUrl}/cam_${padded}/whep`;

    console.log(`[WebRTC] SDP offer for cam ${cameraId} → ${whepUrl}`);

    const mediamtxRes = await axios.post(whepUrl, sdp, {
      headers: { 'Content-Type': 'application/sdp' },
      timeout: 10000,
      validateStatus: () => true,
    });

    console.log(`[WebRTC] mediaMTX response status: ${mediamtxRes.status}`);
    console.log(`[WebRTC] mediaMTX response headers:`, mediamtxRes.headers);
    console.log(`[WebRTC] mediaMTX response body (first 200 chars):`, mediamtxRes.data?.substring(0, 200));

    if (mediamtxRes.status < 200 || mediamtxRes.status >= 300) {
      console.error(`[WebRTC] mediaMTX error: ${mediamtxRes.status}`, mediamtxRes.data);
      return res.status(502).json({ error: 'Failed to connect to camera stream', detail: mediamtxRes.data });
    }

    const answerSdp = mediamtxRes.data;
    if (!answerSdp || typeof answerSdp !== 'string' || !answerSdp.includes('v=0')) {
      console.error('[WebRTC] Invalid SDP response from mediaMTX:', answerSdp);
      return res.status(502).json({ error: 'Invalid SDP response from mediaMTX' });
    }

    res.json({
      sdp: answerSdp,
      type: 'answer',
      session_url: mediamtxRes.headers.location || mediamtxRes.headers['content-location'],
    });
  } catch (err) {
    console.error('[WebRTC] offer error:', err.message);
    res.status(502).json({ error: 'WebRTC connection failed', details: err.message });
  }
});

app.get('/api/webrtc/info/:cameraId', async (req, res) => {
  try {
    const { cameraId } = req.params;
    const [cameras] = await dbQuery('SELECT id, name, status FROM cameras WHERE id = ?', [cameraId]);

    if (!cameras.length) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    res.json({
      camera_id: cameraId,
      camera_name: cameras[0].name,
      codec: 'H.264',
      mediamtx_status: cameras[0].status,
    });
  } catch (err) {
    console.error('[WebRTC] info error:', err.message);
    res.status(500).json({ error: 'Failed to fetch camera info' });
  }
});

// ─── MJPEG Stream Proxy ────────────────────────────────────────────────────────
app.get('/api/cameras/:cameraId/stream', async (req, res) => {
  try {
    const { cameraId } = req.params;
    const [cameras] = await dbQuery('SELECT id, name, status FROM cameras WHERE id = ?', [cameraId]);

    if (!cameras.length) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    const padded = String(cameraId).padStart(2, '0');
    const mediamtxUrl = process.env.MEDIAMTX_URL || 'http://172.16.1.155:8889';
    const mjpegUrl = mediamtxUrl.replace(':8889', ':8888') + `/cam_${padded}/index.m3u8/request.jpg`;

    console.log(`[MJPEG] Proxying stream for camera ${cameraId} from ${mjpegUrl}`);

    const response = await axios.get(mjpegUrl, {
      responseType: 'arraybuffer',
      timeout: 5000,
    });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(response.data);
  } catch (err) {
    console.error('[MJPEG] Stream error:', err.message);
    res.status(503).json({ error: 'Stream unavailable', details: err.message });
  }
});

// Health-check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error.' });
});

// ─── Socket.IO – web clients ──────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on('join_web', async () => {
    socket.join('web_clients');
    console.log(`[Socket] Web client joined 'web_clients': ${socket.id}`);

    const { query } = require('./config/db');
    try {
      const [cameras] = await query(
        `SELECT id, name, rtsp_url, location, device_ip, online_status, camera_type, threshold, status,
                roi_x, roi_y, roi_width, roi_height, created_at
         FROM cameras ORDER BY name ASC`
      );
      socket.emit('cameras_list', { cameras });
    } catch (err) {
      console.error('[Socket] Failed to fetch cameras:', err.message);
      socket.emit('cameras_list', { cameras: [] });
    }

    // Send today's attendance logs so the UI never misses events during reconnects
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [logs] = await query(
        `SELECT al.id, al.employee_id, al.punch_type, al.timestamp, al.confidence,
                e.name AS employee_name, e.employee_code, e.image_path AS employee_image,
                c.name AS camera_name, c.location AS camera_location
         FROM attendance_logs al
         LEFT JOIN employees e ON e.id = al.employee_id
         LEFT JOIN cameras   c ON c.id = al.camera_id
         WHERE al.timestamp BETWEEN ? AND ?
         ORDER BY al.timestamp DESC
         LIMIT 50`,
        [`${today} 00:00:00`, `${today} 23:59:59`]
      );
      socket.emit('attendance_today', { logs });
    } catch (err) {
      console.error('[Socket] Failed to fetch today logs:', err.message);
    }

    socket.emit('python_status', { connected: false });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Client disconnected: ${socket.id} (${reason})`);
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = cfg.PORT;

async function startServer() {
  try {
    await initDB();

    server.listen(PORT, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════════════════╗');
      console.log('║       Live Attendance Backend  •  Node.js            ║');
      console.log('╠══════════════════════════════════════════════════════╣');
      console.log(`║  HTTP  listening on  http://localhost:${PORT}           ║`);
      console.log(`║  WS    listening on  ws://localhost:${PORT}             ║`);
      console.log('╚══════════════════════════════════════════════════════╝');
      console.log('');
    });
  } catch (err) {
    console.error('[Server] Startup failed:', err.message);
    process.exit(1);
  }
}

// ─── Periodic device health monitoring – WATCHDOG ─────────────────────────────
// Devices report via POST /api/cameras/health-update (heartbeat).
// If a device doesn't check in for 40 seconds, we mark it offline.
async function runHealthWatchdog() {
  const { query } = require('./config/db');
  try {
    // Find devices that were 'online' but haven't checked in for > 40 seconds
    const [expired] = await query(
      `SELECT id, name FROM cameras 
       WHERE online_status = 'online' 
       AND last_heartbeat < (NOW() - INTERVAL 40 SECOND)`
    );

    if (expired.length > 0) {
      for (const cam of expired) {
        console.log(`[Watchdog] Device ${cam.name} (id: ${cam.id}) timed out. Marking OFFLINE.`);
        await query(`UPDATE cameras SET online_status = 'offline' WHERE id = ?`, [cam.id]);
        io.emit('device_health_update', { camera_id: cam.id, online_status: 'offline' });
      }
    }
  } catch (err) {
    console.error('[Watchdog] Error:', err.message);
  }
}

startServer();

// Start Watchdog — delays and intervals from central config
setTimeout(() => {
  setInterval(runHealthWatchdog, cfg.WATCHDOG.intervalMs);
}, cfg.WATCHDOG.startDelayMs);

module.exports = { app, server, io };
