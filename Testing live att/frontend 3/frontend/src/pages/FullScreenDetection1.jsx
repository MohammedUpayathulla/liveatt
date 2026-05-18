import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket, ATTENDANCE_MARKED, FACE_PRESENT } from '../services/socket.js';
import { getCameras } from '../services/api.js';
import cfg from '../config.js';
import { Thermometer, TrendingUp, Eye, Cloud, Droplets, Wind, Sunrise, Sunset, LogIn, LogOut, CheckCircle2, XCircle } from 'lucide-react';

import av1Video from '../Assets/av1.mp4';
import AdCarousel from '../components/AdCarousel1.jsx';

import srcLogo from '../Assets/src1.png';
import naviyatech from '../Assets/Naviya.png';

const BACKEND_BASE = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
const MAX_FEED = 50;

const FUNNY_QUOTES = [
  // ── English ──────────────────────────────────────────────────────────────
  "Welcome! The office has been looking forward to your arrival. 🎉",
  "Face recognized. Attendance confirmed. You're all set for the day. 💰",
  "Great to see you! Showing up is already a strong start. 💪",
  "Facial recognition succeeded—right on time! 😊",
  "Wishing you a productive day with short meetings and a relaxing lunch break. 🥪",
  "Access granted. The workplace is ready for you. 🏢",
  "Achievement unlocked: Successfully checked in for the day. 🏅",
  "Recognition complete. Your presence is appreciated. 👏",
  "Checked in successfully. Ready to take on the day! 😇",
  "You're here—one step closer to a successful day. 🔬",

  // ── Hindi ─────────────────────────────────────────────────────────────────
  "स्वागत है! ऑफिस आपके आने का इंतज़ार कर रहा था। 🎉",
  "चेहरा पहचाना गया। उपस्थिति दर्ज हो गई है। आगे बढ़ें। 💰",
  "आपको देखकर अच्छा लगा! दिन की शुरुआत शानदार है। 💪",
  "फेस रिकग्निशन सफल रहा—समय पर उपस्थिति दर्ज! 😊",
  "आपका दिन सफल हो—मीटिंग्स छोटी हों और लंच आरामदायक हो। 🥪",
  "प्रवेश स्वीकृत है। आपका कार्यस्थल तैयार है। 🏢",
  "उपलब्धि अनलॉक: आज की उपस्थिति सफलतापूर्वक दर्ज हुई। 🏅",
  "पहचान पूरी हुई। आपकी उपस्थिति सराहनीय है। 👏",
  "उपस्थिति दर्ज। अब दिन की शुरुआत करें! 😇",
  "आप आ गए हैं—एक सफल दिन की ओर एक कदम और। 🔬",

  // ── Tamil ─────────────────────────────────────────────────────────────────
  "வரவேற்கிறோம்! உங்கள் வரவை அலுவலகம் எதிர்பார்த்துக் கொண்டிருந்தது. 🎉",
  "முகம் அடையாளம் காணப்பட்டது. வருகை பதிவு செய்யப்பட்டது. முன்னே செல்லுங்கள். 💰",
  "உங்களை பார்க்க மிகவும் மகிழ்ச்சி! நாள் நல்ல முறையில் தொடங்கியுள்ளது. 💪",
  "முகம் அடையாளம் காணல் வெற்றிகரமாக முடிந்தது—சரியான நேரத்தில் வருகை! 😊",
  "உங்கள் நாள் சிறப்பாக அமையட்டும்—கூட்டங்கள் குறுகியதாகவும் மதிய உணவு அமைதியாகவும் இருக்கட்டும். 🥪",
  "அணுகல் வழங்கப்பட்டது. உங்கள் பணியிடம் தயாராக உள்ளது. 🏢",
  "சாதனை திறக்கப்பட்டது: இன்றைய வருகை வெற்றிகரமாக பதிவு செய்யப்பட்டது. 🏅",
  "அடையாளம் உறுதிசெய்யப்பட்டது. உங்கள் வருகை பாராட்டப்படுகிறது. 👏",
  "வருகை பதிவு செய்யப்பட்டது. உங்கள் நாளை தொடங்குங்கள்! 😇",
  "நீங்கள் வந்துவிட்டீர்கள்—ஒரு வெற்றிகரமான நாளுக்கு இன்னும் ஒரு படி. 🔬",
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
function WCard({ bg, textColor, Icon, label, value, wide }) {
  return (
    <div
      className="flex flex-col justify-between overflow-hidden"
      style={{
        background: bg,
        borderRadius: 8,
        padding: '6px 8px',
        gridColumn: wide ? 'span 2' : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <Icon size={11} strokeWidth={2.5} color={textColor} style={{ opacity: 0.85 }} />
        <span style={{ fontSize: 8, color: textColor, fontWeight: 700, opacity: 0.65, letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      <p style={{ fontSize: 'clamp(11px, 1.3vw, 15px)', fontWeight: 900, color: textColor, marginTop: 3, lineHeight: 1 }}>
        {value}
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
    const fallback = () => load(13.0827, 80.2707);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => load(pos.coords.latitude, pos.coords.longitude),
        fallback, { timeout: 5000 }
      );
    } else {
      fallback();
    }
  }, []);

  const hour = now.getHours();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const weekday = now.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).toUpperCase();
  const dateStr = now.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' }).toUpperCase();

  // Subtle sky-tint background based on time of day
  const panelBg =
    hour >= 5 && hour < 8 ? 'linear-gradient(160deg,#fff7ed 0%,#fef3c7 50%,#fde8d8 100%)' :
      hour >= 8 && hour < 17 ? 'linear-gradient(160deg,#e0f2fe 0%,#f0fdf4 50%,#fdf4ff 100%)' :
        hour >= 17 && hour < 20 ? 'linear-gradient(160deg,#fff7ed 0%,#fce7f3 50%,#fdf4ff 100%)' :
          'linear-gradient(160deg,#f5f3ff 0%,#eff6ff 50%,#f0fdf4 100%)';

  return (
    <div
      className="h-full w-full flex flex-col select-none overflow-hidden"
      style={{ background: panelBg, padding: '10px 14px', gap: 7 }}
    >

      {/* ── Big clock + date ── */}
      <div className="flex-shrink-0">
        <p className="whitespace-nowrap font-black leading-none tracking-tight"
          style={{ fontSize: 'clamp(26px,3.5vw,38px)', letterSpacing: '-0.03em', color: '#1e3a5f' }}>
          {timeStr}
        </p>
        <p className="font-bold mt-0.5" style={{ fontSize: 7.5, letterSpacing: '0.12em', color: '#94a3b8' }}>
          {weekday}, {dateStr}
        </p>
      </div>

      {/* ── Divider ── */}
      <div className="flex-shrink-0 h-px" style={{ background: 'linear-gradient(90deg,#e2e8f0 60%,transparent)' }} />

      {/* ── Temperature + condition  |  Sunrise & Sunset ── */}
      <div className="flex items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span style={{
            fontSize: 'clamp(22px, 2.8vw, 32px)', lineHeight: 1, display: 'inline-block',
            animation: 'wFloat 4s ease-in-out infinite',
            filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.15))',
          }}>
            {weather ? wmoEmoji(weather.code) : '🌤️'}
          </span>
          <div>
            <p className="font-black leading-none"
              style={{ fontSize: 'clamp(20px, 2.5vw, 30px)', letterSpacing: '-0.03em', color: '#1e3a5f' }}>
              {weather ? `${weather.temp}°C` : '--°C'}
            </p>
            <p className="font-bold mt-0.5 text-gray-500" style={{ fontSize: 7.5, letterSpacing: '0.05em' }}>
              {weather ? wmoLabel(weather.code).toUpperCase() : 'LOADING…'}
            </p>
          </div>
        </div>

        {/* Sunrise / Sunset mini-cards */}
        <div className="flex  gap-1.5">
          <div className="flex items-center gap-1 rounded-lg px-2 py-1"
            style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
            <Sunrise size={10} strokeWidth={2.5} color="#ea580c" />
            <div>
              <p className="font-black leading-none" style={{ fontSize: 9, color: '#ea580c' }}>
                {weather?.sunrise ?? '--'}
              </p>
              <p style={{ fontSize: 6, color: '#9a3412', fontWeight: 700, letterSpacing: '0.06em' }}>SUNRISE</p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-lg px-2 py-1"
            style={{ background: '#fdf4ff', border: '1px solid #e9d5ff' }}>
            <Sunset size={10} strokeWidth={2.5} color="#9333ea" />
            <div>
              <p className="font-black leading-none" style={{ fontSize: 9, color: '#9333ea' }}>
                {weather?.sunset ?? '--'}
              </p>
              <p style={{ fontSize: 6, color: '#6b21a8', fontWeight: 700, letterSpacing: '0.06em' }}>SUNSET</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 6 pastel info cards (3 cols × 2 rows) ── */}
      <div
        className="flex-1 overflow-hidden"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 6, minHeight: 0 }}
      >
        <WCard bg="linear-gradient(135deg,#ede9fe,#c4b5fd55)" textColor="#6d28d9" Icon={Thermometer} label="FEELS LIKE"
          value={weather ? `${weather.feelsLike}°C` : '--°C'} />
        <WCard bg="linear-gradient(135deg,#dcfce7,#bbf7d0)" textColor="#15803d" Icon={TrendingUp} label="MIN / MAX"
          value={weather ? `${weather.tempMin}° / ${weather.tempMax}°` : '-- / --'} />
        <WCard bg="linear-gradient(135deg,#ffedd5,#fed7aa)" textColor="#c2410c" Icon={Eye} label="VISIBILITY"
          value={weather ? `${weather.visibility} km` : '-- km'} />
        <WCard bg="linear-gradient(135deg,#dbeafe,#bfdbfe)" textColor="#1d4ed8" Icon={Cloud} label="CLOUD COVER"
          value={weather ? `${weather.cloudCover}%` : '--%'} />
        <WCard bg="linear-gradient(135deg,#cffafe,#a5f3fc)" textColor="#0e7490" Icon={Droplets} label="HUMIDITY"
          value={weather ? `${weather.humidity}%` : '--%'} />
        <WCard bg="linear-gradient(135deg,#fce7f3,#fbcfe8)" textColor="#be185d" Icon={Wind} label="WIND"
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

