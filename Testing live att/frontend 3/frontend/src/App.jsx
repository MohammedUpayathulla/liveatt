import { useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './App.css';

import Sidebar from './components/Sidebar.jsx';
import Login from './pages/Login.jsx';
import { socket, ATTENDANCE_MARKED } from './services/socket.js';
import cfg from './config.js';

const BACKEND_BASE = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');

// ── Global attendance pop-up toast ────────────────────────────────────────────
// Shown on every page whenever Python marks an attendance record.
function AttendanceToast({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-3 bg-slate-800 border border-green-600/70 rounded-2xl shadow-2xl min-w-[280px] max-w-sm"
          style={{ animation: 'slideInRight 0.25s ease-out' }}
        >
          {/* Avatar / face image */}
          {t.image ? (
            <img
              src={`${BACKEND_BASE}/uploads/${t.image}`}
              alt={t.name}
              className="w-10 h-10 rounded-full object-cover border-2 border-green-500/60 flex-shrink-0"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">{t.name}</p>
            <p className="text-green-400 text-xs font-mono">{t.code}</p>
            <p className="text-slate-400 text-[11px] truncate">
              {t.camera}{t.punch ? ` · ${t.punch.toUpperCase()}` : ''}
            </p>
          </div>
          {/* Progress bar */}
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <button
              onClick={() => onDismiss(t.id)}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="w-12 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{
                  animation: `shrink ${t.duration}ms linear forwards`,
                  transformOrigin: 'left',
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const TOAST_DURATION_MS = 5000;

// Direct imports — no lazy loading.
// Lazy loading delays every first page visit by a chunk download round-trip.
// For a local LAN app the total JS bundle is small (~400 KB) and loads once;
// the per-navigation chunk download overhead is worse than the upfront cost.
import Dashboard from './pages/Dashboard.jsx';
import LiveAttendance from './pages/LiveAttendance.jsx';
import AttendanceLogs from './pages/AttendanceLogs.jsx';
import EmployeeList from './pages/EmployeeList.jsx';
import Settings from './pages/Settings.jsx';
import SyncEmployees from './pages/SyncEmployees.jsx';
import FullScreenDetection from './pages/FullScreenDetection.jsx';
import FullScreenDetection1 from './pages/FullScreenDetection1.jsx';
import UnknownPersons from './pages/UnknownPersons.jsx';
import SimpleStream from './pages/SimpleStream.jsx';
import RTSPStream from './pages/RTSPStream.jsx';
import StreamDebug from './pages/StreamDebug.jsx';

import { getCameras, getEmployees, getDashboardStats, getSettings } from './services/api.js';

// Routes that render without the sidebar/layout shell
const FULLSCREEN_ROUTES = ['/fullscreen', '/fullscreen1', '/stream', '/rtsp'];
const FULLSCREEN_EXACT = ['/'];

function Layout({ children, onLogout }) {
  const location = useLocation();
  const isFullscreen =
    FULLSCREEN_EXACT.includes(location.pathname) ||
    FULLSCREEN_ROUTES.some((p) => location.pathname.startsWith(p));

  if (isFullscreen) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-slate-900">     
        <Sidebar onLogout={onLogout} />
      <main className="flex-1 lg:ml-64 min-h-screen overflow-auto">
        <div className="pt-12 lg:pt-0 h-full">
          {children}
        </div>
      </main>
    </div>
  );
}

// Auth gate — only one hook here so React's hook order never changes
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => !!localStorage.getItem('live_att_token')
  );

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <AppContent
      onLogout={() => {
        localStorage.removeItem('live_att_token');
        localStorage.removeItem('live_att_user');
        setIsAuthenticated(false);
      }}
    />
  );
}

// Main app — rendered only when authenticated
function AppContent({ onLogout }) {
  const [attendanceToasts, setAttendanceToasts] = useState([]);
  const location = useLocation();
  const isFullscreen =
    FULLSCREEN_EXACT.includes(location.pathname) ||
    FULLSCREEN_ROUTES.some((p) => location.pathname.startsWith(p));

  const dismissToast = useCallback((id) => {
    setAttendanceToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    function onAttendance(data) {
      const id = Date.now() + Math.random();
      setAttendanceToasts((prev) => [...prev.slice(-4), {
        id,
        name: data.employee_name || 'Employee',
        code: data.employee_code || '',
        image: data.employee_image || null,
        camera: data.camera_name || '',
        punch: data.punch_type || '',
        duration: TOAST_DURATION_MS,
      }]);
      setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
    }
    socket.on(ATTENDANCE_MARKED, onAttendance);
    return () => socket.off(ATTENDANCE_MARKED, onAttendance);
  }, [dismissToast]);

  useEffect(() => {
    getCameras();
    getEmployees();
    getDashboardStats();
    getSettings();
  }, []);

  return (
    <>
      {!isFullscreen && <AttendanceToast toasts={attendanceToasts} onDismiss={dismissToast} />}
      <Layout onLogout={onLogout}>
        <Routes>
          <Route path="/" element={<FullScreenDetection />} />
          <Route path="/stream" element={<SimpleStream />} />
          <Route path="/rtsp" element={<RTSPStream />} />
          <Route path="/debug-stream" element={<StreamDebug />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/live" element={<LiveAttendance />} />
          <Route path="/logs" element={<AttendanceLogs />} />
          <Route path="/employees" element={<EmployeeList />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/sync" element={<SyncEmployees />} />
          <Route path="/unknown" element={<UnknownPersons />} />
          <Route path="/fullscreen" element={<FullScreenDetection />} />
          <Route path="/fullscreen1" element={<FullScreenDetection1 />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </>
  );
}
