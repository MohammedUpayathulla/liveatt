import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket, ATTENDANCE_MARKED, FACE_PRESENT, CAMERAS_UPDATED } from '../services/socket.js';
import { getCameras, getEmployees, invalidateCache } from '../services/api.js';
import api from '../services/api.js';
import cfg from '../config.js';
import { Thermometer, TrendingUp, Eye, Cloud, Droplets, Wind, Sunrise, Sunset, LogIn, LogOut, CheckCircle2, XCircle } from 'lucide-react';
import { BsCameraVideo } from 'react-icons/bs';

import AdCarousel from '../components/AdCarousel.jsx';
import WebRTCStream from '../components/WebRTCStream.jsx';
import siri1Gif from '../Assets/siri1.gif';
import ava1 from '../Assets/ava1.mp4'
import ava2 from '../Assets/ava2.mp4'
import ava3 from '../Assets/ava3.mp4'
import ava4 from '../Assets/ava4.mp4'
import ava6 from '../Assets/ava6.mp4'
import ava7 from '../Assets/ava7.mp4'
import ava8 from '../Assets/ava8.mp4'
import ava9 from '../Assets/ava9.mp4'
import ava10 from '../Assets/ava10.mp4'
import ava11 from '../Assets/ava11.mp4'
import ava12 from '../Assets/ava12.mp4'
import ava13 from '../Assets/ava13.mp4'
import ava14 from '../Assets/ava14.mp4'




import srcLogo from '../Assets/src.png';
import naviyatech from '../Assets/Naviya.png';
import cbre from '../Assets/cbre.png';



const BACKEND_BASE = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
const MAX_FEED = 50;

const FUNNY_QUOTES = [
  { en: "Welcome! The office has been looking forward to your arrival. 🎉", hi: "स्वागत है! ऑफिस आपके आने का इंतज़ार कर रहा था। 🎉", ta: "வரவேற்கிறோம்! உங்கள் வரவை அலுவலகம் எதிர்பார்த்துக் கொண்டிருந்தது. 🎉" },
  { en: "Face recognized. Attendance confirmed. You're all set for the day. 💰", hi: "चेहरा पहचाना गया। उपस्थिति दर्ज हो गई है। आगे बढ़ें। 💰", ta: "முகம் அடையாளம் காணப்பட்டது. வருகை பதிவு செய்யப்பட்டது. முன்னே செல்லுங்கள். 💰" },
  { en: "Great to see you! Showing up is already a strong start. 💪", hi: "आपको देखकर अच्छा लगा! दिन की शुरुआत शानदार है। 💪", ta: "உங்களை பார்க்க மிகவும் மகிழ்ச்சி! நாள் நல்ல முறையில் தொடங்கியுள்ளது. 💪" },
  { en: "Facial recognition succeeded—right on time! 😊", hi: "फेस रिकग्निशन सफल रहा—समय पर उपस्थिति दर्ज! 😊", ta: "முகம் அடையாளம் காணல் வெற்றிகரமாக முடிந்தது—சரியான நேரத்தில் வருகை! 😊" },
  { en: "Wishing you a productive day with short meetings and a relaxing lunch. 🥪", hi: "आपका दिन सफल हो—मीटिंग्स छोटी हों और लंच आरामदायक हो। 🥪", ta: "கூட்டங்கள் குறுகியதாகவும் மதிய உணவு அமைதியாகவும் இருக்கட்டும். 🥪" },
  { en: "Access granted. The workplace is ready for you. 🏢", hi: "प्रवेश स्वीकृत है। आपका कार्यस्थल तैयार है। 🏢", ta: "அணுகல் வழங்கப்பட்டது. உங்கள் பணியிடம் தயாராக உள்ளது. 🏢" },
  { en: "Achievement unlocked: Successfully checked in for the day. 🏅", hi: "उपलब्धि अनलॉक: आज की उपस्थिति सफलतापूर्वक दर्ज हुई। 🏅", ta: "சாதனை திறக்கப்பட்டது: இன்றைய வருகை வெற்றிகரமாக பதிவு செய்யப்பட்டது. 🏅" },
  { en: "Recognition complete. Your presence is appreciated. 👏", hi: "पहचान पूरी हुई। आपकी उपस्थिति सराहनीय है। 👏", ta: "அடையாளம் உறுதிசெய்யப்பட்டது. உங்கள் வருகை பாராட்டப்படுகிறது. 👏" },
  { en: "Checked in successfully. Ready to take on the day! 😇", hi: "उपस्थिति दर्ज। अब दिन की शुरुआत करें! 😇", ta: "வருகை பதிவு செய்யப்பட்டது. உங்கள் நாளை தொடங்குங்கள்! 😇" },
  { en: "You're here—one step closer to a successful day. 🔬", hi: "आप आ गए हैं—एक सफल दिन की ओर एक कदम और। 🔬", ta: "நீங்கள் வந்துவிட்டீர்கள்—ஒரு வெற்றிகரமான நாளுக்கு இன்னும் ஒரு படி. 🔬" },
];

function ordinal(n) {
  if (n >= 11 && n <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}
function wmoEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '⛅';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  return '⛈️';
}
function wmoLabel(code) {
  if (code === 0) return 'Clear Sky';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 67) return 'Rainy';
  if (code <= 77) return 'Snowy';
  if (code <= 82) return 'Showers';
  return 'Thunderstorm';
}

// ── Single weather info card ──────────────────────────────────────────────────
function WCard({ bg, textColor, borderColor, Icon, label, value, wide }) {
  return (
    <div
      className="flex flex-col justify-between overflow-hidden"
      style={{
        background: bg,
        borderRadius: 8,
        padding: '6px 8px',
        border: `1px solid ${borderColor || textColor + '55'}`,
        gridColumn: wide ? 'span 2' : undefined,
      }}
    >
      <div className="flex items-center justify-between ">
        <Icon size={16} strokeWidth={2.5} color={textColor} style={{ opacity: 0.9 }} />
        <span className='whitespace-nowrap' style={{ fontSize: 9, color: textColor, fontWeight: 700, opacity: 0.75, letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      <p style={{ fontSize: 'clamp(11px, 1.3vw, 15px)', fontWeight: 900, color: textColor, marginTop: 3, lineHeight: 1 }}>
        {value}
      </p>
    </div>
  );
}

// ── Time Card ────────────────────────────────────────────────────────────────
function TimeCard({ now }) {
  const rawTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const timeStr = rawTime.toUpperCase();
  const weekday = now.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).toUpperCase();
  const dateStr = now.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' }).toUpperCase();

  return (
    <div className="h-full w-full flex flex-col justify-center select-none overflow-hidden"
      style={{
        background: '#000000',
        padding: '8px 14px',
        gap: 4,
        borderRadius: 12,
        border: '0.5px solid #033FF0',
        boxShadow: '0 0 0 1px #033FF010, 0 4px 20px rgba(3,63,240,0.12)',
      }}>
      <p className="whitespace-nowrap font-black leading-none tracking-tight"
        style={{ fontSize: 'clamp(28px,4vw,48px)', letterSpacing: '-0.03em', color: '#f1f5f9' }}>
        {timeStr}
      </p>
      <p className="font-bold mt-1" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: '#94a3b8' }}>
        {weekday}, {dateStr}
      </p>
    </div>
  );
}

