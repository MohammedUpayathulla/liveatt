import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { socket, ATTENDANCE_MARKED, FACE_PRESENT } from '../services/socket.js';
import { getCameras } from '../services/api.js';
import cfg from '../config.js';

const BACKEND_BASE = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
const MAX_FEED = 50;

// ── Hindi transliteration for Indian names ────────────────────────────────────
// Converts English phonetic spelling → approximate Devanagari
// e.g.  "Kishore" → "किशोर",  "Lokesh" → "लोकेश",  "Suresh" → "सुरेश"
function _transliterateWord(word) {
  const t = word.toLowerCase();
  const CONS = [
    ['ksh','क्ष'],['gya','ज्ञ'],['shr','श्र'],['str','स्त्र'],
    ['pr','प्र'],['br','ब्र'],['kr','क्र'],['gr','ग्र'],['tr','त्र'],['dr','ड्र'],
    ['sh','श'],['ch','च'],['ph','फ'],['gh','घ'],['dh','ध'],
    ['th','थ'],['kh','ख'],['bh','भ'],['jh','झ'],
    ['k','क'],['g','ग'],['c','क'],['j','ज'],['t','त'],['d','द'],
    ['n','न'],['p','प'],['b','ब'],['m','म'],['y','य'],['r','र'],
    ['l','ल'],['v','व'],['w','व'],['s','स'],['h','ह'],['f','फ'],['z','ज'],['q','क'],
  ];
  const MATRA  = { 'aa':'ा','ai':'ै','au':'ौ','ii':'ी','ee':'ी','oo':'ू','uu':'ू','a':'','e':'े','i':'ि','o':'ो','u':'ु' };
  const VOWEL  = { 'aa':'आ','ai':'ऐ','au':'औ','ii':'ई','ee':'ई','oo':'ऊ','uu':'ऊ','a':'अ','e':'ए','i':'इ','o':'ओ','u':'उ' };
  const VKEYS  = Object.keys(VOWEL).sort((a, b) => b.length - a.length);

  function matchV(pos) { return VKEYS.find(k => t.startsWith(k, pos)) ?? null; }
  function matchC(pos) { return CONS.find(([k]) => t.startsWith(k, pos))?.[0] ?? null; }
  function devaC(k)    { return CONS.find(([c]) => c === k)?.[1] ?? ''; }

  let out = '', i = 0;
  while (i < t.length) {
    const ck = matchC(i);
    if (ck) {
      const ac = i + ck.length;
      const vk = matchV(ac);
      if (vk) {
        const isLast = ac + vk.length >= t.length;
        // Silent final 'e' is extremely common in Indian name romanisation (Kishore → किशोर)
        out += isLast && vk === 'e' ? devaC(ck) : devaC(ck) + MATRA[vk];
        i = ac + vk.length;
      } else {
        out += devaC(ck) + (ac < t.length ? '्' : '');
        i = ac;
      }
    } else {
      const vk = matchV(i);
      if (vk) { out += VOWEL[vk]; i += vk.length; }
      else     { out += word[i];   i++;             }
    }
  }
  return out;
}
function toHindi(name) {
  if (!name) return '';
  return name.trim().split(/\s+/).map(_transliterateWord).join(' ');
}

