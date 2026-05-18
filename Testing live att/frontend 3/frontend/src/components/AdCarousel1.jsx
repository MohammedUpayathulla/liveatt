import React, { useState, useEffect, useRef } from 'react';
import p001 from '../Assets/products/07.p.png';
import p002 from '../Assets/products/08.p.png';
import p003 from '../Assets/products/09.p.png';
import p004 from '../Assets/products/ATEX.png';
import p005 from '../Assets/products/Artboard 1.png';
import p006 from '../Assets/products/Baby Monitor.png';
import p007 from '../Assets/products/CCTV Camera.png';
import p008 from '../Assets/products/CG.png';
import p009 from '../Assets/products/CK.png';
import p010 from '../Assets/products/CR.png';
import p011 from '../Assets/products/CU.png';
import p012 from '../Assets/products/CY.png';
// import p013 from '../Assets/products/D5604.png';  // file does not exist
// import p014 from '../Assets/products/D5604B.png';  // file does not exist
// import p015 from '../Assets/products/D5604S.png';  // file does not exist
// import p016 from '../Assets/products/D5704.png';  // file does not exist
import p017 from '../Assets/products/FG.png';
import p018 from '../Assets/products/FP.png';
import p019 from '../Assets/products/KA.png';
import p020 from '../Assets/products/KMB.png';
import p021 from '../Assets/products/KPB.png';
import p022 from '../Assets/products/KRB.png';
import p023 from '../Assets/products/LILY-ANG-1.png';
import p024 from '../Assets/products/LILY-ANG-2 - Copy (2).png';
import p025 from '../Assets/products/MDA.png';
import p026 from '../Assets/products/ND.png';
import p027 from '../Assets/products/NI.png';
import p028 from '../Assets/products/NK.png';
import p029 from '../Assets/products/NVR.png';
import p030 from '../Assets/products/NVR5.png';
import p031 from '../Assets/products/POE Switch 4 Port.png';
import p032 from '../Assets/products/POE Switch 8 Port.png';
import p033 from '../Assets/products/PTZ-1.png';
import p034 from '../Assets/products/PTZ-2.png';
import p035 from '../Assets/products/PTZ-3.png';
import p036 from '../Assets/products/PTZ-4.png';
import p037 from '../Assets/products/PTZ.png';
import p038 from '../Assets/products/RB.png';
import p039 from '../Assets/products/RL.png';
import p040 from '../Assets/products/RS-CH222H1XF-TL-28W.png';
import p041 from '../Assets/products/RS-CH222M6CGA-WL-36W.png';
import p042 from '../Assets/products/RS-CH222M6CGA-WTL-36W.png';
import p043 from '../Assets/products/RS-CH222M6UG-WL-36W.png';
import p044 from '../Assets/products/RS-CH222M6UG-WTL-36W.png';
import p045 from '../Assets/products/RS-CH224M6UI-TF-36PW-M.png';
import p046 from '../Assets/products/RS-CH224N6CU-TF-L36PW-M.png';
import p047 from '../Assets/products/RS-CH296I3XC-TL-26W.png';
import p048 from '../Assets/products/RS-CH296I3XD-TL-26W.png';
import p049 from '../Assets/products/RS-CH298N3UG-TF-36PW-M.png';
import p050 from '../Assets/products/RS-CH324M6-398N3KHP-TF-36PW-M.png';
import p051 from '../Assets/products/RS-CH324N6KMB-TF-28PW-M.png';
import p052 from '../Assets/products/RS-CH356M4KGB-CH348M7KGB-TF-LW36PW-M.png';
import p053 from '../Assets/products/RS-CH356M4MCA-CH348M7MCA-WA2812PW.png';
import p054 from '../Assets/products/RS-CH442FEE-WA11PW.png';
import p055 from '../Assets/products/RS-CH456M4CB-LW28PW-M.png';
import p056 from '../Assets/products/RS-CH456M4DB-CH448M7DB-WA2812PW.png';
import p057 from '../Assets/products/RS-CH456M4DC-CH448M7DC-LW28PW-A.png';
import p058 from '../Assets/products/RS-CH728M4C-WA28PB.png';
import p059 from '../Assets/products/RS-CXH-SW02A.png';
import p060 from '../Assets/products/RS-D8004-D8008AS-N-T.png';
import p061 from '../Assets/products/RS-D8016HR-N-T.png';
// import p062 from '../Assets/products/RS-ESS-A.png';  // file does not exist
// import p063 from '../Assets/products/RS-H8008AN-N-W.png';  // file does not exist
// import p064 from '../Assets/products/RS-H8008AQ-N-W.png';  // file does not exist
// import p065 from '../Assets/products/RS-H8108HR-N-W.png';  // file does not exist
// import p066 from '../Assets/products/RS-N10128OD-E4HL - RS-N1064OD-E4HL.png';  // file does not exist
// import p067 from '../Assets/products/RS-N5064OD-EHL.png';  // file does not exist
import p068 from '../Assets/products/RS-N7016PC-EHL.png';
import p069 from '../Assets/products/RS-N7032PC-EHL.png';
import p070 from '../Assets/products/RS-N7316GR-P-EN7332PC-P-E.png';
import p071 from '../Assets/products/RS-N7504HR-M7508HR-N7516HR.png';
import p072 from '../Assets/products/RS-N7604HR-PRS-N7604HR-FP.png';
import p073 from '../Assets/products/RS-N8104HR-N8208HR-FP.png';
// import p074 from '../Assets/products/RS-S1008AR-W.png';  // file does not exist
// import p075 from '../Assets/products/RS-SW-04.png';  // file does not exist
// import p076 from '../Assets/products/RS-SW-08.png';  // file does not exist
// import p077 from '../Assets/products/TA.png';  // file does not exist
// import p078 from '../Assets/products/Tulip-STB-07-12-2021.1338.png';  // file does not exist
import p079 from '../Assets/products/USB CAMERA.png';
import p080 from '../Assets/products/VE.png';
// import p081 from '../Assets/products/nd-Exp.jpg';  // file does not exist
// import p082 from '../Assets/products/tulip 21.jpg';  // file does not exist
// import p083 from '../Assets/products/tulip_2-removebg-preview.png';  // file does not exist
// import p084 from '../Assets/products/untitled.1373-.png';  // file does not exist
// import p085 from '../Assets/products/untitled.1388.png';  // file does not exist
// import p086 from '../Assets/products/untitled.1389.png';  // file does not exist
// import p087 from '../Assets/products/untitled.1405.png';  // file does not exist
// import p088 from '../Assets/products/untitled.1423.png';  // file does not exist
// import p089 from '../Assets/products/untitled.1424.png';  // file does not exist
// import p090 from '../Assets/products/untitled.1425.png';  // file does not exist
// import p091 from '../Assets/products/untitled.1426.png';  // file does not exist
// import p092 from '../Assets/products/untitled.1428.png';  // file does not exist
// import p093 from '../Assets/products/untitled.1604.png';  // file does not exist
// import p094 from '../Assets/products/untitled.1606.png';  // file does not exist
// import p095 from '../Assets/products/untitled.1611.png';  // file does not exist
import main from '../Assets/image.png'

