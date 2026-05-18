import React, { useEffect, useState, useCallback } from 'react';
import {
  getCameras,
  createCamera,
  updateCamera,
  deleteCamera,
  getSettings,
  saveSettings,
  getCached,
  pushCameraConfig,
  pushCameraROI,
} from '../services/api.js';
import { socket, CAMERAS_UPDATED } from '../services/socket.js';
import ROIDrawer from '../components/ROIDrawer.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────
function calcWorkingHours(startTime, endTime) {
  if (!startTime || !endTime) return 8;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin   = eh * 60 + em;
  const diff = endMin - startMin;
  return diff > 0 ? parseFloat((diff / 60).toFixed(1)) : 8;
}

// ── Toggle Switch ─────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 flex-shrink-0 ${
        checked ? 'bg-green-500' : 'bg-slate-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

// ── Shared device validation + UI helpers ─────────────────────────────────
function validateDevice(form) {
  const e = {};
  const id = form.device_id.trim();
  if (!id)               e.device_id = 'Device ID is required';
  else if (id.length < 2)   e.device_id = 'At least 2 characters';
  else if (id.length > 30)  e.device_id = 'Max 30 characters';
  else if (!/^[A-Z0-9_\-]+$/i.test(id)) e.device_id = 'Letters, numbers, _ and – only (no spaces)';

  const nm = form.name.trim();
  if (!nm)               e.name = 'Device name is required';
  else if (nm.length < 2)   e.name = 'At least 2 characters';
  else if (nm.length > 60)  e.name = 'Max 60 characters';

  const ip = form.device_ip.trim();
  if (!ip)
    e.device_ip = 'Device IP is required';
  else if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip))
    e.device_ip = 'Invalid IP format (e.g. 192.168.1.100)';
  else if (ip.split('.').map(Number).some((n) => n > 255))
    e.device_ip = 'Each octet must be 0–255';

  const rtsp = form.rtsp_url.trim();
  if (!rtsp)
    e.rtsp_url = 'RTSP URL is required';
  else if (!rtsp.startsWith('rtsp://'))
    e.rtsp_url = 'Must start with rtsp://';

  return e;
}

