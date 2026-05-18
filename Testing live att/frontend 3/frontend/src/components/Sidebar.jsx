import { useEffect, useState, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { socket } from '../services/socket.js';
import { useTheme } from '../context/ThemeContext.jsx';
import api from '../services/api.js';

// ── Icons ──────────────────────────────────────────────────────────────────
function IconDashboard() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth="2" />
      <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth="2" />
      <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth="2" />
      <rect x="14" y="14" width="7" height="7" rx="1" strokeWidth="2" />
    </svg>
  );
}
function IconCamera() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
    </svg>
  );
}
function IconClipboard() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8zm6 4a3 3 0 100-6 3 3 0 000 6zM3 16a3 3 0 100-6 3 3 0 000 6z" />
    </svg>
  );
}
function IconSync() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
function IconCog() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function IconUnknown() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function IconFullscreen() {
  return (
    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  );
}
function IconMenu() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
function IconX() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

const navItems = [
  { to: '/dashboard',  label: 'Dashboard',        Icon: IconDashboard,  exact: true },
  { to: '/live',       label: 'Live Attendance',   Icon: IconCamera },
  { to: '/logs',       label: 'Attendance Logs',   Icon: IconClipboard },
  { to: '/employees',  label: 'Employee List',     Icon: IconUsers },
  { to: '/unknown',    label: 'Unknown Persons',   Icon: IconUnknown,   badge: true },
  { to: '/sync',       label: 'Sync to Devices',   Icon: IconSync },
  { to: '/settings',   label: 'Device Managment',  Icon: IconCog },
  { to: '/fullscreen', label: 'Full Screen',        Icon: IconFullscreen },
  // { to: '/fullscreen1', label: 'Full Screen 1',     Icon: IconFullscreen },
];

export default function Sidebar({ onLogout }) {
  const [connected, setConnected] = useState(socket.connected);
  const [open, setOpen] = useState(false);
  const [unknownBadge, setUnknownBadge] = useState(0);
  const location = useLocation();
  const { isDark, toggle } = useTheme();

  // Always-current pathname ref — lets async callbacks read the live route
  // without stale closure values.
  const pathnameRef = useRef(location.pathname);

  // Close sidebar on route change (mobile) + clear badge + keep ref in sync
  useEffect(() => {
    pathnameRef.current = location.pathname;
    setOpen(false);
    if (location.pathname === '/unknown') setUnknownBadge(0);
  }, [location.pathname]);

  useEffect(() => {
    function onConnect()    { setConnected(true); }
    function onDisconnect() { setConnected(false); }
    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
  }, []);

  // Fetch initial unknown badge count.
  // Uses pathnameRef (not location closure) so the async callback sees the
  // CURRENT route at the time the response arrives — preventing the fetch from
  // overwriting the badge=0 clear that already ran synchronously on mount.
  useEffect(() => {
    api.get('/unknown-faces/stats')
      .then((r) => {
        if (pathnameRef.current !== '/unknown') {
          setUnknownBadge(r.data.new_count || 0);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Increment badge on real-time unknown detection (only when off the page)
  useEffect(() => {
    function onUnknown() {
      if (pathnameRef.current !== '/unknown') setUnknownBadge((c) => c + 1);
    }
    socket.on('unknown_face_detected', onUnknown);
    return () => socket.off('unknown_face_detected', onUnknown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* ── Mobile hamburger button ────────────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-[60] p-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:bg-slate-700"
        aria-label="Open menu"
      >
        <IconMenu />
      </button>

      {/* ── Backdrop (mobile only) ─────────────────────────────────────── */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-[65]"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Sidebar panel ─────────────────────────────────────────────── */}
      <aside
        className={`
          fixed left-0 top-0 h-screen bg-slate-900 border-r border-slate-700
          flex flex-col z-[70]
          transition-transform duration-200 ease-in-out
          w-58
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="px-4 py-4 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm leading-tight truncate">Live Attendance</p>
              <p className="text-slate-400 text-xs truncate">AI Powered By RuRu tek</p>
            </div>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"
          >
            <IconX />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, label, Icon, exact, badge }) => {
            const isActive = exact
              ? location.pathname === to
              : location.pathname.startsWith(to);
            const badgeCount = badge ? unknownBadge : 0;
            return (
              <NavLink
                key={to}
                to={to}
                className={() =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                  }`
                }
              >
                <Icon />
                <span className="flex-1">{label}</span>
                {badgeCount > 0 && (
                  <span className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full text-xs font-bold bg-red-600 text-white">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer: logout + connection status + theme toggle */}
        <div className="px-4 py-3 border-t border-slate-700 space-y-2">
          {/* Logged-in user + logout */}
          <div className="flex items-center justify-between gap-2 px-1 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full bg-blue-600/30 border border-blue-600/50 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <span className="text-slate-300 text-xs font-medium truncate">
                {localStorage.getItem('live_att_user') || 'admin'}
              </span>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out"
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            )}
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              connected ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-slate-500'
            }`} />
            <span className="text-xs text-slate-400 truncate">
              {connected ? 'Server Connected' : 'Connecting…'}
            </span>
          </div>

          {/* Dark / Light toggle */}
          <button
            onClick={toggle}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors group"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
              {isDark ? 'Dark Mode' : 'Light Mode'}
            </span>
            {/* Toggle pill */}
            <div className={`relative w-10 h-5 rounded-full transition-colors ${isDark ? 'bg-slate-600' : 'bg-blue-500'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full shadow transition-all ${isDark ? 'left-0.5 bg-slate-300' : 'left-5 bg-white'}`} />
              {/* Icon inside knob */}
              <span className={`absolute top-0.5 w-4 h-4 flex items-center justify-center transition-all ${isDark ? 'left-0.5' : 'left-5'}`}>
                {isDark ? (
                  <svg className="w-2.5 h-2.5 text-slate-700" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                  </svg>
                ) : (
                  <svg className="w-2.5 h-2.5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                  </svg>
                )}
              </span>
            </div>
          </button>
        </div>
      </aside>
    </>
  );
}