// ── Weather Widget ────────────────────────────────────────────────────────────
function WeatherWidget({ now }) {
  const [weather, setWeather] = useState(null);

  useEffect(() => {
    async function load(lat, lon) {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,cloud_cover,visibility` +
          `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min` +
          `&timezone=auto&forecast_days=1`
        );
        const d = await res.json();
        setWeather({
          temp: Math.round(d.current.temperature_2m),
          feelsLike: Math.round(d.current.apparent_temperature),
          code: d.current.weather_code,
          wind: Math.round(d.current.wind_speed_10m),
          humidity: d.current.relative_humidity_2m,
          cloudCover: d.current.cloud_cover,
          visibility: +(d.current.visibility / 1000).toFixed(1),
          tempMin: Math.round(d.daily.temperature_2m_min[0]),
          tempMax: Math.round(d.daily.temperature_2m_max[0]),
          sunrise: (d.daily.sunrise[0] || '').slice(11, 16),
          sunset: (d.daily.sunset[0] || '').slice(11, 16),
        });
      } catch { }
    }
    const fallback = () => load(12.7301507, 80.0001913);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => load(pos.coords.latitude, pos.coords.longitude),
        fallback, { timeout: 5000 }
      );
    } else {
      fallback();
    }
  }, []);

  return (
    <div
      className="h-full w-full flex flex-col select-none  overflow-hidden border border-[#3d3d3d] "
      style={{ background: '#000000', padding: '10px 14px', gap: 7, borderRadius: 12,   }}
    >

      {/* ── Temperature + condition  |  Sunrise & Sunset ── */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span style={{
            fontSize: 'clamp(20px, 2.4vw, 28px)', lineHeight: 1, display: 'inline-block',
            animation: 'wFloat 4s ease-in-out infinite',
            filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.15))',
          }}>
            {weather ? wmoEmoji(weather.code) : '🌤️'}
          </span>
          <div>
            <p className="font-black leading-none"
              style={{ fontSize: 'clamp(18px, 2.2vw, 26px)', letterSpacing: '-0.03em', color: '#f1f5f9' }}>
              {weather ? `${weather.temp}°C` : '--°C'}
            </p>
            <p className="font-bold mt-0.5" style={{ fontSize: 7.5, letterSpacing: '0.05em', color: '#94a3b8' }}>
              {weather ? wmoLabel(weather.code).toUpperCase() : 'LOADING…'}
            </p>
          </div>
        </div>

        {/* Sunrise / Sunset mini-cards */}
        <div className="flex gap-1.5">
          <div className="flex items-center gap-1 rounded-lg px-2 py-1"
            style={{ background: '#1a1000', border: '1px solid #44300a' }}>
            <Sunrise size={10} strokeWidth={2.5} color="#ea580c" />
            <div>
              <p className="font-black leading-none" style={{ fontSize: 9, color: '#ea580c' }}>
                {weather?.sunrise ?? '--'}
              </p>
              <p style={{ fontSize: 6, color: '#ea580c', fontWeight: 700, letterSpacing: '0.06em' }}>SUNRISE</p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg px-2 py-1"
            style={{ background: '#120a1a', border: '1px solid #3b1f5a' }}>
            <Sunset size={10} strokeWidth={2.5} color="#9333ea" />
            <div>
              <p className="font-black leading-none" style={{ fontSize: 9, color: '#9333ea' }}>
                {weather?.sunset ?? '--'}
              </p>
              <p style={{ fontSize: 6, color: '#c084fc', fontWeight: 700, letterSpacing: '0.06em' }}>SUNSET</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 6 pastel info cards (3 cols × 2 rows) ── */}
      <div
        className="flex-1 overflow-hidden"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 8, minHeight: 0 }}
      >
        <WCard bg="#1a1030" textColor="#a78bfa" borderColor="#4c1d95" Icon={Thermometer} label="FEELS LIKE"
          value={weather ? `${weather.feelsLike}°C` : '--°C'} />
        <WCard bg="#0a1f0a" textColor="#4ade80" borderColor="#166534" Icon={TrendingUp} label="MIN / MAX"
          value={weather ? `${weather.tempMin}° / ${weather.tempMax}°` : '-- / --'} />
        <WCard bg="#1a0f00" textColor="#fb923c" borderColor="#92400e" Icon={Eye} label="VISIBILITY"
          value={weather ? `${weather.visibility} km` : '-- km'} />
        <WCard bg="#050f1f" textColor="#60a5fa" borderColor="#1e3a5f" Icon={Cloud} label="CLOUD"
          value={weather ? `${weather.cloudCover}%` : '--%'} />
        <WCard bg="#001a1a" textColor="#22d3ee" borderColor="#164e63" Icon={Droplets} label="HUMIDITY"
          value={weather ? `${weather.humidity}%` : '--%'} />
        <WCard bg="#1a001a" textColor="#f472b6" borderColor="#831843" Icon={Wind} label="WIND"
          value={weather ? `${weather.wind} km/h` : '-- km/h'} />
      </div>
    </div>
  );
}

// ── Single person card — scales based on how many people are active ───────────
function transliterateHindi(name) {
  const lower = name.toLowerCase();
  const VOWS = new Set(['a', 'e', 'i', 'o', 'u']);
  const digraphCons = { 'sh': 'श', 'ch': 'च', 'kh': 'ख', 'gh': 'घ', 'ph': 'फ', 'bh': 'भ', 'dh': 'ध', 'th': 'थ', 'tr': 'त्र' };
  const singleCons = { 'b': 'ब', 'c': 'क', 'd': 'द', 'f': 'फ', 'g': 'ग', 'h': 'ह', 'j': 'ज', 'k': 'क', 'l': 'ल', 'm': 'म', 'n': 'न', 'p': 'प', 'q': 'क', 'r': 'र', 's': 'स', 't': 'त', 'v': 'व', 'w': 'व', 'y': 'य', 'z': 'ज़' };
  const vowelStd = { 'aa': 'आ', 'ee': 'ई', 'oo': 'ऊ', 'a': 'अ', 'e': 'ए', 'i': 'इ', 'o': 'ओ', 'u': 'उ' };
  const vowelMat = { 'aa': 'ा', 'ee': 'ी', 'oo': 'ू', 'a': 'ा', 'e': 'े', 'i': 'ि', 'o': 'ो', 'u': 'ु' };
  let result = '';
  let i = 0;
  let prevCons = false;
  while (i < lower.length) {
    const two = lower.slice(i, i + 2);
    const one = lower[i];
    if (digraphCons[two]) {
      result += digraphCons[two]; i += 2; prevCons = true;
    } else if (singleCons[one]) {
      result += singleCons[one]; i++; prevCons = true;
    } else if (VOWS.has(one)) {
      if ((two === 'aa' || two === 'ee' || two === 'oo') && vowelMat[two]) {
        result += prevCons ? vowelMat[two] : vowelStd[two]; i += 2;
      } else {
        result += prevCons ? vowelMat[one] : vowelStd[one]; i++;
      }
      prevCons = false;
    } else { result += one; i++; prevCons = false; }
  }
  return result;
}

function PersonCard({ card, backendBase, solo = false, compact = false }) {
  const { event, quoteIdx } = card;
  const name  = event.employee_name || event.name || 'Detected';
  const code  = event.employee_code || '';
  const imgSrc = event.employee_image || event.image_path;
  const punch = event.punch_type;
  const quoteSet = FUNNY_QUOTES[quoteIdx % FUNNY_QUOTES.length];

  const isIn  = punch === 'in';
  const isOut = punch === 'out';

  // Color palette per punch type
  const colors = isIn
    ? { a: '#00ffb3', b: '#00c97a', dark: '#001a0f', mid: '#003320', glow: '#00ffb366', badge: '#00ffb322', soft: '#00ffb388' }
    : isOut
    ? { a: '#ff4e6a', b: '#cc1f3a', dark: '#1a0008', mid: '#35000f', glow: '#ff4e6a66', badge: '#ff4e6a22', soft: '#ff4e6a88' }
    : { a: '#4db8ff', b: '#0077cc', dark: '#00091a', mid: '#001433', glow: '#4db8ff66', badge: '#4db8ff22', soft: '#4db8ff88' };

  const quoteEmoji = /\p{Emoji}/u.test(quoteSet.en.at(-1)) ? quoteSet.en.at(-1) : '💬';
  const stripEmoji = (s) => s.endsWith(quoteEmoji) ? s.slice(0, -quoteEmoji.length).trim() : s;

  /* ── COMPACT: horizontal card for 2+ person grid ── */
  if (compact) {
    const avSz = 'clamp(40px,60%,70px)'; // % of container width — never overflows the cell
    return (
      <div style={{
        height: '100%', width: '100%', display: 'flex', flexDirection: 'row',
        overflow: 'hidden', borderRadius: 14, position: 'relative',
        background: `linear-gradient(155deg, #05080f 0%, ${colors.dark} 55%, ${colors.mid} 100%)`,
        border: `1.5px solid ${colors.a}35`,
        boxShadow: `0 0 0 1px ${colors.a}10, 0 4px 30px ${colors.glow}`,
        animation: 'punchCardIn 0.5s cubic-bezier(0.22,1,0.36,1) both',
      }}>
        {/* left accent bar */}
        <div style={{ width: 4, flexShrink: 0, background: `linear-gradient(180deg,transparent,${colors.b} 25%,${colors.a} 50%,${colors.b} 75%,transparent)`, boxShadow: `2px 0 14px ${colors.glow}` }} />
        {/* background glow */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(ellipse 55% 90% at 18% 50%, ${colors.a}15 0%, transparent 60%)` }} />
        {/* avatar */}
        <div style={{ width: 'clamp(70px,24%,110px)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 2 }}>
          {[0, 1].map(i => (
            <div key={i} style={{ position: 'absolute', inset: 8 + i * 8, borderRadius: '50%', border: `1px solid ${colors.a}${i === 0 ? '45' : '20'}`, animation: `punchRipple ${2.4 + i * 0.7}s ease-out ${i * 0.9}s infinite` }} />
          ))}
          {imgSrc ? (
            <img src={`${backendBase}/${imgSrc}`} alt={name} style={{ width: avSz, height: avSz, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${colors.a}`, boxShadow: `0 0 0 3px ${colors.dark}, 0 0 22px ${colors.glow}`, position: 'relative', zIndex: 2 }} />
          ) : (
            <div style={{ width: avSz, height: avSz, borderRadius: '50%', background: `linear-gradient(135deg,${colors.b},${colors.dark})`, border: `2px solid ${colors.a}`, boxShadow: `0 0 0 3px ${colors.dark}, 0 0 22px ${colors.glow}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'clamp(18px,3.5vh,28px)', fontWeight: 900, color: '#fff', position: 'relative', zIndex: 2 }}>{name.charAt(0).toUpperCase()}</div>
          )}
        </div>
        {/* content */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8px 12px 8px 8px', gap: 5, position: 'relative', zIndex: 2, overflow: 'hidden' }}>
          <div>
            <p style={{ fontSize: 'clamp(12px,2vh,20px)', fontWeight: 900, color: '#fff', margin: 0, letterSpacing: '0.05em', textTransform: 'uppercase', textShadow: `0 0 18px ${colors.glow}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
            <p style={{ fontSize: 'clamp(9px,1.3vh,14px)', fontWeight: 700, color: 'rgba(255,255,255,0.6)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{transliterateHindi(name)}</p>
            {code && <span style={{ display: 'inline-block', marginTop: 3, fontSize: 'clamp(7px,0.9vh,10px)', fontFamily: 'monospace', letterSpacing: '0.15em', padding: '1px 8px', background: colors.badge, border: `1px solid ${colors.a}45`, borderRadius: 16, color: colors.a }}>{code}</span>}
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 12px', borderRadius: 50, background: `linear-gradient(90deg,${colors.b}55,${colors.a}33)`, border: `1.5px solid ${colors.a}`, boxShadow: `0 0 12px ${colors.glow}` }}>
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: colors.a, boxShadow: `0 0 5px ${colors.a}`, animation: 'bounceEmoji 1.4s ease-in-out infinite' }} />
            {isIn ? <LogIn size={10} color={colors.a} strokeWidth={2.5} /> : <LogOut size={10} color={colors.a} strokeWidth={2.5} />}
            <span style={{ fontSize: 'clamp(8px,1.1vh,11px)', fontWeight: 900, color: '#fff', letterSpacing: '0.18em', textTransform: 'uppercase' }}>{isIn ? 'CHECKED IN' : isOut ? 'CHECKED OUT' : 'DETECTING...'}</span>
          </div>
          <p style={{ fontSize: 'clamp(7px,0.9vh,10px)', color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{quoteEmoji} "{stripEmoji(quoteSet.en).slice(0, 65)}…"</p>
        </div>
        {/* right accent bar */}
        <div style={{ width: 3, flexShrink: 0, background: `linear-gradient(180deg,transparent,${colors.a}55,transparent)` }} />
      </div>
    );
  }

  const avatarSz = solo ? 'clamp(140px,20vh,220px)' : 'clamp(80px,12vh,130px)';
  const p        = solo ? '20px 22px' : '10px 12px';

  return (
    <div style={{
      height: '100%', width: '100%', position: 'relative', overflow: 'hidden',
      borderRadius: solo ? 28 : 18,
      background: `linear-gradient(160deg, #05080f 0%, ${colors.dark} 55%, ${colors.mid} 100%)`,
      border: `1.5px solid ${colors.a}30`,
      boxShadow: `0 0 0 1px ${colors.a}12, 0 8px 60px ${colors.glow}, inset 0 1px 0 ${colors.a}25`,
      display: 'flex', flexDirection: 'column',
      animation: 'punchCardIn 0.5s cubic-bezier(0.22,1,0.36,1) both',
    }}>

      {/* ── Decorative top hero strip ── */}
      <div style={{
        flexShrink: 0, height: solo ? 6 : 4, position: 'relative', overflow: 'hidden',
        background: `linear-gradient(90deg, transparent 0%, ${colors.b} 20%, ${colors.a} 50%, ${colors.b} 80%, transparent 100%)`,
        boxShadow: `0 2px 20px ${colors.glow}`,
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
          animation: 'spotSweep 2.2s ease-in-out infinite',
        }} />
      </div>

      {/* ── Background mesh glow ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 90% 60% at 50% 110%, ${colors.a}22 0%, transparent 65%)` }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '45%', zIndex: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 80% 100% at 50% 0%, ${colors.a}12 0%, transparent 70%)` }} />

      {/* ── Scan line on enter ── */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 1.5, zIndex: 8, pointerEvents: 'none',
        background: `linear-gradient(90deg, transparent, ${colors.a}cc, transparent)`,
        animation: 'spotSweep 1.1s ease-out 0.05s both',
      }} />

      {/* ── Main content ── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'space-evenly', position: 'relative', zIndex: 2,
        padding: p, gap: 0, overflow: 'hidden',
      }}>

        {/* ① Avatar with rings */}
        <div style={{ position: 'relative', flexShrink: 0, animation: 'namePop 0.5s cubic-bezier(0.22,1,0.36,1) 0.05s both' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              position: 'absolute',
              inset: -(14 + i * 14),
              borderRadius: '50%',
              border: `1px solid ${colors.a}${['44','28','12'][i]}`,
              animation: `punchRipple ${2.2 + i * 0.6}s ease-out ${i * 0.8}s infinite`,
            }} />
          ))}
          <div style={{
            position: 'absolute', inset: -6, borderRadius: '50%', zIndex: 0,
            background: `radial-gradient(circle, ${colors.a}38 0%, transparent 68%)`,
          }} />
          {imgSrc ? (
            <img src={`${backendBase}/${imgSrc}`} alt={name} style={{
              width: avatarSz, height: avatarSz,
              borderRadius: '50%', objectFit: 'cover',
              border: `3px solid ${colors.a}`,
              boxShadow: `0 0 0 4px ${colors.dark}, 0 0 50px ${colors.glow}, 0 0 100px ${colors.glow}`,
              position: 'relative', zIndex: 2, display: 'block',
            }} />
          ) : (
            <div style={{
              width: avatarSz, height: avatarSz, borderRadius: '50%',
              background: `linear-gradient(135deg, ${colors.b} 0%, ${colors.dark} 100%)`,
              border: `3px solid ${colors.a}`,
              boxShadow: `0 0 0 4px ${colors.dark}, 0 0 50px ${colors.glow}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: solo ? 'clamp(52px,9vh,80px)' : 'clamp(32px,6vh,52px)',
              fontWeight: 900, color: '#fff', position: 'relative', zIndex: 2,
            }}>{name.charAt(0).toUpperCase()}</div>
          )}
        </div>

        {/* ② Name block */}
        <div style={{ width: '100%', textAlign: 'center', flexShrink: 0, marginTop: solo ? 10 : 5,
          animation: 'punchLabelIn 0.4s ease 0.15s both' }}>
          <p style={{
            fontSize: solo ? 'clamp(24px,3.2vh,42px)' : 'clamp(13px,2vh,20px)',
            fontWeight: 900, color: '#ffffff', margin: 0,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            textShadow: `0 0 30px ${colors.glow}, 0 2px 8px rgba(0,0,0,0.95)`,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{name}</p>
          <p style={{
            fontSize: solo ? 'clamp(24px,3.2vh,42px)' : 'clamp(9px,1.2vh,14px)',
            fontWeight: 900, color: '#ffffff', margin: 0, marginTop: solo ? 4 : 2,
            opacity: 0.85, letterSpacing: '0.04em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{transliterateHindi(name)}</p>
          {code && (
            <div style={{ marginTop: solo ? 7 : 4, display: 'flex', justifyContent: 'center' }}>
              <span style={{
                fontSize: solo ? 12 : 9, fontFamily: 'monospace',
                letterSpacing: '0.2em', padding: solo ? '4px 16px' : '2px 10px',
                background: colors.badge, border: `1px solid ${colors.a}55`,
                borderRadius: 30, color: colors.a,
              }}>{code}</span>
            </div>
          )}
        </div>

        {/* ③ Status badge */}
        <div style={{ flexShrink: 0, marginTop: solo ? 10 : 5, animation: 'quoteFadeUp 0.4s ease 0.22s both' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: solo ? 10 : 6,
            padding: solo ? '10px 28px' : '5px 16px',
            borderRadius: 50,
            background: `linear-gradient(90deg, ${colors.b}55, ${colors.a}33)`,
            border: `1.5px solid ${colors.a}`,
            boxShadow: `0 0 24px ${colors.glow}, inset 0 1px 0 ${colors.a}40`,
          }}>
            <span style={{
              width: solo ? 8 : 6, height: solo ? 8 : 6, borderRadius: '50%',
              background: colors.a, flexShrink: 0,
              boxShadow: `0 0 8px ${colors.a}`,
              animation: 'bounceEmoji 1.4s ease-in-out infinite',
            }} />
            {isIn ? <LogIn  size={solo ? 16 : 11} color={colors.a} strokeWidth={2.5} />
                  : <LogOut size={solo ? 16 : 11} color={colors.a} strokeWidth={2.5} />}
            <span style={{
              fontSize: solo ? 14 : 10, fontWeight: 900, color: '#fff',
              letterSpacing: '0.24em', textTransform: 'uppercase',
            }}>{isIn ? 'CHECKED IN' : 'CHECKED OUT'}</span>
          </div>
        </div>

        {/* ④ Thin rule */}
        <div style={{
          width: '60%', height: 1, flexShrink: 0, marginTop: solo ? 12 : 6,
          background: `linear-gradient(90deg, transparent, ${colors.a}70, transparent)`,
          boxShadow: `0 0 10px ${colors.soft}`,
        }} />

        {/* ⑤ Quote */}
        <div style={{
          width: '100%', flexShrink: 1, minHeight: 0, overflow: 'hidden', marginTop: solo ? 8 : 4,
          animation: 'quoteFadeUp 0.5s ease 0.32s both',
        }}>
          <div style={{
            borderRadius: solo ? 16 : 10,
            padding: solo ? '10px 16px' : '6px 10px',
            background: 'rgba(255,255,255,0.035)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(10px)',
            textAlign: 'center',
          }}>
            <span style={{ fontSize: solo ? 20 : 14, display: 'block', marginBottom: solo ? 6 : 3,
              animation: 'bounceEmoji 1.8s ease-in-out infinite' }}>{quoteEmoji}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: solo ? 4 : 2 }}>
              {[
                { text: quoteSet.en, color: '#ffffff', weight: 500 },
                { text: quoteSet.hi, color: '#fde68a', weight: 400 },
                { text: quoteSet.ta, color: '#93c5fd', weight: 400 },
              ].map(({ text, color, weight }, i) => (
                <p key={i} style={{
                  fontSize: solo ? 'clamp(11px,1.3vh,14px)' : 'clamp(7px,1vh,10px)',
                  color, fontWeight: weight, lineHeight: 1.55, margin: 0,
                  overflow: 'hidden', display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  textShadow: '0 1px 8px rgba(0,0,0,0.95)',
                }}>
                  {i === 0 ? `"${stripEmoji(text)}"` : stripEmoji(text)}
                </p>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* ── Bottom glow bar ── */}
      <div style={{
        flexShrink: 0, height: solo ? 5 : 3,
        background: `linear-gradient(90deg, transparent, ${colors.b} 20%, ${colors.a} 50%, ${colors.b} 80%, transparent)`,
        boxShadow: `0 -4px 18px ${colors.glow}`,
      }} />
    </div>
  );
}

// ── Grid that shows ALL active detections at once ─────────────────────────────
// Grid column rules:
//   Portrait 1          → solo
//   Portrait 2          → 1 col  (2 cards stacked; after rotation = side-by-side)
//   Portrait 3–4        → 2 cols (2×2 grid; all cards visible, no overflow)
//   Portrait 5–6        → 2 cols (2×3)
//   Portrait 7+         → 3 cols
//   Landscape 1         → solo
//   Landscape 2         → 2 cols
//   Landscape 3–6       → 3 cols
//   Landscape 7+        → 4 cols
function DetectionHeroGrid({ cards, backendBase, isPortrait = false }) {
  const count = cards.length;
  if (count === 0) return null;

  if (count === 1) {
    return (
      <div className="h-full w-full flex items-center justify-center" style={{ padding: 'clamp(6px,1.5vh,16px)' }}>
        <div style={{ width: '100%', maxWidth: 'min(340px, 90%)', height: '100%', maxHeight: '100%' }}>
          <PersonCard card={cards[0]} backendBase={backendBase} solo />
        </div>
      </div>
    );
  }

  const cols = isPortrait
    ? (count <= 2 ? 1 : count <= 6 ? 2 : 3)
    : (count === 2 ? 2 : count <= 6 ? 3 : 4);
  const rows = Math.ceil(count / cols);

  return (
    <div
      style={{
        width: '100%', height: '100%',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: isPortrait ? 4 : 6,
        padding: isPortrait ? '4px 6px' : '8px 10px',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {cards.map((card, i) => {
        // Lone card in last row → center it (span all cols) so it doesn't sit in a tiny cell
        const isLast = i === count - 1 && count % cols !== 0;
        return (
          <div
            key={card.rid}
            style={{
              gridColumn: isLast ? `1 / -1` : undefined,
              minWidth: 0, minHeight: 0, overflow: 'hidden',
              display: 'flex', alignItems: 'stretch',
              // Limit max-width of a spanning last card so it doesn't look stretched
              ...(isLast ? { justifyContent: 'center' } : {}),
            }}
          >
            <div style={{ width: isLast ? `${100 / cols}%` : '100%', minWidth: 0 }}>
              <PersonCard card={card} backendBase={backendBase} solo={false} compact={isPortrait && cols >= 2} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Advertisement full grid — all images always visible, fills the section ─────
function AdGrid({ images }) {
  const cols = 3;
  const rows = Math.ceil(images.length / cols);

  return (
    <div
      className="flex-1 min-h-0"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: 8,
        padding: '8px 10px 10px',
      }}
    >
      {images.map((img, i) => (
        <div
          key={i}
          style={{
            borderRadius: 12,
            background: '#222222',
            border: '1px solid #e9ecef',
            boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
            padding: 10,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: `adCardIn 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 0.07}s both`,
          }}
        >
          <img
            src={img}
            alt={`Product ${i + 1}`}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
      ))}
    </div>
  );  
}

const IDLE_MSGS = [
  'Step closer and look at the camera',
  'AI is ready — show your face to check in',
  'Face recognition active',
  'Stand in front of the camera to mark attendance',
  'Biometric scan in progress',
  'Looking for a familiar face...',
];

// Face landmark positions (68-point style, scaled to 120x140 SVG)
const LM = [
  [18, 52], [24, 44], [32, 40], [42, 38], [52, 40], [62, 38], [72, 40], [80, 44], [86, 52], // jaw top
  [20, 62], [28, 70], [36, 76], [44, 80], [52, 82], [60, 80], [68, 76], [76, 70], [84, 62], // jaw bottom
  [36, 34], [42, 30], [50, 30], [58, 30], [64, 34], // left brow
  [56, 34], [62, 30], [70, 30], [78, 30], [84, 34], // right brow
  [60, 40], [60, 48], [60, 56], [60, 64], // nose bridge
  [48, 68], [52, 72], [58, 74], [62, 74], [66, 72], [72, 68], // nose base
  [36, 86], [44, 82], [52, 82], [60, 82], [68, 82], [76, 82], [84, 86], // upper lip top
  [44, 90], [52, 90], [60, 90], [68, 90], [76, 90], // lower lip
  [44, 94], [52, 96], [60, 96], [68, 96], [76, 94], // chin area
];


// ── Idle hero ─────────────────────────────────────────────────────────────────
const _PTCLS = Array.from({ length: 36 }, (_, i) => ({
  id: i,
  cx: Math.random() * 100,
  cy: Math.random() * 100,
  r: 0.15 + Math.random() * 0.25,
  dur: 8 + Math.random() * 14,
  del: Math.random() * 10,
  dx: (Math.random() - 0.5) * 32,
  dy: (Math.random() - 0.5) * 32,
  op: 0.08 + Math.random() * 0.22,
  gray: ['#ffffff', '#bbbbbb', '#777777', '#333333'][i % 4],
}));

const _BIN_L = Array.from({ length: 8 }, (_, i) => ({ id: i, del: i * 0.5, val: i % 2 === 0 ? '1 0 1 1 0' : '0 1 0 0 1' }));
const _BIN_R = Array.from({ length: 8 }, (_, i) => ({ id: i, del: i * 0.42, val: i % 2 === 0 ? '1 1 0 1 0' : '0 0 1 0 1' }));

const AVA_VIDEOS = [ ava1 , ava2 , ava4 , ava6 , ava7, ava9, ava10, ava11, ava12, ava13, ava14];

function IdleScreen({ detectionCount = 0, showSiri = false, landscape = false }) {
  const avatarSize = landscape ? 'min(38vh, 38vw)' : 'min(48vh, 48vw)';
  const [tick, setTick] = React.useState(0);
  const videoRef = React.useRef(null);
  const avatarIdx = detectionCount % AVA_VIDEOS.length;
  const currentVideo = AVA_VIDEOS[avatarIdx];

  // Restart video after key-driven remount — wait one tick so <source> is attached
  useEffect(() => {
    const id = setTimeout(() => {
      const v = videoRef.current;
      if (!v) return;
      v.load();
      v.play().catch(() => { });
    }, 0);
    return () => clearTimeout(id);
  }, [avatarIdx]);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 2200);
    return () => clearInterval(t);
  }, []);
  const msgs = ['BIOMETRIC SCAN ACTIVE', 'AI READY', 'FACE RECOGNITION ON', 'SYSTEM ONLINE'];
  const msg = msgs[tick % msgs.length];

  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: 14, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: '#000000', position: 'relative',
    }}>

      {/* dark radial — pure black centre, slightly lighter edge so vignette reads */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 78% 78% at 50% 50%, #0b0b0b 0%, #000000 72%)',
      }} />

      {/* dot-grid — near-black dots, drifting */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.16,
        backgroundImage: 'radial-gradient(circle, #1c1c1c 1px, transparent 1px)',
        backgroundSize: '34px 34px',
        animation: 'bkGridDrift 28s linear infinite',
      }} />

      {/* horizontal sweep line */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 1, pointerEvents: 'none',
        background: 'linear-gradient(90deg, transparent, #1A56FF44 25%, #1A56FF88 50%, #1A56FF44 75%, transparent)',
        animation: 'bkScanH 7s ease-in-out infinite',
      }} />

      {/* vertical sweep line */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, width: 1, pointerEvents: 'none',
        background: 'linear-gradient(180deg, transparent, #1A56FF33 30%, #1A56FF66 50%, #1A56FF33 70%, transparent)',
        animation: 'bkScanV 10s ease-in-out infinite',
      }} />

      {/* floating dust particles */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        {_PTCLS.map(p => (
          <circle key={p.id} cx={p.cx} cy={p.cy} r={p.r} fill={p.gray} opacity={p.op}>
            <animateMotion dur={`${p.dur}s`} begin={`${p.del}s`} repeatCount="indefinite"
              path={`M0,0 Q${p.dx * 0.5},${p.dy * 0.4} ${p.dx},${p.dy} T0,0`} />
            <animate attributeName="opacity" values={`${p.op};${p.op * 0.08};${p.op}`}
              dur={`${p.dur * 0.75}s`} begin={`${p.del}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </svg>

      {/* 4 corner brackets */}
      {[
        { top: 14, left: 14, rotate: 0 },
        { top: 14, right: 14, rotate: 90 },
        { bottom: 14, right: 14, rotate: 180 },
        { bottom: 14, left: 14, rotate: 270 },
      ].map((pos, i) => (
        <svg key={i} width="34" height="34" viewBox="0 0 34 34" fill="none"
          style={{ position: 'absolute', ...pos, transform: `rotate(${pos.rotate}deg)`, animation: `bkCorner 4.5s ease-in-out ${i * 0.8}s infinite` }}>
          <path d="M5 22 L5 5 L22 5" stroke="#1A56FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 14 L5 5 L14 5" stroke="#1A56FF" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
          <circle cx="5" cy="5" r="2.2" fill="#000000" />
          <circle cx="5" cy="5" r="1" fill="#1A56FF" />
        </svg>
      ))}

      {/* left binary column */}
      <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 11, pointerEvents: 'none' }}>
        {_BIN_L.map(row => (
          <div key={row.id} style={{ fontSize: 7, fontFamily: 'monospace', letterSpacing: '0.16em', color: '#1A56FF', animation: `bkBin 3.2s ease-in-out ${row.del}s infinite` }}>
            {row.val}
          </div>
        ))}
      </div>

      {/* right binary column */}
      <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 11, pointerEvents: 'none', alignItems: 'flex-end' }}>
        {_BIN_R.map(row => (
          <div key={row.id} style={{ fontSize: 7, fontFamily: 'monospace', letterSpacing: '0.16em', color: '#1A56FF', animation: `bkBin 3.8s ease-in-out ${row.del}s infinite` }}>
            {row.val}
          </div>
        ))}
      </div>


      {/* left & right side accent bars */}
      {['left', 'right'].map(side => (
        <div key={side} style={{
          position: 'absolute', [side]: 0, top: '18%', bottom: '18%', width: 1,
          background: 'linear-gradient(180deg, transparent, #1A56FF44 35%, #1A56FF88 50%, #1A56FF44 65%, transparent)',
          animation: `bkSideBar 5s ease-in-out ${side === 'right' ? '1.8s' : '0s'} infinite`,
          pointerEvents: 'none',
        }} />
      ))}

      {/* top status pill */}
      <div style={{
        position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
        whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 7,
        padding: '3px 18px', borderRadius: 20,
        background: '#000000', border: '1px solid #1A56FF55',
        pointerEvents: 'none',
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: '50%', display: 'inline-block',
          background: '#1A56FF', boxShadow: '0 0 8px #1A56FFaa',
          animation: 'bkDot 1.5s ease-in-out infinite',
        }} />
        <span style={{
          fontSize: 8.5, fontFamily: 'monospace', fontWeight: 700,
          color: '#1A56FF', letterSpacing: '0.22em',
        }}>
          {msg}
        </span>
      </div>

      {/* bottom metric tags */}
      <div style={{
        position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 20, pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>
        {[
          { label: 'ACCURACY', value: '99.8%' },
          { label: 'LATENCY', value: '<50ms' },
          { label: 'ENGINE', value: 'InsightFace' },
        ].map((m, i) => (
          <div key={m.label} style={{ textAlign: 'center', animation: `bkMetric 1.2s ease ${i * 0.2}s both` }}>
            <p style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 800, color: '#1A56FF', letterSpacing: '0.08em', margin: 0 }}>{m.value}</p>
            <p style={{ fontSize: 6, color: '#1A56FFaa', letterSpacing: '0.1em', margin: '2px 0 0' }}>{m.label}</p>
          </div>
        ))}
      </div>

      {/* center — avatar video */}
      <div style={{
        position: 'relative', zIndex: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 0, flex: 1, justifyContent: 'center', paddingBottom: 48,
      }}>
        {/* glow ring behind video */}

        <video
          ref={videoRef}
          key={avatarIdx}
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: avatarSize,
            height: avatarSize,
            objectFit: 'cover',
            borderRadius: '50%',
            border: '1px solid #1A56FF44',
            // boxShadow: '10px 10px 32px #1A56FF55',
            boxShadow: '0px 10px 32px #1A56FF55, 0px -10px 32px #1A56FF55',
            position: 'relative', zIndex: 1,
          }}
        >
          <source src={currentVideo} type="video/mp4" />
        </video>

        

      </div>

      <style>{`
        @keyframes bkGridDrift { from { backgroundPosition: 0 0; } to { backgroundPosition: 34px 34px; } }
        @keyframes bkScanH    { 0%,100% { top:  8%; opacity:.05; } 50% { top: 92%; opacity:.2; } }
        @keyframes bkScanV    { 0%,100% { left: 8%; opacity:.04; } 50% { left:92%; opacity:.16; } }
        @keyframes bkCorner   { 0%,100% { opacity:.18; } 50% { opacity:.55; } }
        @keyframes bkBin      { 0%,100% { opacity:.1; } 50% { opacity:.38; } }

        @keyframes bkSideBar  { 0%,100% { opacity:.12; } 50% { opacity:.45; } }
        @keyframes bkDot      { 0%,100% { opacity:.4; box-shadow:0 0 4px #1A56FF; } 50% { opacity:1; box-shadow:0 0 12px #1A56FFcc; } }
        @keyframes bkMetric   { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FullScreenDetection() {
  const navigate = useNavigate();

  const [feedEvents, setFeedEvents] = useState(() => {
    try { const s = sessionStorage.getItem('liveAttendanceFeed'); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });
  const [newEventIds, setNewEventIds] = useState(new Set());
  const [activeCards, setActiveCards] = useState(new Map());
  const [cameras, setCameras] = useState([]);
  const [selectedCamIdx, setSelectedCamIdx] = useState(0);
  const [streamKey, setStreamKey] = useState(0);
  const [streamStatus, setStreamStatus] = useState('connecting');
  const [now, setNow] = useState(() => new Date());
  const [fsActive, setFsActive] = useState(!!document.fullscreenElement);
  const [fsBlocked, setFsBlocked] = useState(false);
  const [isPortraitLayout, setIsPortraitLayout] = useState(true);
  const [layoutMode, setLayoutMode] = useState('portrait'); // 'portrait' | 'landscape'
  // true when the OS/browser viewport is already portrait (height > width)
  // In that case we must NOT apply rotate(90deg) — the screen handles it already
  const [screenIsPortrait, setScreenIsPortrait] = useState(
    () => window.innerHeight > window.innerWidth
  );
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [detectionBoxes, setDetectionBoxes] = useState({});
  const cardTimersRef = useRef(new Map());
  const streamRetryTimer = useRef(null);
  const streamWatchdog = useRef(null);   // kicks in if stream stays non-live too long
  const saveTimer = useRef(null);
  const videoRef = useRef(null);
  const thumbnailVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const hlsRef = useRef(null);
  const clearedAt = useRef((() => {
    try { const ts = sessionStorage.getItem('liveAttendanceClearedAt'); return ts ? parseInt(ts, 10) : null; }
    catch { return null; }
  })());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { sessionStorage.setItem('liveAttendanceFeed', JSON.stringify(feedEvents)); } catch { }
    }, 300);
    return () => clearTimeout(saveTimer.current);
  }, [feedEvents]);

  useEffect(() => () => { cardTimersRef.current.forEach((id) => clearTimeout(id)); }, []);

  useEffect(() => {
    function onFsChange() {
      const inFs = !!document.fullscreenElement;
      setFsActive(inFs);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    const el = document.documentElement;
    if (document.fullscreenElement) {
      setFsActive(true);
    } else if (el.requestFullscreen) {
      el.requestFullscreen()
        .then(() => setFsActive(true))
        .catch(() => setFsBlocked(true));
    } else {
      setFsBlocked(true);
    }
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
    };
  }, []);

  // Keep isPortraitLayout in sync with layoutMode
  useEffect(() => {
    setIsPortraitLayout(layoutMode === 'portrait');
  }, [layoutMode]);

  // Track real screen orientation — re-evaluate on resize / orientation change
  useEffect(() => {
    const check = () => setScreenIsPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        // Exit fullscreen if in fullscreen, otherwise do nothing
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    console.log('[CAMERAS] Fetching cameras from API...');
    getCameras().then((data) => {
      const cameraList = Array.isArray(data) ? data : data.cameras || [];
      console.log('[CAMERAS] Received:', cameraList.length, 'cameras');
      cameraList.forEach((cam, idx) => {
        console.log(`[CAMERAS] Camera ${idx}:`, { id: cam.id, name: cam.name, rtsp_url: cam.rtsp_url });
      });
      setCameras(cameraList);
    }).catch((err) => {
      console.error('[CAMERAS] Fetch failed:', err.message);
      setError('Failed to load cameras: ' + err.message);
    });

    getEmployees().then((data) => {
      const list = Array.isArray(data) ? data : data.employees || [];
      // console.log('[EMPLOYEES] Loaded:', list.length, 'employees');
      setTotalEmployees(list.length);
    }).catch((err) => {
      console.error('[EMPLOYEES] Fetch failed:', err);
    });

    function onHealth({ camera_id, online_status }) {
      console.log('[HEALTH] Camera', camera_id, 'status:', online_status);
      setCameras((prev) => prev.map((c) => c.id === camera_id ? { ...c, online_status } : c));
    }
    function onCamerasUpdated() {
      console.log('[CAMERAS] Update event received, refreshing...');
      invalidateCache('cameras');
      getCameras().then((data) => setCameras(Array.isArray(data) ? data : data.cameras || [])).catch(() => { });
    }
    socket.on('device_health_update', onHealth);
    socket.on(CAMERAS_UPDATED, onCamerasUpdated);
    return () => {
      socket.off('device_health_update', onHealth);
      socket.off(CAMERAS_UPDATED, onCamerasUpdated);
    };
  }, []);

  // Watchdog: if stream stays non-live for >20s (e.g. hung TCP that never fires onError),
  // force a retry. This is a safety net on top of the backend's 15s frame timeout.
  useEffect(() => {
    clearTimeout(streamWatchdog.current);
    if (streamStatus !== 'live') {
      streamWatchdog.current = setTimeout(() => {
        setStreamStatus('connecting');
        setStreamKey((k) => k + 1);
      }, 20_000);
    }
    return () => clearTimeout(streamWatchdog.current);
  }, [streamStatus, streamKey]);

  useEffect(() => {
    function handleAttendance(event) {
      const code = event.employee_code || String(Math.random());
      const rid = `fs-${Date.now()}-${Math.random()}`;
      const quoteIdx = Math.floor(Math.random() * FUNNY_QUOTES.length);
      const enriched = { ...event, _reactId: rid };
      setFeedEvents((prev) => [enriched, ...prev].slice(0, MAX_FEED));
      setNewEventIds((prev) => { const s = new Set(prev); s.add(rid); return s; });
      setTimeout(() => setNewEventIds((prev) => { const s = new Set(prev); s.delete(rid); return s; }), 4000);
      if (cardTimersRef.current.has(code)) clearTimeout(cardTimersRef.current.get(code));
      setActiveCards((prev) => { const n = new Map(prev); n.set(code, { event: enriched, rid, quoteIdx }); return n; });
      const timer = setTimeout(() => {
        setActiveCards((prev) => { const n = new Map(prev); n.delete(code); return n; });
        cardTimersRef.current.delete(code);
      }, 10_000);
      cardTimersRef.current.set(code, timer);
    }
    socket.on(ATTENDANCE_MARKED, handleAttendance);
    return () => socket.off(ATTENDANCE_MARKED, handleAttendance);
  }, []);

  useEffect(() => {
    // Ensure this page is in the web_clients room so detection_frame events are received
    function onConnect() { socket.emit('join_web'); }
    socket.on('connect', onConnect);
    if (socket.connected) socket.emit('join_web');
    return () => socket.off('connect', onConnect);
  }, []);

  useEffect(() => {
    function handleDetectionFrame(data) {
      setDetectionBoxes((prev) => ({ ...prev, [data.stream]: data }));
    }
    socket.on('detection_frame', handleDetectionFrame);
    return () => socket.off('detection_frame', handleDetectionFrame);
  }, []);

  useEffect(() => {
    function handlePresence(event) {
      const code = event.employee_code;
      if (!code) return;
      if (cardTimersRef.current.has(code)) clearTimeout(cardTimersRef.current.get(code));
      const presRid = `pres-${Date.now()}-${Math.random()}`;
      const presQuoteIdx = Math.floor(Math.random() * FUNNY_QUOTES.length);
      setActiveCards((prev) => {
        if (prev.has(code)) return prev;
        if (!event.employee_name) return prev;
        const next = new Map(prev);
        next.set(code, { event: { ...event, _reactId: presRid, punch_type: '' }, rid: presRid, quoteIdx: presQuoteIdx });
        return next;
      });
      const timer = setTimeout(() => {
        setActiveCards((prev) => { const n = new Map(prev); n.delete(code); return n; });
        cardTimersRef.current.delete(code);
      }, 10_000);
      cardTimersRef.current.set(code, timer);
    }
    socket.on(FACE_PRESENT, handlePresence);
    return () => socket.off(FACE_PRESENT, handlePresence);
  }, []);

  useEffect(() => {
    function handleToday({ logs }) {
      if (!logs?.length) return;
      setFeedEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id).filter(Boolean));
        const cutoff = clearedAt.current;
        const incoming = logs
          .filter((l) => !existingIds.has(l.id))
          .filter((l) => !cutoff || !l.timestamp || new Date(l.timestamp).getTime() > cutoff)
          .map((l) => ({ ...l, _reactId: `db-${l.id}` }));
        if (!incoming.length) return prev;
        return [...incoming, ...prev].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, MAX_FEED);
      });
    }
    socket.on('attendance_today', handleToday);
    return () => socket.off('attendance_today', handleToday);
  }, []);

  const handleClear = useCallback(() => {
    const ts = Date.now();
    clearedAt.current = ts;
    setFeedEvents([]);
    setNewEventIds(new Set());
    cardTimersRef.current.forEach((id) => clearTimeout(id));
    cardTimersRef.current.clear();
    setActiveCards(new Map());
    try {
      sessionStorage.removeItem('liveAttendanceFeed');
      sessionStorage.setItem('liveAttendanceClearedAt', String(ts));
    } catch { }
  }, []);

  const activeCount = activeCards.size;
  const currentCam = cameras[selectedCamIdx];

  useEffect(() => {
    // console.log('[CURRENTCAM] Updated - selectedIdx:', selectedCamIdx, 'camera:', currentCam ? { id: currentCam.id, name: currentCam.name } : 'UNDEFINED');
  }, [currentCam, selectedCamIdx]);

  // Streaming is now handled by <LiveStreamDisplay> component — no effect needed here

  // ── Bbox canvas overlay ───────────────────────────────────────────────────────
  // Keep latest values in refs so the paint fn always sees current data without
  // being recreated (avoids stale-closure bugs and unnecessary ResizeObserver resets).
  const detectionBoxesRef = useRef({});
  const currentCamRef     = useRef(null);
  const bboxRafRef        = useRef(null);
  useEffect(() => { detectionBoxesRef.current = detectionBoxes; }, [detectionBoxes]);
  useEffect(() => { currentCamRef.current = currentCam; }, [currentCam]);

  const paintBbox = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (!w || !h) return;
    if (canvas.width !== w)  canvas.width  = w;
    if (canvas.height !== h) canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const cam = currentCamRef.current;
    if (!cam) return;

    const ROI_W = 640, ROI_H = 480;
    const sx = w / ROI_W;
    const sy = h / ROI_H;

    // ROI zone — bright green solid box
    const { roi_x, roi_y, roi_width, roi_height } = cam;
    if (roi_x != null && roi_y != null && roi_width != null && roi_height != null) {
      ctx.strokeStyle = '#49ff00';
      ctx.lineWidth   = 2;
      ctx.strokeRect(roi_x * sx, roi_y * sy, roi_width * sx, roi_height * sy);
    }

    // Face bboxes — green for known, red for unknown
    const frameData = detectionBoxesRef.current[cam.name];
    if (frameData?.faces?.length) {
      const bx = w / (frameData.frame_w || ROI_W);
      const by = h / (frameData.frame_h || ROI_H);
      frameData.faces.forEach(({ x1, y1, x2, y2, known }) => {
        ctx.strokeStyle = known ? '#22c55e' : '#ef4444';
        ctx.lineWidth   = 2;
        ctx.strokeRect(x1 * bx, y1 * by, (x2 - x1) * bx, (y2 - y1) * by);
      });
    }
  }, []);

  const scheduleBboxPaint = useCallback(() => {
    if (bboxRafRef.current) cancelAnimationFrame(bboxRafRef.current);
    bboxRafRef.current = requestAnimationFrame(paintBbox);
  }, [paintBbox]);

  // Repaint whenever detection data or camera changes
  useEffect(() => { scheduleBboxPaint(); }, [detectionBoxes, currentCam, scheduleBboxPaint]);

  // ResizeObserver on the canvas — repaints when stream container resizes or layout switches
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => scheduleBboxPaint());
    ro.observe(canvas);
    scheduleBboxPaint(); // paint immediately after layout change
    return () => { ro.disconnect(); if (bboxRafRef.current) cancelAnimationFrame(bboxRafRef.current); };
  }, [scheduleBboxPaint, layoutMode]);

  // All currently-active detected persons — shown simultaneously in the grid
  const heroCards = [...activeCards.values()];
  const footerDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/\//g, '-');
  const footerTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

  if (!fsActive && fsBlocked) {
    return (
      <div
        className="fixed inset-0 flex flex-col items-center justify-center bg-slate-950 cursor-pointer select-none"
        onClick={() => {
          const el = document.documentElement;
          if (el.requestFullscreen) {
            el.requestFullscreen()
              .then(() => { setFsActive(true); setFsBlocked(false); setIsPortraitLayout(true); })
              .catch(() => { });
          }
        }}
      >
        <svg className="w-16 h-16 text-slate-400 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5h-4m4 0v-4m0 4l-5-5" />
        </svg>
        <p className="text-white text-xl font-semibold mb-2">Tap to enter fullscreen</p>
        <p className="text-slate-500 text-sm">Browser requires a tap to enable fullscreen mode</p>
      </div>
    );
  }

  // Only apply CSS rotate(90deg) when the browser viewport is LANDSCAPE
  // (width > height). If the OS/Windows already rotated the display to portrait
  // (height > width), adding another 90deg rotation would flip everything sideways.
  const needsCssRotation = isPortraitLayout && !screenIsPortrait;

  const rootStyle = needsCssRotation ? {
    position: 'fixed',
    width: '100vh', height: '100vw',
    top: 'calc((100vh - 100vw) / 2)',
    left: 'calc((100vw - 100vh) / 2)',
    transform: 'rotate(90deg)',
    transformOrigin: 'center center',
    overflow: 'hidden',
    background: '#000000',
  } : {
    position: 'fixed', inset: 0,
    overflow: 'hidden',
    background: '#000000',
  };

  return (

    <div className="flex flex-col" style={rootStyle}>

      {/* ══ HEADER ═════════════════════════════════════════════════════════ */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-4"
        style={{
          height: 48,
          background: 'linear-gradient(90deg, #111111 0%, #1a1a1a 100%)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.06), 0 4px 20px rgba(0,0,0,0.6)',
          borderBottom: '1px solid #2a2a2a',
        }}
      >
        {/* Left — icon only */}
        <BsCameraVideo size={18} color="#e2e8f0" href='/dashbard'/>

        {/* Right — logos + CBRE tag */}
      <div className="flex items-center gap-2 ">
          <img src={naviyatech} alt="Naviya" className="object-contain" style={{ height: 22, opacity: 0.9 }} />
          <div className="w-px h-5" style={{ background: '#333' }} />
          <img src={srcLogo} alt="SRC" className="object-contain" style={{ height: 30, opacity: 0.9 }} />
          <div className="w-px h-5" style={{ background: '#333' }} />
          <img src={cbre} alt="" style={{ height: 20, opacity: 0.9 }} />
        </div>
      </header>

      {/* ══ BODY ═══════════════════════════════════════════════════════════ */}
      {layoutMode === 'landscape' ? (
        /* ────────────────── LANDSCAPE LAYOUT ────────────────── */
        <div className="flex-1 flex flex-col overflow-hidden" style={{ gap: 6, padding: 6 }}>

          {/* Top 3-column row */}
          <div className="flex-1 flex overflow-hidden" style={{ gap: 0 }}>

            {/* COL 1 — Camera stream → Today's Attendance → Weather */}
            <div className="flex flex-col overflow-hidden" style={{ width: '26%', gap: 4, paddingRight: 6 }}>

              {/* Camera stream */}
              <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ borderRadius: 14, background: '#0a0f1a', height: '32%' }}>
                {/* Camera selector bar */}
                <div className="flex items-center justify-between flex-shrink-0 px-2 py-1" style={{ background: '#0d1421', borderBottom: '1px solid #1e293b' }}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${streamStatus === 'live' ? 'bg-green-400 animate-pulse' : streamStatus === 'error' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`} />
                    <span className="text-[9px] font-bold text-white tracking-wide">
                      {streamStatus === 'live' ? 'LIVE' : streamStatus === 'error' ? 'RETRY' : 'CONN'}
                    </span>
                  </div>
                  <select value={selectedCamIdx} onChange={e => { setSelectedCamIdx(Number(e.target.value)); setStreamStatus('connecting'); setStreamKey(k => k + 1); }}
                    className="text-[9px] font-semibold text-white rounded px-1.5 py-0.5 outline-none cursor-pointer"
                    style={{ background: '#1e293b', border: '1px solid #334155', maxWidth: '65%' }}>
                    {cameras.map((c, i) => <option key={c.id} value={i}>{c.name}</option>)}
                  </select>
                </div>
                {/* Stream */}
                <div className="relative flex-1 overflow-hidden" style={{ background: '#0f172a', willChange: 'contents' }}>
                  {/* WebRTC stream via mediamtx WHEP */}
                  <div className="relative w-full h-full bg-slate-900" style={{ display: currentCam ? 'block' : 'none' }}>
                    <WebRTCStream key={`portrait-${currentCam?.id}`} whepUrl={currentCam?.whep_url} />
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-0 w-full h-full"
                      style={{ pointerEvents: 'none', zIndex: 3, background: 'transparent' }}
                    />
                    {activeCount >= 3 && (
                      <div className="absolute top-2 right-2 bg-amber-500 text-white px-3 py-1 rounded-full text-sm font-semibold" style={{ zIndex: 20 }}>
                        🔍 {activeCount} DETECTED
                      </div>
                    )}
                  </div>
                  {/* No cameras message */}
                  {!currentCam && (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>
                      <p className="text-gray-400 text-xs">No cameras</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Time Card */}
              <div className="flex-shrink-0" style={{ height: '12vh' }}>
                <TimeCard now={now} />
              </div>

              {/* Today's Attendance */}
              {(() => {
                const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                let todayIn = 0, todayOut = 0;
                const seen = new Set();
                feedEvents.forEach(ev => {
                  const ts = ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null;
                  if (ts !== todayStr) return;
                  const key = `${ev.employee_code || ev.id}-${ev.punch_type}`;
                  if (seen.has(key)) return;
                  seen.add(key);
                  if (ev.punch_type === 'in') todayIn++;
                  else if (ev.punch_type === 'out') todayOut++;
                });
                const total = todayIn + todayOut;
                const inPct = total > 0 ? Math.round((todayIn / total) * 100) : 0;
                return (
                  <div className="flex-shrink-0" style={{ height: '15vh', borderRadius: 12, background: '#000000', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', border: '1px solid #222', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div className="flex items-center justify-between flex-shrink-0">
                      <span className='text-[12px] font-bold text-gray-100'>Today's Attendance</span>
                      <span className='text-[11px] font-medium text-gray-300'>{now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase()}</span>
                    </div>
                    <div className="flex gap-1.5 flex-1">
                      {/* Check-in */}
                      <div className="flex-1 relative overflow-hidden flex flex-col justify-between"
                        style={{ borderRadius: 8, background: '#0a1f0a', padding: '5px 7px', border: '1px solid #166534' }}>
                        <div className="flex items-center justify-between">
                          <LogIn size={12} color="#4ade80" strokeWidth={2.5} />
                          <span style={{ fontSize: 6.5, fontWeight: 800, color: '#4ade80', letterSpacing: '0.08em' }}>CHECK-IN</span>
                        </div>
                        <p style={{ fontSize: 22, fontWeight: 900, color: '#4ade80', lineHeight: 1, marginTop: 2 }}>{todayIn}</p>
                        <p style={{ fontSize: 6, color: '#4ade80', fontWeight: 600 }}>in office today</p>
                      </div>
                      {/* Check-out */}
                      <div className="flex-1 relative overflow-hidden flex flex-col justify-between"
                        style={{ borderRadius: 8, background: '#1a0f00', padding: '5px 7px', border: '1px solid #92400e' }}>
                        <div className="flex items-center justify-between">
                          <LogOut size={12} color="#ea580c" strokeWidth={2.5} />
                          <span style={{ fontSize: 6.5, fontWeight: 800, color: '#fb923c', letterSpacing: '0.08em' }}>CHECK-OUT</span>
                        </div>
                        <p style={{ fontSize: 22, fontWeight: 900, color: '#f97316', lineHeight: 1, marginTop: 2 }}>{todayOut}</p>
                          <p style={{ fontSize: 6, color: '#fb923c', fontWeight: 600 }}>left office today</p>
                      </div>
                      {/* Total Employees */}
                      <div className="flex-1 relative overflow-hidden flex flex-col justify-between"
                        style={{ borderRadius: 8, background: '#120a1f', padding: '5px 7px', border: '1px solid #6d28d9' }}>
                        <div className="flex items-center justify-between">
                          <CheckCircle2 size={12} color="#a78bfa" strokeWidth={2.5} />
                          <span style={{ fontSize: 6.5, fontWeight: 800, color: '#a78bfa', letterSpacing: '0.08em' }}>TOTAL EMP</span>
                        </div>
                        <p style={{ fontSize: 22, fontWeight: 900, color: '#a78bfa', lineHeight: 1, marginTop: 2 }}>{totalEmployees || '—'}</p>
                        <p style={{ fontSize: 6, color: '#a78bfa', fontWeight: 600 }}>registered</p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Weather */}
              <div className="flex-1 min-h-0 overflow-hidden" style={{ borderRadius: 14, border: '1px solid #2a2a2a' }}>
                <WeatherWidget now={now} />
              </div>
            </div>

            {/* Divider 1 */}
            <div style={{
              width: 1, flexShrink: 0, alignSelf: 'stretch', margin: '0 6px',
              background: 'linear-gradient(180deg, transparent 0%, #1A56FF55 15%, #1A56FFcc 40%, #60a5fa 50%, #1A56FFcc 60%, #1A56FF55 85%, transparent 100%)',
              boxShadow: '0 0 8px #1A56FF88, 0 0 20px #1A56FF33',
              borderRadius: 2,
              position: 'relative',
            }}>
              {/* diamond accent at center */}
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%) rotate(45deg)',
                width: 7, height: 7,
                background: '#60a5fa',
                boxShadow: '0 0 10px #60a5facc',
              }} />
            </div>

            {/* COL 2 — Hero / video on top, AdCarousel below */}
            <div className="flex flex-col overflow-hidden" style={{ width: '42%', gap: 6, paddingLeft: 2, paddingRight: 2 }}>
              <div className="flex-1 min-h-0" style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#222222', border: '1px solid #222222' }}>
                {heroCards.length > 0 ? <DetectionHeroGrid cards={heroCards} backendBase={BACKEND_BASE} /> : <IdleScreen detectionCount={feedEvents.length} landscape />}
              </div>
              {/* AdCarousel below animation */}
              <div className="flex-shrink-0" style={{ height: 295, borderRadius: 14, overflow: 'hidden' }}>
                <AdCarousel />
              </div>
            </div>

            {/* Divider 2 */}
            <div style={{
              width: 1, flexShrink: 0, alignSelf: 'stretch', margin: '0 6px',
              background: 'linear-gradient(180deg, transparent 0%, #6366f155 15%, #6366f1cc 40%, #a78bfa 50%, #6366f1cc 60%, #6366f155 85%, transparent 100%)',
              boxShadow: '0 0 8px #6366f188, 0 0 20px #6366f133',
              borderRadius: 2,
              position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%) rotate(45deg)',
                width: 7, height: 7,
                background: '#a78bfa',
                boxShadow: '0 0 10px #a78bfacc',
              }} />
            </div>

            {/* COL 3 — Detection Log (full height) */}
            <div className="flex-1 flex flex-col overflow-hidden" style={{ borderRadius: 14, background: '#000000', border: '1px solid #222', boxShadow: '0 4px 24px rgba(139,92,246,0.12)' }}>
              <div className="flex-shrink-0 px-3 py-2" style={{ background: '#0a0a0a', borderBottom: '1px solid #2a2a2a' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#6366f1,#3b82f6)' }} />
                    <span className="text-[11px] font-bold text-blue-400 tracking-wider">DETECTION LOG</span>
                    {activeCount > 0 && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full animate-pulse" style={{ background: '#052e16', color: '#4ade80', border: '1px solid #166534' }}>{activeCount} ACTIVE</span>}
                  </div>
                  <span className="text-[9px] text-gray-400">{feedEvents.length} records</span>
                </div>
              </div>
              {(() => {
                const LOG_ROWS = 19;
                const real = feedEvents.slice(0, LOG_ROWS);
                const skeletonCount = LOG_ROWS - real.length;
                return (
                  <div className="flex-1 overflow-hidden" style={{ display: 'flex', flexDirection: 'column' }}>
                    <table className="w-full" style={{ tableLayout: 'fixed' }}>
                      <thead style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
                        <tr>
                          <th style={{ width: 36, padding: '7px 8px', fontSize: 9, fontWeight: 700, color: '#cbd5e1', textAlign: 'center', letterSpacing: '0.08em' }}>NO</th>
                          <th style={{ padding: '7px 8px', fontSize: 9, fontWeight: 700, color: '#cbd5e1', textAlign: 'left', letterSpacing: '0.08em' }}>EMPLOYEE</th>
                          <th style={{ width: 60, padding: '7px 8px', fontSize: 9, fontWeight: 700, color: '#cbd5e1', textAlign: 'center', letterSpacing: '0.08em' }}>TYPE</th>
                          <th style={{ width: 54, padding: '7px 8px', fontSize: 9, fontWeight: 700, color: '#cbd5e1', textAlign: 'right', letterSpacing: '0.08em' }}>TIME</th>
                        </tr>
                      </thead>
                      <tbody>
                        {real.map((event, i) => {
                          const name = event.employee_name || event.name || 'Unknown';
                          const code = event.employee_code || '';
                          const punch = event.punch_type || '';
                          const imgSrc = event.employee_image || event.image_path || null;
                          const timeStr = event.timestamp ? new Date(event.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
                          const isNew = newEventIds.has(event._reactId);
                          const isIn = punch === 'in';
                          const isOut = punch === 'out';
                          const punchColor = isIn ? '#22c55e' : isOut ? '#ef4444' : '#60a5fa';
                          const punchBg = isIn ? '#052e16' : isOut ? '#450a0a' : '#020d1f';
                          const punchBdr = isIn ? '#166534' : isOut ? '#7f1d1d' : '#1e3a5f';
                          return (
                            <tr key={event._reactId} style={{ borderBottom: '1px solid #111111', background: isNew ? 'rgba(34,197,94,0.08)' : i % 2 === 0 ? '#0a0a0a' : '#0d0d0d', animation: isNew ? 'rowSlideIn 0.35s ease-out' : 'none' }}>
                              <td style={{ padding: '6px 8px', fontSize: 10, color: '#94a3b8', textAlign: 'center', fontWeight: 700 }}>{i + 1}</td>
                              <td style={{ padding: '6px 8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {imgSrc ? (
                                    <img src={`${BACKEND_BASE}/${imgSrc}`} alt={name} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1.5px solid ${punchColor}` }} onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                                  ) : null}
                                  <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: imgSrc ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: '#1e3a5f', color: '#93c5fd', border: '1.5px solid #1d4ed8' }}>
                                    {name.charAt(0).toUpperCase()}
                                  </div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{name}</p>
                                    {code && <p style={{ fontSize: 8, color: '#64748b', margin: 0, lineHeight: 1.2 }}>{code}</p>}
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                {punch ? (
                                  <span className='whitespace-nowrap' style={{ display: 'inline-block', fontSize: 8, fontWeight: 900, padding: '2px 7px', borderRadius: 20, background: punchBg, color: punchColor, border: `1px solid ${punchBdr}`, letterSpacing: '0.1em' }}>
                                    {isIn ? '▲ IN' : isOut ? '▼ OUT' : punch.toUpperCase()}
                                  </span>
                                ) : <span style={{ fontSize: 8, color: '#475569' }}>—</span>}
                              </td>
                              <td style={{ padding: '6px 8px', fontSize: 9, color: '#ffffff', textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{timeStr}</td>
                            </tr>
                          );
                        })}
                        {Array.from({ length: skeletonCount }, (_, si) => (
                          <tr key={`lsk-${si}`} style={{ borderBottom: '1px solid #0d0d0d', background: (real.length + si) % 2 === 0 ? '#111111' : '#141414' }}>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <div style={{ width: 16, height: 8, borderRadius: 4, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', margin: '0 auto', animation: `skelShimmer 1.6s ease-in-out ${si * 0.12}s infinite` }} />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', animation: `skelShimmer 1.6s ease-in-out ${si * 0.14}s infinite` }} />
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <div style={{ height: 7, borderRadius: 4, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', width: '65%', animation: `skelShimmer 1.6s ease-in-out ${si * 0.16}s infinite` }} />
                                  <div style={{ height: 5, borderRadius: 4, background: 'linear-gradient(90deg,#222222,#2e2e2e,#222222)', backgroundSize: '200% 100%', width: '42%', animation: `skelShimmer 1.6s ease-in-out ${si * 0.18}s infinite` }} />
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                              <div style={{ width: 38, height: 14, borderRadius: 10, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', margin: '0 auto', animation: `skelShimmer 1.6s ease-in-out ${si * 0.2}s infinite` }} />
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <div style={{ width: 30, height: 8, borderRadius: 4, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', marginLeft: 'auto', animation: `skelShimmer 1.6s ease-in-out ${si * 0.22}s infinite` }} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

          </div>
        </div>
      ) : (
        /* ────────────────── PORTRAIT LAYOUT (original) ────────────────── */
        <>
          <div className="flex-1 flex overflow-hidden" style={{ gap: 5, padding: 5 }}>

            {/* ── LEFT COLUMN ──────────────────────────────────────────────── */}
            <div className="flex flex-col flex-shrink-0 overflow-hidden" style={{ width: '50%', gap: 5 }}>

              {/* ① Camera stream */}
              <div
                className="flex-shrink-0 flex flex-col overflow-hidden"
                style={{ borderRadius: 14, background: '#0a0f1a' }}
              >
                {/* ── Camera selector bar ── */}
                <div className="flex items-center justify-between flex-shrink-0 px-3 py-1.5" style={{ background: '#0d1421', borderBottom: '1px solid #1e293b' }}>
                  {/* Status pill */}
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${streamStatus === 'live' ? 'bg-green-400 animate-pulse' : streamStatus === 'error' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`} />
                    <span className="text-[10px] font-bold text-white tracking-wide">
                      {streamStatus === 'live' ? 'LIVE' : streamStatus === 'error' ? 'RETRYING' : 'CONNECTING'}
                    </span>
                  </div>
                  {/* Camera dropdown — always visible */}
                  <select
                    value={selectedCamIdx}
                    onChange={(e) => { setSelectedCamIdx(Number(e.target.value)); setStreamStatus('connecting'); setStreamKey((k) => k + 1); }}
                    className="text-[11px] font-semibold text-white rounded-lg px-2 py-0.5 outline-none cursor-pointer"
                    style={{ background: '#1e293b', border: '1px solid #334155', maxWidth: '55%' }}
                  >
                    {cameras.map((c, i) => (
                      <option key={c.id} value={i}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* ── Stream image ── */}
                <div className="relative overflow-hidden" style={{ background: '#0f172a', willChange: 'contents' }}>
                  {currentCam ? (
                    <div className="relative w-full h-[25vh] bg-slate-900">
                      <WebRTCStream key={`landscape-${currentCam?.id}`} whepUrl={currentCam?.whep_url} />
                      <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full"
                        style={{ pointerEvents: 'none', zIndex: 3, background: 'transparent' }}
                      />
                      {activeCount >= 3 && (
                        <div className="absolute top-2 right-2 bg-amber-500 text-white px-3 py-1 rounded-full text-sm font-semibold" style={{ zIndex: 20 }}>
                          🔍 {activeCount} DETECTED
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-[25vh] flex flex-col items-center justify-center gap-2">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                      </svg>
                      <p className="text-gray-400 text-xs">No cameras configured</p>
                    </div>
                  )}
                </div>
              </div>

              {/* ② Idle video / Detection hero grid — flex-1 keeps height static */}
              <div
                className="flex-1 min-h-0"
                style={{
                  overflow: heroCards.length > 0 ? 'hidden' : 'visible',
                  borderRadius: heroCards.length > 0 ? 14 : 0,
                  background: heroCards.length > 0 ? '#222222' : 'transparent',
                  boxShadow: 'none',
                  border: heroCards.length > 0 ? '1px solid #2a2a2a' : 'none',
                  transition: 'background 0.5s ease, border-color 0.5s ease',
                }}
              >
                {heroCards.length > 0
                  ? <DetectionHeroGrid cards={heroCards} backendBase={BACKEND_BASE} isPortrait />
                  : <IdleScreen detectionCount={feedEvents.length} showSiri />
                }
              </div>

              {/* ③ Weather widget */}


            </div>

            <div style={{
              width: 1, flexShrink: 0, alignSelf: 'stretch', margin: '0 5px',
              background: 'linear-gradient(180deg, transparent 0%, #1A56FF55 15%, #1A56FFcc 40%, #60a5fa 50%, #1A56FFcc 60%, #1A56FF55 85%, transparent 100%)',
              boxShadow: '0 0 8px #1A56FF88, 0 0 20px #1A56FF33',
              borderRadius: 2, position: 'relative',
            }}>
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%) rotate(45deg)',
                width: 7, height: 7, background: '#60a5fa',
                boxShadow: '0 0 10px #60a5facc',
              }} />
            </div>

            {/* ── RIGHT COLUMN ─────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden" style={{ gap: 5 }}>

              {/* ④ Detection Log */}
              <div
                className="flex flex-col overflow-hidden"
                style={{
                  flexShrink: 0,
                  height: '48%',
                  borderRadius: 14,
                  background: '#000000',
                  boxShadow: '0 4px 24px rgba(139,92,246,0.12)',
                }}
              >
                {/* <div
              className="flex-shrink-0 flex items-center justify-between px-4 py-2.5"
              style={{ background: '#1a1a1a', borderBottom: '1px solid #2a2a2a' }}
            >
              <div className="flex items-center gap-2">
                <div className="w-1 h-5 rounded-full" style={{ background: 'linear-gradient(180deg,#22c55e,#16a34a)' }} />
                <span className="font-bold text-gray-200" style={{ fontSize: 12 }}>Detection Log</span>
                {activeCount > 0 && (
                  <span
                    className="text-[9px] font-bold px-2 py-0.5 rounded-full animate-pulse"
                    style={{ background: '#052e16', color: '#4ade80', border: '1px solid #166534' }}
                  >
                    {activeCount} ACTIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#222222', color: '#94a3b8' }}>
                  {feedEvents.length} records
                </span>
                <button
                  onClick={handleClear}
                  disabled={feedEvents.length === 0}
                  className="text-[10px] font-semibold text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1.5 py-0.5 rounded"
                >
                  Clear
                </button>
              </div>
            </div> */}

                {(() => {
                  const LOG_ROWS = 10;
                  const real = feedEvents.slice(0, LOG_ROWS);
                  const skeletonCount = LOG_ROWS - real.length;

                  return (
                    <div className="flex-1 overflow-hidden rounded-[18px] border border-[#3d3d3d]" style={{ display: 'flex', flexDirection: 'column' }}>
                      <table className="w-full" style={{ tableLayout: 'fixed' }}>
                        <thead style={{ background: '#0f0f0f', borderBottom: '1px solid #1e1e1e' }}>
                          <tr>
                            <th className='text-gray-100' style={{ width: 36, padding: '7px 8px', fontSize: 9, fontWeight: 700, textAlign: 'center', letterSpacing: '0.08em' }}>NO</th>
                            <th className='text-gray-100' style={{ padding: '7px 8px', fontSize: 9, fontWeight: 700, textAlign: 'left', letterSpacing: '0.08em' }}>EMPLOYEE</th>
                            <th className='text-gray-100' style={{ width: 70, padding: '7px 8px', fontSize: 9, fontWeight: 700, textAlign: 'center', letterSpacing: '0.08em' }}>TYPE</th>
                            <th className='text-gray-100' style={{ width: 58, padding: '7px 8px', fontSize: 9, fontWeight: 700, textAlign: 'right', letterSpacing: '0.08em' }}>TIME</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* ── Real rows ── */}
                          {real.map((event, i) => {
                            const name = event.employee_name || event.name || 'Unknown';
                            const code = event.employee_code || '';
                            const punch = event.punch_type || '';
                            const imgSrc = event.employee_image || event.image_path || null;
                            const timeStr = event.timestamp
                              ? new Date(event.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
                              : '';
                            const isNew = newEventIds.has(event._reactId);
                            const isIn = punch === 'in';
                            const isOut = punch === 'out';
                            const punchColor = isIn ? '#22c55e' : isOut ? '#ef4444' : '#60a5fa';
                            const punchBg = isIn ? '#052e16' : isOut ? '#450a0a' : '#020d1f';
                            const punchBdr = isIn ? '#166534' : isOut ? '#7f1d1d' : '#1e3a5f';
                            return (
                              <tr key={event._reactId} style={{
                                borderBottom: '1px solid #111111',
                                background: isNew ? 'rgba(34,197,94,0.08)' : i % 2 === 0 ? '#0a0a0a' : '#0d0d0d',
                                animation: isNew ? 'rowSlideIn 0.35s ease-out' : 'none',
                              }}>
                                <td style={{ padding: '6px 8px', fontSize: 10, color: '#94a3b8', textAlign: 'center', fontWeight: 700 }}>{i + 1}</td>
                                <td style={{ padding: '6px 8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {imgSrc ? (
                                      <img src={`${BACKEND_BASE}/${imgSrc}`} alt={name}
                                        style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1.5px solid ${punchColor}` }}
                                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                                    ) : null}
                                    <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: imgSrc ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, background: '#1e3a5f', color: '#93c5fd', border: '1.5px solid #1d4ed8' }}>
                                      {name.charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <p style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{name}</p>
                                      {code && <p style={{ fontSize: 8, color: '#64748b', margin: 0, lineHeight: 1.2, letterSpacing: '0.05em' }}>{code}</p>}
                                    </div>
                                  </div>
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                  {punch ? (
                                    <span style={{ display: 'inline-block', fontSize: 8, fontWeight: 900, padding: '2px 8px', borderRadius: 20, background: punchBg, color: punchColor, border: `1px solid ${punchBdr}`, letterSpacing: '0.1em' }}>
                                      {isIn ? '▲ IN' : isOut ? '▼ OUT' : punch.toUpperCase()}
                                    </span>
                                  ) : <span style={{ fontSize: 8, color: '#475569' }}>—</span>}
                                </td>
                                <td style={{ padding: '6px 8px', fontSize: 9, color: '#ffffff', textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{timeStr}</td>
                              </tr>
                            );
                          })}

                          {/* ── Skeleton placeholder rows ── */}
                          {Array.from({ length: skeletonCount }, (_, si) => (
                            <tr key={`sk-${si}`} style={{ borderBottom: '1px solid #1a1a1a', background: (real.length + si) % 2 === 0 ? '#111111' : '#141414' }}>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                <div style={{ width: 16, height: 8, borderRadius: 4, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', margin: '0 auto', animation: `skelShimmer 1.6s ease-in-out ${si * 0.12}s infinite` }} />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', animation: `skelShimmer 1.6s ease-in-out ${si * 0.14}s infinite` }} />
                                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div style={{ height: 7, borderRadius: 4, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', width: '65%', animation: `skelShimmer 1.6s ease-in-out ${si * 0.16}s infinite` }} />
                                    <div style={{ height: 5, borderRadius: 4, background: 'linear-gradient(90deg,#222222,#2e2e2e,#222222)', backgroundSize: '200% 100%', width: '42%', animation: `skelShimmer 1.6s ease-in-out ${si * 0.18}s infinite` }} />
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                <div style={{ width: 38, height: 14, borderRadius: 10, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', margin: '0 auto', animation: `skelShimmer 1.6s ease-in-out ${si * 0.2}s infinite` }} />
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <div style={{ width: 30, height: 8, borderRadius: 4, background: 'linear-gradient(90deg,#2a2a2a,#3a3a3a,#2a2a2a)', backgroundSize: '200% 100%', marginLeft: 'auto', animation: `skelShimmer 1.6s ease-in-out ${si * 0.22}s infinite` }} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <style>{`@keyframes skelShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
                    </div>
                  );
                })()}
              </div>

              {/* ⑤ Time Card */}
              <div className="flex-shrink-0 h-[14vh] overflow-hidden">
                <TimeCard now={now} />
              </div>

              {/* ⑥ Today's Check-in / Check-out Summary */}
              {(() => {
                const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
                let todayIn = 0, todayOut = 0;
                const seen = new Set();
                feedEvents.forEach(ev => {
                  const ts = ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : null;
                  if (ts !== todayStr) return;
                  const key = `${ev.employee_code || ev.id}-${ev.punch_type}`;
                  if (seen.has(key)) return;
                  seen.add(key);
                  if (ev.punch_type === 'in') todayIn++;
                  else if (ev.punch_type === 'out') todayOut++;
                });
                const total = todayIn + todayOut;
                const inPct = total > 0 ? Math.round((todayIn / total) * 100) : 0;
                return (
                    <div className="flex-shrink-0 h-[14vh] overflow-hidden border border-[#3d3d3d] "
                      style={{ borderRadius: 12, background: '#000000', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>

                      {/* Title row */}
                      <div className="flex items-center justify-between flex-shrink-0">
                        <span className='text-[12px] font-bold text-gray-100'>Today's Attendance</span>
                        <span className='text-[11px] font-medium text-gray-300'>
                          {now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase()}
                        </span>
                      </div>

                      {/* 3 stat tiles */}
                      <div className="flex gap-1.5 flex-1 min-h-0">
                        {/* Check-in */}
                        <div className="flex-1 relative overflow-hidden flex flex-col justify-between"
                          style={{ borderRadius: 8, background: '#0a1f0a', padding: '5px 7px', border: '1px solid #166534' }}>
                          <div className="flex items-center justify-between">
                            <LogIn size={12} color="#4ade80" strokeWidth={2.5} />
                            <span style={{ fontSize: 6.5, fontWeight: 800, color: '#4ade80', letterSpacing: '0.08em' }}>CHECK-IN</span>
                          </div>
                          <p style={{ fontSize: 22, fontWeight: 900, color: '#4ade80', lineHeight: 1, marginTop: 2 }}>{todayIn}</p>
                          <p style={{ fontSize: 6, color: '#4ade80', fontWeight: 600 }}>in office today</p>
                        </div>

                        {/* Check-out */}
                        <div className="flex-1 relative overflow-hidden flex flex-col justify-between"
                          style={{ borderRadius: 8, background: '#1a0f00', padding: '5px 7px', border: '1px solid #92400e' }}>
                          <div className="flex items-center justify-between">
                            <LogOut size={12} color="#ea580c" strokeWidth={2.5} />
                            <span style={{ fontSize: 6.5, fontWeight: 800, color: '#fb923c', letterSpacing: '0.08em' }}>CHECK-OUT</span>
                          </div>
                          <p style={{ fontSize: 22, fontWeight: 900, color: '#f97316', lineHeight: 1, marginTop: 2 }}>{todayOut}</p>
                          <p style={{ fontSize: 6, color: '#fb923c', fontWeight: 600 }}>left office today</p>
                        </div>

                        {/* Total Employees */}
                        <div className="flex-1 relative overflow-hidden flex flex-col justify-between"
                          style={{ borderRadius: 8, background: '#120a1f', padding: '5px 7px', border: '1px solid #6d28d9' }}>
                          <div className="flex items-center justify-between">
                            <CheckCircle2 size={12} color="#a78bfa" strokeWidth={2.5} />
                            <span style={{ fontSize: 6.5, fontWeight: 800, color: '#a78bfa', letterSpacing: '0.08em' }}>TOTAL EMP</span>
                          </div>
                          <p style={{ fontSize: 22, fontWeight: 900, color: '#a78bfa', lineHeight: 1, marginTop: 2 }}>{totalEmployees || '—'}</p>
                          <p style={{ fontSize: 6, color: '#a78bfa', fontWeight: 600 }}>registered</p>
                        </div>
                      </div>
                    </div>
                );
              })()}

              {/* ⑦ Weather Card */}
              <div className="flex-1 min-h-0  overflow-hidden " >
                <WeatherWidget now={now} />
              </div>

              {/* ⑤ Advertisement */}

            </div>
          </div>

          <div className="flex-shrink-0 mb-1 h-[45vh]">
            <AdCarousel />
          </div>
        </>
      )}

      {/* ══ FOOTER ═════════════════════════════════════════════════════════ */}
      <footer
        className="flex-shrink-0 flex items-center justify-between px-5"
        style={{ height: 28, background: '#222222', borderTop: '1px solid #222222' }}
      >
        <div className='flex items-center gap-2'>
          {/* Layout toggle — icon only */}
          <button
            onClick={() => setLayoutMode(m => m === 'portrait' ? 'landscape' : 'portrait')}
            title={layoutMode === 'portrait' ? 'Switch to Landscape' : 'Switch to Portrait'}
            style={{
              width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, opacity: 0.75,
            }}
          >
            {layoutMode === 'portrait' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="9" x2="22" y2="9" />
                <line x1="6" y1="9" x2="6" y2="19" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="7" y="2" width="10" height="20" rx="2" />
                <line x1="7" y1="6" x2="17" y2="6" />
                <line x1="7" y1="10" x2="11" y2="10" />
              </svg>
            )}
          </button>
          {/* Back — arrow-left icon */}
          <button
            onClick={() => navigate('/dashboard')}
            title="Back to Dashboard"
            style={{
              width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, opacity: 0.75,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 8 8 12 12 16" />
              <line x1="16" y1="12" x2="8" y2="12" />
            </svg>
          </button>
          {/* Refresh */}
          <button
            onClick={() => window.location.reload()}
            title="Refresh Page"
            style={{
              width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, opacity: 0.75,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>

        <span className="text-[10px] text-gray-400">
          Powered by <span className="font-bold" style={{ color: '#36C5ED' }}>RuruTek</span>
        </span>

      </footer>

      <EscHint />

      <style>{`
        @keyframes punchCardIn   { from{opacity:0;transform:scale(0.88) translateY(18px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes punchLabelIn  { from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes namePop       { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
        @keyframes quoteFadeUp   { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes punchRipple   { 0%{opacity:0.7;transform:scale(0.85)} 100%{opacity:0;transform:scale(1.6)} }
        @keyframes spotSweep     { 0%{top:-4px;opacity:0} 10%{opacity:1} 90%{opacity:0.5} 100%{top:100%;opacity:0} }
        @keyframes bounceEmoji   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes adCardIn      { from{opacity:0;transform:scale(0.9)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}

function EscHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(id);
  }, []);
  if (!visible) return null;
  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-800/80 border border-gray-700 rounded-full text-gray-300 text-xs backdrop-blur-sm pointer-events-none">
      Press{' '}
      <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-200 text-[10px]">ESC</kbd>
      {' '}to exit fullscreen
    </div>
  );
}
