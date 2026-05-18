import axios from 'axios';
import cfg from '../config.js';

const api = axios.create({
  baseURL: cfg.API_BASE_URL,
  timeout: cfg.API_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('live_att_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Token expired / invalid → clear session and reload to show login
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('live_att_token');
      localStorage.removeItem('live_att_user');
      window.location.reload();
      return new Promise(() => {});   // suppress further error handling
    }
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);

/**
 * Retry a request up to `retries` times with a delay between attempts.
 * Only retries on network errors / timeouts — NOT on 4xx/5xx or cancelled requests.
 */
async function withRetry(fn, retries = 1, delayMs = 500) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry cancelled requests (AbortError) or server-side errors
      const isCancelled = err.name === 'AbortError' || err.message === 'canceled';
      const isNetworkErr = !err.response && !isCancelled;
      if (!isNetworkErr || i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

// ── In-memory GET cache ─────────────────────────────────────────────────────
// Prevents duplicate network requests when multiple components on the same
// page call the same API (e.g. getCameras called by Settings + Logs + LiveAttendance).
//
// Two layers:
//  1. In-flight deduplication: if a request is already in progress, return the
//     same Promise so all callers share one response.
//  2. Short-lived result cache (TTL): serve the cached value without a network
//     round-trip for TTL ms after the last successful fetch.

const _inflight = new Map();          // key → Promise
const _resultCache = new Map();       // key → { data, ts }
const CACHE_TTL_MS = cfg.CACHE_TTL_MS;

function cachedGet(key, fetchFn) {
  // Serve from result cache if still fresh
  const hit = _resultCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return Promise.resolve(hit.data);
  }

  // Share an in-flight request (deduplication)
  if (_inflight.has(key)) return _inflight.get(key);

  // Start a new request
  const p = fetchFn()
    .then((data) => {
      _resultCache.set(key, { data, ts: Date.now() });
      _inflight.delete(key);
      return data;
    })
    .catch((err) => {
      _inflight.delete(key);         // don't cache errors
      _resultCache.delete(key);
      throw err;
    });

  _inflight.set(key, p);
  return p;
}

/**
 * Read a cached value synchronously (returns undefined if not cached or stale).
 * Used by page components to initialise state with already-fetched data so
 * they skip the skeleton entirely when the App pre-warm has completed.
 */
export function getCached(key) {
  const hit = _resultCache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
  return undefined;
}

/**
 * Invalidate a cache entry — call after mutating operations (create/update/delete)
 * so the next read fetches fresh data from the server.
 * Also clears any in-flight deduplication entry so the next caller starts a
 * new request rather than reusing a stale in-flight response.
 */
export function invalidateCache(key) {
  _resultCache.delete(key);
  _inflight.delete(key);
}

// ── Employees ──────────────────────────────────────────────────────────────
export const getEmployees = (params = {}) => {
  // Include params in the cache key so different searches don't collide
  const key = `employees:${JSON.stringify(params)}`;
  return cachedGet(key, () =>
    withRetry(() => api.get('/employees', { params }).then((r) => r.data))
  );
};

export const getEmployee = (id) =>
  api.get(`/employees/${id}`).then((r) => r.data);

export const createEmployee = (formData) =>
  api
    .post('/employees', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((r) => {
      invalidateCache('employees:{}');
      return r.data;
    });

export const updateEmployee = (id, data) => {
  const isFormData = data instanceof FormData;
  return api.put(`/employees/${id}`, data, {
    headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : {},
  }).then((r) => {
    invalidateCache('employees:{}');
    return r.data;
  });
};

export const deleteEmployee = (id, cameraId) =>
  api.delete(`/employees/${id}`, { params: cameraId ? { camera_id: cameraId } : {} }).then((r) => {
    invalidateCache('employees:{}');
    return r.data;
  });

export const reactivateEmployee = (id) =>
  api.patch(`/employees/${id}/status`, { status: 'active' }).then((r) => {
    invalidateCache('employees:{}');
    return r.data;
  });

export const enrollEmployeeFromCamera = (id, rtsp_url) =>
  api
    .post(`/employees/${id}/enroll-from-camera`, { rtsp_url }, { timeout: 30000 })
    .then((r) => r.data);

// ── Cameras ────────────────────────────────────────────────────────────────
export const getCameras = () =>
  cachedGet('cameras', () =>
    withRetry(() => api.get('/cameras').then((r) => r.data))
  );

export const createCamera = (data) =>
  api.post('/cameras', data).then((r) => {
    invalidateCache('cameras');
    return r.data;
  });

export const updateCamera = (id, data) =>
  api.put(`/cameras/${id}`, data).then((r) => {
    invalidateCache('cameras');
    return r.data;
  });

export const updateCameraROI = (id, roi) =>
  api.put(`/cameras/${id}/roi`, roi).then((r) => {
    invalidateCache('cameras');
    return r.data;
  });

// Saves ROI to MySQL + pushes directly to Python /set-roi in one call
export const pushCameraROI = (id, roiOrNull) =>
  api.post(`/cameras/${id}/push-roi`, roiOrNull || { clear: true }).then((r) => {
    invalidateCache('cameras');
    return r.data;
  });

export const deleteCamera = (id) =>
  api.delete(`/cameras/${id}`).then((r) => {
    invalidateCache('cameras');
    return r.data;
  });

export const pushCameraConfig = (data) =>
  api.post('/cameras/push-config', data).then((r) => r.data);

// ── Attendance ─────────────────────────────────────────────────────────────
export const getAttendanceLogs = (params = {}) =>
  withRetry(() => api.get('/attendance', { params }).then((r) => r.data));

export const getTodayAttendance = () =>
  api.get('/attendance/today').then((r) => r.data);

export const getAttendanceStats = () =>
  api.get('/attendance/stats').then((r) => r.data);

// ── Dashboard ──────────────────────────────────────────────────────────────
export const getDashboardStats = () =>
  cachedGet('dashboard:stats', () =>
    api.get('/dashboard/stats').then((r) => r.data)
  );

export const getDashboardWeekly = () =>
  api.get('/dashboard/weekly').then((r) => r.data);

export const getDashboardDepartments = () =>
  api.get('/dashboard/departments').then((r) => r.data);

// ── Settings ──────────────────────────────────────────────────────────────
export const getAttendanceSummary = (params = {}) =>
  api.get('/attendance/summary', { params }).then((r) => r.data);


export const getSettings = () =>
  cachedGet('settings', () =>
    api.get('/settings').then((r) => r.data)
  );

export const saveSettings = (data) =>
  api.post('/settings', data).then((r) => {
    invalidateCache('settings');
    return r.data;
  });

// ── Sync ───────────────────────────────────────────────────────────────────
// ── Unknown Faces ──────────────────────────────────────────────────────────────
export const getUnknownFaces = (params = {}) =>
  api.get('/unknown-faces', { params }).then((r) => r.data);

export const getUnknownFaceStats = () =>
  api.get('/unknown-faces/stats').then((r) => r.data);

export const getUnknownFaceDevices = () =>
  api.get('/unknown-faces/devices').then((r) => r.data);

export const getUnknownCluster = (clusterId) =>
  api.get(`/unknown-faces/cluster/${clusterId}`).then((r) => r.data);

export const markAllUnknownReviewed = () =>
  api.put('/unknown-faces/mark-all-reviewed').then((r) => r.data);

export const updateUnknownClusterStatus = (clusterId, status) =>
  api.put(`/unknown-faces/cluster/${clusterId}/status`, { status }).then((r) => r.data);

export const deleteUnknownCluster = (clusterId) =>
  api.delete(`/unknown-faces/cluster/${clusterId}`).then((r) => r.data);

export const deleteUnknownFace = (id) =>
  api.delete(`/unknown-faces/${id}`).then((r) => r.data);

export const deleteAllUnknownFaces = (status = null) =>
  api.delete('/unknown-faces', { params: status ? { status } : {} }).then((r) => r.data);

// ── Sync ───────────────────────────────────────────────────────────────────────
export const startSync    = (body)   => api.post('/sync/start', body).then((r) => r.data);
export const getSyncJobs  = ()       => api.get('/sync/jobs').then((r) => r.data);
export const getSyncJob   = (jobId)  => api.get(`/sync/${jobId}`).then((r) => r.data);
export const retrySyncJob = (jobId)  => api.post(`/sync/${jobId}/retry`).then((r) => r.data);
export const startUnsync        = (body)         => api.post('/sync/unsync', body).then((r) => r.data);
export const getSyncHistory     = (params = {})  => api.get('/sync/history', { params }).then((r) => r.data);
export const getSyncHistoryCycles = (params = {}) => api.get('/sync/history/cycles', { params }).then((r) => r.data);

export default api;