// ── Scan-flow animation — shown when no one is detected ──────────────────────
const D = '6s';
function ScanFlowAnimation() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center select-none py-2 px-2 overflow-hidden min-h-0">
      <p className="text-slate-600 text-[10px] font-semibold tracking-widest uppercase mb-3">
        Face Recognition Ready
      </p>

      <div className="flex flex-col items-center w-full max-w-[148px]">

        {/* ── Step 1: Camera ── */}
        <div className="rounded-xl border border-transparent flex flex-col items-center gap-1 py-2 px-3 w-full"
             style={{ animation: `sfStep1 ${D} infinite` }}>
          <div className="relative p-3 rounded-full border border-slate-700/50 bg-slate-800/50">
            <svg viewBox="0 0 48 40" className="w-8 h-7" fill="none" stroke="#94a3b8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="8" width="44" height="28" rx="4" strokeWidth="1.8"/>
              <rect x="16" y="4" width="10" height="6" rx="2" strokeWidth="1.5"/>
              <circle cx="24" cy="22" r="9" strokeWidth="1.8"/>
              <circle cx="24" cy="22" r="4.5" strokeWidth="1.4"/>
              <circle cx="24" cy="22" r="1.5" fill="#94a3b8" stroke="none"/>
              <rect x="36" y="12" width="4" height="4" rx="1" strokeWidth="1.2"/>
            </svg>
            {/* Capture-ring pulse */}
            <div className="absolute inset-0 rounded-full border-2 border-blue-400/50"
                 style={{ animation: `sfCapture ${D} infinite` }} />
          </div>
          <div className="text-center">
            <p className="text-slate-300 text-xs font-semibold">Camera</p>
            <p className="text-slate-600 text-[10px]">Capturing frame</p>
          </div>
        </div>

        {/* ── Connector 1 ── */}
        <div className="relative flex justify-center" style={{ width: 16, height: 20 }}>
          <div className="w-px h-full border-l border-dashed border-slate-700/50" />
          <div className="absolute w-2 h-2 rounded-full bg-blue-400 -translate-x-1/2 left-1/2"
               style={{ animation: `sfConn1 ${D} infinite`, top: 0 }} />
        </div>

        {/* ── Step 2: Face Analysis ── */}
        <div className="rounded-xl border border-transparent flex flex-col items-center gap-1 py-2 px-3 w-full"
             style={{ animation: `sfStep2 ${D} infinite` }}>
          <div className="relative">
            <svg viewBox="0 0 64 76" className="w-10 h-[48px]" fill="none">
              <defs>
                <clipPath id="sfFaceClip">
                  <ellipse cx="32" cy="40" rx="18" ry="22"/>
                </clipPath>
              </defs>
              {/* Corner scan brackets */}
              <path d="M7 17 L7 5 L19 5"   stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
              <path d="M57 17 L57 5 L45 5"  stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
              <path d="M7 59 L7 71 L19 71"  stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
              <path d="M57 59 L57 71 L45 71" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
              {/* Face ellipse */}
              <ellipse cx="32" cy="40" rx="18" ry="22" stroke="#475569" strokeWidth="1.5"/>
              {/* Landmark dots */}
              <circle cx="24" cy="33" r="2" fill="#10b981" style={{ animation: `sfDot1 ${D} infinite` }}/>
              <circle cx="40" cy="33" r="2" fill="#10b981" style={{ animation: `sfDot2 ${D} infinite` }}/>
              <circle cx="32" cy="26" r="2" fill="#10b981" style={{ animation: `sfDot3 ${D} infinite` }}/>
              <circle cx="32" cy="44" r="1.8" fill="#10b981" style={{ animation: `sfDot4 ${D} infinite` }}/>
              <circle cx="26" cy="50" r="1.8" fill="#10b981" style={{ animation: `sfDot5 ${D} infinite` }}/>
              <circle cx="38" cy="50" r="1.8" fill="#10b981" style={{ animation: `sfDot6 ${D} infinite` }}/>
              <circle cx="16" cy="40" r="1.5" fill="#6366f1" style={{ animation: `sfDot2 ${D} infinite` }}/>
              <circle cx="48" cy="40" r="1.5" fill="#6366f1" style={{ animation: `sfDot3 ${D} infinite` }}/>
              {/* Scan line — clipped to face ellipse */}
              <g clipPath="url(#sfFaceClip)">
                <line x1="14" y1="40" x2="50" y2="40" stroke="#06b6d4" strokeWidth="2"
                  style={{ animation: `sfScanLine ${D} infinite` }}/>
                <rect x="14" y="37" width="36" height="6" fill="#06b6d4" opacity="0.12"
                  style={{ animation: `sfScanLine ${D} infinite` }}/>
              </g>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-slate-300 text-xs font-semibold">Face Analysis</p>
            <p className="text-slate-600 text-[10px]">Mapping landmarks</p>
          </div>
        </div>

        {/* ── Connector 2 ── */}
        <div className="relative flex justify-center" style={{ width: 16, height: 20 }}>
          <div className="w-px h-full border-l border-dashed border-slate-700/50" />
          <div className="absolute w-2 h-2 rounded-full bg-cyan-400 -translate-x-1/2 left-1/2"
               style={{ animation: `sfConn2 ${D} infinite`, top: 0 }} />
        </div>

        {/* ── Step 3: Database Verification ── */}
        <div className="rounded-xl border border-transparent flex flex-col items-center gap-1 py-2 px-3 w-full"
             style={{ animation: `sfStep3 ${D} infinite` }}>
          <div className="p-2 rounded-full border border-slate-700/50 bg-slate-800/50">
            <svg viewBox="0 0 60 44" className="w-12 h-9" fill="none" stroke="#94a3b8" strokeLinecap="round">
              {/* Left DB cylinder */}
              <ellipse cx="14" cy="10" rx="11" ry="4"  strokeWidth="1.5"/>
              <line x1="3"  y1="10" x2="3"  y2="26" strokeWidth="1.5"/>
              <line x1="25" y1="10" x2="25" y2="26" strokeWidth="1.5"/>
              <ellipse cx="14" cy="26" rx="11" ry="4"  strokeWidth="1.5"/>
              {/* Right DB cylinder */}
              <ellipse cx="46" cy="18" rx="11" ry="4"  stroke="#8b5cf6" strokeWidth="1.5"/>
              <line x1="35" y1="18" x2="35" y2="34" stroke="#8b5cf6" strokeWidth="1.5"/>
              <line x1="57" y1="18" x2="57" y2="34" stroke="#8b5cf6" strokeWidth="1.5"/>
              <ellipse cx="46" cy="34" rx="11" ry="4"  stroke="#8b5cf6" strokeWidth="1.5"/>
              {/* Match arrow */}
              <path d="M27 22 L33 22" stroke="#10b981" strokeWidth="2" strokeDasharray="6 3"
                    style={{ animation: `sfMatch ${D} infinite` }}/>
              <path d="M31 19 L35 22 L31 25" stroke="#10b981" strokeWidth="1.8" fill="none"
                    style={{ animation: `sfMatch ${D} infinite` }}/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-slate-300 text-xs font-semibold">Verification</p>
            <p className="text-slate-600 text-[10px]">Matching identity</p>
          </div>
        </div>

        {/* ── Connector 3 ── */}
        <div className="relative flex justify-center" style={{ width: 16, height: 20 }}>
          <div className="w-px h-full border-l border-dashed border-slate-700/50" />
          <div className="absolute w-2 h-2 rounded-full bg-purple-400 -translate-x-1/2 left-1/2"
               style={{ animation: `sfConn3 ${D} infinite`, top: 0 }} />
        </div>

        {/* ── Step 4: Attendance Marked ── */}
        <div className="rounded-xl border border-transparent flex flex-col items-center gap-1 py-2 px-3 w-full"
             style={{ animation: `sfStep4 ${D} infinite` }}>
          <div className="p-3 rounded-full border border-slate-700/50 bg-slate-800/50"
               style={{ animation: `sfShieldGlow ${D} infinite` }}>
            <svg viewBox="0 0 44 52" className="w-8 h-9" fill="none">
              {/* Shield body */}
              <path d="M22 4 L40 12 L40 28 C40 38 32 46 22 50 C12 46 4 38 4 28 L4 12 Z"
                    stroke="#94a3b8" strokeWidth="1.8" strokeLinejoin="round"/>
              {/* Checkmark draw-in */}
              <path d="M12 27 L20 35 L32 18"
                    stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                    strokeDasharray="36" strokeDashoffset="36"
                    style={{ animation: `sfCheck ${D} infinite` }}/>
              {/* Person silhouette hint */}
              <circle cx="22" cy="22" r="4" stroke="#475569" strokeWidth="1.2" fill="none" opacity="0.5"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-xs font-bold" style={{ animation: `sfLabel ${D} infinite` }}>
              Attendance Marked
            </p>
            <p className="text-slate-600 text-[10px]">Access granted</p>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Detection card ────────────────────────────────────────────────────────────