function PersonCard({ card, backendBase, solo = false }) {
  const { event, quoteIdx } = card;
  const name    = event.employee_name || event.name || 'Detected';
  const code    = event.employee_code || '';
  const imgSrc  = event.employee_image || event.image_path;
  const punch   = event.punch_type;
  const quote   = FUNNY_QUOTES[quoteIdx % FUNNY_QUOTES.length];

  const isIn  = punch === 'in';
  const isOut = punch === 'out';

  /* Dark-theme accent palette — mirrors AdCarousel style */
  const ac  = isIn ? '#4ade80' : isOut ? '#fb923c' : '#60a5fa';
  const acD = isIn ? '#16a34a' : isOut ? '#ea580c' : '#2563eb';
  const bgD = isIn ? '#021a0a' : isOut ? '#1a0800' : '#020d1f';
  const bgM = isIn ? '#063a18' : isOut ? '#2d1200' : '#061830';

  const quoteEmoji = /\p{Emoji}/u.test(quote.at(-1)) ? quote.at(-1) : '💬';
  const quoteText  = quote.endsWith(quoteEmoji) ? quote.slice(0, -quoteEmoji.length).trim() : quote;
  const avatarSize = solo ? 76 : 52;

  return (
    <div style={{
      height: '100%', width: '100%', position: 'relative',
      overflow: 'hidden', borderRadius: 20,
      background: `linear-gradient(155deg, ${bgM} 0%, ${bgD} 100%)`,
      border: `1.5px solid ${ac}45`,
      boxShadow: `0 0 0 1px ${ac}15, 0 12px 40px rgba(0,0,0,0.6)`,
      display: 'flex', flexDirection: 'column',
      animation: 'punchCardIn 0.55s cubic-bezier(0.22,1,0.36,1) both',
    }}>

      {/* Top accent line */}
      <div style={{ height: 3, flexShrink: 0, background: `linear-gradient(90deg, transparent 0%, ${ac} 40%, ${ac}80 70%, transparent 100%)` }} />

      {/* Radial glow layer */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '60%',
        background: `radial-gradient(ellipse 85% 65% at 50% 20%, ${ac}1a 0%, transparent 72%)`,
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* Scan-line sweep on entry */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 2, zIndex: 6,
        background: `linear-gradient(90deg, transparent, ${ac}90, transparent)`,
        animation: 'spotSweep 1.3s ease-out 0.1s both',
        pointerEvents: 'none',
      }} />

      {/* Main content */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', position: 'relative', zIndex: 2,
        padding: solo ? '12px 18px 12px' : '8px 10px 8px',
        gap: solo ? 9 : 6,
      }}>

        {/* Status pill */}
        <div style={{ animation: 'punchLabelIn 0.4s ease 0.25s both' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 14px', borderRadius: 20,
            background: `${ac}18`, border: `1.5px solid ${ac}65`,
          }}>
            {isIn
              ? <LogIn  size={solo ? 11 : 9} color={ac} strokeWidth={2.5} />
              : <LogOut size={solo ? 11 : 9} color={ac} strokeWidth={2.5} />}
            <span style={{
              fontSize: solo ? 11 : 9, fontWeight: 800, color: ac,
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              {isIn ? 'Welcome In' : 'See You Soon'}
            </span>
          </div>
        </div>

        {/* Avatar + ripple rings */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {[0, 1].map(i => (
            <div key={i} style={{
              position: 'absolute', inset: -6 - i * 8, borderRadius: '50%',
              border: `1.5px solid ${ac}${i === 0 ? '55' : '28'}`,
              animation: `punchRipple 2.6s ease-out ${i * 1.1}s infinite`,
            }} />
          ))}
          {imgSrc ? (
            <img
              src={`${backendBase}/${imgSrc}`}
              alt={name}
              style={{
                width: avatarSize, height: avatarSize,
                borderRadius: '50%', objectFit: 'cover',
                border: `2.5px solid ${ac}`,
                boxShadow: `0 0 0 3px ${bgD}, 0 4px 24px ${ac}55`,
                position: 'relative', zIndex: 2,
              }}
            />
          ) : (
            <div style={{
              width: avatarSize, height: avatarSize, borderRadius: '50%',
              background: `linear-gradient(135deg, ${acD}, ${bgM})`,
              border: `2.5px solid ${ac}`,
              boxShadow: `0 0 0 3px ${bgD}, 0 4px 24px ${ac}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: solo ? 30 : 20, fontWeight: 900, color: ac,
              position: 'relative', zIndex: 2,
            }}>
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Name + Hindi transliteration + code */}
        <div style={{
          textAlign: 'center', lineHeight: 1.25, width: '100%',
          animation: 'namePop 0.5s cubic-bezier(0.22,1,0.36,1) 0.2s both',
        }}>
          <p style={{
            fontSize: solo ? 'clamp(18px,2vw,26px)' : 14,
            fontWeight: 900, color: '#ffffff', margin: 0,
            letterSpacing: '-0.02em',
          }}>{name}</p>
          <p style={{
            fontSize: solo ? 14 : 11, fontWeight: 700, color: ac,
            marginTop: 3, fontFamily: "'Noto Sans Devanagari',sans-serif",
          }}>{transliterateHindi(name)}</p>
          {code && (
            <p style={{
              fontSize: 9, color: `${ac}65`, fontFamily: 'monospace',
              letterSpacing: '0.14em', marginTop: 2,
            }}>{code}</p>
          )}
        </div>

        {/* Divider */}
        <div style={{
          width: '45%', height: 1, borderRadius: 1,
          background: `linear-gradient(90deg, transparent, ${ac}55, transparent)`,
        }} />

        {/* Quote block */}
        <div style={{ width: '100%', animation: 'quoteFadeUp 0.5s ease 0.38s both' }}>
          <div style={{
            borderRadius: 12,
            padding: solo ? '8px 12px' : '5px 8px',
            background: `${ac}0c`, border: `1px solid ${ac}22`,
            textAlign: 'center',
          }}>
            <span style={{
              fontSize: solo ? 20 : 15, display: 'block',
              marginBottom: solo ? 5 : 3,
              animation: 'bounceEmoji 1.6s ease-in-out infinite',
            }}>{quoteEmoji}</span>
            <p style={{
              fontSize: solo ? 'clamp(11px,1.2vw,14px)' : 11,
              color: 'rgba(255,255,255,0.62)', fontWeight: 400,
              lineHeight: 1.6, margin: 0,
            }}>
              "{solo ? quoteText : (quoteText.length > 55 ? quoteText.slice(0, 55) + '…' : quoteText)}"
            </p>
          </div>
        </div>

        {/* Emoji watermark bottom-right */}
        <div style={{
          position: 'absolute', bottom: 8, right: 10,
          fontSize: solo ? 30 : 20, opacity: 0.15, pointerEvents: 'none',
          animation: isIn ? 'thumbsBob 2s ease-in-out infinite' : 'waveContinue 1.8s ease-in-out infinite',
        }}>
          {isIn ? '👍' : '👋'}
        </div>
      </div>

      {/* Bottom accent bar */}
      <div style={{
        height: 3, flexShrink: 0,
        background: `linear-gradient(90deg, transparent, ${ac}80, ${ac}, transparent)`,
      }} />
    </div>
  );
}

// ── Grid that shows ALL active detections at once ─────────────────────────────
function DetectionHeroGrid({ cards, backendBase }) {
  const count = cards.length;
  if (count === 0) return null;

  if (count === 1) {
    return (
      <div className="h-full w-full flex items-center justify-center" style={{ padding: 12 }}>
        <div style={{ width: '100%', maxWidth: 340, height: '100%', maxHeight: 420 }}>
          <PersonCard card={cards[0]} backendBase={backendBase} solo />
        </div>
      </div>
    );
  }

  // cols: 2 for 2 people, 3 for 3–6, 4 for 7+
  const cols = count === 2 ? 2 : count <= 6 ? 3 : 4;

  return (
    <div
      style={{
        width: '100%', height: '100%',
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 6,
        padding: '8px 10px',
        overflowY: 'auto',
        alignContent: 'center',
      }}
    >
      {cards.map((card) => (
        <PersonCard key={card.rid} card={card} backendBase={backendBase} solo={false} />
      ))}
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
            background: 'linear-gradient(145deg,#f8fafc 0%,#ffffff 100%)',
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
  const cardTimersRef = useRef(new Map());
  const streamRetryTimer = useRef(null);
  const saveTimer = useRef(null);
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

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') navigate('/live'); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  useEffect(() => {
    getCameras().then((data) => setCameras(Array.isArray(data) ? data : data.cameras || [])).catch(() => { });
    function onHealth({ camera_id, online_status }) {
      setCameras((prev) => prev.map((c) => c.id === camera_id ? { ...c, online_status } : c));
    }
    socket.on('device_health_update', onHealth);
    return () => socket.off('device_health_update', onHealth);
  }, []);

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

  const rootStyle = {
    position: 'fixed',
    width: '100vh', height: '100vw',
    top: 'calc((100vh - 100vw) / 2)',
    left: 'calc((100vw - 100vh) / 2)',
    transform: 'rotate(90deg)',
    transformOrigin: 'center center',
    overflow: 'hidden',
    background: '#c8d0e0',
  };

  return (
    <div className="flex flex-col" style={rootStyle}>

      {/* ══ HEADER ═════════════════════════════════════════════════════════ */}
      <header className="flex-shrink-0 flex items-center justify-between px-4"
        style={{ height: 40, background: 'rgba(15,23,42,0.88)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          <span className="font-bold tracking-widest" style={{ fontSize: 11, color: '#f1f5f9', letterSpacing: '0.18em' }}>LIVE ATTENDANCE</span>
        </div>
        <div className="flex items-center gap-2">
          <img src={naviyatech} alt="" className="object-contain" style={{ height: 22 }} />
          <img src={srcLogo} alt="" className="object-contain" style={{ height: 30 }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: '#16a34a', letterSpacing: '0.06em' }}>CBRE</span>
        </div>
      </header>

      {/* ══ BODY ═══════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ gap: 5, padding: 5 }}>

        {/* ── TOP ROW: Left col (stream+attendance+weather) | Right col (detection log) ── */}
        <div className="flex overflow-hidden" style={{ flex: '0 0 44%', gap: 5 }}>

          {/* LEFT COL */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ gap: 5 }}>

            {/* Stream */}
            <div className="flex-shrink-0 h-[30vh] relative overflow-hidden" style={{ borderRadius: 12, background: '#0f172a', height: '33%', boxShadow: 'rgba(17,12,46,0.15) 0px 48px 100px 0px' }}>
              {currentCam ? (
                <>
                  <img key={streamKey} src={`/api/cameras/${currentCam.id}/stream?t=${streamKey}`}
                    className="w-full h-full object-cover" alt="Live"
                    onLoad={() => { setStreamStatus('live'); clearTimeout(streamRetryTimer.current); }}
                    onError={() => { setStreamStatus('error'); clearTimeout(streamRetryTimer.current); streamRetryTimer.current = setTimeout(() => { setStreamStatus('connecting'); setStreamKey(k => k + 1); }, 5000); }}
                  />
                  <div className="absolute bottom-0 left-0 right-0 h-6 pointer-events-none" style={{ background: 'linear-gradient(to top,rgba(0,0,0,0.4),transparent)' }} />
                  <div className="absolute top-1.5 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                    <span className={`w-1.5 h-1.5 rounded-full ${streamStatus === 'live' ? 'bg-green-400 animate-pulse' : streamStatus === 'error' ? 'bg-red-400' : 'bg-amber-400 animate-pulse'}`} />
                    {streamStatus === 'live' ? 'LIVE' : streamStatus === 'error' ? 'Retrying' : 'Connecting'}
                  </div>
                  {streamStatus !== 'live' && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(15,23,42,0.7)' }}>
                      {streamStatus === 'error' ? <p className="text-gray-400 text-xs">Stream unavailable</p> : <div className="w-5 h-5 border-2 border-gray-600 border-t-blue-400 rounded-full animate-spin" />}
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center gap-2">
                  <svg className="w-7 h-7 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>
                  <p className="text-gray-500 text-xs">No cameras</p>
                </div>
              )}
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
                <div className="flex-shrink-0 h-[13vh]" style={{ borderRadius: 12, background: '#ffffff', boxShadow: 'rgba(17,12,46,0.15) 0px 48px 100px 0px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#334155', letterSpacing: '0.06em' }}>TODAY'S ATTENDANCE</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: '#64748b' }}>{now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase()}</span>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1 rounded-lg flex items-center gap-1.5 px-2 py-1.5" style={{ boxShadow: 'rgba(17,12,46,0.15) 0px 48px 100px 0px' }}>
                      <LogIn size={12} color="#16a34a" />
                      <div>
                        <p style={{ fontSize: 6, fontWeight: 700, color: '#15803d', letterSpacing: '0.06em' }}>CHECK-IN</p>
                        <p style={{ fontSize: 20, fontWeight: 900, color: '#16a34a', lineHeight: 1 }}>{todayIn}</p>
                      </div>
                    </div>
                    <div className="flex-1 rounded-lg flex items-center gap-1.5 px-2 py-1.5" style={{ boxShadow: 'rgba(17,12,46,0.15) 0px 48px 100px 0px' }}>
                      <LogOut size={12} color="#ea580c" />
                      <div>
                        <p style={{ fontSize: 6, fontWeight: 700, color: '#c2410c', letterSpacing: '0.06em' }}>CHECK-OUT</p>
                        <p style={{ fontSize: 20, fontWeight: 900, color: '#f97316', lineHeight: 1 }}>{todayOut}</p>
                      </div>
                    </div>
                    <div className="flex-1 rounded-lg flex items-center gap-1.5 px-2 py-1.5" style={{ boxShadow: 'rgba(17,12,46,0.15) 0px 48px 100px 0px' }}>
                      <CheckCircle2 size={12} color="#2563eb" />
                      <div className="flex-1">
                        <p style={{ fontSize: 6, fontWeight: 700, color: '#1d4ed8', letterSpacing: '0.06em' }}>TOTAL</p>
                        <p style={{ fontSize: 20, fontWeight: 900, color: '#2563eb', lineHeight: 1 }}>{total}</p>
                        <div style={{ height: 2, borderRadius: 2, background: '#bfdbfe', overflow: 'hidden', marginTop: 2 }}><div style={{ height: '100%', width: `${inPct}%`, background: 'linear-gradient(90deg,#22c55e,#3b82f6)', transition: 'width 0.6s ease' }} /></div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Weather */}
            <div className="flex-shrink-0 overflow-hidden" style={{ height: '48%', borderRadius: 12, boxShadow: 'rgba(17,12,46,0.15) 0px 48px 100px 0px' }}>
              <WeatherWidget now={now} />
            </div>
          </div>

          {/* RIGHT COL — Detection Log */}
          <div className="flex flex-col overflow-hidden" style={{ width: '44%', height:'100%', borderRadius: 12, background: '#ffffff', boxShadow: 'rgba(17,12,46,0.15) 0px 48px 100px 0px' }}>
            <div className="flex-shrink-0 px-3 py-2" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(180deg,#6366f1,#3b82f6)' }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', letterSpacing: '0.08em' }}>DETECTION LOG</span>
                  {activeCount > 0 && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full animate-pulse" style={{ background: '#dcfce7', color: '#15803d' }}>{activeCount} ACTIVE</span>}
                </div>
                <span style={{ fontSize: 9, color: '#94a3b8' }}>{feedEvents.length} records</span>
              </div>
            </div>
            {feedEvents.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2">
                <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <p className="text-xs text-gray-400">Waiting for detections…</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto detection-log-scroll" style={{ scrollbarWidth: 'thin', scrollbarColor: '#94a3b8 transparent' }}>
                <table className="w-full">
                  <thead className="sticky top-0 z-10" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <tr>
                      <th className="px-2 py-1.5 text-[9px] font-bold text-center w-7 text-blue-500">S.No</th>
                      <th className="px-2 py-1.5 text-[9px] font-bold text-left text-blue-500">Employee</th>
                      <th className="px-2 py-1.5 text-[9px] font-bold text-left text-blue-500">Device / Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedEvents.slice(0, 20).map((event, i) => {
                      const name = event.employee_name || event.name || 'Unknown';
                      const code = event.employee_code || '';
                      const device = event.camera_name || '';
                      const punch = event.punch_type || '';
                      const imgSrc = event.employee_image || event.image_path || null;
                      const timeStr = event.timestamp ? new Date(event.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
                      const isNew = newEventIds.has(event._reactId);
                      const punchColor = punch === 'in' ? '#16a34a' : punch === 'out' ? '#dc2626' : '#2563eb';
                      return (
                        <tr key={event._reactId} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', background: isNew ? 'rgba(220,252,231,0.6)' : i % 2 === 0 ? 'rgba(255,255,255,0.7)' : 'transparent', animation: isNew ? 'rowSlideIn 0.35s ease-out' : 'none' }}>
                          <td className="px-2 py-1 text-[9px] text-center text-gray-300">{i + 1}</td>
                          <td className="px-2 py-1">
                            <div className="flex items-center gap-1.5">
                              {punch && <div className="w-0.5 h-5 rounded-full flex-shrink-0" style={{ background: punchColor }} />}
                              {imgSrc ? <img src={`${BACKEND_BASE}/${imgSrc}`} className="w-5 h-5 rounded-full object-cover flex-shrink-0" style={{ border: `1.5px solid ${punchColor}` }} alt={name} onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} /> : null}
                              <div className={`w-5 h-5 rounded-full items-center justify-center font-bold text-[9px] flex-shrink-0 ${imgSrc ? 'hidden' : 'flex'}`} style={{ background: '#dbeafe', color: '#1d4ed8' }}>{name.charAt(0).toUpperCase()}</div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold text-gray-800 truncate leading-tight">{name}</p>
                                {code && <p className="text-[8px] text-gray-400 leading-tight">{code}</p>}
                              </div>
                              {punch && <span className="flex-shrink-0 text-[7px] font-black px-1 py-0.5 rounded-full" style={{ background: punch === 'in' ? '#dcfce7' : '#fee2e2', color: punchColor }}>{punch === 'in' ? 'IN' : 'OUT'}</span>}
                            </div>
                          </td>
                          <td className="px-2 py-1">
                            <p className="text-[9px] text-gray-600 font-medium truncate">{device}</p>
                            <p className="text-[8px] text-gray-400">{timeStr}</p>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── BOTTOM ROW: person card when detected, advertisement when idle ── */}
        <div className="flex-1 overflow-hidden " style={{ borderRadius: 12, boxShadow: 'rgba(17,12,46,0.15) 0px 48px 100px 0px' }}>
          {heroCards.length > 0
            ? <DetectionHeroGrid cards={heroCards} backendBase={BACKEND_BASE} />
            : <AdCarousel />
          }
        </div>

      </div>

      {/* ══ FOOTER ═════════════════════════════════════════════════════════ */}
      <footer
        className="flex-shrink-0 flex items-center justify-between px-5"
        style={{ height: 28, background: 'linear-gradient(90deg,#fdf4ff,#eff6ff,#f0fdf4)', borderTop: '1px solid #ddd6fe' }}
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
            onClick={() => navigate('/dashbaord')}
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
        </div>
        
        <span className="text-[10px] text-gray-400">
          Powered by <span className="font-bold" style={{ color: '#3b82f6' }}>RuruTek</span>
        </span>

          
      </footer>

      <EscHint />
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
