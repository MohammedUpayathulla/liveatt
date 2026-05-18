import React, { useEffect, useState, useRef, useCallback } from 'react';
import cfg from '../config.js';

const BACKEND_BASE = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  getDashboardStats, getDashboardWeekly, getDashboardDepartments,
  getAttendanceLogs, getSettings, getCached,
} from '../services/api.js';
import { socket, ATTENDANCE_MARKED } from '../services/socket.js';

// ── Stat Card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, colorClass, bgClass, loading, sub }) {
  return (
    <div className="bg-slate-800 rounded-xl p-3 lg:p-5 border border-slate-700 flex items-center gap-3 lg:gap-4">
      <div className={`w-10 h-10 lg:w-12 lg:h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${bgClass}`}>
        <span className={colorClass}>{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-slate-400 text-xs lg:text-sm font-medium truncate">{label}</p>
        {loading ? (
          <div className="mt-1 h-7 w-12 bg-slate-700 rounded animate-pulse" />
        ) : (
          <p className="text-white text-2xl lg:text-3xl font-bold leading-none mt-0.5">{value ?? '—'}</p>
        )}
        {sub && !loading && <p className="text-slate-500 text-xs mt-1 truncate">{sub}</p>}
      </div>
    </div>
  );
}

// ── Custom Tooltip ────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-semibold">
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

// ── Recent Log Row ────────────────────────────────────────────────────────
const LogRow = React.memo(function LogRow({ event, isNew }) {
  const name = event.employee_name || event.name || 'Unknown';
  const code = event.employee_code || '';
  const camera = event.camera_name || '';
  const confidence = event.confidence > 0 ? Math.round(event.confidence * 100) : null;
  const imgSrc = event.employee_image || event.image_path || null;
  const time = event.timestamp
    ? new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
      isNew ? 'bg-green-900/20 border-green-700/40 animate-slide-in' : 'bg-slate-900/60 border-slate-700/50'
    }`}>
      {imgSrc ? (
        <img src={`${BACKEND_BASE}/${imgSrc}`} className="w-9 h-9 rounded-full object-cover border-2 border-slate-600 flex-shrink-0"
          alt={name} loading="lazy"
          onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
      ) : null}
      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm border-2 border-slate-600 bg-blue-600/20 text-blue-400 flex-shrink-0 ${imgSrc ? 'hidden' : 'flex'}`}>
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold truncate">{name}</p>
        <p className="text-slate-500 text-xs truncate">{code}{code && camera ? ' · ' : ''}{camera}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-slate-300 text-xs font-mono">{time}</p>
        {confidence !== null && (
          <p className={`text-xs font-mono font-bold mt-0.5 ${confidence >= 70 ? 'text-green-400' : confidence >= 55 ? 'text-yellow-400' : 'text-orange-400'}`}>
            {confidence}%
          </p>
        )}
      </div>
    </div>
  );
});

const DEPT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];