function DevFieldErr({ msg }) {
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

function devFieldCls(touched, err, extra = '') {
  const base = `w-full bg-slate-900 text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 placeholder-slate-500 border ${extra}`;
  if (!touched) return `${base} border-slate-700 focus:ring-blue-500`;
  if (err)      return `${base} border-red-500 focus:ring-red-500/40`;
  return        `${base} border-green-600 focus:ring-green-500/40`;
}

// ── Add Camera Modal ──────────────────────────────────────────────────────
function AddCameraModal({ onClose, onSaved, prefill = null }) {
  const isAddStream = !!(prefill?.device_ip || prefill?.device_id);
  const [form, setForm] = useState({
    device_id: prefill?.device_id || '',
    device_ip: prefill?.device_ip || '',
    name: '',
    rtsp_url: '',
    mode: 'in',
    threshold: '',
    useCustomThreshold: false,
    enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [touched, setTouched] = useState({});
  const touch = (f) => setTouched((t) => ({ ...t, [f]: true }));
  const errs = React.useMemo(() => validateDevice(form), [form]);
  function handleDeviceIpChange(ip) {
    setForm((f) => ({ ...f, device_ip: ip }));
  }

  function handleRtspChange(val) {
    setForm((f) => ({ ...f, rtsp_url: val }));
  }

  async function handleSave() {
    setTouched({ device_id: true, name: true, device_ip: true, rtsp_url: true });
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      // 1. Save to DB
      await createCamera({
        name:        form.name,
        rtsp_url:    form.rtsp_url.trim() || '',
        location:    form.device_id,
        device_ip:   form.device_ip.trim() || null,
        camera_type: form.mode,
        threshold:   form.useCustomThreshold ? parseFloat(form.threshold) : null,
        status:      form.enabled ? 'active' : 'inactive',
      });

      // 2. Push config to Python (best-effort)
      try {
        await pushCameraConfig({
          device_id:     form.device_id,
          device_ip:     form.device_ip,
          device_name:   form.name,
          rtsp_url:      form.rtsp_url.trim() || '',
          mode:          form.mode,
          threshold:     form.useCustomThreshold ? parseFloat(form.threshold) : null,
          enable_device: form.enabled,
        });
      } catch (_) { /* Python unreachable — DB save succeeded anyway */ }

      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">{isAddStream ? 'Add RTSP Stream' : 'Add Device'}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
          )}

          {isAddStream && (
            <div className="p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg text-blue-300 text-xs flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Adding a new RTSP stream to the same device. Device ID and IP are pre-filled — enter a unique stream name and RTSP URL.
            </div>
          )}

          {/* Device ID + Device IP (side by side) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-1.5">
                Device ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.device_id}
                onChange={(e) => setForm((f) => ({ ...f, device_id: e.target.value }))}
                onBlur={() => touch('device_id')}
                placeholder="pi_cam_01"
                maxLength={30}
                className={devFieldCls(touched.device_id, errs.device_id, 'font-mono')}
              />
              <DevFieldErr msg={touched.device_id && errs.device_id} />
            </div>
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-1.5">
                Device IP <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.device_ip}
                onChange={(e) => handleDeviceIpChange(e.target.value)}
                onBlur={() => touch('device_ip')}
                placeholder="192.168.1.100"
                className={devFieldCls(touched.device_ip, errs.device_ip, 'font-mono')}
              />
              <DevFieldErr msg={touched.device_ip && errs.device_ip} />
            </div>
          </div>

          {/* Device Name */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-slate-300 text-sm font-medium">
                Device Name <span className="text-red-400">*</span>
              </label>
              <span className={`text-xs tabular-nums ${form.name.length > 55 ? 'text-red-400' : 'text-slate-500'}`}>
                {form.name.length}/60
              </span>
            </div>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onBlur={() => touch('name')}
              placeholder="Front Entrance Camera"
              maxLength={60}
              className={devFieldCls(touched.name, errs.name)}
            />
            <DevFieldErr msg={touched.name && errs.name} />
          </div>

          {/* Mode */}
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">Camera Mode</label>
            <div className="flex gap-2">
              {[
                { value: 'in',   label: 'IN',       desc: 'First detection only' },
                { value: 'out',  label: 'OUT',       desc: 'Always mark as OUT' },
                { value: 'both', label: 'IN & OUT',  desc: 'First IN, then OUT' },
              ].map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, mode: m.value }))}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${
                    form.mode === m.value
                      ? m.value === 'in'   ? 'bg-green-700/40 border-green-500 text-green-300'
                      : m.value === 'out'  ? 'bg-red-700/40 border-red-500 text-red-300'
                      :                      'bg-blue-700/40 border-blue-500 text-blue-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  <div className="font-bold">{m.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* RTSP URL */}
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">
              RTSP URL <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.rtsp_url}
              onChange={(e) => handleRtspChange(e.target.value)}
              onBlur={() => touch('rtsp_url')}
              placeholder={form.device_ip ? `rtsp://${form.device_ip}:554/stream` : 'rtsp://192.168.1.x:554/stream'}
              className={devFieldCls(touched.rtsp_url, errs.rtsp_url, 'font-mono')}
            />
            <DevFieldErr msg={touched.rtsp_url && errs.rtsp_url} />
          </div>

          {/* Threshold */}
          <div className="bg-slate-900/60 rounded-xl p-4 space-y-3 border border-slate-700/50">
            <div className="flex items-center justify-between">
              <label className="text-slate-300 text-sm font-medium">Recognition Threshold</label>
              <Toggle
                checked={form.useCustomThreshold}
                onChange={(v) => setForm((f) => ({ ...f, useCustomThreshold: v, threshold: v ? '0.45' : '' }))}
              />
            </div>
            {form.useCustomThreshold ? (
              <>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min="0.10" max="0.90" step="0.05"
                    value={parseFloat(form.threshold) || 0.45}
                    onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
                    className="flex-1 h-2 bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-500"
                  />
                  <span className="text-blue-400 font-mono text-sm font-bold w-10 text-right">
                    {parseFloat(form.threshold || 0.45).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-500 text-xs">
                  <span>0.10 lenient</span><span>0.90 strict</span>
                </div>
              </>
            ) : (
              <p className="text-slate-500 text-xs">Using global threshold from System Settings.</p>
            )}
          </div>

          {/* Enable */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-slate-300 text-sm font-medium">Enable Device</p>
              <p className="text-slate-500 text-xs mt-0.5">Activate stream processing on save</p>
            </div>
            <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2"
          >
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : isAddStream ? 'Add Stream' : 'Add Device'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Camera Modal ─────────────────────────────────────────────────────
function EditCameraModal({ camera, onClose, onSaved }) {
  const camId = camera.id || camera._id;
  const [form, setForm] = useState({
    device_id:          camera.location     || '',
    device_ip:          camera.device_ip    || '',
    name:               camera.name         || '',
    rtsp_url:           camera.rtsp_url     || '',
    mode:               camera.camera_type  || 'in',
    useCustomThreshold: camera.threshold != null,
    threshold:          camera.threshold != null ? camera.threshold : 0.45,
    enabled:            camera.status === 'active',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);
  const [touched, setTouched] = useState({});
  const touch = (f) => setTouched((t) => ({ ...t, [f]: true }));
  const errs = React.useMemo(() => validateDevice(form), [form]);

  async function handleSave() {
    setTouched({ device_id: true, name: true, device_ip: true, rtsp_url: true });
    if (Object.keys(errs).length > 0) return;
    setSaving(true); setError(null);
    try {
      // 1. Save to DB
      await updateCamera(camId, {
        name:        form.name,
        rtsp_url:    form.rtsp_url,
        location:    form.device_id,
        device_ip:   form.device_ip.trim() || null,
        camera_type: form.mode,
        threshold:   form.useCustomThreshold ? form.threshold : null,
        status:      form.enabled ? 'active' : 'inactive',
      });

      // 2. Push to Python (best-effort — don't block save on failure)
      if (form.device_id.trim()) {
        try {
          await pushCameraConfig({
            device_id:     form.device_id,
            device_ip:     form.device_ip,
            device_name:   form.name,
            rtsp_url:      form.rtsp_url,
            mode:          form.mode,
            threshold:     form.useCustomThreshold ? form.threshold : null,
            enable_device: form.enabled,
          });
        } catch (_) {
          // Python unreachable — saved to DB anyway
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">Edit Device</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>
          )}

          {/* Device ID + Device IP (side by side) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-1.5">
                Device ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.device_id}
                onChange={(e) => setForm((f) => ({ ...f, device_id: e.target.value }))}
                onBlur={() => touch('device_id')}
                placeholder="pi_cam_01"
                maxLength={30}
                className={devFieldCls(touched.device_id, errs.device_id, 'font-mono')}
              />
              <DevFieldErr msg={touched.device_id && errs.device_id} />
            </div>
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-1.5">
                Device IP <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={form.device_ip}
                onChange={(e) => setForm((f) => ({ ...f, device_ip: e.target.value }))}
                onBlur={() => touch('device_ip')}
                placeholder="192.168.1.100"
                className={devFieldCls(touched.device_ip, errs.device_ip, 'font-mono')}
              />
              <DevFieldErr msg={touched.device_ip && errs.device_ip} />
            </div>
          </div>

          {/* Device Name */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-slate-300 text-sm font-medium">
                Device Name <span className="text-red-400">*</span>
              </label>
              <span className={`text-xs tabular-nums ${form.name.length > 55 ? 'text-red-400' : 'text-slate-500'}`}>
                {form.name.length}/60
              </span>
            </div>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onBlur={() => touch('name')}
              maxLength={60}
              className={devFieldCls(touched.name, errs.name)}
            />
            <DevFieldErr msg={touched.name && errs.name} />
          </div>

          {/* Mode */}
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">Camera Mode</label>
            <div className="flex gap-2">
              {[
                { value: 'in',   label: 'IN',      desc: 'First detection only' },
                { value: 'out',  label: 'OUT',      desc: 'Always mark as OUT' },
                { value: 'both', label: 'IN & OUT', desc: 'First IN, then OUT' },
              ].map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, mode: m.value }))}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-colors ${
                    form.mode === m.value
                      ? m.value === 'in'   ? 'bg-green-700/40 border-green-500 text-green-300'
                      : m.value === 'out'  ? 'bg-red-700/40 border-red-500 text-red-300'
                      :                      'bg-blue-700/40 border-blue-500 text-blue-300'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  <div className="font-bold">{m.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* RTSP URL */}
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">
              RTSP URL <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.rtsp_url}
              onChange={(e) => setForm((f) => ({ ...f, rtsp_url: e.target.value }))}
              onBlur={() => touch('rtsp_url')}
              placeholder="rtsp://192.168.1.x:554/stream"
              className={devFieldCls(touched.rtsp_url, errs.rtsp_url, 'font-mono')}
            />
            <DevFieldErr msg={touched.rtsp_url && errs.rtsp_url} />
          </div>

          {/* Threshold */}
          <div className="bg-slate-900/60 rounded-xl p-4 space-y-3 border border-slate-700/50">
            <div className="flex items-center justify-between">
              <label className="text-slate-300 text-sm font-medium">Recognition Threshold</label>
              <Toggle
                checked={form.useCustomThreshold}
                onChange={(v) => setForm((f) => ({ ...f, useCustomThreshold: v }))}
              />
            </div>
            {form.useCustomThreshold ? (
              <>
                <div className="flex items-center gap-3">
                  <input
                    type="range" min="0.10" max="0.90" step="0.05"
                    value={form.threshold}
                    onChange={(e) => setForm((f) => ({ ...f, threshold: parseFloat(e.target.value) }))}
                    className="flex-1 h-2 bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-500"
                  />
                  <span className="text-blue-400 font-mono text-sm font-bold w-10 text-right">
                    {parseFloat(form.threshold).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-500 text-xs">
                  <span>0.10 lenient</span><span>0.90 strict</span>
                </div>
              </>
            ) : (
              <p className="text-slate-500 text-xs">Using global threshold from System Settings.</p>
            )}
          </div>

          {/* Enable */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-slate-300 text-sm font-medium">Enable Device</p>
              <p className="text-slate-500 text-xs mt-0.5">Active devices process RTSP streams</p>
            </div>
            <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-5 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2"
          >
            {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save & Push to Python'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Camera Modal ───────────────────────────────────────────────────
function DeleteCameraModal({ camera, onClose, onConfirm, deleting }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-sm shadow-2xl">
        <div className="p-6 text-center">
          <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h3 className="text-white font-semibold text-lg mb-2">Delete Device</h3>
          <p className="text-slate-400 text-sm">
            Remove <span className="text-white font-medium">{camera?.name}</span> from the system?
          </p>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={onClose} className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2"
          >
            {deleting && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Page ─────────────────────────────────────────────────────────
export default function Settings() {
  const _cachedCams = getCached('cameras');
  const [cameras, setCameras] = useState(() => {
    const d = _cachedCams;
    return Array.isArray(d) ? d : (d?.cameras || []);
  });
  const [camLoading, setCamLoading] = useState(!_cachedCams);
  const [camError,   setCamError]   = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const CAM_PAGE_SIZE = 5;
  const [camPage, setCamPage] = useState(1);

  const [showAddCamera,     setShowAddCamera]     = useState(false);
  const [addStreamPrefill,  setAddStreamPrefill]  = useState(null);
  const [editCamera,        setEditCamera]        = useState(null);
  const [deleteCamera_state, setDeleteCamera]     = useState(null);
  const [deletingCam,       setDeletingCam]       = useState(false);
  const [roiCamera,         setRoiCamera]         = useState(null);
  const [roiSaving,         setRoiSaving]         = useState(false);

  const [sysSettings, setSysSettings] = useState({
    recognition_threshold:  0.45,
    frame_interval_ms:      100,
    punch_cooldown_seconds: 3,
  });
  const [shiftSettings, setShiftSettings] = useState({
    shift_start_time: '09:00',
    shift_end_time:   '18:00',
    working_hours:    8,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved,  setSettingsSaved]  = useState(false);
  const [settingsError,  setSettingsError]  = useState(null);

  const fetchCameras = useCallback(async () => {
    setCamLoading(true); setCamError(null);
    try {
      const data = await getCameras();
      setCameras(Array.isArray(data) ? data : data.cameras || []);
    } catch (err) {
      setCamError(err.message);
    } finally {
      setCamLoading(false);
    }
  }, []);

  useEffect(() => { fetchCameras(); }, [fetchCameras]);

  // Real-time: update online_status and device_ip when heartbeat arrives
  useEffect(() => {
    function onHealthUpdate({ camera_id, online_status, device_ip }) {
      setCameras((prev) =>
        prev.map((c) => {
          if (c.id !== camera_id) return c;
          const update = { ...c, online_status };
          if (device_ip) update.device_ip = device_ip;
          return update;
        })
      );
    }
    socket.on('device_health_update', onHealthUpdate);
    socket.on(CAMERAS_UPDATED, fetchCameras);
    return () => {
      socket.off('device_health_update', onHealthUpdate);
      socket.off(CAMERAS_UPDATED, fetchCameras);
    };
  }, [fetchCameras]);



  useEffect(() => {
    let alive = true;
    getSettings()
      .then((data) => {
        if (!alive || !data) return;
        const s = data.settings || {};
        setSysSettings({
          recognition_threshold:  s.recognition_threshold  ?? 0.45,
          frame_interval_ms:      s.frame_interval_ms      ?? 100,
          punch_cooldown_seconds: s.punch_cooldown_seconds ?? 3,
        });
        setShiftSettings({
          shift_start_time: s.shift_start_time || '09:00',
          shift_end_time:   s.shift_end_time   || '18:00',
          working_hours:    s.working_hours     ?? 8,
        });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function handleToggleActive(cam) {
    const camId = cam.id || cam._id;
    const newStatus = cam.status === 'active' ? 'inactive' : 'active';
    setTogglingId(camId);
    try {
      const data = await updateCamera(camId, { status: newStatus });
      setCameras((prev) =>
        prev.map((c) => (c.id || c._id) === camId
          ? { ...c, status: newStatus, online_status: newStatus === 'inactive' ? 'offline' : (data?.camera?.online_status || c.online_status) }
          : c
        )
      );
    } catch (err) {
      setCamError(err.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDeleteCamera() {
    if (!deleteCamera_state) return;
    setDeletingCam(true);
    try {
      await deleteCamera(deleteCamera_state.id || deleteCamera_state._id);
      setDeleteCamera(null);
      fetchCameras();
    } catch (err) {
      setCamError(err.message);
    } finally {
      setDeletingCam(false);
    }
  }

  async function handleSaveSettings() {
    setSettingsSaving(true); setSettingsError(null); setSettingsSaved(false);
    try {
      await saveSettings({
        recognition_threshold:  sysSettings.recognition_threshold,
        frame_interval_ms:      sysSettings.frame_interval_ms,
        punch_cooldown_seconds: sysSettings.punch_cooldown_seconds,
        shift_start_time:       shiftSettings.shift_start_time,
        shift_end_time:         shiftSettings.shift_end_time,
        working_hours:          shiftSettings.working_hours,
      });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (err) {
      setSettingsError(err.message);
    } finally {
      setSettingsSaving(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 lg:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-white">Settings</h1>
        <p className="text-slate-400 text-xs lg:text-sm mt-0.5">Manage devices and system configuration</p>
      </div>

      {/* ── Device Management ── */}
      <section className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="flex items-center justify-between px-4 lg:px-5 py-3 lg:py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
            <h2 className="text-white font-semibold text-sm lg:text-base">Device Management</h2>
          </div>
          <button
            onClick={() => { setAddStreamPrefill(null); setShowAddCamera(true); }}
            className="flex items-center gap-1.5 lg:gap-2 px-3 lg:px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs lg:text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Device
          </button>
        </div>

        {camError && (
          <div className="mx-5 mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{camError}</div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/60">
                <th className="text-left text-slate-400 font-medium px-5 py-3 w-12">S.No</th>
                <th className="text-left text-slate-400 font-medium px-5 py-3">Device ID</th>
                <th className="text-left text-slate-400 font-medium px-5 py-3">IP / Health</th>
                <th className="text-left text-slate-400 font-medium px-5 py-3">Mode</th>
                <th className="text-left text-slate-400 font-medium px-5 py-3">RTSP URL</th>
                <th className="text-left text-slate-400 font-medium px-5 py-3">Threshold</th>
                <th className="text-left text-slate-400 font-medium px-5 py-3">Enrolled</th>
                <th className="text-left text-slate-400 font-medium px-5 py-3">Enable</th>
                <th className="text-right text-slate-400 font-medium px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {camLoading && Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-700/50">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-5 py-3">
                      <div className="h-4 bg-slate-700 rounded animate-pulse" style={{ width: '70%' }} />
                    </td>
                  ))}
                </tr>
              ))}

              {!camLoading && cameras.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-500">
                    No devices added yet.
                  </td>
                </tr>
              )}

              {!camLoading && (() => {
                const sorted = [...cameras].sort((a, b) =>
                  (a.device_ip || '').localeCompare(b.device_ip || '') || (a.name || '').localeCompare(b.name || '')
                );
                return sorted.slice((camPage - 1) * CAM_PAGE_SIZE, camPage * CAM_PAGE_SIZE).map((cam, idx, slice) => {
                const camId = cam.id || cam._id;
                const globalIdx = (camPage - 1) * CAM_PAGE_SIZE + idx;
                const prevCam = slice[idx - 1];
                const sameGroup = !!(prevCam && prevCam.device_ip && prevCam.device_ip === cam.device_ip);
                return (
                  <tr
                    key={camId}
                    className={`border-b border-slate-700/50 hover:bg-slate-700/20 transition-colors ${
                      sameGroup ? 'border-l-2 border-l-blue-600/50 bg-slate-800/60' : idx % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'
                    }`}
                  >
                    {/* S.No */}
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-700 text-slate-300 text-xs font-mono font-bold">
                        {globalIdx + 1}
                      </span>
                    </td>

                    {/* Device ID (name) */}
                    <td className="px-5 py-3">
                      <div>
                        <span className="text-white font-medium">{cam.name}</span>
                        {cam.location && (
                          <p className="text-slate-500 text-xs font-mono mt-0.5">{cam.location}</p>
                        )}
                      </div>
                    </td>

                    {/* IP / Health */}
                    <td className="px-5 py-3">
                      {cam.device_ip ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            {sameGroup && <span className="text-blue-500/70 text-sm leading-none">↳</span>}
                            <span className={`font-mono text-xs ${sameGroup ? 'text-slate-500' : 'text-slate-400'}`}>{cam.device_ip}</span>
                          </div>
                          <div>
                            {cam.online_status === 'online' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-900/40 border border-green-700/50 text-green-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                Online
                              </span>
                            ) : cam.online_status === 'offline' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-900/40 border border-red-700/50 text-red-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                                Offline
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-700/60 border border-slate-600 text-slate-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                Unknown
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600 text-xs italic">—</span>
                      )}
                    </td>

                    {/* Mode badge */}
                    <td className="px-5 py-3">
                      {cam.camera_type === 'out' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-900/40 text-red-300 border border-red-700/40">OUT</span>
                      ) : cam.camera_type === 'both' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-blue-900/40 text-blue-300 border border-blue-700/40">IN & OUT</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-green-900/40 text-green-300 border border-green-700/40">IN</span>
                      )}
                    </td>

                    {/* RTSP URL */}
                    <td className="px-5 py-3">
                      <span className="text-slate-400 font-mono text-xs truncate block max-w-[260px]" title={cam.rtsp_url}>
                        {cam.rtsp_url || '—'}
                      </span>
                    </td>

                    {/* Threshold */}
                    <td className="px-5 py-3">
                      {cam.threshold != null ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-mono font-semibold bg-purple-900/40 text-purple-300 border border-purple-700/40">
                          {parseFloat(cam.threshold).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs">Global</span>
                      )}
                    </td>

                    {/* Enrolled count */}
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/30 text-blue-300 border border-blue-700/40">
                        {cam.enrolled_count ?? 0} emp{cam.enrolled_count !== 1 ? 's' : ''}
                      </span>
                    </td>

                    {/* Enable toggle */}
                    <td className="px-5 py-3">
                      <Toggle
                        checked={cam.status === 'active'}
                        onChange={() => handleToggleActive(cam)}
                        disabled={togglingId === camId}
                      />
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setAddStreamPrefill({ device_id: cam.location || '', device_ip: cam.device_ip || '' });
                            setShowAddCamera(true);
                          }}
                          className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                          title="Add another RTSP stream for this device"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setEditCamera(cam)}
                          className="p-1.5 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors"
                          title="Edit device"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setRoiCamera(cam)}
                          className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 active:scale-90 active:bg-cyan-500/20 rounded-lg transition-all duration-75 touch-manipulation"
                          title="Set ROI — detection zone"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                              d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
                          </svg>
                        </button>
                        <button
                          onClick={() => setDeleteCamera(cam)}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Delete device"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              });
            })()}
            </tbody>
          </table>
        </div>

        {/* Camera pagination */}
        {!camLoading && cameras.length > CAM_PAGE_SIZE && (() => {
          const totalCamPages = Math.ceil(cameras.length / CAM_PAGE_SIZE);
          return (
            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700">
              <span className="text-xs text-slate-500">
                {(camPage - 1) * CAM_PAGE_SIZE + 1}–{Math.min(camPage * CAM_PAGE_SIZE, cameras.length)} of {cameras.length} devices
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCamPage(1)}
                  disabled={camPage === 1}
                  className="px-2 py-1 text-xs text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >«</button>
                <button
                  onClick={() => setCamPage((p) => Math.max(1, p - 1))}
                  disabled={camPage === 1}
                  className="px-2 py-1 text-xs text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >‹ Prev</button>
                {Array.from({ length: totalCamPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setCamPage(p)}
                    className={`px-2.5 py-1 text-xs rounded ${p === camPage ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'}`}
                  >{p}</button>
                ))}
                <button
                  onClick={() => setCamPage((p) => Math.min(totalCamPages, p + 1))}
                  disabled={camPage === totalCamPages}
                  className="px-2 py-1 text-xs text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >Next ›</button>
                <button
                  onClick={() => setCamPage(totalCamPages)}
                  disabled={camPage === totalCamPages}
                  className="px-2 py-1 text-xs text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                >»</button>
              </div>
            </div>
          );
        })()}
      </section>

      {/* ── System Settings + Shift ── */}
      <section className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-4 border-b border-slate-700">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h2 className="text-white font-semibold">Shift Settings</h2>
        </div>

        <div className="p-6">
          {/* ── Shift Rules ── */}
          <div className="flex items-center gap-2 mb-5">
            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-white font-semibold text-sm">Shift &amp; Attendance Rules</h3>
            <span className="text-xs text-slate-500 ml-auto">Applied globally</span>
          </div>

          <div className="flex gap-3 items-stretch">
            {/* Shift Start */}
            <div className="flex-1 bg-slate-900/50 border border-slate-700/60 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-green-400" />
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Shift Start</span>
              </div>
              <input
                type="time"
                value={shiftSettings.shift_start_time}
                onChange={(e) => {
                  const start = e.target.value;
                  const wh = calcWorkingHours(start, shiftSettings.shift_end_time);
                  setShiftSettings((s) => ({ ...s, shift_start_time: start, working_hours: wh }));
                }}
                className="w-full bg-slate-800 border border-slate-600 text-white text-sm font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-slate-500 text-xs mt-1">Employees are late after this time</p>
            </div>

            {/* Shift End */}
            <div className="flex-1 bg-slate-900/50 border border-slate-700/60 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Shift End</span>
              </div>
              <input
                type="time"
                value={shiftSettings.shift_end_time}
                onChange={(e) => {
                  const end = e.target.value;
                  const wh = calcWorkingHours(shiftSettings.shift_start_time, end);
                  setShiftSettings((s) => ({ ...s, shift_end_time: end, working_hours: wh }));
                }}
                className="w-full bg-slate-800 border border-slate-600 text-white text-sm font-mono rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-slate-500 text-xs mt-1">Shift ends at this time</p>
            </div>

            {/* Working Hours */}
            <div className="flex-1 bg-blue-900/20 border border-blue-700/40 rounded-lg p-3 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Working Hours</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold text-blue-400 font-mono">
                  {Number(shiftSettings.working_hours).toFixed(1)}
                </span>
                <span className="text-slate-400 text-sm">hrs</span>
              </div>
              <p className="text-slate-500 text-xs mt-1">Auto-calculated from start &amp; end</p>
            </div>
          </div>
        </div>

        {/* Footer: error + save */}
        <div className="px-6 pb-6 flex items-center gap-3">
          {settingsError && (
            <span className="text-red-400 text-sm">{settingsError}</span>
          )}
          <button
            onClick={handleSaveSettings}
            disabled={settingsSaving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
          >
            {settingsSaving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {settingsSaving ? 'Saving…' : 'Save Settings'}
          </button>
          {settingsSaved && (
            <span className="flex items-center gap-1.5 text-green-400 text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
        </div>
      </section>

      {/* Modals */}
      {showAddCamera && (
        <AddCameraModal
          onClose={() => { setShowAddCamera(false); setAddStreamPrefill(null); }}
          onSaved={fetchCameras}
          prefill={addStreamPrefill}
        />
      )}
      {editCamera && (
        <EditCameraModal camera={editCamera} onClose={() => setEditCamera(null)} onSaved={fetchCameras} />
      )}
      {deleteCamera_state && (
        <DeleteCameraModal
          camera={deleteCamera_state}
          onClose={() => setDeleteCamera(null)}
          onConfirm={handleDeleteCamera}
          deleting={deletingCam}
        />
      )}

      {/* ── ROI Modal ─────────────────────────────────────────────────── */}
      {roiCamera && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-2xl shadow-2xl flex flex-col gap-0 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
              <div>
                <h2 className="text-white font-semibold">Set Detection Zone (ROI)</h2>
                <p className="text-slate-400 text-xs mt-0.5">{roiCamera.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {(roiCamera.roi_x != null) && (
                  <button
                    onClick={async () => {
                      setRoiSaving(true);
                      try { await pushCameraROI(roiCamera.id || roiCamera._id, null); fetchCameras(); setRoiCamera(null); }
                      catch { /* best-effort */ }
                      finally { setRoiSaving(false); }
                    }}
                    disabled={roiSaving}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 active:scale-95 active:bg-slate-800 disabled:opacity-40 text-slate-300 text-xs font-medium rounded-lg transition-all duration-75 touch-manipulation"
                  >
                    Clear ROI
                  </button>
                )}
                <button onClick={() => setRoiCamera(null)} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 active:scale-90 rounded-lg transition-all duration-75 touch-manipulation">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* ROIDrawer */}
            <div className="p-5">
              <ROIDrawer
                cameraId={roiCamera.id || roiCamera._id}
                whepUrl={roiCamera.whep_url}
                streamWidth={640}
                streamHeight={360}
                existingROI={
                  roiCamera.roi_x != null
                    ? { x: roiCamera.roi_x, y: roiCamera.roi_y, width: roiCamera.roi_width, height: roiCamera.roi_height }
                    : null
                }
                onROISet={async (roi) => {
                  setRoiSaving(true);
                  try {
                    await pushCameraROI(roiCamera.id || roiCamera._id, roi);
                    fetchCameras();
                    setRoiCamera(null);
                  } catch { /* best-effort */ }
                  finally { setRoiSaving(false); }
                }}
                onClose={() => setRoiCamera(null)}
              />
              {roiSaving && (
                <div className="flex items-center gap-2 mt-3 text-cyan-400 text-sm">
                  <div className="w-4 h-4 border-2 border-cyan-600 border-t-cyan-400 rounded-full animate-spin" />
                  Saving ROI…
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
