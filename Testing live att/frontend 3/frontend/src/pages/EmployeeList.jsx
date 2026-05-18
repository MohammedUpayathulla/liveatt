import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api, {
  getEmployees,
  getCameras,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  reactivateEmployee,
  getCached,
  invalidateCache,
} from '../services/api.js';
import { socket } from '../services/socket.js';
import cfg from '../config.js';
import * as faceapi from '@vladmandic/face-api';
import MultiAngleFaceUpload from '../components/MultiAngleFaceUpload.jsx';

// ── Face detection utility ────────────────────────────────────────────────
let _faceModelLoaded = false;
let _faceModelLoading = null;

async function _loadFaceModel() {
  if (_faceModelLoaded) return;
  if (_faceModelLoading) return _faceModelLoading;
  _faceModelLoading = faceapi.nets.tinyFaceDetector.loadFromUri('/models/face-api');
  await _faceModelLoading;
  _faceModelLoaded = true;
  _faceModelLoading = null;
}

// Pre-filter: reject blank / solid-color images before running the neural net.
// Draws a 64×64 thumbnail and computes pixel variance — real photos have high
// variance; blank/white/solid images have variance near zero.
function _imagePixelVariance(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const SIZE = 64;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        URL.revokeObjectURL(url);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        let sum = 0, sumSq = 0;
        const n = (SIZE * SIZE);
        for (let i = 0; i < data.length; i += 4) {
          const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
          sum += gray;
          sumSq += gray * gray;
        }
        const mean = sum / n;
        const variance = sumSq / n - mean * mean;
        resolve(variance);
      } catch {
        URL.revokeObjectURL(url);
        resolve(9999); // on error assume non-blank
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(9999); };
    img.src = url;
  });
}

async function detectFaceCount(file) {
  // Reject blank / solid-color images immediately (variance < 300 ≈ near-uniform)
  const variance = await _imagePixelVariance(file);
  if (variance < 300) return 0;

  await _loadFaceModel();
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        const results = await faceapi.detectAllFaces(
          img,
          new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.75, inputSize: 608 })
        );
        URL.revokeObjectURL(url);
        resolve(results.length);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

const BACKEND_BASE = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');