const AD_IMAGES = [
  p001,p002,p003,p004,p005,p006,p007,p008,p009,p010,
  p011,p012,p017,p018,p019,p020,
  p021,p022,p023,p024,p025,p026,p027,p028,p029,p030,
  p031,p032,p033,p034,p035,p036,p037,p038,p039,p040,
  p041,p042,p043,p044,p045,p046,p047,p048,p049,p050,
  p051,p052,p053,p054,p055,p056,p057,p058,p059,p060,
  p061,p068,p069,p070,
  p071,p072,p073,p079,p080,
];

const LABELS = [
  'Product 07','Product 08','Product 09',
  'ATEX','Artboard 1','Baby Monitor',
  'CCTV Camera','CG Series','CK Series',
  'CR Series','CU Series','CY Series',
  'FG Series','FP Series',
  'KA Series','KMB Series','KPB Series',
  'KRB Series','Lily ANG 1','Lily ANG 2',
  'MDA Series','ND Series','NI Series',
  'NK Series','NVR','NVR5',
  'POE Switch 4P','POE Switch 8P','PTZ-1',
  'PTZ-2','PTZ-3','PTZ-4',
  'PTZ','RB Series','RL Series',
  'RS-CH222H1XF','RS-CH222M6CGA-WL','RS-CH222M6CGA-WTL',
  'RS-CH222M6UG-WL','RS-CH222M6UG-WTL','RS-CH224M6UI',
  'RS-CH224N6CU','RS-CH296I3XC','RS-CH296I3XD',
  'RS-CH298N3UG','RS-CH324M6','RS-CH324N6KMB',
  'RS-CH356M4KGB','RS-CH356M4MCA','RS-CH442FEE',
  'RS-CH456M4CB','RS-CH456M4DB','RS-CH456M4DC',
  'RS-CH728M4C','RS-CXH-SW02A','RS-D8004',
  'RS-D8016HR','RS-N7016PC','RS-N7032PC',
  'RS-N7316GR','RS-N7504HR','RS-N7604HR',
  'RS-N8104HR',
  'USB Camera','VE Series',
];