// ── Dashboard Page ────────────────────────────────────────────────────────
export default function Dashboard() {
  const _cachedStats = getCached('dashboard:stats');
  const [stats, setStats]           = useState(_cachedStats ?? null);
  const [statsLoading, setStatsLoading] = useState(!_cachedStats);
  const [statsError, setStatsError] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [newEventIds, setNewEventIds]   = useState(new Set());
  const [threshold, setThreshold]       = useState(0.45);
  const [weeklyData, setWeeklyData] = useState([]);
  const [deptData, setDeptData]     = useState([]);

  const presentTodayRef = useRef(new Set());
  const presentDateRef  = useRef(new Date().toDateString());
  const MAX_EVENTS = 8;

  const fetchStats = useCallback(async (silent = false) => {
    if (!silent) setStatsLoading(true);
    setStatsError(null);
    try {
      const [data] = await Promise.all([
        getDashboardStats(),
        getDashboardWeekly().then((d) => setWeeklyData(d.weekly || [])).catch(() => {}),
        getDashboardDepartments().then((d) => setDeptData(d.departments || [])).catch(() => {}),
      ]);
      setStats(data);
    } catch (err) {
      if (!silent) setStatsError(err.message);
    } finally {
      if (!silent) setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const today = new Date().toISOString().slice(0, 10);

    fetchStats(false);

    getAttendanceLogs({ limit: MAX_EVENTS, date: today })
      .then((data) => {
        if (!alive) return;
        setRecentEvents((data.logs || []).slice(0, MAX_EVENTS).map((l) => ({ ...l, _reactId: `init-${l.id}` })));
      }).catch(() => {});

    getSettings()
      .then((data) => {
        if (!alive) return;
        const thr = parseFloat(data?.settings?.recognition_threshold);
        if (!isNaN(thr)) setThreshold(thr);
      }).catch(() => {});

    getDashboardWeekly()
      .then((data) => { if (alive) setWeeklyData(data.weekly || []); })
      .catch(() => {});

    getDashboardDepartments()
      .then((data) => { if (alive) setDeptData(data.departments || []); })
      .catch(() => {});

    const interval = setInterval(() => {
      fetchStats(true);
      getDashboardWeekly().then((d) => setWeeklyData(d.weekly || [])).catch(() => {});
      getDashboardDepartments().then((d) => setDeptData(d.departments || [])).catch(() => {});
    }, 30000);

    return () => { alive = false; clearInterval(interval); };
  }, [fetchStats]);

  useEffect(() => {
    function handleAttendance(event) {
      const id = event.id || event._id || `evt-${Date.now()}-${Math.random()}`;
      const enriched = { ...event, _reactId: `rt-${id}` };
      setRecentEvents((prev) => [enriched, ...prev].slice(0, MAX_EVENTS));
      setNewEventIds((prev) => { const n = new Set(prev); n.add(enriched._reactId); return n; });
      setTimeout(() => setNewEventIds((prev) => { const n = new Set(prev); n.delete(enriched._reactId); return n; }), 3000);

      const today = new Date().toDateString();
      if (presentDateRef.current !== today) { presentDateRef.current = today; presentTodayRef.current = new Set(); }
      const empId = String(event.employee_id || '');
      if (empId && !presentTodayRef.current.has(empId)) {
        presentTodayRef.current.add(empId);
        setStats((prev) => prev ? { ...prev, present_today: (prev.present_today ?? 0) + 1 } : prev);
      }
    }
    socket.on(ATTENDANCE_MARKED, handleAttendance);
    return () => socket.off(ATTENDANCE_MARKED, handleAttendance);
  }, []);

  const presentPct = stats?.total_employees > 0
    ? Math.round((stats.present_today / stats.total_employees) * 100) : 0;
  const absentCount = stats?.total_employees != null && stats?.present_today != null
    ? Math.max(0, stats.total_employees - stats.present_today) : null;


  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl lg:text-2xl font-bold text-white truncate">Dashboard</h1>
          <p className="text-slate-400 text-xs lg:text-sm mt-0.5 hidden sm:block">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          <p className="text-slate-400 text-xs mt-0.5 sm:hidden">
            {new Date().toLocaleDateString()}
          </p>
        </div>
        <button onClick={() => fetchStats(false)}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs lg:text-sm rounded-lg transition-colors flex-shrink-0">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {statsError && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          Failed to load stats: {statsError}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <StatCard label="Total Employees" value={stats?.total_employees} loading={statsLoading}
          colorClass="text-blue-400" bgClass="bg-blue-500/10"
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m4-4a4 4 0 100-8 4 4 0 000 8z" /></svg>}
        />
        <StatCard label="Present Today" value={stats?.present_today} loading={statsLoading}
          colorClass="text-green-400" bgClass="bg-green-500/10"
          sub={stats?.total_employees > 0 ? `${presentPct}% attendance rate` : null}
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard label="Absent Today" value={absentCount} loading={statsLoading}
          colorClass="text-red-400" bgClass="bg-red-500/10"
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard label="Active Devices" value={stats?.active_cameras} loading={statsLoading}
          colorClass="text-yellow-400" bgClass="bg-yellow-500/10"
          icon={<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>}
        />
      </div>

      {/* Charts Row: Weekly + Department */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">

        {/* Weekly Attendance Bar Chart */}
        <div className="lg:col-span-2 bg-slate-800 rounded-xl border border-slate-700 p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-white font-semibold">Weekly Attendance</h2>
              <p className="text-slate-500 text-xs mt-0.5">Unique employees present per day</p>
            </div>
            <span className="text-xs text-slate-500 bg-slate-700 px-2 py-1 rounded-full">Last 7 days</span>
          </div>
          {weeklyData.length === 0 ? (
            <div className="h-44 flex items-center justify-center">
              <div className="space-y-2 w-full px-4">
                {[...Array(5)].map((_, i) => <div key={i} className="h-4 bg-slate-700 rounded animate-pulse" style={{ width: `${60 + i * 8}%` }} />)}
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={weeklyData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar dataKey="count" name="Present" radius={[6, 6, 0, 0]}>
                  {weeklyData.map((entry, i) => (
                    <Cell key={i} fill={entry.date === (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })() ? '#10b981' : '#3b82f6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="flex items-center gap-4 mt-2 justify-end">
            <span className="flex items-center gap-1.5 text-xs text-slate-400"><span className="w-3 h-3 rounded-sm bg-green-500 inline-block" />Today</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-400"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" />Previous</span>
          </div>
        </div>

        {/* Department Breakdown */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-white font-semibold">By Department</h2>
              <p className="text-slate-500 text-xs mt-0.5">Present today</p>
            </div>
            <span className="text-xs text-slate-500 bg-slate-700 px-2 py-1 rounded-full">Today</span>
          </div>
          {deptData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 text-slate-500 text-sm">No data yet today</div>
          ) : (
            <div className="space-y-3 mt-1">
              {deptData.map((d, i) => {
                const total = Number(d.total) || 0;
                const present = Number(d.present) || 0;
                const pct = total > 0 ? Math.round((present / total) * 100) : 0;
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-300 truncate max-w-[110px]">{d.department}</span>
                      <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                        <span className="text-slate-500">{present}/{total}</span>
                        <span className="font-mono font-bold text-white w-9 text-right">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: DEPT_COLORS[i % DEPT_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent Attendance */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <h2 className="text-white font-semibold">Recent Detections</h2>
            <span className="text-slate-500 text-xs bg-slate-700/60 px-2 py-0.5 rounded-full">Last {MAX_EVENTS}</span>
          </div>
          <span className="text-slate-400 text-xs bg-slate-700 px-2 py-0.5 rounded-full">Live</span>
        </div>
        <div className="p-4">
          {recentEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <svg className="w-10 h-10 text-slate-600 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-slate-500 text-sm">No detections today yet</p>
              <p className="text-slate-600 text-xs mt-1">Detection events will appear here in real time</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {recentEvents.map((event) => (
                <LogRow key={event._reactId} event={event} isNew={newEventIds.has(event._reactId)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