// ── Searchable Single Select ──────────────────────────────────────────────
function SearchableSelect({ value, onChange, options, onAddNew, placeholder = 'Search…' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newVal, setNewVal] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setAddingNew(false); setNewVal(''); } }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function submitNew() {
    const v = newVal.trim();
    if (!v) return;
    onAddNew && onAddNew(v);
    onChange(v);
    setAddingNew(false);
    setNewVal('');
    setOpen(false);
  }

  const filtered = options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));
  const label = value || placeholder;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setSearch(''); setAddingNew(false); }}
        className="w-full flex items-center justify-between bg-slate-900 border border-slate-700 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-left"
      >
        <span className={value ? 'text-white' : 'text-slate-500'}>{label}</span>
        <svg className="w-4 h-4 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          <div className="p-2 border-b border-slate-700">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-slate-500 text-sm px-3 py-2">No results</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => { onChange(o); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-700 transition-colors ${o === value ? 'text-blue-400 bg-slate-700/50' : 'text-white'}`}
                >
                  {o}
                </button>
              ))
            )}
          </div>
          {onAddNew && (
            <div className="border-t border-slate-700">
              {addingNew ? (
                <div className="flex gap-1.5 p-2">
                  <input
                    autoFocus
                    type="text"
                    value={newVal}
                    onChange={(e) => setNewVal(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submitNew()}
                    placeholder="Department name…"
                    className="flex-1 bg-slate-900 border border-blue-500 text-white text-sm rounded-md px-2 py-1.5 focus:outline-none"
                  />
                  <button type="button" onClick={submitNew} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-md">Add</button>
                  <button type="button" onClick={() => { setAddingNew(false); setNewVal(''); }} className="px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded-md">✕</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingNew(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-blue-400 hover:bg-slate-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                  </svg>
                  New Department
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Searchable Multi Select ────────────────────────────────────────────────
function SearchableMultiSelect({ selectedIds, onChange, options, placeholder = 'Select devices…' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggle(id) {
    const sid = String(id);
    onChange(selectedIds.includes(sid) ? selectedIds.filter((x) => x !== sid) : [...selectedIds, sid]);
  }

  function selectAll() {
    onChange(options.map((o) => String(o.id || o._id)));
  }

  function deselectAll() {
    onChange([]);
  }

  const allSelected = options.length > 0 && selectedIds.length === options.length;

  const filtered = options.filter((o) =>
    (o.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (o.location || '').toLowerCase().includes(search.toLowerCase())
  );

  const selectedNames = options.filter((o) => selectedIds.includes(String(o.id || o._id))).map((o) => o.name);

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
          <span className="text-blue-300 text-sm font-medium">All {options.length} devices selected</span>
        ) : (
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {selectedNames.slice(0, 3).map((n) => (
              <span key={n} className="bg-blue-700/50 text-blue-200 text-xs px-2 py-0.5 rounded-full">{n}</span>
            ))}
            {selectedNames.length > 3 && (
              <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">+{selectedNames.length - 3} more</span>
            )}
          </div>
        )}
        <svg className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden">
          {/* Search + Select All */}
          <div className="p-2 border-b border-slate-700 space-y-2">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices…"
              className="w-full bg-slate-900 border border-slate-700 text-white text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-500"
            />
            <div className="flex items-center justify-between px-1">
              <span className="text-slate-500 text-xs">{selectedIds.length} of {options.length} selected</span>
              <button
                type="button"
                onClick={allSelected ? deselectAll : selectAll}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-slate-500 text-sm px-3 py-2">No devices found</p>
            ) : (
              filtered.map((o) => {
                const sid = String(o.id || o._id);
                const checked = selectedIds.includes(sid);
                return (
                  <label
                    key={sid}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-slate-700 ${checked ? 'bg-blue-900/20' : ''}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggle(sid)} className="w-4 h-4 accent-blue-500 flex-shrink-0" />
                    <span className="text-white text-sm flex-1">{o.name}</span>
                    {o.location && <span className="text-slate-500 text-xs font-mono">{o.location}</span>}
                    {o.device_ip && <span className="text-slate-600 text-xs font-mono">{o.device_ip}</span>}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Employee Detail Modal ─────────────────────────────────────────────────
function EmployeeDetailModal({ employee, onClose, onEdit, enrolling }) {
  const imgUrl = employee.image_path ? `${BACKEND_BASE}/${employee.image_path}` : null;
  const [imgError, setImgError] = React.useState(false);

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Large photo area */}
        <div className="relative h-72 bg-slate-900 overflow-hidden">
          {imgUrl && !imgError ? (
            <img
              src={imgUrl}
              alt={employee.name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-900/30 to-slate-900">
              <span className="text-8xl font-bold text-blue-400/40 uppercase select-none">
                {(employee.name || '?').charAt(0)}
              </span>
            </div>
          )}
          {/* Gradient overlay at bottom for readability */}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-800/90 to-transparent" />
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Enrollment badge over bottom of image */}
          <div className="absolute bottom-3 left-4">
            <EnrolledBadge
              enrolled={employee.is_enrolled || employee.face_enrolled || employee.enrolled}
              enrolling={enrolling}
            />
          </div>
        </div>

        {/* Details */}
        <div className="px-5 pt-4 pb-2 space-y-3">
          {/* Name + code */}
          <div>
            <h2 className="text-xl font-bold text-white leading-tight">{employee.name || '—'}</h2>
            <p className="text-slate-400 text-sm font-mono mt-0.5">{employee.employee_code || '—'}</p>
          </div>

          {/* Department */}
          {employee.department && (
            <div className="flex items-center gap-2 text-slate-300 text-sm">
              <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span>{employee.department}</span>
            </div>
          )}

          {/* Enrolled devices */}
          {employee.enrolled_devices?.length > 0 && (
            <div>
              <p className="text-slate-500 text-xs mb-1.5">Enrolled Devices</p>
              <div className="flex flex-wrap gap-1">
                {employee.enrolled_devices.map((d) => (
                  <span
                    key={d.camera_id}
                    className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full border border-slate-600"
                    title={d.device_ip}
                  >
                    {d.camera_name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Registered via + date */}
          <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-700/60">
            <span className="flex items-center gap-1">
              {employee.registered_via === 'device' ? (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                  </svg>
                  Registered via Device
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                  </svg>
                  Registered via Web
                </>
              )}
            </span>
            {employee.created_at && (
              <span>{new Date(employee.created_at).toLocaleDateString()}</span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3">
          <button
            onClick={() => { onClose(); onEdit(); }}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-medium transition-colors"
          >
            Edit Employee
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Enroll Badge ──────────────────────────────────────────────────────────
function EnrolledBadge({ enrolled, enrolling }) {
  if (enrolling) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/40 text-blue-300 border border-blue-700/40">
        <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
        Enrolling…
      </span>
    );
  }
  return enrolled ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/40">
      <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
      Enrolled
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700 text-slate-400 border border-slate-600">
      <span className="w-1.5 h-1.5 bg-slate-500 rounded-full" />
      Not Enrolled
    </span>
  );
}

// ── Enrollment toast notification ──────────────────────────────────────────
function EnrollmentToast({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-3 bg-slate-800 border border-green-700/60 rounded-xl shadow-2xl min-w-[260px] max-w-xs animate-fade-in"
        >
          <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{t.name}</p>
            <p className="text-green-400 text-xs">Enrolled in {t.seconds}s</p>
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-slate-500 hover:text-slate-300 flex-shrink-0 ml-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Validation helpers ────────────────────────────────────────────────────
function validateEmployee(form, { isEdit = false, capturedFile = null, hasCameras = false } = {}) {
  const e = {};

  // Name
  const n = form.name.trim();
  if (!n)                          e.name = 'Full name is required';
  else if (n.length < 2)           e.name = 'At least 2 characters';
  else if (n.length > 60)          e.name = 'Max 60 characters';
  else if (/\s{2,}/.test(n))       e.name = 'Multiple consecutive spaces are not allowed';
  else if (!/^[a-zA-Z\s\-'\.]+$/.test(n)) e.name = "Letters, spaces, hyphens and apostrophes only";

  // Employee Code
  const c = form.employee_code.trim();
  if (!c)               e.employee_code = 'Employee code is required';
  else if (c.length < 2)   e.employee_code = 'At least 2 characters';
  else if (c.length > 20)  e.employee_code = 'Max 20 characters';
  else if (!/^[A-Z0-9_\-]+$/i.test(c)) e.employee_code = 'Letters, numbers, _ and – only (no spaces)';


  // Device — required in Add mode (if devices exist)
  if (!isEdit && hasCameras && form.camera_ids.length === 0)
    e.camera_ids = 'Select at least one device';

  // Face photo — required in Add mode only
  if (!isEdit && !capturedFile)
    e.photo = 'Face photo is required';

  return e;
}

function FieldErr({ msg }) {
  if (!msg) return null;
  return (
    <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
      <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
      {msg}
    </p>
  );
}

function fieldCls(touched, err, extra = '') {
  const base = `w-full bg-slate-900 text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 placeholder-slate-500 border ${extra}`;
  if (!touched) return `${base} border-slate-700 focus:ring-blue-500`;
  if (err)      return `${base} border-red-500 focus:ring-red-500/40`;
  return        `${base} border-green-600 focus:ring-green-500/40`;
}

// ── Employee Modal ────────────────────────────────────────────────────────
function EmployeeModal({ employee, onClose, onSaved, initialImage = null, fromClusterId = null }) {
  const isEdit = !!employee;

  const [form, setForm] = useState({
    name:          employee?.name          || '',
    name_hindi:    employee?.name_hindi    || '',
    employee_code: employee?.employee_code || '',
    department:    employee?.department    || '',
    camera_ids:    [],
  });
  const [cameras, setCamerasLocal] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [capturedFiles, setCapturedFiles] = useState({ straight: null, up: null, down: null, left: null, right: null });
  const existingImageUrl = isEdit && employee?.image_path ? `${BACKEND_BASE}/${employee.image_path}` : null;
  const [previewUrls, setPreviewUrls] = useState({ straight: null, up: null, down: null, left: null, right: null });
  const [saving, setSaving] = useState(false);
  const [faceChecking, setFaceChecking] = useState({});
  const [faceError, setFaceError] = useState({});
  const [touched, setTouched] = useState({});
  const touch = (f) => setTouched((t) => ({ ...t, [f]: true }));
  const [photoMode, setPhotoMode] = useState('upload');
  const [streamActive, setStreamActive] = useState(false);
  const [webcamError, setWebcamError] = useState(null);
  const [videoDevices, setVideoDevices] = useState([]);   // all available cameras
  const [selectedDeviceId, setSelectedDeviceId] = useState(''); // chosen camera deviceId
  const errs = React.useMemo(
    () => validateEmployee(form, { isEdit, capturedFile: Object.values(capturedFiles).some(f => f), hasCameras: cameras.length > 0 }),
    [form, isEdit, capturedFiles, cameras.length]
  );

  // Load cameras + existing departments
  useEffect(() => {
    getCameras()
      .then((data) => {
        const list = Array.isArray(data) ? data : data.cameras || [];
        setCamerasLocal(list);
        // In edit mode, pre-select only cameras this employee is currently enrolled on
        if (isEdit) {
          const enrolledIds = (employee?.enrolled_devices || []).map((d) => String(d.camera_id));
          setForm((f) => ({ ...f, camera_ids: enrolledIds }));
        }
      })
      .catch(() => {});
    // Load unique departments from employees
    getEmployees()
      .then((data) => {
        const list = Array.isArray(data) ? data : data.employees || [];
        const depts = [...new Set(list.map((e) => e.department).filter(Boolean))].sort();
        // Merge with localStorage saved departments
        const saved = JSON.parse(localStorage.getItem('custom_departments') || '[]');
        const merged = [...new Set([...depts, ...saved])].sort();
        setDepartments(merged);
      })
      .catch(() => {});
  }, [isEdit]);

  // Pre-load image passed from the Unknown Persons page
  useEffect(() => {
    if (!initialImage || isEdit) return;
    async function preload() {
      try {
        const resp = await fetch(initialImage);
        const blob = await resp.blob();
        const file = new File([blob], 'unknown-face.jpg', { type: 'image/jpeg' });
        await _processImageFile(file);
      } catch (_) {}
    }
    preload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  async function startWebcam(deviceId) {
    setWebcamError(null);
    setStreamActive(false);
    try {
      // Optimized video constraints for fast streaming
      const videoConstraints = {
        ...(deviceId && { deviceId: { exact: deviceId } }),
        width: { ideal: 640 },  // Optimal for face detection
        height: { ideal: 480 },
        frameRate: { ideal: 30 },  // 30 FPS for smooth playback
        facingMode: 'user'
      };
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });

      // After permission is granted, enumerate all cameras (labels become available)
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === 'videoinput');
      setVideoDevices(inputs);

      // Track which device is actually streaming
      const activeTrack = stream.getVideoTracks()[0];
      const activeId = activeTrack?.getSettings?.()?.deviceId || deviceId || '';
      setSelectedDeviceId(activeId);

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreamActive(true);
    } catch (err) {
      setWebcamError('Camera access denied or not available. Check browser permissions.');
    }
  }

  function stopWebcam() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreamActive(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(async (blob) => {
      stopWebcam();
      const file = new File([blob], 'webcam-capture.jpg', { type: 'image/jpeg' });
      await _processImageFile(file);
    }, 'image/jpeg', 0.92);
  }

  useEffect(() => {
    if (photoMode === 'webcam') startWebcam(selectedDeviceId || undefined);
    else if (photoMode === 'upload') stopWebcam();
    return () => stopWebcam();
  }, [photoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up object URLs
  useEffect(() => {
    return () => {
      Object.values(previewUrls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [previewUrls]);

  // ── File Upload ────────────────────────────────────────────────────────
  async function _processImageFile(file, angle = 'straight') {
    if (!file || !file.type.startsWith('image/')) return;
    setFaceChecking((prev) => ({ ...prev, [angle]: true }));
    setFaceError((prev) => ({ ...prev, [angle]: null }));
    // Show preview immediately so user can see what was picked
    const objUrl = URL.createObjectURL(file);
    setPreviewUrls((prev) => ({ ...prev, [angle]: objUrl }));
    setCapturedFiles((prev) => ({ ...prev, [angle]: null })); // clear until face confirmed
    try {
      const count = await detectFaceCount(file);
      if (count === 0) {
        setFaceError((prev) => ({ ...prev, [angle]: 'No face detected — please upload a clear face photo' }));
        setCapturedFiles((prev) => ({ ...prev, [angle]: null }));
        // keep preview so user can see the rejected image
      } else {
        if (count > 1) {
          setFaceError((prev) => ({ ...prev, [angle]: `${count} faces detected — please upload a photo with only one person` }));
          setCapturedFiles((prev) => ({ ...prev, [angle]: null }));
        } else {
          setFaceError((prev) => ({ ...prev, [angle]: null }));
          setCapturedFiles((prev) => ({ ...prev, [angle]: file }));
        }
      }
    } catch {
      // If model fails to load or detection errors, allow the file anyway
      setFaceError((prev) => ({ ...prev, [angle]: null }));
      setCapturedFiles((prev) => ({ ...prev, [angle]: file }));
    } finally {
      setFaceChecking((prev) => ({ ...prev, [angle]: false }));
    }
  }

  async function handleFileChange(e, angle = 'straight') {
    const file = e.target.files?.[0];
    if (!file) return;
    await _processImageFile(file, angle);
  }

  async function handleDrop(e, angle = 'straight') {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    await _processImageFile(file, angle);
  }

  // ── Save ───────────────────────────────────────────────────────────────
  async function handleSave() {
    setTouched({ name: true, employee_code: true, camera_ids: true, photo: true });
    if (Object.values(faceChecking).some(v => v)) return; // still verifying
    if (Object.values(faceError).some(e => e)) return;    // face check failed
    if (Object.keys(errs).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      // Convert captured files to base64 for Python service
      const images_base64 = [];
      for (const angle of ['straight', 'up', 'down', 'left', 'right']) {
        const file = capturedFiles[angle];
        if (file) {
          const b64 = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(file);
          });
          images_base64.push(b64);
        }
      }

      const fd = new FormData();
      fd.append('name',          form.name);
      fd.append('name_hindi',    form.name_hindi || '');
      fd.append('employee_code', form.employee_code);
      fd.append('department',    form.department);
      form.camera_ids.forEach((cid) => fd.append('camera_ids', cid));
      if (isEdit) fd.append('devices_updated', '1'); // tells backend to sync device assignments
      if (images_base64.length > 0) {
        fd.append('images_base64', JSON.stringify(images_base64));
      }
      if (!isEdit && fromClusterId) fd.append('cluster_id', fromClusterId);

      let result;
      if (isEdit) {
        result = await updateEmployee(employee.id || employee._id, fd);
      } else {
        result = await createEmployee(fd);
      }

      // Tell parent whether Python enrollment will run in background
      // Enrollment happens when: images were provided AND at least one device was selected
      const willEnroll = images_base64.length > 0 && form.camera_ids.length > 0;
      onSaved({ employee: result?.employee, willEnroll });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 modal-overlay">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold text-lg">
            {isEdit ? 'Edit Employee' : 'Add Employee'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Error */}
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-slate-300 text-sm font-medium">Full Name <span className="text-red-400">*</span></label>
              <span className={`text-xs tabular-nums ${form.name.length > 55 ? 'text-red-400' : 'text-slate-500'}`}>
                {form.name.length}/60
              </span>
            </div>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onBlur={() => {
                setForm((f) => ({ ...f, name: f.name.replace(/\s{2,}/g, ' ').trimStart() }));
                touch('name');
              }}
              placeholder="John Doe"
              maxLength={60}
              className={fieldCls(touched.name, errs.name)}
            />
            <FieldErr msg={touched.name && errs.name} />
          </div>

          {/* Employee Code */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-slate-300 text-sm font-medium">Employee Code <span className="text-red-400">*</span></label>
              <span className={`text-xs tabular-nums ${form.employee_code.length > 18 ? 'text-red-400' : 'text-slate-500'}`}>
                {form.employee_code.length}/20
              </span>
            </div>
            <input
              type="text"
              value={form.employee_code}
              onChange={(e) => setForm((f) => ({ ...f, employee_code: e.target.value.toUpperCase() }))}
              onBlur={() => touch('employee_code')}
              placeholder="EMP001"
              maxLength={20}
              className={fieldCls(touched.employee_code, errs.employee_code, 'font-mono tracking-wider')}
            />
            <FieldErr msg={touched.employee_code && errs.employee_code} />
            {!errs.employee_code && !touched.employee_code && (
              <p className="mt-1 text-xs text-slate-500">Letters, numbers, _ and – only. Auto-uppercased.</p>
            )}
          </div>

          {/* Department */}
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">
              Department
            </label>
            <div className={`rounded-lg ${touched.department && errs.department ? 'ring-2 ring-red-500/40' : touched.department && !errs.department ? 'ring-2 ring-green-500/40' : ''}`}>
              <SearchableSelect
                value={form.department}
                onChange={(d) => { setForm((f) => ({ ...f, department: d })); touch('department'); }}
                options={departments}
                placeholder="— Select Department —"
                onAddNew={(d) => {
                  const saved = JSON.parse(localStorage.getItem('custom_departments') || '[]');
                  if (!saved.includes(d)) localStorage.setItem('custom_departments', JSON.stringify([...saved, d].sort()));
                  setDepartments((prev) => [...new Set([...prev, d])].sort());
                  touch('department');
                }}
              />
            </div>
            <FieldErr msg={touched.department && errs.department} />
          </div>

          {/* Device multi-select */}
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">
              Send Embedding to Device(s) {!isEdit && <span className="text-red-400">*</span>}
            </label>
            {cameras.length === 0 ? (
              <p className="text-slate-500 text-xs">No devices configured yet. Add a device in Settings first.</p>
            ) : (
              <div className={`rounded-lg ${touched.camera_ids && errs.camera_ids ? 'ring-2 ring-red-500/40' : touched.camera_ids && !errs.camera_ids ? 'ring-2 ring-green-500/40' : ''}`}>
                <SearchableMultiSelect
                  selectedIds={form.camera_ids}
                  onChange={(ids) => { setForm((f) => ({ ...f, camera_ids: ids })); touch('camera_ids'); }}
                  options={cameras}
                  placeholder="— Select device(s) —"
                />
              </div>
            )}
            <FieldErr msg={touched.camera_ids && errs.camera_ids} />
          </div>

          {/* Multi-Angle Face Photos */}
          <MultiAngleFaceUpload
            capturedFiles={capturedFiles}
            previewUrls={previewUrls}
            faceChecking={faceChecking}
            faceError={faceError}
            touched={touched}
            errs={errs}
            onFileChange={handleFileChange}
            onDrop={handleDrop}
            onRemove={(angle) => {
              setCapturedFiles((prev) => ({ ...prev, [angle]: null }));
              setPreviewUrls((prev) => ({ ...prev, [angle]: null }));
              setFaceError((prev) => ({ ...prev, [angle]: null }));
            }}
            streamActive={streamActive}
            videoRef={videoRef}
            onCapture={(angle) => {
              const video = videoRef.current;
              if (!video) return;
              const canvas = document.createElement('canvas');
              canvas.width = video.videoWidth || 640;
              canvas.height = video.videoHeight || 480;
              canvas.getContext('2d').drawImage(video, 0, 0);
              canvas.toBlob(async (blob) => {
                const file = new File([blob], `${angle}-face.jpg`, { type: 'image/jpeg' });
                await _processImageFile(file, angle);
              }, 'image/jpeg', 0.92);
            }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || Object.values(faceChecking).some(v => v)}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {(saving || Object.values(faceChecking).some(v => v)) && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {Object.values(faceChecking).some(v => v) ? 'Checking faces…' : saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Confirm Delete Modal ──────────────────────────────────────────────────
function DeactivateModal({ employee, onClose, onConfirm, deleting }) {
  // Seed device options from the employee's currently enrolled devices
  const devices = employee?.enrolled_devices || [];
  const [selectedCameraId, setSelectedCameraId] = useState(
    devices.length === 1 ? String(devices[0].camera_id) : ''
  );

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-sm shadow-2xl">
        {/* Header */}
        <div className="p-6 pb-4">
          <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h3 className="text-white font-semibold text-lg text-center mb-1">Deactivate Employee</h3>
          <p className="text-slate-400 text-sm text-center">
            <span className="text-white font-medium">{employee?.name}</span> will be marked inactive.
          </p>
        </div>

        {/* Device selector */}
        <div className="px-6 pb-5">
          <label className="block text-slate-400 text-xs font-medium mb-2 uppercase tracking-wide">
            Remove face data from device
          </label>
          {devices.length === 0 ? (
            <p className="text-slate-500 text-sm py-2">No devices enrolled — only status will be updated.</p>
          ) : (
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 text-slate-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500"
            >
              <option value="">— All devices —</option>
              {devices.map((d) => (
                <option key={d.camera_id} value={String(d.camera_id)}>
                  {d.camera_name}{d.device_ip ? ` (${d.device_ip})` : ''}
                </option>
              ))}
            </select>
          )}
          <p className="text-slate-600 text-xs mt-2">
            {selectedCameraId
              ? 'Employee will be removed only from the selected device.'
              : devices.length > 0
                ? 'Employee will be removed from all enrolled devices.'
                : ''}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selectedCameraId || null)}
            disabled={deleting}
            className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {deleting && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {deleting ? 'Deactivating…' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Employee List Page ────────────────────────────────────────────────────
// ── Bulk Upload Modal ─────────────────────────────────────────────────────────
function BulkUploadModal({ onClose, onDone }) {
  // step: 'guide' | 'upload' | 'results'
  const [step, setStep]           = useState('guide');
  const [files, setFiles]         = useState([]); // { file, name, employee_code, department, preview, matched }
  const [uploading, setUploading] = useState(false);
  const [results, setResults]     = useState(null);
  const [dragOverImg, setDragOverImg] = useState(false);
  const [dragOverXls, setDragOverXls] = useState(false);
  const [excelName, setExcelName] = useState('');
  const imgInputRef = useRef(null);
  const xlsInputRef = useRef(null);

  // ── Sample Excel download (.xlsx with image hints) ───────────────────────
  async function downloadSample() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    // Data rows
    const data = [
      { employee_code: 'EMP001', name: 'John Doe',   department: 'Engineering', image_filename: 'EMP001.jpg' },
      { employee_code: 'EMP002', name: 'Jane Smith', department: 'HR',          image_filename: 'EMP002.jpg' },
      { employee_code: 'EMP003', name: 'Alex Kumar', department: 'Finance',     image_filename: 'EMP003.jpg' },
    ];

    const ws = XLSX.utils.json_to_sheet(data, { header: ['employee_code','name','department','image_filename'] });

    // Column widths
    ws['!cols'] = [
      { wch: 15 }, // employee_code
      { wch: 20 }, // name
      { wch: 15 }, // department
      { wch: 20 }, // image_filename (tip column)
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, 'bulk_upload_sample.xlsx');
  }

  // ── Parse Excel / CSV ────────────────────────────────────────────────────
  async function parseExcel(file) {
    const XLSX = await import('xlsx');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function handleExcelDrop(newFiles) {
    const f = Array.from(newFiles).find((f) =>
      f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv')
    );
    if (!f) return;
    setExcelName(f.name);
    try {
      const rows = await parseExcel(f);
      // Try to match with already-loaded images by filename
      setFiles((prev) => {
        // Build map: employee_code (uppercase, trimmed) → row
        const map = {};
        rows.forEach((r) => {
          const code = String(r['employee_code'] || r['Employee Code'] || r['code'] || '').toUpperCase().trim();
          if (code) map[code] = r;
        });
        if (prev.length === 0) {
          // No images yet — create placeholder rows from Excel only
          return rows.map((r) => ({
            file: null,
            preview: null,
            name: r['name'] || r['Name'] || '',
            employee_code: String(r['employee_code'] || r['Employee Code'] || r['code'] || ''),
            department: r['department'] || r['Department'] || '',
            matched: false,
          }));
        }
        // Merge with existing images: match by filename-without-extension == employee_code
        return prev.map((img) => {
          const fileCode = (img.file?.name || '').replace(/\.[^.]+$/, '').toUpperCase().trim();
          const match = map[fileCode];
          if (!match) return img;
          return {
            ...img,
            name: match['name'] || match['Name'] || img.name,
            employee_code: String(match['employee_code'] || match['Employee Code'] || match['code'] || img.employee_code),
            department: match['department'] || match['Department'] || img.department,
            matched: true,
          };
        });
      });
    } catch { alert('Could not parse the Excel/CSV file.'); }
  }

  function addImageFiles(newFiles) {
    const imgs = Array.from(newFiles).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [
      ...prev,
      ...imgs.map((f) => ({
        file: f,
        name: f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
        employee_code: '',
        department: '',
        preview: URL.createObjectURL(f),
        matched: false,
      })),
    ]);
  }

  function removeFile(idx) {
    setFiles((prev) => {
      if (prev[idx].preview) URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function updateField(idx, key, value) {
    setFiles((prev) => prev.map((f, i) => i === idx ? { ...f, [key]: value } : f));
  }

  async function handleSubmit() {
    const invalid = files.findIndex((f) => !f.name.trim() || !f.employee_code.trim());
    if (invalid >= 0) { alert(`Row ${invalid + 1}: Name and Employee Code are required.`); return; }
    const noImage = files.findIndex((f) => !f.file);
    if (noImage >= 0) { alert(`Row ${noImage + 1}: No image file. Please upload images.`); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('metadata', JSON.stringify(files.map((f) => ({
        name: f.name.trim(),
        employee_code: f.employee_code.trim(),
        department: f.department.trim(),
      }))));
      files.forEach((f) => fd.append('images', f.file));
      const resp = await api.post('/employees/bulk', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const data = resp.data;
      setResults(data);
      setStep('results');
      if (data.summary?.succeeded > 0) onDone();
    } catch (err) { alert('Upload failed: ' + err.message); }
    finally { setUploading(false); }
  }

  const matchedCount = files.filter((f) => f.matched).length;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-white font-semibold">Bulk Upload Employees</h2>
              <p className="text-slate-400 text-xs mt-0.5">Upload images + Excel to register multiple employees at once</p>
            </div>
            {/* Steps */}
            <div className="hidden sm:flex items-center gap-2 ml-4">
              {['guide', 'upload', 'results'].map((s, i) => (
                <React.Fragment key={s}>
                  <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${step === s ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>
                    <span>{i + 1}</span>
                    <span className="capitalize">{s}</span>
                  </div>
                  {i < 2 && <span className="text-slate-600">→</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── STEP 1: Guide ── */}
          {step === 'guide' && (
            <div className="space-y-5">
              <div className="p-4 bg-blue-900/20 border border-blue-700/40 rounded-xl text-sm text-blue-200">
                Follow these steps to bulk-register employees. Download the sample file to see the exact format required.
              </div>

              {/* Steps */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { step: '1', title: 'Prepare Photos', desc: 'Name each photo file with the employee code (e.g. EMP001.jpg, EMP002.jpg). This is the key used to match photos with Excel rows. Use JPG or PNG with a clear front-facing face.', color: 'blue' },
                  { step: '2', title: 'Fill Excel / CSV', desc: 'Fill the sample file — one row per employee. The employee_code column must match the photo filename exactly (e.g. EMP001 → EMP001.jpg).', color: 'purple' },
                  { step: '3', title: 'Upload Both', desc: 'Upload all photos and the filled Excel/CSV together. Data is matched automatically by filename.', color: 'green' },
                ].map(({ step: s, title, desc, color }) => (
                  <div key={s} className={`p-4 rounded-xl border bg-${color}-900/10 border-${color}-700/30`}>
                    <div className={`w-8 h-8 rounded-full bg-${color}-700/30 text-${color}-300 flex items-center justify-center text-sm font-bold mb-3`}>{s}</div>
                    <p className="text-white text-sm font-semibold mb-1">{title}</p>
                    <p className="text-slate-400 text-xs leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>

              {/* Sample file preview */}
              <div>
                <p className="text-slate-300 text-sm font-medium mb-3">Sample Excel / CSV Format</p>
                <div className="overflow-x-auto rounded-xl border border-slate-700">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-700/60">
                        {['employee_code', 'name', 'department'].map((h) => (
                          <th key={h} className="text-left px-4 py-2.5 text-slate-300 font-semibold font-mono">{h}</th>
                        ))}
                        <th className="text-left px-4 py-2.5 text-slate-500 font-semibold text-xs">→ photo file</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['EMP001', 'John Doe',   'Engineering', 'EMP001.jpg'],
                        ['EMP002', 'Jane Smith', 'HR',          'EMP002.jpg'],
                        ['EMP003', 'Alex Kumar', 'Finance',     'EMP003.jpg'],
                      ].map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? 'bg-slate-900/40' : 'bg-slate-800/40'}>
                          <td className="px-4 py-2.5 text-green-400 font-mono font-bold">{row[0]}</td>
                          <td className="px-4 py-2.5 text-slate-200">{row[1]}</td>
                          <td className="px-4 py-2.5 text-slate-200">{row[2]}</td>
                          <td className="px-4 py-2.5 text-blue-400 font-mono text-xs">{row[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-slate-500 text-xs mt-2">
                  <span className="text-yellow-400 font-medium">Note:</span> Photo filename (without extension) must match <span className="font-mono text-green-400">employee_code</span> exactly — e.g. <span className="font-mono text-blue-400">EMP001.jpg</span> matches code <span className="font-mono text-green-400">EMP001</span>. Case-insensitive.
                </p>
              </div>
            </div>
          )}

          {/* ── STEP 2: Upload ── */}
          {step === 'upload' && (
            <>
              {/* Upload zones side by side */}
              <div className="grid grid-cols-2 gap-4">
                {/* Images */}
                <div>
                  <p className="text-slate-300 text-sm font-medium mb-2">
                    Face Photos <span className="text-red-400">*</span>
                    {files.filter((f) => f.file).length > 0 && (
                      <span className="ml-2 text-xs text-green-400">{files.filter((f) => f.file).length} loaded</span>
                    )}
                  </p>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOverImg(true); }}
                    onDragLeave={() => setDragOverImg(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOverImg(false); addImageFiles(e.dataTransfer.files); }}
                    onClick={() => imgInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors h-36 flex flex-col items-center justify-center ${
                      dragOverImg ? 'border-blue-500 bg-blue-900/20' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/20'
                    }`}
                  >
                    <input ref={imgInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => addImageFiles(e.target.files)} />
                    <svg className="w-8 h-8 text-slate-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="text-slate-300 text-xs font-medium">Drop photos here</p>
                    <p className="text-slate-500 text-xs mt-0.5">JPG / PNG</p>
                  </div>
                </div>

                {/* Excel */}
                <div>
                  <p className="text-slate-300 text-sm font-medium mb-2">
                    Excel / CSV File
                    {excelName && <span className="ml-2 text-xs text-green-400 font-mono truncate">{excelName}</span>}
                  </p>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOverXls(true); }}
                    onDragLeave={() => setDragOverXls(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOverXls(false); handleExcelDrop(e.dataTransfer.files); }}
                    onClick={() => xlsInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors h-36 flex flex-col items-center justify-center ${
                      dragOverXls ? 'border-green-500 bg-green-900/20' : excelName ? 'border-green-600/50 bg-green-900/10' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/20'
                    }`}
                  >
                    <input ref={xlsInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleExcelDrop(e.target.files)} />
                    <svg className="w-8 h-8 mb-2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-slate-300 text-xs font-medium">{excelName ? 'Replace Excel/CSV' : 'Drop Excel / CSV'}</p>
                    <p className="text-slate-500 text-xs mt-0.5">.xlsx · .xls · .csv</p>
                  </div>
                </div>
              </div>

              {/* Match status */}
              {excelName && files.length > 0 && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-xs ${matchedCount > 0 ? 'bg-green-900/20 border border-green-700/40 text-green-300' : 'bg-yellow-900/20 border border-yellow-700/40 text-yellow-300'}`}>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={matchedCount > 0 ? 'M5 13l4 4L19 7' : 'M12 9v2m0 4h.01'} />
                  </svg>
                  {matchedCount > 0
                    ? `${matchedCount} of ${files.length} photos matched to Excel data automatically`
                    : 'No filenames matched — fill in details manually or check filenames match the Excel'}
                </div>
              )}

              {/* File rows */}
              {files.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-slate-300 text-sm font-medium">{files.length} employee{files.length !== 1 ? 's' : ''}</p>
                    <button onClick={() => { setFiles([]); setExcelName(''); }} className="text-xs text-slate-500 hover:text-red-400 transition-colors">Clear all</button>
                  </div>
                  <div className="grid grid-cols-[48px_1fr_1fr_1fr_36px] gap-2 px-2">
                    <div /><div className="text-slate-500 text-xs font-medium">Full Name *</div>
                    <div className="text-slate-500 text-xs font-medium">Employee Code *</div>
                    <div className="text-slate-500 text-xs font-medium">Department</div><div />
                  </div>
                  {files.map((f, idx) => (
                    <div key={idx} className={`grid grid-cols-[48px_1fr_1fr_1fr_36px] gap-2 items-center border rounded-lg p-2 ${f.matched ? 'bg-green-900/10 border-green-700/30' : 'bg-slate-900/60 border-slate-700'}`}>
                      {f.preview
                        ? <img src={f.preview} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                        : <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-slate-500 text-xs">?</div>
                      }
                      <input value={f.name} onChange={(e) => updateField(idx, 'name', e.target.value)} placeholder="Full name"
                        className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-500 w-full" />
                      <input value={f.employee_code} onChange={(e) => updateField(idx, 'employee_code', e.target.value)} placeholder="EMP001"
                        className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-500 w-full font-mono" />
                      <input value={f.department} onChange={(e) => updateField(idx, 'department', e.target.value)} placeholder="Engineering"
                        className="bg-slate-800 border border-slate-700 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-500 w-full" />
                      <button onClick={() => removeFile(idx)} className="p-1 text-slate-500 hover:text-red-400 transition-colors rounded">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── STEP 3: Results ── */}
          {step === 'results' && results && (
            <div className="space-y-3">
              <div className="flex items-center gap-6 p-4 bg-slate-900 rounded-xl border border-slate-700">
                <div className="text-center"><div className="text-2xl font-bold text-white">{results.summary?.total || 0}</div><div className="text-slate-400 text-xs">Total</div></div>
                <div className="text-center"><div className="text-2xl font-bold text-green-400">{results.summary?.succeeded || 0}</div><div className="text-slate-400 text-xs">Succeeded</div></div>
                <div className="text-center"><div className="text-2xl font-bold text-red-400">{results.summary?.failed || 0}</div><div className="text-slate-400 text-xs">Failed</div></div>
              </div>
              <div className="space-y-2">
                {(results.results || []).map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${r.success ? 'bg-green-900/20 border-green-700/40' : 'bg-red-900/20 border-red-700/40'}`}>
                    {r.success
                      ? <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                      : <svg className="w-5 h-5 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>}
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-sm font-medium">{r.employee_code}</span>
                      {r.employee && <span className="text-slate-400 text-xs ml-2">— {r.employee.name}</span>}
                      {r.error && <span className="text-red-400 text-xs ml-2">{r.error}</span>}
                    </div>
                    <span className={`text-xs font-semibold ${r.success ? 'text-green-400' : 'text-red-400'}`}>
                      {r.success ? (r.employee?.face_enrolled ? 'Enrolled' : 'Added') : 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-700 flex-shrink-0">
          <div className="flex gap-2">
            {step === 'guide' && (
              <button onClick={downloadSample} className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download Sample CSV
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors">
              {step === 'results' ? 'Close' : 'Cancel'}
            </button>
            {step === 'guide' && (
              <button onClick={() => setStep('upload')} className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg flex items-center gap-2">
                Next — Upload Files
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}
            {step === 'upload' && (
              <>
                <button onClick={() => setStep('guide')} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg">← Back</button>
                <button
                  onClick={handleSubmit}
                  disabled={uploading || files.length === 0}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2"
                >
                  {uploading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {uploading ? `Uploading…` : `Upload ${files.length} Employee${files.length !== 1 ? 's' : ''}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function EmployeeList() {
  // Pre-filled image (and optional cluster_id) passed from Unknown Persons page via router state
  const location       = useLocation();
  const _prefilledImg  = location.state?.prefilledImage || null;
  const _fromClusterId = location.state?.fromClusterId  || null;
  const [prefilledImage, setPrefilledImage] = useState(_prefilledImg);
  const [fromClusterId,  setFromClusterId]  = useState(_fromClusterId);

  // Seed from pre-warmed cache — renders list immediately without skeleton
  const _cachedEmp = getCached('employees:{}');
  const [employees, setEmployees] = useState(() => {
    const d = _cachedEmp;
    return Array.isArray(d) ? d : (d?.employees || []);
  });
  const [loading, setLoading] = useState(!_cachedEmp);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const [showAddModal, setShowAddModal]     = useState(!!_prefilledImg);
  const [showBulkModal, setShowBulkModal]   = useState(false);
  const [editEmployee, setEditEmployee]     = useState(null);
  const [viewEmployee, setViewEmployee]     = useState(null);
  const [deleteEmployee_state, setDeleteEmployee] = useState(null);
  const [deleting, setDeleting]             = useState(false);

  // Track employees currently being enrolled in background (Python push running)
  const [enrollingIds, setEnrollingIds]     = useState(new Set());
  // Toast notifications: { id, name, seconds }
  const [enrollToasts, setEnrollToasts]     = useState([]);

  // ── Export employees to Excel with face photo thumbnails ─────────────────
  async function exportEmployees() {
    const XLSX = await import('xlsx');
    const wb   = XLSX.utils.book_new();

    const backendBase = BACKEND_BASE;

    // Build rows — fetch each image as base64 for embedding
    const rows = await Promise.all(
      employees.map(async (emp) => {
        let photo = '';
        if (emp.image_path) {
          try {
            const imgUrl  = `${backendBase}/${emp.image_path}`;
            const resp    = await fetch(imgUrl);
            const buf     = await resp.arrayBuffer();
            const base64  = btoa(String.fromCharCode(...new Uint8Array(buf)));
            photo = `data:image/jpeg;base64,${base64}`;
          } catch (_) {}
        }
        return {
          'Employee Code': emp.employee_code,
          'Name':          emp.name,
          'Department':    emp.department || '',
          'Face Enrolled': emp.face_enrolled ? 'Yes' : 'No',
          'Joined':        emp.created_at ? new Date(emp.created_at).toLocaleDateString() : '',
          '_photo':        photo,
        };
      })
    );

    // Sheet without photo column (xlsm doesn't support true img embedding via SheetJS free)
    const sheetRows = rows.map(({ _photo, ...rest }) => rest);
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws['!cols'] = [{ wch: 15 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, `employees_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  // silent=true → background refresh (no loading spinner, no skeleton flash)
  const fetchEmployees = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const data = await getEmployees();
      setEmployees(Array.isArray(data) ? data : data.employees || []);
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  useEffect(() => {
    socket.on('employee_updated', (data) => {
      // Force-bypass the cache so we always get fresh data from DB
      invalidateCache('employees:{}');
      fetchEmployees(true); // silent — no loading flash

      // Enrollment just completed — log timing and show toast
      if (data?.enrollment_time_ms != null && data.face_enrolled) {
        const seconds = (data.enrollment_time_ms / 1000).toFixed(1);
        console.log(`[Enrollment] ${data.name || 'Employee'} (${data.employee_code || ''}) enrolled in ${seconds}s`);

        const toastId = Date.now();
        setEnrollToasts((prev) => [...prev, { id: toastId, name: data.name || 'Employee', seconds }]);
        setTimeout(() => {
          setEnrollToasts((prev) => prev.filter((t) => t.id !== toastId));
        }, 6000);
      }

      // Always clear enrolling spinner for this employee (whether timing is present or not)
      if (data?.id) {
        setEnrollingIds((prev) => {
          const next = new Set(prev);
          next.delete(data.id);
          return next;
        });
      }
    });

    return () => {
      socket.off('employee_updated');
    };
  }, [fetchEmployees]);

  const [currentPage, setCurrentPage] = React.useState(1);
  const [enrollFilter, setEnrollFilter] = React.useState('all'); // 'all' | 'enrolled' | 'not_enrolled'
  const [deptFilter,   setDeptFilter]   = React.useState('');
  const [deviceFilter, setDeviceFilter] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState(''); // '' | 'web' | 'device'
  const PAGE_SIZE = 10;

  // Derive unique department options from employees list
  const deptOptions = React.useMemo(() => {
    const set = new Set();
    employees.forEach((e) => { if (e.department) set.add(e.department); });
    return Array.from(set).sort();
  }, [employees]);

  // Derive unique device name options from enrolled_devices
  const deviceOptions = React.useMemo(() => {
    const set = new Set();
    employees.forEach((e) => (e.enrolled_devices || []).forEach((d) => { if (d.camera_name) set.add(d.camera_name); }));
    return Array.from(set).sort();
  }, [employees]);

  const filtered = employees.filter((emp) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(emp.name || '').toLowerCase().includes(q) && !(emp.employee_code || '').toLowerCase().includes(q)) return false;
    }
    if (enrollFilter === 'active'       &&  emp.status === 'inactive')  return false;
    if (enrollFilter === 'inactive'     &&  emp.status !== 'inactive')  return false;
    if (enrollFilter === 'enrolled'     && (!emp.face_enrolled || emp.status === 'inactive')) return false;
    if (enrollFilter === 'not_enrolled' && ( emp.face_enrolled || emp.status === 'inactive')) return false;
    if (deptFilter   && emp.department !== deptFilter) return false;
    if (deviceFilter && !(emp.enrolled_devices || []).some((d) => d.camera_name === deviceFilter)) return false;
    if (sourceFilter === 'web'    && emp.registered_via !== 'web')    return false;
    if (sourceFilter === 'device' && emp.registered_via !== 'device') return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset to page 1 when any filter changes
  React.useEffect(() => { setCurrentPage(1); }, [search, enrollFilter, deptFilter, deviceFilter, sourceFilter]);

  async function handleDelete(cameraId) {
    if (!deleteEmployee_state) return;
    setDeleting(true);
    try {
      await deleteEmployee(deleteEmployee_state.id || deleteEmployee_state._id, cameraId || null);
      setDeleteEmployee(null);
      fetchEmployees();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleReactivate(emp) {
    try {
      await reactivateEmployee(emp.id || emp._id);
      fetchEmployees();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 lg:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl lg:text-2xl font-bold text-white truncate">Employee List</h1>
          <p className="text-slate-400 text-xs lg:text-sm mt-0.5">{employees.length} employees registered</p>
        </div>
        <div className="flex items-center gap-1.5 lg:gap-2 flex-shrink-0">
          <button
            onClick={exportEmployees}
            className="flex items-center gap-1.5 px-2.5 lg:px-4 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-xs lg:text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-1.5 px-2.5 lg:px-4 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-xs lg:text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="hidden sm:inline">Bulk Upload</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-2.5 lg:px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs lg:text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add Employee</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-full max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M21 21l-4.35-4.35M16.65 16.65A7 7 0 1116.65 2.65a7 7 0 010 14z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
          />
        </div>
        <select
          value={enrollFilter}
          onChange={(e) => setEnrollFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="enrolled">Enrolled</option>
          <option value="not_enrolled">Not Enrolled</option>
        </select>
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Departments</option>
          {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Devices</option>
          {deviceOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Sources</option>
          <option value="web">Web</option>
          <option value="device">Device</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                <th className="text-left text-slate-400 font-medium px-4 py-3 w-12">S.No</th>
                <th className="text-left text-slate-400 font-medium px-4 py-3">Employee</th>
                <th className="text-left text-slate-400 font-medium px-4 py-3">Code</th>
                <th className="text-left text-slate-400 font-medium px-4 py-3">Department</th>
                <th className="text-left text-slate-400 font-medium px-4 py-3">Status</th>
                <th className="text-left text-slate-400 font-medium px-4 py-3">Registered Via</th>
                <th className="text-left text-slate-400 font-medium px-4 py-3">Devices</th>
                <th className="text-right text-slate-400 font-medium px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'}>
                    <td className="px-4 py-3"><div className="h-4 w-6 bg-slate-700 rounded animate-pulse" /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-700 animate-pulse" />
                        <div className="h-4 w-32 bg-slate-700 rounded animate-pulse" />
                      </div>
                    </td>
                    {[1, 2, 3, 4].map((j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-slate-700 rounded animate-pulse" style={{ width: '70%' }} />
                      </td>
                    ))}
                  </tr>
                ))}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-500">
                    {search ? 'No employees match your search.' : 'No employees found. Add one to get started.'}
                  </td>
                </tr>
              )}

              {!loading &&
                paginated.map((emp, idx) => (
                  <tr
                    key={emp.id || emp._id}
                    onClick={() => setViewEmployee(emp)}
                    className={`border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors cursor-pointer ${
                      idx % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'
                    } ${emp.status === 'inactive' ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 text-slate-500 text-sm font-mono">
                      {(currentPage - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {emp.image_path ? (
                          <img
                            src={`${BACKEND_BASE}/${emp.image_path}`}
                            alt={emp.name}
                            className="w-9 h-9 rounded-full object-cover border border-slate-600 flex-shrink-0"
                            loading="lazy"
                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                          />
                        ) : null}
                        <div className={`w-9 h-9 rounded-full bg-blue-600/20 border border-blue-500/20 items-center justify-center text-blue-400 text-sm font-semibold flex-shrink-0 uppercase ${emp.image_path ? 'hidden' : 'flex'}`}>
                          {(emp.name || '?').charAt(0)}
                        </div>
                        <span className="text-white font-medium">{emp.name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono text-xs">
                      {emp.employee_code || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {emp.department || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {emp.status === 'inactive' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-700/60 text-slate-400 border border-slate-600/50">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                          Inactive
                        </span>
                      ) : (
                        <EnrolledBadge enrolled={emp.is_enrolled || emp.face_enrolled || emp.enrolled} enrolling={enrollingIds.has(emp.id)} />
                      )}
                    </td>
                    {/* Registered Via */}
                    <td className="px-4 py-3">
                      {emp.registered_via === 'device' ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-900/40 text-purple-300 border border-purple-700/50 w-fit">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                            </svg>
                            Device
                          </span>
                          {emp.registered_device_name && (
                            <span className="text-slate-500 text-[11px] pl-1">{emp.registered_device_name}</span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/40 text-blue-300 border border-blue-700/50">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                          </svg>
                          Web
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {emp.enrolled_devices?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {emp.enrolled_devices.slice(0, 3).map((d) => (
                            <span
                              key={d.camera_id}
                              className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full border border-slate-600 truncate max-w-[80px]"
                              title={d.device_ip}
                            >
                              {d.camera_name}
                            </span>
                          ))}
                          {emp.enrolled_devices.length > 3 && (
                            <span className="bg-slate-700 text-slate-400 text-xs px-2 py-0.5 rounded-full">
                              +{emp.enrolled_devices.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditEmployee(emp); }}
                          className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {emp.status === 'inactive' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReactivate(emp); }}
                            className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                            title="Activate employee"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteEmployee(emp); }}
                            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Deactivate employee"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-slate-500 text-sm">
            Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} employees
          </p>
          <div className="flex items-center gap-1">
            {/* Previous */}
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
              </svg>
              Prev
            </button>

            {/* Window of 3 pages: prev, current, next (clamped to valid range) */}
            {(() => {
              const start = Math.max(1, Math.min(currentPage - 1, totalPages - 2));
              const end   = Math.min(totalPages, start + 2);
              return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((pg) => (
                <button
                  key={pg}
                  onClick={() => setCurrentPage(pg)}
                  className={`w-9 py-1.5 rounded-lg text-sm border transition-colors font-medium ${
                    pg === currentPage
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {pg}
                </button>
              ));
            })()}

            {/* Next */}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {viewEmployee && (
        <EmployeeDetailModal
          employee={viewEmployee}
          enrolling={enrollingIds.has(viewEmployee.id)}
          onClose={() => setViewEmployee(null)}
          onEdit={() => setEditEmployee(viewEmployee)}
        />
      )}
      {showAddModal && (
        <EmployeeModal
          initialImage={prefilledImage}
          fromClusterId={fromClusterId}
          onClose={() => { setShowAddModal(false); setPrefilledImage(null); setFromClusterId(null); }}
          onSaved={({ employee, willEnroll } = {}) => {
            fetchEmployees();
            setPrefilledImage(null);
            setFromClusterId(null);
            if (willEnroll && employee?.id) {
              setEnrollingIds((prev) => new Set([...prev, employee.id]));
            }
          }}
        />
      )}
      {editEmployee && (
        <EmployeeModal
          employee={editEmployee}
          onClose={() => setEditEmployee(null)}
          onSaved={({ employee, willEnroll } = {}) => {
            fetchEmployees();
            if (willEnroll && employee?.id) {
              setEnrollingIds((prev) => new Set([...prev, employee.id]));
            }
          }}
        />
      )}
      {deleteEmployee_state && (
        <DeactivateModal
          employee={deleteEmployee_state}
          onClose={() => setDeleteEmployee(null)}
          onConfirm={handleDelete}
          deleting={deleting}
        />
      )}
      {showBulkModal && (
        <BulkUploadModal
          onClose={() => setShowBulkModal(false)}
          onDone={() => { fetchEmployees(); }}
        />
      )}

      {/* Enrollment toast notifications */}
      <EnrollmentToast
        toasts={enrollToasts}
        onDismiss={(id) => setEnrollToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