const TAGS = [
  'Electronics','Electronics','Electronics',
  'Safety','Design','Security',
  'Surveillance','Camera','Camera',
  'Camera','Camera','Camera',
  'Camera','Camera',
  'Camera','Camera','Camera',
  'Camera','Lily Range','Lily Range',
  'Camera','Camera','Camera',
  'Camera','NVR','NVR',
  'Networking','Networking','PTZ',
  'PTZ','PTZ','PTZ',
  'PTZ','Camera','Camera',
  'CCTV','CCTV','CCTV',
  'CCTV','CCTV','CCTV',
  'CCTV','CCTV','CCTV',
  'CCTV','CCTV','CCTV',
  'CCTV','CCTV','CCTV',
  'CCTV','CCTV','CCTV',
  'CCTV','Networking',
  'Camera','Camera',
  'USB Camera','Camera',
];

const DESCS = [
  'Advanced digital receiver','Next-gen set-top box','High-performance tuner',
  'ATEX certified device','Artboard design unit','Smart baby monitor',
  'HD CCTV camera','CG series module','CK series module',
  'CR series module','CU series module','CY series module',
  'FG series module','FP series module',
  'KA series module','KMB series module','KPB series module',
  'KRB series module','Lily ANG first edition','Lily ANG second edition',
  'MDA series module','ND series module','NI series module',
  'NK series module','Network video recorder','NVR5 series recorder',
  'POE Switch 4 port','POE Switch 8 port','PTZ camera model 1',
  'PTZ camera model 2','PTZ camera model 3','PTZ camera model 4',
  'Pan-tilt-zoom camera','RB series module','RL series module',
  'HD wide-angle camera','Colour grading camera WL','Colour grading camera WTL',
  'UG series camera WL','UG series camera WTL','UI series camera TF',
  'CU series camera TF','XC series camera TL','XD series camera TL',
  'UG series camera TF','KHP series camera TF','KMB series camera TF',
  'KGB series camera TF','MCA series camera WA','FEE series camera WA',
  'CB series camera LW','DB series camera WA','DC series camera LW',
  'M4C series camera WA','Switch module 02A','D8004/D8008 NVR',
  'D8016HR NVR unit','N7016PC NVR unit','N7032PC NVR unit',
  'N7316GR NVR unit','N7504HR NVR unit','N7604HR NVR unit',
  'N8104HR NVR unit',
  'USB surveillance camera','VE series module',
];

const THEMES = [
  { bg:'#060818', g1:'#0f1f5c', g2:'#1a0a4e', ac:'#6366f1', hi:'#a5b4fc' },
  { bg:'#080d12', g1:'#0c2340', g2:'#0a1628', ac:'#38bdf8', hi:'#7dd3fc' },
  { bg:'#0d0618', g1:'#2d0a4e', g2:'#1a0535', ac:'#a855f7', hi:'#d8b4fe' },
  { bg:'#0c0a06', g1:'#3d2000', g2:'#1a0e00', ac:'#f97316', hi:'#fdba74' },
  { bg:'#060d0a', g1:'#023020', g2:'#011a12', ac:'#10b981', hi:'#6ee7b7' },
  { bg:'#0a0610', g1:'#3b0764', g2:'#1a0030', ac:'#e879f9', hi:'#f0abfc' },
  { bg:'#080608', g1:'#4a0020', g2:'#250010', ac:'#f43f5e', hi:'#fda4af' },
  { bg:'#060a0c', g1:'#023748', g2:'#011c28', ac:'#06b6d4', hi:'#67e8f9' },
  { bg:'#090906', g1:'#3a2800', g2:'#1e1500', ac:'#eab308', hi:'#fde047' },
  { bg:'#060c0d', g1:'#012e2e', g2:'#01191a', ac:'#14b8a6', hi:'#5eead4' },
];

