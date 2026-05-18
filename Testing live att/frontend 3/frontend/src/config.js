/**
 * Central configuration for the Live Attendance frontend.
 * All ports, URLs, timeouts, and socket settings live here.
 * Change VITE_ env vars in .env (or here as defaults) — reflected everywhere.
 *
 * Vite exposes only variables prefixed with VITE_ to the browser bundle.
 */

const _host = import.meta.env.VITE_BACKEND_HOST || 'localhost';
const _port = parseInt(import.meta.env.VITE_BACKEND_PORT, 10) || 5005;

const cfg = {
  // ── Backend API ───────────────────────────────────────────────────────────
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || '/api',

  // ── Direct backend URL — used for streaming to bypass Vite proxy buffering
  STREAM_BASE_URL: `http://${_host}:${_port}`,

  // ── Backend server port ───────────────────────────────────────────────────
  BACKEND_PORT: _port,

  // ── Socket.IO ─────────────────────────────────────────────────────────────
  SOCKET: {
    // Connect to same origin in prod; proxy handles it in dev.
    url:                  import.meta.env.VITE_SOCKET_URL || '/',
    path:                 '/socket.io',
    transports:           ['websocket', 'polling'],
    reconnectionAttempts: parseInt(import.meta.env.VITE_SOCKET_RECONNECT_ATTEMPTS, 10) || 10,
    reconnectionDelay:    parseInt(import.meta.env.VITE_SOCKET_RECONNECT_DELAY_MS, 10) || 1000,
    reconnectionDelayMax: parseInt(import.meta.env.VITE_SOCKET_RECONNECT_DELAY_MAX_MS, 10) || 5000,
    timeout:              parseInt(import.meta.env.VITE_SOCKET_TIMEOUT_MS, 10) || 5000,
  },

  // ── Axios / API client ────────────────────────────────────────────────────
  API_TIMEOUT_MS:  parseInt(import.meta.env.VITE_API_TIMEOUT_MS, 10) || 10_000,
  CACHE_TTL_MS:    parseInt(import.meta.env.VITE_CACHE_TTL_MS, 10)   ||  5_000,

  // ── Frontend dev server ───────────────────────────────────────────────────
  // Referenced in vite.config.js via process.env (not import.meta.env).
  DEV_PORT: parseInt(import.meta.env.VITE_DEV_PORT, 10) || 3000,
};

export default cfg;