const DetectionCard = React.memo(function DetectionCard({ event, isNew, fullScreen }) {
  const name       = event.employee_name        || event.name || 'Unknown';
  const nameHindi  = event.employee_name_hindi  || (name !== 'Unknown' ? toHindi(name) : null);
  const code       = event.employee_code || '';
  const camera     = event.camera_name   || '';
  const punch      = event.punch_type    || '';
  const imgSrc     = event.employee_image || event.image_path || null;
  const timeStr    = event.timestamp
    ? new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  const avatarCls  = fullScreen ? 'w-32 h-32 rounded-2xl'  : 'w-16 h-16 rounded-full';
  const initialCls = fullScreen ? 'text-5xl'                : 'text-lg';
  const dotCls     = fullScreen ? 'w-4 h-4 bottom-1 right-1 border-2' : 'w-3 h-3 bottom-0.5 right-0.5 border-2';
  const nameCls    = fullScreen ? 'text-2xl font-bold'      : 'text-sm font-semibold';
  const hindiCls   = fullScreen ? 'text-lg mt-1'            : 'text-xs mt-0.5';
  const codeCls    = fullScreen ? 'text-base mt-1'          : 'text-xs mt-0.5';
  const timeCls    = fullScreen ? 'text-base mt-3'          : 'text-xs mt-1.5';
  const padCls     = fullScreen ? 'p-8'                     : 'p-4';

  return (
    <div
      className={`rounded-xl border flex flex-col items-center text-center w-full transition-all ${padCls} ${
        isNew ? 'bg-green-900/20 border-green-600/50 ring-1 ring-green-500/30' : 'bg-slate-800/70 border-slate-700/50'
      } ${fullScreen ? 'h-full justify-center' : ''}`}
      style={{ minHeight: fullScreen ? undefined : '160px', animation: 'cardFadeIn 0.3s ease' }}
    >
      {/* Avatar */}
      <div className="relative mb-4">
        {imgSrc ? (
          <img
            src={`${BACKEND_BASE}/${imgSrc}`}
            className={`${avatarCls} object-cover border-2 border-slate-600`}
            alt={name}
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <div className={`${avatarCls} items-center justify-center font-bold border-2 bg-blue-700/30 border-blue-600/60 text-blue-300 ${initialCls} ${imgSrc ? 'hidden' : 'flex'}`}>
          {name.charAt(0).toUpperCase()}
        </div>
        <span className={`absolute rounded-full border-slate-900 ${dotCls} ${isNew ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`} />
      </div>

      {/* Info */}
      <p className={`text-white truncate w-full leading-tight ${nameCls}`}>{name}</p>
      {nameHindi && (
        <p className={`text-slate-300 truncate w-full leading-tight ${hindiCls}`}
           style={{ fontFamily: 'system-ui, sans-serif' }}>
          {nameHindi}
        </p>
      )}
      {code && <p className={`text-slate-400 font-mono ${codeCls}`}>{code}</p>}
      <p className={`text-blue-400 font-mono font-semibold ${timeCls}`}>{timeStr}</p>

      {/* Camera + Punch */}
      <div className={`flex items-center justify-center gap-2 flex-wrap w-full ${fullScreen ? 'mt-4' : 'mt-2'}`}>
        {punch && (
          <span className={`inline-flex items-center px-3 py-1 rounded-full font-bold border ${fullScreen ? 'text-sm' : 'text-[10px]'} ${
            punch === 'in'  ? 'bg-green-900/50 text-green-300 border-green-700/50' :
            punch === 'out' ? 'bg-red-900/50   text-red-300   border-red-700/50'   :
                              'bg-blue-900/50  text-blue-300  border-blue-700/50'
          }`}>
            {punch === 'in' ? '↗ IN' : punch === 'out' ? '↙ OUT' : punch.toUpperCase()}
          </span>
        )}
        {camera && (
          <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600/50 max-w-full ${fullScreen ? 'text-sm' : 'text-[10px]'}`}>
            <svg className={`flex-shrink-0 ${fullScreen ? 'w-4 h-4' : 'w-3 h-3'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <span className="truncate">{camera}</span>
          </span>
        )}
      </div>

      {/* Live / Present badge */}
      {isNew ? (
        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full font-medium bg-green-900/50 text-green-400 border border-green-700/50 ${fullScreen ? 'mt-4 text-sm' : 'mt-2 text-[10px]'}`}>
          <span className={`rounded-full bg-green-400 animate-pulse ${fullScreen ? 'w-2 h-2' : 'w-1.5 h-1.5'}`} />
          Live
        </span>
      ) : (
        <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full font-medium bg-slate-700/50 text-slate-300 border border-slate-600/50 ${fullScreen ? 'mt-4 text-sm' : 'mt-2 text-[10px]'}`}>
          <span className={`rounded-full bg-green-400/70 animate-pulse ${fullScreen ? 'w-2 h-2' : 'w-1.5 h-1.5'}`} />
          Present
        </span>
      )}

      {/* 15-second countdown bar */}
      <div className={`w-full bg-slate-700/60 rounded-full overflow-hidden flex-shrink-0 ${fullScreen ? 'h-1 mt-6' : 'h-0.5 mt-3'}`}>
        <div
          className="h-full bg-green-500/70 rounded-full"
          style={{ animation: 'shrink10s 15s linear forwards', transformOrigin: 'left' }}
        />
      </div>
    </div>
  );
});

// ── Log Table Row (right panel) ───────────────────────────────────────────────
const LogRow = React.memo(function LogRow({ event, isNew, index }) {
  const name    = event.employee_name || event.name || 'Unknown';
  const code    = event.employee_code || '';
  const device  = event.camera_name  || '';
  const imgSrc  = event.employee_image || event.image_path || null;
  const timeStr = event.timestamp
    ? new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';
  const dateStr = event.timestamp
    ? new Date(event.timestamp).toLocaleDateString([], { day: '2-digit', month: 'short' })
    : '';

  return (
    <tr className={`border-b border-slate-700/40 transition-colors ${isNew ? 'bg-green-900/10' : index % 2 === 0 ? 'bg-transparent' : 'bg-slate-800/20'}`}>
      <td className="px-3 py-2.5 text-slate-500 text-xs font-mono text-center">{index + 1}</td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          {imgSrc ? (
            <img src={`${BACKEND_BASE}/${imgSrc}`} className="w-8 h-8 rounded-full object-cover border border-slate-600 flex-shrink-0"
              alt={name} onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
          ) : null}
          <div className={`w-8 h-8 rounded-full items-center justify-center font-bold text-xs border border-slate-600 bg-blue-700/30 text-blue-300 flex-shrink-0 ${imgSrc ? 'hidden' : 'flex'}`}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{name}</p>
            {code && <p className="text-slate-500 text-xs font-mono">{code}</p>}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-slate-400 text-xs truncate max-w-[120px]">{device}</td>
      <td className="px-3 py-2.5 text-right">
        <p className="text-white text-xs font-mono">{timeStr}</p>
        <p className="text-slate-500 text-xs">{dateStr}</p>
      </td>
      <td className="px-3 py-2.5 text-center">
        {isNew ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-green-900/40 text-green-400 border border-green-700/50">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-slate-700/50 text-slate-400">
            Marked
          </span>
        )}
      </td>
    </tr>
  );
});

// ── Live Attendance Page ──────────────────────────────────────────────────────
export default function LiveAttendance() {
  // ── Right-panel log feed (persisted in sessionStorage) ──
  const [feedEvents, setFeedEvents] = useState(() => {
    try {
      const saved = sessionStorage.getItem('liveAttendanceFeed');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [newEventIds,    setNewEventIds]    = useState(new Set());
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [todayCount,     setTodayCount]     = useState(0);
  const [cameras,        setCameras]        = useState([]);

  const saveTimer  = useRef(null);
  const clearedAt  = useRef(
    (() => {
      try { const ts = sessionStorage.getItem('liveAttendanceClearedAt'); return ts ? parseInt(ts, 10) : null; }
      catch { return null; }
    })()
  );

  // ── Left-panel: ephemeral active detection cards ──
  // Map<employee_code, { event, rid }>  — insertion order = display order
  const [activeCards,   setActiveCards]   = useState(new Map());
  const cardTimersRef = useRef(new Map()); // code → timeoutId

  // Persist log feed
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { sessionStorage.setItem('liveAttendanceFeed', JSON.stringify(feedEvents)); } catch {}
    }, 300);
    return () => clearTimeout(saveTimer.current);
  }, [feedEvents]);

  // Today count
  useEffect(() => {
    const today = new Date().toDateString();
    setTodayCount(feedEvents.filter(
      (e) => e.timestamp && new Date(e.timestamp).toDateString() === today
    ).length);
  }, [feedEvents]);

  // Clear feed + reset active cards
  const handleClearFeed = useCallback(() => {
    const now = Date.now();
    clearedAt.current = now;
    setFeedEvents([]);
    setNewEventIds(new Set());
    setTodayCount(0);
    cardTimersRef.current.forEach((id) => clearTimeout(id));
    cardTimersRef.current.clear();
    setActiveCards(new Map());
    try {
      sessionStorage.removeItem('liveAttendanceFeed');
      sessionStorage.setItem('liveAttendanceClearedAt', String(now));
    } catch {}
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => { cardTimersRef.current.forEach((id) => clearTimeout(id)); };
  }, []);

  // Socket connection
  useEffect(() => {
    function onConnect()    { setSocketConnected(true);  socket.emit('join_web'); }
    function onDisconnect() { setSocketConnected(false); }
    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) socket.emit('join_web');
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
  }, []);

  // Cameras + heartbeat
  useEffect(() => {
    getCameras().then((data) => {
      setCameras(Array.isArray(data) ? data : data.cameras || []);
    }).catch(() => {});
    function onHealthUpdate({ camera_id, online_status }) {
      setCameras((prev) => prev.map((c) => c.id === camera_id ? { ...c, online_status } : c));
    }
    socket.on('device_health_update', onHealthUpdate);
    return () => socket.off('device_health_update', onHealthUpdate);
  }, []);

  // Remove deactivated employees
  useEffect(() => {
    function onEmployeeUpdated({ employee_code, status }) {
      if (status === 'inactive') {
        setFeedEvents((prev) => prev.filter((e) => e.employee_code !== employee_code));
      }
    }
    socket.on('employee_updated', onEmployeeUpdated);
    return () => socket.off('employee_updated', onEmployeeUpdated);
  }, []);

  // Today's logs on reconnect (right panel only — does NOT touch active cards)
  useEffect(() => {
    function handleToday({ logs }) {
      if (!logs?.length) return;
      setFeedEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id).filter(Boolean));
        const cutoff      = clearedAt.current;
        const incoming    = logs
          .filter((l) => !existingIds.has(l.id))
          .filter((l) => !cutoff || !l.timestamp || new Date(l.timestamp).getTime() > cutoff)
          .map((l) => ({ ...l, _reactId: `db-${l.id}` }));
        if (!incoming.length) return prev;
        return [...incoming, ...prev]
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, MAX_FEED);
      });
    }
    socket.on('attendance_today', handleToday);
    return () => socket.off('attendance_today', handleToday);
  }, []);

  // ── Live detection events ──────────────────────────────────────────────────
  useEffect(() => {
    function handleAttendance(event) {
      const code = event.employee_code || String(Math.random());
      const rid  = `marked-${Date.now()}-${Math.random()}`;
      const enriched = { ...event, _reactId: rid };

      // Right-panel log (unchanged behaviour)
      setFeedEvents((prev) => [enriched, ...prev].slice(0, MAX_FEED));
      setNewEventIds((prev) => { const s = new Set(prev); s.add(rid); return s; });
      setTimeout(() => setNewEventIds((prev) => { const s = new Set(prev); s.delete(rid); return s; }), 4000);

      // Reset 10s timer so repeated detections keep the card alive
      if (cardTimersRef.current.has(code)) {
        clearTimeout(cardTimersRef.current.get(code));
      }

      // Show/refresh card (Map.set on existing key preserves insertion order)
      setActiveCards((prev) => {
        const next = new Map(prev);
        next.set(code, { event: enriched, rid });
        return next;
      });

      // 15-second expiry — card disappears
      const timer = setTimeout(() => {
        setActiveCards((prev) => { const next = new Map(prev); next.delete(code); return next; });
        cardTimersRef.current.delete(code);
      }, 15_000);
      cardTimersRef.current.set(code, timer);
    }

    socket.on(ATTENDANCE_MARKED, handleAttendance);
    return () => socket.off(ATTENDANCE_MARKED, handleAttendance);
  }, []);

  // ── Presence heartbeat (Python fires every 5 s per recognized face) ───────────
  // Resets the 10-second card expiry so cards stay alive while person is in frame.
  // If the attendance_marked event was missed, creates a minimal card from presence data.
  useEffect(() => {
    function handlePresence(event) {
      const code = event.employee_code;
      if (!code) return;

      // Reset existing expiry timer
      if (cardTimersRef.current.has(code)) {
        clearTimeout(cardTimersRef.current.get(code));
      }

      // Create a card if one doesn't exist (e.g. browser opened after first detection)
      setActiveCards((prev) => {
        if (prev.has(code)) return prev; // card already showing — timer reset is enough
        if (!event.employee_name) return prev;
        const rid  = `pres-${Date.now()}-${Math.random()}`;
        const next = new Map(prev);
        next.set(code, { event: { ...event, _reactId: rid, punch_type: '' }, rid });
        return next;
      });

      // New 15-second expiry
      const timer = setTimeout(() => {
        setActiveCards((prev) => { const n = new Map(prev); n.delete(code); return n; });
        cardTimersRef.current.delete(code);
      }, 15_000);
      cardTimersRef.current.set(code, timer);
    }

    socket.on(FACE_PRESENT, handlePresence);
    return () => socket.off(FACE_PRESENT, handlePresence);
  }, []);

  const activeEntries = useMemo(() => Array.from(activeCards.values()), [activeCards]);
  const activeCount   = activeEntries.length;

  return (
    <div className="relative h-full min-h-screen lg:h-screen flex flex-col overflow-hidden bg-slate-900">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 lg:px-6 py-3 border-b border-slate-700 bg-slate-900 flex-shrink-0">
        <div>
          <h1 className="text-base lg:text-lg font-bold text-white">Live Attendance</h1>
          <p className="text-slate-500 text-xs hidden sm:block">Real-time face detection feed</p>
        </div>
        <div className="flex items-center gap-1.5 lg:gap-2.5">
          {cameras.length > 0 && cameras.map((cam) => (
            <div
              key={cam.id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                cam.online_status === 'online'
                  ? 'bg-green-900/30 border-green-700/50 text-green-400'
                  : 'bg-red-900/30 border-red-700/50 text-red-400'
              }`}
              title={cam.device_ip || cam.name}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${cam.online_status === 'online' ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="hidden sm:inline">{cam.name} — </span>
              {cam.online_status === 'online' ? 'Online' : 'Offline'}
            </div>
          ))}
          {cameras.length === 0 && (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
              socketConnected ? 'bg-green-900/30 border-green-700/50 text-green-400' : 'bg-red-900/30 border-red-700/50 text-red-400'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${socketConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
              {socketConnected ? 'Connected' : 'Disconnected'}
            </div>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border bg-blue-900/30 border-blue-700/50 text-blue-400">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {todayCount} today
          </div>
          <button
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
              else document.documentElement.requestFullscreen().catch(() => {});
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-colors"
            title="Toggle fullscreen"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
            </svg>
            Fullscreen
          </button>
          <button
            onClick={handleClearFeed}
            disabled={feedEvents.length === 0 && activeCards.size === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-700/50 hover:bg-red-900/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex overflow-hidden">

          {/* Detection cards */}
          <div className="w-[40%] flex-shrink-0 border-r border-slate-700 flex flex-col bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between flex-shrink-0">
              <span className="text-white text-sm font-semibold">Live Detections</span>
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{activeCount} active</span>
            </div>
            {activeCount === 0 ? (
              <ScanFlowAnimation />
            ) : activeCount === 1 ? (
              <div className="flex-1 p-4 flex items-center justify-center overflow-hidden min-h-0">
                <DetectionCard key={activeEntries[0].rid} event={activeEntries[0].event} isNew={newEventIds.has(activeEntries[0].rid)} fullScreen />
              </div>
            ) : (
              <div className="flex-1 p-3 overflow-y-auto min-h-0">
                <div className={`grid gap-3 ${activeCount === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  {activeEntries.map((entry) => (
                    <DetectionCard key={entry.rid} event={entry.event} isNew={newEventIds.has(entry.rid)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Log */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <div className="px-4 py-3 border-b border-slate-700/60 flex items-center justify-between flex-shrink-0">
              <span className="text-white text-sm font-semibold">Detection Log</span>
              <span className="text-xs text-slate-500">{feedEvents.length} records</span>
            </div>
            {feedEvents.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center mb-3">
                  <svg className="w-7 h-7 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <p className="text-slate-400 text-sm font-medium">No logs yet</p>
                <p className="text-slate-600 text-xs mt-1">Waiting for face detection…</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800 z-10">
                    <tr className="border-b border-slate-700">
                      <th className="px-3 py-2.5 text-slate-400 text-xs font-medium text-center w-10">#</th>
                      <th className="px-3 py-2.5 text-slate-400 text-xs font-medium text-left">Employee</th>
                      <th className="px-3 py-2.5 text-slate-400 text-xs font-medium text-left">Device</th>
                      <th className="px-3 py-2.5 text-slate-400 text-xs font-medium text-right">Time</th>
                      <th className="px-3 py-2.5 text-slate-400 text-xs font-medium text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedEvents.map((event, i) => (
                      <LogRow key={event._reactId} event={event} isNew={newEventIds.has(event._reactId)} index={i} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
    </div>
  );
}