const ACCENTS = AD_IMAGES.map((_, i) => THEMES[i % THEMES.length].ac);
const THEMES_MAP = AD_IMAGES.map((_, i) => THEMES[i % THEMES.length]);

/* ─────────────────────────────────────────────────────────────
   Premium Digital-Signage Keyframes
   All TV-safe: opacity + transform only, no blur, no clip-path
───────────────────────────────────────────────────────────── */
const STYLE = `
@keyframes tv-fadeIn    { from{opacity:0}                          to{opacity:1} }
@keyframes tv-fadeOut   { from{opacity:1}                          to{opacity:0} }
@keyframes tv-riseUp    { from{opacity:0;transform:translateY(32px)} to{opacity:1;transform:translateY(0)} }
@keyframes tv-dropDown  { from{opacity:0;transform:translateY(-24px)} to{opacity:1;transform:translateY(0)} }
@keyframes tv-slideL    { from{opacity:0;transform:translateX(-48px)} to{opacity:1;transform:translateX(0)} }
@keyframes tv-slideR    { from{opacity:0;transform:translateX(48px)}  to{opacity:1;transform:translateX(0)} }
@keyframes tv-zoomSpring{ 0%{opacity:0;transform:scale(0.6) rotate(-3deg)} 70%{opacity:1;transform:scale(1.05) rotate(0.5deg)} 100%{transform:scale(1) rotate(0)} }
@keyframes tv-lineWipe  { from{transform:scaleX(0);transform-origin:left} to{transform:scaleX(1);transform-origin:left} }
@keyframes tv-pulse     { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:0.8;transform:scale(1.04)} }
@keyframes tv-rotateSlow{ from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes tv-rotateCCW { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
@keyframes tv-ticker    { from{transform:translateX(110%)} to{transform:translateX(-110%)} }
@keyframes tv-bgSlide   {
  0%  {background-position:0% 50%}
  50% {background-position:100% 50%}
  100%{background-position:0% 50%}
}
@keyframes tv-scanLine  {
  0%  {top:-4px;opacity:0}
  10% {opacity:1}
  90% {opacity:0.6}
  100%{top:100%;opacity:0}
}
@keyframes tv-cornerSpin{
  0%  {opacity:0.3} 50%{opacity:1} 100%{opacity:0.3}
}
@keyframes tv-numberRise{
  from{opacity:0;transform:translateY(20px) scale(0.8)}
  to  {opacity:1;transform:translateY(0)    scale(1)}
}
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const el = document.createElement('style');
  el.textContent = STYLE;
  document.head.appendChild(el);
}

const INTERVAL = 6000;

/* Corner bracket SVG-like element using CSS borders */
function Corner({ size = 18, color, style: extraStyle = {} }) {
  return (
    <div style={{
      width: size, height: size,
      borderTop: `2.5px solid ${color}`,
      borderLeft: `2.5px solid ${color}`,
      ...extraStyle,
    }} />
  );
}

export default function AdCarousel() {
  const [current, setCurrent] = useState(0);
  const [slideKey, setSlideKey] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => { injectStyle(); }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setCurrent(p => (p + 1) % AD_IMAGES.length);
      setSlideKey(k => k + 1);
    }, INTERVAL);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setProgress(0);
    const start = performance.now();
    let raf;
    function tick(now) {
      const pct = Math.min(((now - start) / INTERVAL) * 100, 100);
      setProgress(pct);
      if (pct < 100) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slideKey]);

  const theme = THEMES_MAP[current];
  const { bg, g1, g2, ac, hi } = theme;
  const num = String(current + 1).padStart(2, '0');
  const tot = String(AD_IMAGES.length).padStart(2, '0');

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      overflow: 'hidden', borderRadius: 0,
      background: bg,
    }}>
      

      {/* ══ LAYER 0: Animated gradient background ══ */}
      <div key={`bg-${current}`} style={{
        position: 'absolute', inset: 0, zIndex: 0,
        background: `linear-gradient(135deg, ${bg} 0%, ${g1} 40%, ${g2} 70%, ${bg} 100%)`,
        backgroundSize: '300% 300%',
        animation: 'tv-bgSlide 8s ease-in-out infinite, tv-fadeIn 0.7s ease both',
      }} />

      {/* ══ LAYER 1: Geometric rings behind image ══ */}
      {/* Outer ring */}
      <div style={{
        position: 'absolute', right: '18%', top: '50%',
        width: 160, height: 160, marginTop: -80,
        borderRadius: '50%',
        border: `1px solid ${ac}30`,
        animation: 'tv-rotateSlow 12s linear infinite',
        zIndex: 1,
      }} />
      {/* Inner ring */}
      <div style={{
        position: 'absolute', right: '21%', top: '50%',
        width: 100, height: 100, marginTop: -50,
        borderRadius: '50%',
        border: `1px solid ${ac}50`,
        animation: 'tv-rotateCCW 8s linear infinite',
        zIndex: 1,
      }} />
      {/* Accent dot ring */}
      <div style={{
        position: 'absolute', right: '23%', top: '50%',
        width: 60, height: 60, marginTop: -30,
        borderRadius: '50%',
        border: `2px solid ${ac}70`,
        animation: 'tv-pulse 2.5s ease-in-out infinite',
        zIndex: 1,
      }} />

      {/* ══ LAYER 2: Radial spotlight glow ══ */}
      <div style={{
        position: 'absolute', right: '5%', top: 0, bottom: 0,
        width: '60%', zIndex: 2,
        background: `radial-gradient(ellipse 80% 80% at 60% 50%, ${ac}28 0%, ${ac}10 45%, transparent 75%)`,
        animation: 'tv-pulse 4s ease-in-out infinite',
      }} />

      {/* ══ LAYER 3: Scan line sweeping down ══ */}
      <div key={`scan-${slideKey}`} style={{
        position: 'absolute', left: 0, right: 0, height: 3, zIndex: 8,
        background: `linear-gradient(90deg, transparent 0%, ${ac}80 30%, ${hi} 50%, ${ac}80 70%, transparent 100%)`,
        animation: 'tv-scanLine 1.4s ease-in-out 0.1s both',
        pointerEvents: 'none',
      }} />

      {/* ══ Logo — fixed top-right ══ */}
      <div style={{
        position: 'absolute', top: 10, left: 14, zIndex: 20,
        animation: 'tv-fadeIn 0.5s ease both',
      }}>
        <img src={main} alt="Rurutek" style={{ height: 26, objectFit: 'contain' }} />
      </div>

      {/* ══ LAYER 4: Content layout: LEFT info | RIGHT image ══ */}
      <div key={`content-${slideKey}`} style={{
        position: 'absolute', inset: 0, zIndex: 5,
        display: 'flex', flexDirection: 'row',
      }}>

        {/* ── LEFT PANEL (44%) ── */}
        <div style={{
          width: '44%', height: '100%',
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center',
          padding: '12px 10px 22px 16px',
          gap: 7,
        }}>

          {/* Category tag */}
          <div style={{ animation: 'tv-slideL 0.4s ease 0.08s both' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 9, fontWeight: 800, color: ac,
              letterSpacing: '0.18em', textTransform: 'uppercase',
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: ac, display: 'inline-block', flexShrink: 0,
              }} />
              {TAGS[current]}
            </span>
          </div>

          {/* Accent divider */}
          <div style={{
            height: 2, width: '65%', borderRadius: 2,
            background: `linear-gradient(90deg, ${ac}, ${ac}30, transparent)`,
            animation: 'tv-lineWipe 0.5s ease 0.14s both',
          }} />

          {/* Product name */}
          <div style={{ animation: 'tv-slideL 0.5s cubic-bezier(0.22,1,0.36,1) 0.18s both' }}>
            <p style={{
              fontSize: 'clamp(14px,1.9vw,22px)',
              fontWeight: 900, color: '#fff',
              lineHeight: 1.2, letterSpacing: '-0.02em', margin: 0,
            }}>
              {LABELS[current]}
            </p>
          </div>

          {/* Description */}
          <div style={{ animation: 'tv-riseUp 0.4s ease 0.28s both' }}>
            <p style={{
              fontSize: 10, color: 'rgba(255,255,255,0.52)',
              fontWeight: 400, lineHeight: 1.6, margin: 0,
            }}>
              {DESCS[current]}
            </p>
          </div>

          {/* Feature tags */}
          <div style={{
            display: 'flex', gap: 5, flexWrap: 'wrap',
            animation: 'tv-riseUp 0.4s ease 0.36s both',
          }}>
            {['HD Quality', 'Smart Tech', 'Pro Grade'].map((f, fi) => (
              <span key={fi} style={{
                fontSize: 8, fontWeight: 600,
                padding: '2px 9px', borderRadius: 4,
                background: `${ac}18`,
                border: `1px solid ${ac}45`,
                color: hi, letterSpacing: '0.06em',
              }}>{f}</span>
            ))}
          </div>

          {/* Slide counter */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 4,
            animation: 'tv-numberRise 0.4s ease 0.44s both',
            marginTop: 2,
          }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: ac, lineHeight: 1 }}>{num}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: 500 }}>/ {tot}</span>
          </div>

          {/* Progress bar */}
          <div style={{
            height: 3, borderRadius: 3,
            background: 'rgba(255,255,255,0.08)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${progress}%`,
              background: `linear-gradient(90deg, ${ac}, ${hi})`,
              borderRadius: 3,
            }} />
          </div>
        </div>

        {/* ── RIGHT PANEL (56%): Product image ── */}
        <div style={{
          width: '56%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          padding: '18px 16px 22px 6px',
        }}>

          {/* Corner brackets */}
          <Corner size={18} color={ac} style={{
            position: 'absolute', top: 16, right: 16,
            transform: 'rotate(90deg)',
            animation: 'tv-cornerSpin 3s ease-in-out infinite',
          }} />
          <Corner size={18} color={ac} style={{
            position: 'absolute', bottom: 16, right: 16,
            transform: 'rotate(180deg)',
            animation: 'tv-cornerSpin 3s ease-in-out 0.75s infinite',
          }} />
          <Corner size={18} color={ac} style={{
            position: 'absolute', bottom: 16, left: 6,
            transform: 'rotate(270deg)',
            animation: 'tv-cornerSpin 3s ease-in-out 1.5s infinite',
          }} />
          <Corner size={18} color={ac} style={{
            position: 'absolute', top: 16, left: 6,
            animation: 'tv-cornerSpin 3s ease-in-out 2.25s infinite',
          }} />

          {/* Product image */}
          <img
            src={AD_IMAGES[current]}
            alt={LABELS[current]}
            style={{
              maxWidth: '90%', maxHeight: '90%',
              objectFit: 'contain',
              position: 'relative', zIndex: 2,
              animation: 'tv-zoomSpring 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.05s both',
            }}
          />
        </div>
      </div>

      {/* ══ LAYER 9: Bottom ticker strip ══ */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        height: 18,
        background: `${ac}18`,
        borderTop: `1px solid ${ac}35`,
        overflow: 'hidden',
        display: 'flex', alignItems: 'center',
      }}>
        <div style={{
          whiteSpace: 'nowrap',
          animation: 'tv-ticker 18s linear infinite',
          fontSize: 9, fontWeight: 600, color: hi,
          letterSpacing: '0.15em',
        }}>
          {'  ◆  Rurutek Private Limited ◆  ADVANCED SECURITY SOLUTIONS  ◆  SMART SURVEILLANCE  ◆  PTZ CAMERAS  ◆  NVR SYSTEMS  ◆  NETWORKING  ◆  DIGITAL SIGNAGE  ◆  '}
        </div>
      </div>

    </div>
  );
}
