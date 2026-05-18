import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getEmployees, getCameras, startSync, getSyncJobs, getSyncJob, retrySyncJob, startUnsync, getSyncHistory, getSyncHistoryCycles } from '../services/api.js';
import { socket } from '../services/socket.js';
import cfg from '../config.js';

// Make backend base accessible to the EmployeeSelector without prop-drilling
window.__BACKEND_BASE__ = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');

// ── Simple multi-select for devices ──────────────────────────────────────────
function SearchableMultiSelect({ selectedIds, onChange, options, placeholder = 'Select…', labelKey = 'name', subKey = null }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggle = (id) => {
    const sid = String(id);
    onChange(selectedIds.includes(sid) ? selectedIds.filter((x) => x !== sid) : [...selectedIds, sid]);
  };
  const selectAll   = () => onChange(options.map((o) => String(o.id)));
  const deselectAll = () => onChange([]);
  const allSelected = options.length > 0 && selectedIds.length === options.length;

  const filtered = options.filter((o) =>
    String(o[labelKey] || '').toLowerCase().includes(search.toLowerCase()) ||
    String(o[subKey]   || '').toLowerCase().includes(search.toLowerCase())
  );
  const selectedNames = options.filter((o) => selectedIds.includes(String(o.id))).map((o) => o[labelKey]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(''); }}
        className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left min-h-[42px]"
      >
        {selectedNames.length === 0 ? (
          <span className="text-slate-500">{placeholder}</span>
        ) : selectedNames.length === options.length ? (
          <span className="text-blue-400 text-sm font-medium">All {options.length} selected</span>
        ) : (
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {selectedNames.slice(0, 3).map((n) => (
              <span key={n} className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">{n}</span>
            ))}
            {selectedNames.length > 3 && (
              <span className="bg-slate-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">+{selectedNames.length - 3} more</span>
            )}
          </div>
        )}
        <svg className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-700 space-y-2">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-500"
            />
            <div className="flex items-center justify-between px-1">
              <span className="text-slate-500 text-xs">{selectedIds.length} of {options.length} selected</span>
              <button type="button" onClick={allSelected ? deselectAll : selectAll}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium">
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-slate-500 text-sm px-3 py-2">No results found</p>
            ) : filtered.map((o) => {
              const sid     = String(o.id);
              const checked = selectedIds.includes(sid);
              return (
                <label key={sid}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-slate-700 ${checked ? 'bg-blue-900/20' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(sid)} className="w-4 h-4 accent-blue-500 flex-shrink-0" />
                  <span className="text-white text-sm flex-1 truncate">{o[labelKey]}</span>
                  {subKey && o[subKey] && <span className="text-slate-500 text-xs font-mono flex-shrink-0">{o[subKey]}</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Employee selector — grouped by department with multi-dept selection ────────
function EmployeeSelector({ employees, selectedIds, onChange }) {
  const [open, setOpen]               = useState(false);
  const [search, setSearch]           = useState('');
  const [expandedDepts, setExpandedDepts] = useState(new Set());
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Build department → employees map
  const deptMap = {};
  for (const emp of employees) {
    const dept = emp.department || 'No Department';
    if (!deptMap[dept]) deptMap[dept] = [];
    deptMap[dept].push(emp);
  }
  const allDepts = Object.keys(deptMap).sort();

  // Filter employees/departments by search
  const searchLow = search.toLowerCase();
  const filteredDeptMap = {};
  for (const dept of allDepts) {
    const matched = deptMap[dept].filter(
      (e) =>
        e.name.toLowerCase().includes(searchLow) ||
        (e.employee_code || '').toLowerCase().includes(searchLow) ||
        dept.toLowerCase().includes(searchLow)
    );
    if (matched.length > 0) filteredDeptMap[dept] = matched;
  }
  const filteredDepts = Object.keys(filteredDeptMap).sort();

  // Auto-expand depts when searching
  useEffect(() => {
    if (search) setExpandedDepts(new Set(filteredDepts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function toggleEmp(id) {
    const sid = String(id);
    onChange(selectedIds.includes(sid) ? selectedIds.filter((x) => x !== sid) : [...selectedIds, sid]);
  }

  function toggleDept(dept) {
    const ids = (filteredDeptMap[dept] || deptMap[dept] || []).map((e) => String(e.id));
    const allIn = ids.every((id) => selectedIds.includes(id));
    if (allIn) {
      onChange(selectedIds.filter((id) => !ids.includes(id)));
    } else {
      const merged = [...new Set([...selectedIds, ...ids])];
      onChange(merged);
    }
  }

  function selectAll() {
    onChange(employees.map((e) => String(e.id)));
  }

  function deselectAll() {
    onChange([]);
  }

  function toggleExpand(dept) {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      next.has(dept) ? next.delete(dept) : next.add(dept);
      return next;
    });
  }

  function deptState(dept) {
    const ids = (deptMap[dept] || []).map((e) => String(e.id));
    const selected = ids.filter((id) => selectedIds.includes(id));
    if (selected.length === 0) return 'none';
    if (selected.length === ids.length) return 'all';
    return 'partial';
  }

  const allSelected = employees.length > 0 && selectedIds.length === employees.length;

  // Trigger label
  let triggerLabel;
  if (selectedIds.length === 0) {
    triggerLabel = null;
  } else if (allSelected) {
    triggerLabel = <span className="text-blue-300 text-sm font-medium">All {employees.length} employees</span>;
  } else {
    // Summarize by dept
    const deptSummary = [];
    for (const dept of allDepts) {
      const ids = deptMap[dept].map((e) => String(e.id));
      const sel = ids.filter((id) => selectedIds.includes(id));
      if (sel.length === ids.length) deptSummary.push(dept);
    }
    const individualCount = selectedIds.filter((id) => {
      const emp = employees.find((e) => String(e.id) === id);
      if (!emp) return false;
      const dept = emp.department || 'No Department';
      const ids  = deptMap[dept].map((e) => String(e.id));
      return !ids.every((i) => selectedIds.includes(i));
    }).length;

    const parts = [
      ...deptSummary.slice(0, 2).map((d) => (
        <span key={d} className="bg-indigo-700/50 text-indigo-200 text-xs px-2 py-0.5 rounded-full">{d}</span>
      )),
      deptSummary.length > 2 && (
        <span key="more-depts" className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">+{deptSummary.length - 2} depts</span>
      ),
      individualCount > 0 && deptSummary.length === 0 && (
        <span key="indiv" className="bg-blue-700/50 text-blue-200 text-xs px-2 py-0.5 rounded-full">{selectedIds.length} employees</span>
      ),
      individualCount > 0 && deptSummary.length > 0 && (
        <span key="indiv2" className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">+{individualCount} more</span>
      ),
    ].filter(Boolean);

    triggerLabel = <div className="flex flex-wrap gap-1 flex-1 min-w-0">{parts}</div>;
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(''); }}
        className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left min-h-[42px]"
      >
        {triggerLabel || <span className="text-slate-500">— Select employees or departments —</span>}
        <svg className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
          {/* Search + global controls */}
          <div className="p-2.5 border-b border-slate-700 space-y-2">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee or department…"
              className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-500"
            />
            <div className="flex items-center justify-between px-0.5">
              <span className="text-slate-500 text-xs">{selectedIds.length} of {employees.length} selected</span>
              <div className="flex gap-3">
                <button type="button" onClick={selectAll}   className="text-xs text-blue-400 hover:text-blue-300 font-medium">All</button>
                <button type="button" onClick={deselectAll} className="text-xs text-slate-400 hover:text-slate-300 font-medium">None</button>
              </div>
            </div>
          </div>

          {/* Department groups */}
          <div className="max-h-72 overflow-y-auto">
            {filteredDepts.length === 0 ? (
              <p className="text-slate-500 text-sm px-4 py-3">No employees found</p>
            ) : filteredDepts.map((dept) => {
              const deptEmps   = filteredDeptMap[dept];
              const state      = deptState(dept);
              const isExpanded = expandedDepts.has(dept) || !!search;
              const totalInDept   = deptMap[dept].length;
              const selectedInDept = deptMap[dept].filter((e) => selectedIds.includes(String(e.id))).length;

              return (
                <div key={dept} className="border-b border-slate-700/40 last:border-0">
                  {/* Department header row */}
                  <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-slate-700/50 transition-colors">
                    {/* Dept checkbox (select-all for this dept) */}
                    <input
                      type="checkbox"
                      checked={state === 'all'}
                      ref={(el) => { if (el) el.indeterminate = state === 'partial'; }}
                      onChange={() => toggleDept(dept)}
                      className="w-4 h-4 accent-indigo-500 flex-shrink-0 cursor-pointer"
                    />
                    {/* Dept name + count — clicking expands */}
                    <button
                      type="button"
                      onClick={() => toggleExpand(dept)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-indigo-900/40 text-indigo-300 border border-indigo-700/40 truncate max-w-[140px]">
                        {dept}
                      </span>
                      <span className="text-slate-500 text-xs flex-shrink-0">
                        {selectedInDept}/{totalInDept}
                      </span>
                    </button>
                    {/* Expand/collapse chevron */}
                    <button type="button" onClick={() => toggleExpand(dept)} className="p-0.5 text-slate-500 hover:text-slate-300 flex-shrink-0">
                      <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {/* Employees inside department */}
                  {isExpanded && (
                    <div className="bg-slate-900/30">
                      {deptEmps.map((emp) => {
                        const sid     = String(emp.id);
                        const checked = selectedIds.includes(sid);
                        return (
                          <label
                            key={sid}
                            className={`flex items-center gap-3 pl-9 pr-3 py-2 cursor-pointer transition-colors hover:bg-slate-700/60 ${checked ? 'bg-blue-900/20' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleEmp(emp.id)}
                              className="w-3.5 h-3.5 accent-blue-500 flex-shrink-0"
                            />
                            {emp.image_path ? (
                              <img
                                src={`${window.__BACKEND_BASE__ || ''}/${emp.image_path}`}
                                alt={emp.name}
                                className="w-6 h-6 rounded-full object-cover flex-shrink-0 border border-slate-600"
                                onError={(e) => { e.target.style.display = 'none'; }}
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 border border-slate-600">
                                <span className="text-slate-400 text-[9px] font-bold">{emp.name?.[0]?.toUpperCase()}</span>
                              </div>
                            )}
                            <span className="text-white text-sm flex-1 truncate">{emp.name}</span>
                            <span className="text-slate-500 text-xs font-mono flex-shrink-0">{emp.employee_code}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Progress bar per device ───────────────────────────────────────────────────
function DeviceProgressCard({ cameraId, cameraName, deviceIp, progress, total, failures, onRetry, isQueued, retrying }) {
  const [showFails, setShowFails] = useState(false);
  const safeDone = Math.min(progress, total);
  const pct  = total > 0 ? Math.min(100, Math.round((safeDone / total) * 100)) : 0;
  const done = safeDone >= total && total > 0;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isQueued ? 'bg-yellow-400' : done && failures.length === 0 ? 'bg-green-400' : done ? 'bg-orange-400' : 'bg-blue-400 animate-pulse'}`} />
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{cameraName}</p>
            {deviceIp && <p className="text-slate-500 text-xs font-mono">{deviceIp}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-slate-400 text-xs font-mono">{safeDone}/{total}</span>
          {done && failures.length === 0 && (
            <span className="text-green-400 text-xs font-medium">✓ Complete</span>
          )}
          {isQueued && (
            <span className="text-yellow-400 text-xs font-medium">⏳ Queued</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${failures.length > 0 ? 'bg-orange-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {failures.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFails((v) => !v)}
              className="text-xs text-red-400 hover:text-red-300 font-medium"
            >
              {failures.length} failed {showFails ? '▲' : '▼'}
            </button>
            {onRetry && (
              <button
                onClick={() => onRetry(cameraId)}
                disabled={retrying}
                className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {retrying ? 'Retrying…' : 'Retry Failed'}
              </button>
            )}
          </div>
          {showFails && (
            <div className="mt-2 space-y-1 max-h-36 overflow-y-auto">
              {failures.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-red-400 flex-shrink-0">•</span>
                  <span className="text-slate-300 truncate">{f.employee_name}</span>
                  <span className="text-slate-500 flex-shrink-0 truncate max-w-[180px]">{f.error_msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Already-synced conflict modal ─────────────────────────────────────────────
function ConflictModal({ conflicts, totalPairs, onClose, onProceed }) {
  const allConflicted = conflicts.length >= totalPairs;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-semibold text-base">Already Registered</h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {conflicts.length} employee-device pair{conflicts.length !== 1 ? 's' : ''} already synced
            </p>
          </div>
        </div>

        <div className="max-h-48 overflow-y-auto space-y-1 mb-4 pr-1">
          {conflicts.map((c, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 bg-slate-900/60 rounded-lg">
              <span className="text-yellow-400 text-xs flex-shrink-0">•</span>
              <span className="text-white text-sm truncate flex-1">{c.employee_name}</span>
              <span className="text-slate-500 text-xs flex-shrink-0 mx-1">→</span>
              <span className="text-blue-300 text-xs flex-shrink-0 truncate max-w-[120px]">{c.camera_name}</span>
            </div>
          ))}
        </div>

        {allConflicted ? (
          <p className="text-slate-400 text-sm mb-5">
            All selected employees are already registered to the selected device(s). There is nothing new to sync.
          </p>
        ) : (
          <p className="text-slate-400 text-sm mb-5">
            These pairs will be skipped. The remaining{' '}
            <span className="text-white font-semibold">{totalPairs - conflicts.length}</span> pair{totalPairs - conflicts.length !== 1 ? 's' : ''} will be synced.
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
          >
            Cancel
          </button>
          {!allConflicted && (
            <button
              onClick={onProceed}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Sync Remaining ({totalPairs - conflicts.length})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Unsync confirm modal ───────────────────────────────────────────────────────
function UnsyncConfirmModal({ pairs, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-red-700/40 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-semibold text-base">Confirm Unsync</h2>
            <p className="text-slate-400 text-xs mt-0.5">{pairs.length} enrolled pair{pairs.length !== 1 ? 's' : ''} will be removed from devices</p>
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto space-y-1 mb-4 pr-1">
          {pairs.slice(0, 20).map((p, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 bg-slate-900/60 rounded-lg">
              <span className="text-red-400 text-xs flex-shrink-0">—</span>
              <span className="text-white text-sm truncate flex-1">{p.employee_name}</span>
              <span className="text-slate-500 text-xs flex-shrink-0 mx-1">→</span>
              <span className="text-blue-300 text-xs flex-shrink-0 truncate max-w-[120px]">{p.camera_name}</span>
            </div>
          ))}
          {pairs.length > 20 && (
            <p className="text-slate-500 text-xs px-3 py-1">…and {pairs.length - 20} more</p>
          )}
        </div>
        <p className="text-slate-400 text-sm mb-5">
          This will delete their face embeddings from the selected device(s). They can be re-synced at any time.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition-colors">
            Remove from Devices
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Unsync device result card ──────────────────────────────────────────────────
function UnsyncDeviceCard({ cameraName, deviceIp, done, total, failures }) {
  const [showFails, setShowFails] = useState(false);
  const pct  = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const finished = done >= total && total > 0;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${finished && failures.length === 0 ? 'bg-green-400' : finished ? 'bg-orange-400' : 'bg-red-400 animate-pulse'}`} />
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{cameraName}</p>
            {deviceIp && <p className="text-slate-500 text-xs font-mono">{deviceIp}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-xs font-mono">{done}/{total}</span>
          {finished && failures.length === 0 && <span className="text-green-400 text-xs">✓ Removed</span>}
        </div>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2 mb-2">
        <div className={`h-2 rounded-full transition-all duration-300 ${failures.length > 0 ? 'bg-orange-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {failures.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowFails((v) => !v)} className="text-xs text-orange-400 hover:text-orange-300 font-medium">
            {failures.length} failed {showFails ? '▲' : '▼'}
          </button>
          {showFails && (
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {failures.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="text-orange-400 flex-shrink-0">•</span>
                  <span className="text-slate-300 truncate">{f.employee_name}</span>
                  <span className="text-slate-500 truncate max-w-[180px]">{f.error_msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Searchable single-select for history employee filter ──────────────────────
function HistoryEmployeeSelect({ employees, value, onChange }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const selected  = employees.find((e) => String(e.id) === String(value));
  const filtered  = employees.filter((e) =>
    !search ||
    (e.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (e.employee_code || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(''); }}
        className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500 text-left min-h-[38px]"
      >
        {selected ? (
          <span className="text-white truncate">{selected.name} <span className="text-slate-500">({selected.employee_code})</span></span>
        ) : (
          <span className="text-slate-500">All Employees</span>
        )}
        <svg className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-slate-700">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee…"
              className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder-slate-500"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {/* All employees option */}
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-slate-700 ${!value ? 'text-violet-400 bg-slate-700/40' : 'text-slate-400'}`}
            >
              All Employees
            </button>
            {filtered.length === 0 ? (
              <p className="text-slate-500 text-sm px-3 py-2">No results</p>
            ) : filtered.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => { onChange(String(e.id)); setOpen(false); }}
                className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-slate-700 border-b border-slate-700/30 last:border-0 ${String(e.id) === String(value) ? 'bg-violet-900/30 text-violet-300' : 'text-white'}`}
              >
                <span className="font-medium">{e.name}</span>
                <span className="text-slate-500 text-xs ml-2 font-mono">{e.employee_code}</span>
                {e.department && <span className="text-slate-600 text-xs ml-2">{e.department}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SyncEmployees() {
  const [employees,      setEmployees]      = useState([]);
  const [cameras,        setCameras]        = useState([]);
  const [selectedEmps,   setSelectedEmps]   = useState([]);
  const [selectedCams,   setSelectedCams]   = useState([]);
  const [syncing,        setSyncing]        = useState(false);
  const [jobId,          setJobId]          = useState(null);
  const [jobTotal,       setJobTotal]       = useState(0);
  const [deviceProgress, setDeviceProgress] = useState({});
  // { [camera_id]: { done, total, failures: [{employee_name, error_msg}], isQueued } }
  const [recentJobs,     setRecentJobs]     = useState([]);
  const [autoRetryBanner,    setAutoRetryBanner]    = useState(null);
  const [retrying,           setRetrying]           = useState(false);
  const [error,              setError]              = useState(null);
  const [expandedJobId,      setExpandedJobId]      = useState(null);
  const [expandedJobDetail,  setExpandedJobDetail]  = useState(null); // { job, devices }
  const [historyRetryingId,  setHistoryRetryingId]  = useState(null); // jobId being retried from history
  const [conflictData,       setConflictData]       = useState(null); // { conflicts, totalPairs } — shown in modal

  // ── Unsync state ────────────────────────────────────────────────────────────
  const [activeTab,          setActiveTab]          = useState('sync'); // 'sync' | 'unsync' | 'history'
  const [unsyncEmps,         setUnsyncEmps]         = useState([]);
  const [unsyncCams,         setUnsyncCams]         = useState([]);
  const [unsyncing,          setUnsyncing]          = useState(false);
  const [unsyncOpId,         setUnsyncOpId]         = useState(null);
  const [unsyncProgress,     setUnsyncProgress]     = useState({}); // { [camera_id]: { done, total, failures[] } }
  const [unsyncTotal,        setUnsyncTotal]        = useState(0);
  const [unsyncError,        setUnsyncError]        = useState(null);
  const [unsyncConfirmData,  setUnsyncConfirmData]  = useState(null); // pairs to confirm
  // Past unsync operation log — persisted in localStorage
  const [unsyncOpHistory,    setUnsyncOpHistory]    = useState(() => {
    try { return JSON.parse(localStorage.getItem('unsync_op_history') || '[]'); } catch { return []; }
  });

  // ── History state ────────────────────────────────────────────────────────────
  const [historyRows,        setHistoryRows]        = useState([]);
  const [historyTotal,       setHistoryTotal]       = useState(0);
  const [historyPage,        setHistoryPage]        = useState(1);
  const [historyLoading,     setHistoryLoading]     = useState(false);
  const [historyFilters,     setHistoryFilters]     = useState({
    employee_id: '', camera_id: '', from: '', to: '',
  });
  // Expand state: key = "empId_camId", value = [] (loaded) | 'loading' | undefined (not fetched)
  const [expandedHistoryKeys, setExpandedHistoryKeys] = useState(new Set());
  const [historyCycles,       setHistoryCycles]       = useState({});

  // Load employees + cameras on mount
  useEffect(() => {
    getEmployees().then((d) => setEmployees(Array.isArray(d) ? d : d.employees || [])).catch(() => {});
    getCameras().then((d)   => setCameras(Array.isArray(d)   ? d : d.cameras   || [])).catch(() => {});
    getSyncJobs().then((d)  => setRecentJobs(d.jobs || [])).catch(() => {});
  }, []);

  // Socket.IO — real-time progress
  useEffect(() => {
    function onProgress(data) {
      if (data.job_id !== jobId) return;
      setDeviceProgress((prev) => {
        const cam = prev[data.camera_id] || { done: 0, total: 0, failures: [], isQueued: false };
        const newFails = data.status === 'failed'
          ? [...cam.failures, { employee_name: data.employee_name, error_msg: data.error_msg }]
          : cam.failures;
        return {
          ...prev,
          [data.camera_id]: { ...cam, done: cam.done + 1, failures: newFails, isQueued: false },
        };
      });
    }

    function onComplete(data) {
      if (data.job_id !== jobId) return;
      setSyncing(false);
      // Refresh history list and expanded detail
      getSyncJobs().then((d) => setRecentJobs(d.jobs || [])).catch(() => {});
      if (expandedJobId === jobId) {
        getSyncJob(jobId).then((d) => setExpandedJobDetail(d)).catch(() => {});
      }
    }

    function onAutoRetry(data) {
      setAutoRetryBanner(`Auto-retrying ${data.pending_count} tasks for ${data.camera_name}…`);
      setTimeout(() => setAutoRetryBanner(null), 5000);
    }

    socket.on('sync_progress',   onProgress);
    socket.on('sync_complete',   onComplete);
    socket.on('sync_auto_retry', onAutoRetry);
    return () => {
      socket.off('sync_progress',   onProgress);
      socket.off('sync_complete',   onComplete);
      socket.off('sync_auto_retry', onAutoRetry);
    };
  }, [jobId, expandedJobId]);

  // Socket — unsync real-time progress
  useEffect(() => {
    function onUnsyncProgress(data) {
      if (data.operation_id !== unsyncOpId) return;
      setUnsyncProgress((prev) => {
        const cam = prev[data.camera_id] || { done: 0, total: 0, failures: [] };
        const newFails = data.status === 'failed'
          ? [...cam.failures, { employee_name: data.employee_name, error_msg: data.error_msg }]
          : cam.failures;
        return { ...prev, [data.camera_id]: { ...cam, done: cam.done + 1, failures: newFails } };
      });
    }
    function onUnsyncComplete(data) {
      if (data.operation_id !== unsyncOpId) return;
      setUnsyncing(false);
      // Refresh employee list so enrolled_devices reflect removal
      getEmployees().then((d) => setEmployees(Array.isArray(d) ? d : d.employees || [])).catch(() => {});
      // Save to operation history (keep last 20)
      setUnsyncProgress((currentProgress) => {
        const opEntry = {
          id:           data.operation_id,
          ts:           new Date().toISOString(),
          successCount: data.success_count,
          failCount:    data.fail_count,
          total:        data.success_count + data.fail_count,
          cameras:      Object.entries(currentProgress).map(([cid, prog]) => ({
            camera_id:   cid,
            camera_name: prog.cameraName || `Device ${cid}`,
            done:        prog.done,
            total:       prog.total,
            failed:      prog.failures.length,
          })),
        };
        setUnsyncOpHistory((prev) => {
          const next = [opEntry, ...prev].slice(0, 20);
          try { localStorage.setItem('unsync_op_history', JSON.stringify(next)); } catch {}
          return next;
        });
        return currentProgress; // no change to progress
      });
    }
    socket.on('unsync_progress', onUnsyncProgress);
    socket.on('unsync_complete', onUnsyncComplete);
    return () => {
      socket.off('unsync_progress', onUnsyncProgress);
      socket.off('unsync_complete', onUnsyncComplete);
    };
  }, [unsyncOpId]);

  // Unsync: employees that are actually enrolled on at least one selected camera
  const unsyncEligibleEmployees = useCallback(() => {
    if (!unsyncCams.length) return employees;
    return employees.filter((emp) =>
      emp.enrolled_devices?.some((d) => unsyncCams.includes(String(d.camera_id)))
    );
  }, [employees, unsyncCams]);

  const handleStartUnsync = useCallback(() => {
    if (!unsyncEmps.length || !unsyncCams.length) return;
    setUnsyncError(null);

    // Build pairs preview for the confirm modal
    const pairs = [];
    for (const empId of unsyncEmps) {
      const emp = employees.find((e) => String(e.id) === empId);
      if (!emp) continue;
      for (const camId of unsyncCams) {
        if (emp.enrolled_devices?.some((d) => String(d.camera_id) === camId)) {
          const cam = cameras.find((c) => String(c.id) === camId);
          pairs.push({ employee_name: emp.name, camera_name: cam?.name || `Device ${camId}` });
        }
      }
    }
    if (pairs.length === 0) {
      setUnsyncError('None of the selected employees are enrolled on the selected devices.');
      return;
    }
    setUnsyncConfirmData(pairs);
  }, [unsyncEmps, unsyncCams, employees, cameras]);

  const doUnsync = useCallback(async () => {
    setUnsyncConfirmData(null);
    setUnsyncing(true);
    setUnsyncProgress({});

    // Init progress per camera
    const initProgress = {};
    for (const camId of unsyncCams) {
      const count = unsyncEmps.filter((empId) => {
        const emp = employees.find((e) => String(e.id) === empId);
        return emp?.enrolled_devices?.some((d) => String(d.camera_id) === camId);
      }).length;
      if (count > 0) {
        const cam = cameras.find((c) => String(c.id) === camId);
        initProgress[camId] = { done: 0, total: count, failures: [], cameraName: cam?.name, deviceIp: cam?.device_ip };
      }
    }
    setUnsyncProgress(initProgress);

    try {
      const res = await startUnsync({
        employee_ids: unsyncEmps.map(Number),
        camera_ids:   unsyncCams.map(Number),
      });
      setUnsyncOpId(res.operation_id);
      setUnsyncTotal(res.total_tasks);
    } catch (err) {
      const msg = err.response?.status === 409
        ? (err.response?.data?.error || 'None of the selected employees are enrolled on these devices.')
        : (err.message || 'Failed to start unsync.');
      setUnsyncError(msg);
      setUnsyncing(false);
    }
  }, [unsyncEmps, unsyncCams, employees, cameras]);

  // Toggle history row expansion — fetch detail on open
  const handleToggleExpand = useCallback(async (job) => {
    if (expandedJobId === job.id) {
      setExpandedJobId(null);
      setExpandedJobDetail(null);
      return;
    }
    setExpandedJobId(job.id);
    setExpandedJobDetail(null); // loading
    try {
      const detail = await getSyncJob(job.id);
      setExpandedJobDetail(detail);
    } catch {
      setExpandedJobDetail({ error: 'Failed to load job detail.' });
    }
  }, [expandedJobId]);

  // Retry a specific historical job — sets it as the active job and shows live progress
  const handleHistoryRetry = useCallback(async (job) => {
    if (historyRetryingId === job.id || retrying) return;
    setError(null);
    setHistoryRetryingId(job.id);
    try {
      // Fetch current job detail to build initial deviceProgress for the live panel
      const detail = await getSyncJob(job.id);

      // Build deviceProgress from current DB state (failed rows will be retried)
      const initProgress = {};
      for (const dev of (detail.devices || [])) {
        const successCount = dev.tasks.filter((t) => t.status === 'success').length;
        const failedCount  = dev.tasks.filter((t) => t.status === 'failed').length;
        const pendingCount = dev.tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
        initProgress[dev.camera_id] = {
          done:     successCount,           // already done before retry
          total:    dev.tasks.length,
          failures: dev.tasks
            .filter((t) => t.status === 'failed')
            .map((t) => ({ employee_name: t.employee_name, error_msg: t.error_msg })),
          isQueued: pendingCount > 0 && failedCount === 0,
        };
      }

      // Activate this job as the live-tracked job
      setJobId(job.id);
      setJobTotal(detail.job.total_tasks);
      setDeviceProgress(initProgress);
      setSyncing(true);

      // Fire the retry
      await retrySyncJob(job.id);
    } catch (err) {
      const msg = err.response?.status === 409
        ? 'Sync is already in progress — please wait for it to finish.'
        : (err.message || 'Failed to retry.');
      setError(msg);
      setSyncing(false);
    } finally {
      setHistoryRetryingId(null);
    }
  }, [historyRetryingId, retrying]);

  // Offline devices warning
  const offlineCams = cameras.filter(
    (c) => selectedCams.includes(String(c.id)) && c.online_status !== 'online'
  );

  // Core sync starter — called after conflict check clears
  const doStartSync = useCallback(async () => {
    setSyncing(true);

    // Build initProgress — only cameras with at least 1 new (non-already-enrolled) employee
    const initProgress = {};
    for (const camId of selectedCams) {
      const cam         = cameras.find((c) => String(c.id) === camId);
      const newEmpCount = selectedEmps.filter((empId) => {
        const emp = employees.find((e) => String(e.id) === empId);
        return !emp?.enrolled_devices?.some((d) => String(d.camera_id) === camId);
      }).length;
      if (newEmpCount > 0) {
        initProgress[camId] = {
          done:     0,
          total:    newEmpCount,
          failures: [],
          isQueued: cam?.online_status !== 'online',
        };
      }
    }
    // Fallback: if enrolled_devices data is stale, show all cams with all emps
    if (Object.keys(initProgress).length === 0) {
      for (const camId of selectedCams) {
        const cam = cameras.find((c) => String(c.id) === camId);
        initProgress[camId] = { done: 0, total: selectedEmps.length, failures: [], isQueued: cam?.online_status !== 'online' };
      }
    }
    setDeviceProgress(initProgress);

    try {
      const res = await startSync({
        employee_ids: selectedEmps.map(Number),
        camera_ids:   selectedCams.map(Number),
      });
      setJobId(res.job_id);
      setJobTotal(res.total_tasks);
    } catch (err) {
      // Backend 409 means all already enrolled (shouldn't reach here if frontend check ran, but handle it)
      const msg = err.response?.status === 409
        ? (err.response.data?.error || 'All selected employees are already synced to these devices.')
        : (err.message || 'Failed to start sync.');
      setError(msg);
      setSyncing(false);
    }
  }, [selectedEmps, selectedCams, cameras, employees]);

  const handleStartSync = useCallback(() => {
    if (!selectedEmps.length || !selectedCams.length) return;
    setError(null);

    // Detect already-enrolled pairs using local employee data
    const conflicts = [];
    const totalPairs = selectedEmps.length * selectedCams.length;
    for (const empId of selectedEmps) {
      const emp = employees.find((e) => String(e.id) === empId);
      if (!emp) continue;
      for (const camId of selectedCams) {
        const cam = cameras.find((c) => String(c.id) === camId);
        if (emp.enrolled_devices?.some((d) => String(d.camera_id) === camId)) {
          conflicts.push({ employee_name: emp.name, camera_name: cam?.name || `Device ${camId}` });
        }
      }
    }

    if (conflicts.length > 0) {
      setConflictData({ conflicts, totalPairs });
      return;
    }

    doStartSync();
  }, [selectedEmps, selectedCams, cameras, employees, doStartSync]);

  const handleConflictProceed = useCallback(() => {
    setConflictData(null);
    doStartSync();
  }, [doStartSync]);

  const handleRetry = useCallback(async () => {
    if (!jobId || retrying) return;
    setError(null);
    setRetrying(true);
    try {
      await retrySyncJob(jobId);
      // Reset failed entries in UI — subtract failures from done so progress stays accurate
      setDeviceProgress((prev) => {
        const next = { ...prev };
        for (const cid of Object.keys(next)) {
          if (next[cid].failures.length > 0) {
            next[cid] = { ...next[cid], done: Math.max(0, next[cid].done - next[cid].failures.length), failures: [] };
          }
        }
        return next;
      });
      setSyncing(true);
    } catch (err) {
      // 409 = worker already running — show a clear message
      const msg = err.response?.status === 409
        ? 'Sync is already in progress — please wait for it to finish.'
        : (err.message || 'Failed to retry.');
      setError(msg);
    } finally {
      setRetrying(false);
    }
  }, [jobId, retrying]);

  const totalDone     = Object.values(deviceProgress).reduce((s, d) => s + d.done, 0);
  const totalFailed   = Object.values(deviceProgress).reduce((s, d) => s + d.failures.length, 0);
  const hasProgress   = Object.keys(deviceProgress).length > 0;
  const safeTotalDone = Math.min(totalDone, jobTotal);
  const overallPct    = jobTotal > 0 ? Math.min(100, Math.round((safeTotalDone / jobTotal) * 100)) : 0;

  // ── History fetch ────────────────────────────────────────────────────────────
  const HISTORY_LIMIT = 10;

  // Toggle expansion of a history row — fetches all cycles for that pair on first open
  const toggleHistoryExpand = useCallback(async (employeeId, cameraId) => {
    const key = `${employeeId}_${cameraId}`;
    setExpandedHistoryKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); return next; }
      next.add(key);
      return next;
    });
    // Fetch cycles only if not already loaded
    setHistoryCycles((prev) => {
      if (prev[key] !== undefined) return prev;           // already fetched or loading
      // Kick off the fetch and update state when done
      getSyncHistoryCycles({ employee_id: employeeId, camera_id: cameraId })
        .then((data) => setHistoryCycles((p) => ({ ...p, [key]: data.cycles || [] })))
        .catch(() => setHistoryCycles((p) => ({ ...p, [key]: [] })));
      return { ...prev, [key]: 'loading' };               // mark as in-flight
    });
  }, []);

  const fetchHistory = useCallback(async (page = 1, filters = historyFilters) => {
    setHistoryLoading(true);
    // Collapse all expanded rows when fetching new data
    setExpandedHistoryKeys(new Set());
    setHistoryCycles({});
    try {
      const params = { page, limit: HISTORY_LIMIT };
      if (filters.employee_id) params.employee_id = filters.employee_id;
      if (filters.camera_id)   params.camera_id   = filters.camera_id;
      if (filters.from)        params.from         = filters.from;
      if (filters.to)          params.to           = filters.to;
      const data = await getSyncHistory(params);
      setHistoryRows(data.history || []);
      setHistoryTotal(data.total  || 0);
      setHistoryPage(page);
    } catch { /* ignore */ }
    finally { setHistoryLoading(false); }
  }, [historyFilters]);

  // Load history whenever the tab becomes active
  useEffect(() => {
    if (activeTab === 'history') fetchHistory(1, historyFilters);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const unsyncTotalDone = Object.values(unsyncProgress).reduce((s, d) => s + d.done, 0);
  const unsyncTotalFailed = Object.values(unsyncProgress).reduce((s, d) => s + d.failures.length, 0);
  const hasUnsyncProgress = Object.keys(unsyncProgress).length > 0;

  return (
    <div className="min-h-screen bg-slate-900 p-4 lg:p-6">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl lg:text-2xl font-bold text-white">Device Sync</h1>
        <p className="text-slate-400 text-sm mt-1">Push or remove face embeddings on Pi devices</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-5 bg-slate-800 border border-slate-700 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('sync')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'sync' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Sync to Devices
        </button>
        <button
          onClick={() => setActiveTab('unsync')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'unsync' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Unsync from Devices
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'history' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Device History
        </button>
      </div>

      {/* Conflict modal */}
      {conflictData && (
        <ConflictModal
          conflicts={conflictData.conflicts}
          totalPairs={conflictData.totalPairs}
          onClose={() => setConflictData(null)}
          onProceed={handleConflictProceed}
        />
      )}

      {/* Auto-retry banner */}
      {autoRetryBanner && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-blue-900/30 border border-blue-700/50 rounded-xl text-blue-300 text-sm">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          {autoRetryBanner}
        </div>
      )}

      {/* Unsync confirm modal */}
      {unsyncConfirmData && (
        <UnsyncConfirmModal
          pairs={unsyncConfirmData}
          onClose={() => setUnsyncConfirmData(null)}
          onConfirm={doUnsync}
        />
      )}

      {/* ── UNSYNC TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'unsync' && (
        <>
          <div className="bg-slate-800 border border-red-700/30 rounded-xl p-5 mb-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wide">
                  Select Devices first ({unsyncCams.length} selected)
                </label>
                <SearchableMultiSelect
                  selectedIds={unsyncCams}
                  onChange={(ids) => { setUnsyncCams(ids); setUnsyncEmps([]); }}
                  options={cameras}
                  placeholder="— Select devices to unsync from —"
                  labelKey="name"
                  subKey="device_ip"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wide">
                  Select Employees ({unsyncEmps.length} selected)
                  {unsyncCams.length > 0 && (
                    <span className="ml-2 text-red-400 normal-case font-normal">— showing only enrolled employees</span>
                  )}
                </label>
                <EmployeeSelector
                  employees={unsyncEligibleEmployees()}
                  selectedIds={unsyncEmps}
                  onChange={setUnsyncEmps}
                />
              </div>
            </div>

            {unsyncError && (
              <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-700/40 rounded-lg text-red-400 text-sm">{unsyncError}</div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-slate-500 text-xs">
                {unsyncEmps.length > 0 && unsyncCams.length > 0
                  ? `${unsyncEmps.length} employees × ${unsyncCams.length} devices selected`
                  : 'Select devices first, then employees to remove'}
              </p>
              <button
                onClick={handleStartUnsync}
                disabled={unsyncing || !unsyncEmps.length || !unsyncCams.length}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {unsyncing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Removing…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Remove from Devices
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Unsync progress */}
          {hasUnsyncProgress && (
            <div className="mb-6">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white text-sm font-semibold">Removal Progress</span>
                  <span className="text-slate-400 text-xs">{Math.min(unsyncTotalDone, unsyncTotal)}/{unsyncTotal} tasks</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all duration-300 ${unsyncTotalFailed > 0 ? 'bg-orange-500' : 'bg-red-500'}`}
                    style={{ width: `${unsyncTotal > 0 ? Math.min(100, Math.round((Math.min(unsyncTotalDone, unsyncTotal) / unsyncTotal) * 100)) : 0}%` }}
                  />
                </div>
                {!unsyncing && unsyncTotalDone >= unsyncTotal && unsyncTotal > 0 && (
                  <p className={`text-xs mt-1.5 font-medium ${unsyncTotalFailed === 0 ? 'text-green-400' : 'text-orange-400'}`}>
                    {unsyncTotalFailed === 0 ? '✓ All removed successfully' : `${unsyncTotalDone - unsyncTotalFailed} removed, ${unsyncTotalFailed} failed`}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {Object.entries(unsyncProgress).map(([cid, prog]) => {
                  const cam = cameras.find((c) => String(c.id) === cid);
                  return (
                    <UnsyncDeviceCard
                      key={cid}
                      cameraName={cam?.name || `Device ${cid}`}
                      deviceIp={cam?.device_ip}
                      done={prog.done}
                      total={prog.total}
                      failures={prog.failures}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Unsync operation history */}
          {unsyncOpHistory.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                <span className="text-white text-sm font-semibold">Recent Unsync Operations</span>
                <button
                  onClick={() => {
                    setUnsyncOpHistory([]);
                    try { localStorage.removeItem('unsync_op_history'); } catch {}
                  }}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="divide-y divide-slate-700/50">
                {unsyncOpHistory.map((op) => {
                  const date = new Date(op.ts);
                  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                  const allOk = op.failCount === 0;
                  return (
                    <div key={op.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${allOk ? 'bg-green-400' : 'bg-orange-400'}`} />
                          <div className="min-w-0">
                            <p className="text-white text-sm font-medium">
                              {op.successCount} removed
                              {op.failCount > 0 && <span className="text-orange-400 ml-2">{op.failCount} failed</span>}
                              <span className="text-slate-500 font-normal"> of {op.total}</span>
                            </p>
                            <p className="text-slate-500 text-xs mt-0.5">
                              {op.cameras.map((c) => c.camera_name).join(', ')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-slate-400 text-xs">{dateStr}</p>
                          <p className="text-slate-500 text-xs">{timeStr}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── HISTORY TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div>
          {/* Filter bar — all filters auto-apply on change */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Employee filter — searchable, auto-fetches on select */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide">Employee</label>
                <HistoryEmployeeSelect
                  employees={employees}
                  value={historyFilters.employee_id}
                  onChange={(val) => {
                    const next = { ...historyFilters, employee_id: val };
                    setHistoryFilters(next);
                    fetchHistory(1, next);
                  }}
                />
              </div>
              {/* Device filter — auto-fetches on select */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide">Device</label>
                <select
                  value={historyFilters.camera_id}
                  onChange={(e) => {
                    const next = { ...historyFilters, camera_id: e.target.value };
                    setHistoryFilters(next);
                    fetchHistory(1, next);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
                >
                  <option value="">All Devices</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.device_ip ? ` (${c.device_ip})` : ''}</option>
                  ))}
                </select>
              </div>
              {/* From date */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide">From Date</label>
                <input
                  type="date"
                  value={historyFilters.from}
                  onChange={(e) => {
                    const next = { ...historyFilters, from: e.target.value };
                    setHistoryFilters(next);
                    if (e.target.value) fetchHistory(1, next);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
              </div>
              {/* To date */}
              <div>
                <label className="block text-slate-400 text-xs font-medium mb-1.5 uppercase tracking-wide">To Date</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={historyFilters.to}
                    onChange={(e) => {
                      const next = { ...historyFilters, to: e.target.value };
                      setHistoryFilters(next);
                      if (e.target.value) fetchHistory(1, next);
                    }}
                    className="flex-1 bg-slate-900 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                  {/* Clear button inline */}
                  {(historyFilters.employee_id || historyFilters.camera_id || historyFilters.from || historyFilters.to) && (
                    <button
                      onClick={() => {
                        const reset = { employee_id: '', camera_id: '', from: '', to: '' };
                        setHistoryFilters(reset);
                        fetchHistory(1, reset);
                      }}
                      className="px-3 py-2 text-slate-400 hover:text-white text-xs rounded-lg border border-slate-700 hover:border-slate-500 transition-colors flex-shrink-0"
                      title="Clear all filters"
                    >
                      ✕ Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Results table */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
              <span className="text-white text-sm font-semibold">
                Device Enrollment History
                {historyTotal > 0 && (
                  <span className="text-slate-400 font-normal ml-2">
                    ({historyTotal} employee-device pair{historyTotal !== 1 ? 's' : ''})
                  </span>
                )}
              </span>
              <span className="text-slate-500 text-xs">Click a row to see all sync cycles</span>
              {historyLoading && (
                <svg className="w-4 h-4 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              )}
            </div>

            {historyLoading && historyRows.length === 0 ? (
              <div className="px-4 py-10 text-center text-slate-500 text-sm">Loading…</div>
            ) : historyRows.length === 0 ? (
              <div className="px-4 py-10 text-center text-slate-500 text-sm">No history records found.</div>
            ) : (
              <>
                {(() => {
                  // Shared date formatter
                  const fmtDate = (d) => d
                    ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '—';

                  function calcDuration(syncedAt, unsyncedAt) {
                    const endMs  = unsyncedAt ? new Date(unsyncedAt).getTime() : Date.now();
                    const diffMs = endMs - new Date(syncedAt).getTime();
                    if (diffMs <= 0) return '—';
                    const days = Math.floor(diffMs / 86400000);
                    const hrs  = Math.floor((diffMs % 86400000) / 3600000);
                    const mins = Math.floor((diffMs % 3600000) / 60000);
                    if (days > 0) return `${days}d ${hrs}h`;
                    if (hrs > 0)  return `${hrs}h ${mins}m`;
                    return `${mins}m`;
                  }

                  return (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700">
                        <th className="px-4 py-2.5 text-left w-6" />
                        <th className="px-4 py-2.5 text-left">Employee</th>
                        <th className="px-4 py-2.5 text-left">Dept</th>
                        <th className="px-4 py-2.5 text-left">Device</th>
                        <th className="px-4 py-2.5 text-left">Latest Sync</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                        <th className="px-4 py-2.5 text-left">Cycles</th>
                        <th className="px-4 py-2.5 text-left">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row) => {
                        const key       = `${row.employee_id}_${row.camera_id}`;
                        const isExpanded = expandedHistoryKeys.has(key);
                        const isActive  = Number(row.is_active) === 1;
                        const cycles    = historyCycles[key];
                        const hasCycles = Number(row.cycle_count) > 1;

                        // Duration of current/latest enrollment
                        const syncStart = isActive ? row.active_since : row.latest_synced_at;
                        const duration  = calcDuration(syncStart, isActive ? null : row.latest_synced_at);

                        return (
                          <React.Fragment key={key}>
                            {/* ── Main summary row ── */}
                            <tr
                              onClick={() => hasCycles && toggleHistoryExpand(row.employee_id, row.camera_id)}
                              className={`border-b border-slate-700/50 transition-colors ${hasCycles ? 'cursor-pointer hover:bg-slate-700/40' : 'hover:bg-slate-700/20'} ${isExpanded ? 'bg-slate-700/30' : ''}`}
                            >
                              {/* Expand chevron */}
                              <td className="pl-4 py-3 w-6">
                                {hasCycles ? (
                                  <svg
                                    className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                                  </svg>
                                ) : (
                                  <span className="w-3.5 h-3.5 block" />
                                )}
                              </td>
                              {/* Employee */}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {row.image_path ? (
                                    <img
                                      src={`${window.__BACKEND_BASE__ || ''}/${row.image_path}`}
                                      alt={row.employee_name}
                                      className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-slate-600"
                                      onError={(e) => { e.target.style.display = 'none'; }}
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 border border-slate-600">
                                      <span className="text-slate-400 text-xs font-bold">{row.employee_name?.[0]?.toUpperCase()}</span>
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="text-white font-medium truncate">{row.employee_name}</p>
                                    <p className="text-slate-500 text-xs font-mono">{row.employee_code}</p>
                                  </div>
                                </div>
                              </td>
                              {/* Dept */}
                              <td className="px-4 py-3">
                                <span className="text-slate-400 text-xs">{row.department || '—'}</span>
                              </td>
                              {/* Device */}
                              <td className="px-4 py-3">
                                <p className="text-white font-medium">{row.camera_name}</p>
                                {row.device_ip && <p className="text-slate-500 text-xs font-mono">{row.device_ip}</p>}
                              </td>
                              {/* Latest sync date */}
                              <td className="px-4 py-3">
                                <span className="text-slate-300 text-xs whitespace-nowrap">{fmtDate(row.latest_synced_at)}</span>
                              </td>
                              {/* Status */}
                              <td className="px-4 py-3">
                                {isActive ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-900/40 text-green-300 border border-green-700/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                    Active
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-700/60 text-slate-400 border border-slate-600/40">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                    Removed
                                  </span>
                                )}
                              </td>
                              {/* Cycle count badge */}
                              <td className="px-4 py-3">
                                {hasCycles ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-violet-900/40 text-violet-300 border border-violet-700/40 font-medium">
                                    {row.cycle_count}×
                                  </span>
                                ) : (
                                  <span className="text-slate-600 text-xs">1×</span>
                                )}
                              </td>
                              {/* Duration */}
                              <td className="px-4 py-3">
                                <span className={`text-xs font-mono ${isActive ? 'text-green-400' : 'text-slate-400'}`}>{duration}</span>
                                {isActive && <span className="text-slate-600 text-xs ml-1">so far</span>}
                              </td>
                            </tr>

                            {/* ── Expanded sub-rows: all cycles ── */}
                            {isExpanded && (
                              <tr className="border-b border-slate-700/50">
                                <td colSpan={8} className="px-0 py-0">
                                  <div className="bg-slate-900/60 border-l-2 border-violet-600/50 ml-8">
                                    {cycles === 'loading' ? (
                                      <div className="px-6 py-3 text-slate-500 text-xs">Loading cycles…</div>
                                    ) : !cycles || cycles.length === 0 ? (
                                      <div className="px-6 py-3 text-slate-500 text-xs">No cycle data.</div>
                                    ) : (
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-slate-500 uppercase tracking-wide border-b border-slate-700/60">
                                            <th className="px-6 py-2 text-left">#</th>
                                            <th className="px-4 py-2 text-left">Synced At</th>
                                            <th className="px-4 py-2 text-left">Unsynced At</th>
                                            <th className="px-4 py-2 text-left">Status</th>
                                            <th className="px-4 py-2 text-left">Duration</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {cycles.map((c, i) => {
                                            const cIsActive = !c.unsynced_at;
                                            return (
                                              <tr key={c.id} className="border-b border-slate-700/30 last:border-0 hover:bg-slate-800/40">
                                                <td className="px-6 py-2.5 text-slate-600 font-mono">{cycles.length - i}</td>
                                                <td className="px-4 py-2.5 text-slate-300 whitespace-nowrap">{fmtDate(c.synced_at)}</td>
                                                <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{fmtDate(c.unsynced_at)}</td>
                                                <td className="px-4 py-2.5">
                                                  {cIsActive ? (
                                                    <span className="text-green-400 font-semibold">Active</span>
                                                  ) : (
                                                    <span className="text-slate-500">Removed</span>
                                                  )}
                                                </td>
                                                <td className="px-4 py-2.5 font-mono">
                                                  <span className={cIsActive ? 'text-green-400' : 'text-slate-500'}>
                                                    {calcDuration(c.synced_at, c.unsynced_at)}
                                                  </span>
                                                  {cIsActive && <span className="text-slate-600 ml-1">so far</span>}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                  );
                })()}


                {/* Pagination — always visible */}
                {(() => {
                  const totalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_LIMIT));
                  const from = historyTotal === 0 ? 0 : (historyPage - 1) * HISTORY_LIMIT + 1;
                  const to   = Math.min(historyPage * HISTORY_LIMIT, historyTotal);

                  // Build page number buttons: show up to 5 around current page
                  const pages = [];
                  const range = 2;
                  for (let p = Math.max(1, historyPage - range); p <= Math.min(totalPages, historyPage + range); p++) {
                    pages.push(p);
                  }

                  return (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700 flex-wrap gap-2">
                      <span className="text-slate-500 text-xs">
                        {historyTotal === 0 ? 'No records' : `Showing ${from}–${to} of ${historyTotal} records`}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => fetchHistory(1, historyFilters)}
                          disabled={historyPage <= 1 || historyLoading}
                          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 text-xs rounded transition-colors"
                          title="First page"
                        >
                          «
                        </button>
                        <button
                          onClick={() => fetchHistory(historyPage - 1, historyFilters)}
                          disabled={historyPage <= 1 || historyLoading}
                          className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 text-xs rounded transition-colors"
                        >
                          ‹ Prev
                        </button>
                        {pages[0] > 1 && (
                          <span className="text-slate-600 text-xs px-1">…</span>
                        )}
                        {pages.map((p) => (
                          <button
                            key={p}
                            onClick={() => fetchHistory(p, historyFilters)}
                            disabled={historyLoading}
                            className={`px-2.5 py-1 text-xs rounded transition-colors ${
                              p === historyPage
                                ? 'bg-violet-600 text-white font-semibold'
                                : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                        {pages[pages.length - 1] < totalPages && (
                          <span className="text-slate-600 text-xs px-1">…</span>
                        )}
                        <button
                          onClick={() => fetchHistory(historyPage + 1, historyFilters)}
                          disabled={historyPage >= totalPages || historyLoading}
                          className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 text-xs rounded transition-colors"
                        >
                          Next ›
                        </button>
                        <button
                          onClick={() => fetchHistory(totalPages, historyFilters)}
                          disabled={historyPage >= totalPages || historyLoading}
                          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 text-xs rounded transition-colors"
                          title="Last page"
                        >
                          »
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── SYNC TAB ─────────────────────────────────────────────────────────── */}
      {activeTab === 'sync' && (
      <>
      {/* Selection Panel */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wide">
              Select Employees ({selectedEmps.length} selected)
            </label>
            <EmployeeSelector
              employees={employees}
              selectedIds={selectedEmps}
              onChange={setSelectedEmps}
            />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wide">
              Select Devices ({selectedCams.length} selected)
            </label>
            <SearchableMultiSelect
              selectedIds={selectedCams}
              onChange={setSelectedCams}
              options={cameras}
              placeholder="— Select devices —"
              labelKey="name"
              subKey="device_ip"
            />
          </div>
        </div>

        {/* Offline warning */}
        {offlineCams.length > 0 && (
          <div className="mb-4 flex items-start gap-2 px-4 py-3 bg-yellow-900/20 border border-yellow-700/40 rounded-lg text-yellow-300 text-sm">
            <span className="text-yellow-400 flex-shrink-0 mt-0.5">⚠</span>
            <span>
              <strong>{offlineCams.length} device{offlineCams.length > 1 ? 's' : ''} offline</strong>
              {' '}({offlineCams.map((c) => c.name).join(', ')}) — tasks will be queued and auto-retry when they reconnect.
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-900/20 border border-red-700/40 rounded-lg text-red-400 text-sm">{error}</div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-slate-500 text-xs">
            {selectedEmps.length > 0 && selectedCams.length > 0
              ? `${selectedEmps.length} employees × ${selectedCams.length} devices = ${selectedEmps.length * selectedCams.length} tasks`
              : 'Select employees and devices to begin'}
          </p>
          <button
            onClick={handleStartSync}
            disabled={syncing || !selectedEmps.length || !selectedCams.length}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {syncing ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Syncing…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Start Sync
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress Section */}
      {hasProgress && (
        <div className="mb-6">
          {/* Overall */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white text-sm font-semibold">Overall Progress</span>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-xs">{safeTotalDone}/{jobTotal} tasks</span>
                {totalFailed > 0 && !syncing && (
                  <button
                    onClick={handleRetry}
                    disabled={retrying}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {retrying ? 'Retrying…' : `Retry All Failed (${totalFailed})`}
                  </button>
                )}
              </div>
            </div>
            <div className="w-full bg-slate-700 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all duration-300 ${totalFailed > 0 ? 'bg-orange-500' : 'bg-blue-500'}`}
                style={{ width: `${overallPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-slate-500 text-xs">{overallPct}%</span>
              {!syncing && totalDone >= jobTotal && jobTotal > 0 && (
                <span className={`text-xs font-medium ${totalFailed === 0 ? 'text-green-400' : 'text-orange-400'}`}>
                  {totalFailed === 0 ? '✓ All synced successfully' : `${totalDone - totalFailed} success, ${totalFailed} failed`}
                </span>
              )}
            </div>
          </div>

          {/* Per-device cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {Object.entries(deviceProgress).map(([cid, prog]) => {
              const cam = cameras.find((c) => String(c.id) === cid);
              return (
                <DeviceProgressCard
                  key={cid}
                  cameraId={cid}
                  cameraName={cam?.name || `Device ${cid}`}
                  deviceIp={cam?.device_ip}
                  progress={prog.done}
                  total={prog.total}
                  failures={prog.failures}
                  isQueued={prog.isQueued}
                  onRetry={!syncing && prog.failures.length > 0 ? handleRetry : null}
                  retrying={retrying}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Jobs — inside sync tab */}
      {recentJobs.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <h2 className="text-white text-sm font-semibold mb-3">Recent Sync History</h2>
          <div className="space-y-1">
            {recentJobs.slice(0, 10).map((job) => {
              const isExpanded     = expandedJobId === job.id;
              const isActiveJob    = jobId === job.id;
              const isRetryingThis = historyRetryingId === job.id;
              const statusColor    = job.status === 'completed' ? 'text-green-400'
                                   : job.status === 'in_progress' ? 'text-blue-400 animate-pulse'
                                   : 'text-slate-400';
              const createdAt      = new Date(job.created_at).toLocaleString();
              const displayDone    = Math.min(job.done_tasks, job.total_tasks);

              return (
                <div key={job.id} className={`border rounded-lg overflow-hidden transition-colors ${isExpanded ? 'border-blue-700/50 bg-slate-900/50' : 'border-slate-700/50 hover:border-slate-600/50'}`}>
                  {/* Row header — click to expand */}
                  <button
                    type="button"
                    onClick={() => handleToggleExpand(job)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-slate-500 text-xs font-mono flex-shrink-0">#{job.id}</span>
                      <span className={`text-xs font-medium capitalize flex-shrink-0 ${statusColor}`}>{job.status.replace('_', ' ')}</span>
                      <span className="text-slate-400 text-xs flex-shrink-0">{displayDone}/{job.total_tasks} tasks</span>
                      {job.success_count > 0 && <span className="text-green-500 text-xs flex-shrink-0">{job.success_count} ok</span>}
                      {job.fail_count > 0    && <span className="text-red-400 text-xs flex-shrink-0">{job.fail_count} failed</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className="text-slate-600 text-xs hidden sm:block">{createdAt}</span>
                      <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="border-t border-slate-700/50 px-3 pb-3 pt-2">
                      {/* If this job is now being live-tracked, show live progress instead */}
                      {isActiveJob && hasProgress ? (
                        <p className="text-blue-400 text-xs mb-2 animate-pulse">Live progress shown above ↑</p>
                      ) : expandedJobDetail === null ? (
                        <p className="text-slate-500 text-xs py-2">Loading…</p>
                      ) : expandedJobDetail.error ? (
                        <p className="text-red-400 text-xs py-2">{expandedJobDetail.error}</p>
                      ) : (
                        <>
                          {/* Per-device breakdown */}
                          <div className="space-y-2 mb-3">
                            {(expandedJobDetail.devices || []).map((dev) => {
                              const ok  = dev.tasks.filter((t) => t.status === 'success').length;
                              const bad = dev.tasks.filter((t) => t.status === 'failed').length;
                              const pnd = dev.tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
                              const tot = dev.tasks.length;
                              const pct = tot > 0 ? Math.round((ok / tot) * 100) : 0;
                              return (
                                <div key={dev.camera_id} className="bg-slate-800 rounded-lg p-2.5">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div>
                                      <span className="text-white text-xs font-medium">{dev.camera_name}</span>
                                      {dev.device_ip && <span className="text-slate-500 text-xs font-mono ml-2">{dev.device_ip}</span>}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs">
                                      {ok  > 0 && <span className="text-green-400">{ok} ok</span>}
                                      {bad > 0 && <span className="text-red-400">{bad} failed</span>}
                                      {pnd > 0 && <span className="text-yellow-400">{pnd} pending</span>}
                                      <span className="text-slate-500">{ok}/{tot}</span>
                                    </div>
                                  </div>
                                  <div className="w-full bg-slate-700 rounded-full h-1.5">
                                    <div
                                      className={`h-1.5 rounded-full transition-all duration-300 ${bad > 0 ? 'bg-orange-500' : 'bg-blue-500'}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  {/* Failed employee list */}
                                  {bad > 0 && (
                                    <div className="mt-1.5 space-y-0.5 max-h-24 overflow-y-auto">
                                      {dev.tasks.filter((t) => t.status === 'failed').map((t) => (
                                        <div key={t.id} className="flex items-start gap-1.5 text-xs">
                                          <span className="text-red-400 flex-shrink-0">•</span>
                                          <span className="text-slate-300 truncate">{t.employee_name}</span>
                                          {t.error_msg && <span className="text-slate-500 truncate max-w-[160px]">{t.error_msg}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Retry button — only if there are failures */}
                          {job.fail_count > 0 && (
                            <button
                              onClick={() => handleHistoryRetry(job)}
                              disabled={isRetryingThis || syncing || retrying}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              <svg className={`w-3.5 h-3.5 ${isRetryingThis ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              {isRetryingThis ? 'Starting…' : `Retry ${job.fail_count} Failed`}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      </> /* end sync tab */
      )}
    </div>
  );
}