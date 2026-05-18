import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { getAttendanceSummary, getEmployees, getCameras } from '../services/api.js';
import { socket } from '../services/socket.js';
import cfg from '../config.js';

const BACKEND_BASE = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

function fmtHours(minutes) {
  if (!minutes && minutes !== 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_META = {
  PRESENT:   { bg: 'bg-green-900/40  border-green-700/50  text-green-300',  label: 'Present'  },
  LATE:      { bg: 'bg-yellow-900/40 border-yellow-700/50 text-yellow-300', label: 'Late'     },
  OT:        { bg: 'bg-purple-900/40 border-purple-700/50 text-purple-300', label: 'OT'       },
  UT:        { bg: 'bg-red-900/40    border-red-700/50    text-red-300',    label: 'UT'       },
  HALF_DAY:  { bg: 'bg-orange-900/40 border-orange-700/50 text-orange-300', label: 'Half Day' },
  // Legacy aliases for records written before the status rename
  FULL_DAY:  { bg: 'bg-green-900/40  border-green-700/50  text-green-300',  label: 'Present'  },
  OVER_TIME: { bg: 'bg-purple-900/40 border-purple-700/50 text-purple-300', label: 'OT'       },
  UNDER_TIME:{ bg: 'bg-red-900/40    border-red-700/50    text-red-300',    label: 'UT'       },
};

// Keep STATUS_STYLES for summary breakdown backward-compat
const STATUS_STYLES = Object.fromEntries(Object.entries(STATUS_META).map(([k, v]) => [k, { bg: v.bg }]));

function StatusBadge({ status }) {
  if (!status) return <span className="text-slate-500 text-xs">—</span>;
  const s = STATUS_META[status] || STATUS_META.PRESENT;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${s.bg}`}>
      {s.label}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AttendanceLogs() {
  // Use local date (not UTC) to match the backend which stores dates in local time
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();
  
  // Filters State
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate]     = useState(today);
  const [department, setDepartment] = useState('');
  const [search, setSearch]       = useState('');

  const [deviceFilter, setDeviceFilter] = useState('');
  const [cameras, setCameras]     = useState([]);
  const [summary, setSummary]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [employees, setEmployees] = useState([]);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        start_date:  startDate,
        end_date:    endDate,
        department:  department  || undefined,
        camera_id:   deviceFilter || undefined,
      };
      const data = await getAttendanceSummary(params);
      setSummary(data.summary || []);
    } catch (_) {
      setSummary([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, department, deviceFilter]);

  useEffect(() => {
    getEmployees().then(data => setEmployees(data.employees || []));
    getCameras().then(data => setCameras(data.cameras || []));
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // Unique departments for filter
  const departments = useMemo(() => {
    const set = new Set(employees.map(e => e.department).filter(Boolean));
    return Array.from(set).sort();
  }, [employees]);

  // Real-time updates: apply socket events for any date within the currently viewed range
  useEffect(() => {
    function onUpdate(payload) {
      // Derive the event's local date from its timestamp
      const ts = payload.timestamp ? new Date(payload.timestamp) : new Date();
      const payloadDate = `${ts.getFullYear()}-${String(ts.getMonth()+1).padStart(2,'0')}-${String(ts.getDate()).padStart(2,'0')}`;

      // Only update if this date falls within the currently viewed range
      if (payloadDate < startDate || payloadDate > endDate) return;

      // If a device filter is active, only update/add rows whose camera_id matches
      if (deviceFilter && String(payload.camera_id) !== String(deviceFilter)) return;

      setSummary((prev) => {
        const idx = prev.findIndex((r) => r.employee_id === payload.employee_id && r.date === payloadDate);
        const updated = {
          ...prev[idx],
          date:               payloadDate,
          first_in_time:      payload.first_in_time      || prev[idx]?.first_in_time,
          last_out_time:      payload.last_out_time       || prev[idx]?.last_out_time,
          total_work_minutes: payload.total_work_minutes  ?? prev[idx]?.total_work_minutes,
          total_work_hours:   payload.total_work_hours    ?? prev[idx]?.total_work_hours,
          status:             payload.status              || prev[idx]?.status,
          employee_name:      payload.employee_name       || prev[idx]?.employee_name,
          employee_code:      payload.employee_code       || prev[idx]?.employee_code,
          employee_image:     payload.employee_image      || prev[idx]?.employee_image,
          department:         payload.department          || prev[idx]?.department,
          camera_name:        payload.camera_name         || prev[idx]?.camera_name,
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updated;
          return next;
        }
        return [updated, ...prev];
      });
    }
    socket.on('daily_attendance_updated', onUpdate);
    return () => socket.off('daily_attendance_updated', onUpdate);
  }, [startDate, endDate, deviceFilter]);

  // Device filter is applied server-side (camera_id param) — only search filters client-side
  const filtered = summary.filter((r) => {
    const q = search.toLowerCase();
    return !q || r.employee_name?.toLowerCase().includes(q) || r.employee_code?.toLowerCase().includes(q);
  });

  const exportToExcel = async () => {
    const XLSX = await import('xlsx');
    const data = filtered.map((r, idx) => ({
      'S.No': idx + 1,
      'Date': r.date,
      'Employee Code': r.employee_code,
      'Name': r.employee_name,
      'Department': r.department || '',
      'First IN': r.first_in_time ? new Date(r.first_in_time).toLocaleTimeString() : '-',
      'Last OUT': r.last_out_time ? new Date(r.last_out_time).toLocaleTimeString() : '-',
      'Work Hours': r.total_work_hours || '0.00',
      'Status': STATUS_META[r.status]?.label || (r.status || '').replace('_', ' ')
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance Logs');
    XLSX.writeFile(wb, `Attendance_Logs_${startDate}_to_${endDate}.xlsx`);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 lg:space-y-5">
      {/* Header & Main Filters */}
      <div className="flex flex-col gap-3 lg:gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl lg:text-2xl font-bold text-white truncate">Attendance Logs</h1>
            <p className="text-slate-400 text-xs lg:text-sm mt-0.5 hidden sm:block">Summary Reports — Filters & Export</p>
          </div>
          <button
            onClick={exportToExcel}
            className="flex items-center gap-1.5 lg:gap-2 px-3 lg:px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-xs lg:text-sm font-medium rounded-lg transition-colors shadow-lg shadow-green-900/20 flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">Export Excel</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">

            {/* From Date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                From Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              />
            </div>

            {/* To Date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                To Date
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              />
            </div>

            {/* Department */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                Department
              </label>
              <select
                value={department}
                onChange={e => setDepartment(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              >
                <option value="">All Departments</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Device */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
                Device
              </label>
              <select
                value={deviceFilter}
                onChange={e => setDeviceFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              >
                <option value="">All Devices</option>
                {cameras.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Search */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M16.65 16.65A7 7 0 1116.65 2.65a7 7 0 010 14z" />
                </svg>
                Search
              </label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M16.65 16.65A7 7 0 1116.65 2.65a7 7 0 010 14z" />
                </svg>
                <input
                  type="text"
                  placeholder="Name or Code…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
                />
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Stats bar */}
      {!loading && summary.length > 0 && (() => {
        const counts = summary.reduce((acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1; return acc;
        }, {});
        return (
          <div className="flex flex-wrap gap-3">
            {Object.entries(counts).map(([status, count]) => {
              const s = STATUS_STYLES[status] || STATUS_STYLES.PRESENT;
              return (
                <div key={status} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${s.bg}`}>
                  <span>{STATUS_META[status]?.label || status.replace('_', ' ')}</span>
                  <span className="font-bold">{count}</span>
                </div>
              );
            })}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium bg-slate-800 border-slate-600 text-slate-300">
              <span>Total Records</span>
              <span className="font-bold">{summary.length}</span>
            </div>
          </div>
        );
      })()}

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                <th className="text-left text-slate-400 font-medium px-5 py-4 w-10">#</th>
                <th className="text-left text-slate-400 font-medium px-5 py-4">Employee</th>
                <th className="text-left text-slate-400 font-medium px-5 py-4">Date</th>
                <th className="text-left text-slate-400 font-medium px-5 py-4">First IN</th>
                <th className="text-left text-slate-400 font-medium px-5 py-4">Last OUT</th>
                <th className="text-left text-slate-400 font-medium px-5 py-4">Work Hours</th>
                <th className="text-left text-slate-400 font-medium px-5 py-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-700/50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-4">
                      <div className="h-4 bg-slate-700 rounded animate-pulse" style={{ width: `${60 + j * 5}%` }} />
                    </td>
                  ))}
                </tr>
              ))}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-20 text-slate-500">
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-4 bg-slate-900 rounded-full border border-slate-700">
                        <svg className="w-10 h-10 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <p className="text-base font-medium">No results found for selected range</p>
                      <p className="text-sm">Try adjusting your filters or search query</p>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && filtered.map((r, idx) => (
                <tr key={r.id || `${r.employee_id}_${r.date}`}
                  className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${idx % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'}`}
                >
                  <td className="px-5 py-4 text-slate-500 font-mono text-xs">{idx + 1}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      {r.employee_image ? (
                        <img src={`${BACKEND_BASE}/${r.employee_image}`} className="w-9 h-9 rounded-full object-cover border border-slate-600 shadow-sm" alt="" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 text-xs font-bold border border-slate-600">
                          {r.employee_name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div>
                        <p className="text-white font-semibold text-sm">{r.employee_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                           <span className="text-slate-500 text-[10px] font-mono bg-slate-900 px-1 rounded">{r.employee_code}</span>
                           {r.department && <span className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold">{r.department}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                     <span className="text-slate-300 font-medium text-sm">{fmtDate(r.date)}</span>
                  </td>
                  <td className="px-5 py-4">
                    {r.first_in_time
                      ? <span className="text-green-400 font-mono text-sm antialiased">{fmtTime(r.first_in_time)}</span>
                      : <span className="text-slate-600 text-xs italic">Not tracked</span>
                    }
                  </td>
                  <td className="px-5 py-4">
                    {r.last_out_time
                      ? <span className="text-red-400 font-mono text-sm antialiased">{fmtTime(r.last_out_time)}</span>
                      : <span className="text-slate-600 text-xs italic">Not tracked</span>
                    }
                  </td>
                  <td className="px-5 py-4">
                    {r.last_out_time
                      ? <span className="text-white font-mono text-sm font-semibold">{fmtHours(r.total_work_minutes)}</span>
                      : <span className="text-slate-600 text-xs italic">—</span>
                    }
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
