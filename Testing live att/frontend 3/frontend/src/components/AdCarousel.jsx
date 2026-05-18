import React, { useState, useEffect } from 'react';

import p01 from '../Assets/product1/AndroidHybrid.png';
import p03 from '../Assets/product1/BULLET Camera..png';
import p06 from '../Assets/product1/CK.png';
import p12 from '../Assets/product1/HD IRD.png';
import p13 from '../Assets/product1/HD STB..png';
import p15 from '../Assets/product1/HD_STB.png';
import p17 from '../Assets/product1/ND.png';
import p18 from '../Assets/product1/NI.png';
import p19 from '../Assets/product1/NK.png';
import p25 from '../Assets/product1/Web Camera.png';
import p27 from '../Assets/product1/explosion Proof Camera.png';
import p28 from '../Assets/product1/IOT Devices.png';
import p29 from '../Assets/product1/Digital Signage.png';
import p30 from '../Assets/product1/biometric-devices.png';
import p31 from '../Assets/product1/Settop Box.png';
import p32 from '../Assets/product1/V.png';
import p33 from '../Assets/product1/RB.png';
import p34 from '../Assets/product1/FG.png';
import p35 from '../Assets/product1/ND-1.png';
import p36 from '../Assets/product1/CK-1.png';
import p37 from '../Assets/product1/Atex-Camera.png';
import cbre from '../Assets/cbre.png';
import srcLogo from '../Assets/src.png';



const PRODUCTS = [
  { img: p01, name: 'Android Hybrid',          tag: 'STB',          desc: 'Android hybrid set-top box' },
  { img: p03, name: 'Bullet Camera',            tag: 'Surveillance', desc: 'High-definition bullet camera' },
  { img: p06, name: 'CK Series',                tag: 'Camera',       desc: 'CK series security camera' },
  { img: p12, name: 'HD IRD',                   tag: 'Broadcast',    desc: 'HD integrated receiver decoder' },
  { img: p13, name: 'HD STB',                   tag: 'STB',          desc: 'HD set-top box receiver' },
  { img: p15, name: 'HD STB',                   tag: 'STB',          desc: 'HD set-top box flagship model' },
  { img: p17, name: 'ND Series',                tag: 'Camera',       desc: 'ND series camera unit' },
  { img: p18, name: 'NI Series',                tag: 'Camera',       desc: 'NI series camera unit' },
  { img: p19, name: 'NK Series',                tag: 'Camera',       desc: 'NK series camera unit' },
  { img: p25, name: 'Web Camera',               tag: 'USB',          desc: 'USB web camera' },
  { img: p27, name: 'Explosion Proof Camera',   tag: 'Industrial',   desc: 'ATEX explosion-proof camera' },
  { img: p28, name: 'IoT Devices',              tag: 'IoT',          desc: 'Smart IoT devices for connected environments' },
  { img: p29, name: 'Digital Signage',          tag: 'Display',      desc: 'High-brightness digital signage displays' },
  { img: p30, name: 'Biometric Devices',        tag: 'Access',       desc: 'Fingerprint & face-based access control devices' },
  { img: p31, name: 'Set-Top Box',              tag: 'STB',          desc: 'Advanced set-top box for digital broadcasting' },
  { img: p32, name: 'V Series',                 tag: 'Camera',       desc: 'V series professional security camera' },
  { img: p33, name: 'RB Series',                tag: 'Camera',       desc: 'RB series high-performance camera unit' },
  { img: p34, name: 'FG Series',                tag: 'Camera',       desc: 'FG series advanced surveillance camera' },
  { img: p35, name: 'ND-1 Series',              tag: 'Camera',       desc: 'ND-1 series next-gen camera unit' },
  { img: p36, name: 'CK-1 Series',              tag: 'Camera',       desc: 'CK-1 series compact security camera' },
  { img: p37, name: 'ATEX Camera',              tag: 'Industrial',   desc: 'Explosion-proof ATEX certified camera for hazardous environments' },
  {
    img: srcLogo, name: 'SRC Projects', type: 'partner',
    theme: { bg: '#04080f', g1: '#0a1f40', g2: '#061228', ac: '#2563eb', hi: '#93c5fd' },
    tagline: "Building Tomorrow's Landmarks",
    desc: 'Delivering premium residential & commercial spaces with a commitment to quality, precision, and innovation.',
    tags: ['Construction', 'Real Estate', 'Infrastructure'],
    stat1: { val: '20+', label: 'Years of Excellence' },
    stat2: { val: '500+', label: 'Projects Delivered' },
  },
  {
    img: cbre, name: 'CBRE India', type: 'partner',
    theme: { bg: '#020d06', g1: '#00301a', g2: '#011a0e', ac: '#00874a', hi: '#34d399' },
    tagline: 'Real Estate. Reimagined.',
    desc: 'World\'s largest commercial real estate services firm — trusted partner for workplace, facilities & advisory solutions.',
    tags: ['Property Management', 'Advisory', 'Project Management'],
    stat1: { val: '#1', label: 'Global CRE Services' },
    stat2: { val: '100+', label: 'Cities in India' },
  },
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

const STYLE = `
@keyframes tv-fadeIn    { from{opacity:0} to{opacity:1} }
@keyframes tv-riseUp    { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
@keyframes tv-slideL    { from{opacity:0;transform:translateX(-44px)} to{opacity:1;transform:translateX(0)} }
@keyframes tv-zoomSpring{ 0%{opacity:0;transform:scale(0.62) rotate(-3deg)} 70%{opacity:1;transform:scale(1.05) rotate(0.4deg)} 100%{transform:scale(1) rotate(0)} }
@keyframes tv-lineWipe  { from{transform:scaleX(0);transform-origin:left} to{transform:scaleX(1);transform-origin:left} }
@keyframes tv-pulse     { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:0.8;transform:scale(1.04)} }
@keyframes tv-rotateSlow{ from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes tv-rotateCCW { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
@keyframes tv-ticker    { from{transform:translateX(110%)} to{transform:translateX(-110%)} }
@keyframes tv-bgSlide   { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
@keyframes tv-scanLine  { 0%{top:-4px;opacity:0} 10%{opacity:1} 90%{opacity:0.6} 100%{top:100%;opacity:0} }
@keyframes tv-cornerSpin{ 0%{opacity:0.3} 50%{opacity:1} 100%{opacity:0.3} }
@keyframes tv-numberRise{ from{opacity:0;transform:translateY(18px) scale(0.8)} to{opacity:1;transform:translateY(0) scale(1)} }
`;

let _injected = false;
function injectStyle() {
  if (_injected) return; _injected = true;
  const el = document.createElement('style');
  el.textContent = STYLE;
  document.head.appendChild(el);
}

const INTERVAL = 6000;

function Corner({ size = 18, color, style: s = {} }) {
  return (
    <div style={{ width: size, height: size, borderTop: `2.5px solid ${color}`, borderLeft: `2.5px solid ${color}`, ...s }} />
  );
}

export default function AdCarousel() {
  const [current, setCurrent] = useState(0);
  const [slideKey, setSlideKey] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => { injectStyle(); }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setCurrent(p => (p + 1) % PRODUCTS.length);
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

  const product = PRODUCTS[current];
  const themeBase = product.type === 'partner' ? product.theme : THEMES[current % THEMES.length];
  const { bg, g1, g2, ac, hi } = themeBase;
  const { img, name, tag, desc, type, tagline, tags, stat1, stat2 } = product;
  const num = String(current + 1).padStart(2, '0');
  const tot = String(PRODUCTS.length).padStart(2, '0');

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 0, background: bg }}>

      {/* Animated gradient background */}
      <div key={`bg-${current}`} style={{
        position: 'absolute', inset: 0, zIndex: 0,
        background: `linear-gradient(135deg, ${bg} 0%, ${g1} 40%, ${g2} 70%, ${bg} 100%)`,
        backgroundSize: '300% 300%',
        animation: 'tv-bgSlide 8s ease-in-out infinite, tv-fadeIn 0.7s ease both',
      }} />

      {/* Geometric rings */}
      <div style={{ position: 'absolute', right: '18%', top: '50%', width: 160, height: 160, marginTop: -80, borderRadius: '50%', border: `1px solid ${ac}30`, animation: 'tv-rotateSlow 12s linear infinite', zIndex: 1 }} />
      <div style={{ position: 'absolute', right: '21%', top: '50%', width: 100, height: 100, marginTop: -50, borderRadius: '50%', border: `1px solid ${ac}50`, animation: 'tv-rotateCCW 8s linear infinite', zIndex: 1 }} />
      <div style={{ position: 'absolute', right: '23%', top: '50%', width: 60, height: 60, marginTop: -30, borderRadius: '50%', border: `2px solid ${ac}70`, animation: 'tv-pulse 2.5s ease-in-out infinite', zIndex: 1 }} />

      {/* Radial spotlight */}
      <div style={{ position: 'absolute', right: '5%', top: 0, bottom: 0, width: '60%', zIndex: 2, background: `radial-gradient(ellipse 80% 80% at 60% 50%, ${ac}28 0%, ${ac}10 45%, transparent 75%)`, animation: 'tv-pulse 4s ease-in-out infinite' }} />

      {/* Scan line */}
      <div key={`scan-${slideKey}`} style={{ position: 'absolute', left: 0, right: 0, height: 3, zIndex: 8, background: `linear-gradient(90deg, transparent 0%, ${ac}80 30%, ${hi} 50%, ${ac}80 70%, transparent 100%)`, animation: 'tv-scanLine 1.4s ease-in-out 0.1s both', pointerEvents: 'none' }} />

      {/* Content */}
      <div key={`c-${slideKey}`} style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', flexDirection: 'row' }}>

        {type === 'partner' ? (
          /* ── Partner branded slide ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'row', alignItems: 'stretch', padding: '14px 16px 30px 16px', gap: 14 }}>

            {/* LEFT — logo */}
            <div style={{ width: '42%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <div style={{
                padding: '14px 18px', borderRadius: 16,
                background: 'rgba(255,255,255,0.05)', border: `1px solid ${ac}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'tv-zoomSpring 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.05s both',
                boxShadow: `0 0 32px ${ac}25`,
              }}>
                <img src={img} alt={name} style={{ maxWidth: 110, maxHeight: 70, objectFit: 'contain' }} />
              </div>
              {/* stats row */}
              <div style={{ display: 'flex', gap: 8, animation: 'tv-riseUp 0.4s ease 0.4s both' }}>
                {[stat1, stat2].map((s, i) => (
                  <div key={i} style={{ textAlign: 'center', padding: '5px 10px', borderRadius: 8, background: `${ac}18`, border: `1px solid ${ac}35` }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: hi, lineHeight: 1 }}>{s.val}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 7, color: 'rgba(255,255,255,0.5)', fontWeight: 600, letterSpacing: '0.06em' }}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* divider */}
            <div style={{ width: 1, alignSelf: 'stretch', background: `linear-gradient(180deg, transparent, ${ac}60 30%, ${ac}90 50%, ${ac}60 70%, transparent)`, margin: '8px 0' }} />

            {/* RIGHT — text */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
              <div style={{ animation: 'tv-slideL 0.4s ease 0.08s both' }}>
                <span style={{ fontSize: 8, fontWeight: 800, color: ac, letterSpacing: '0.2em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: ac, display: 'inline-block' }} />
                  TRUSTED PARTNER
                </span>
              </div>
              <div style={{ height: 2, width: '70%', borderRadius: 2, background: `linear-gradient(90deg, ${ac}, transparent)`, animation: 'tv-lineWipe 0.5s ease 0.14s both' }} />
              <div style={{ animation: 'tv-slideL 0.5s cubic-bezier(0.22,1,0.36,1) 0.18s both' }}>
                <p style={{ fontSize: 'clamp(13px,1.7vw,20px)', fontWeight: 900, color: '#fff', lineHeight: 1.2, letterSpacing: '-0.02em', margin: 0 }}>{name}</p>
              </div>
              <div style={{ animation: 'tv-riseUp 0.4s ease 0.24s both' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: hi, margin: 0, letterSpacing: '0.02em' }}>{tagline}</p>
              </div>
              <div style={{ animation: 'tv-riseUp 0.4s ease 0.32s both' }}>
                <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0 }}>{desc}</p>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', animation: 'tv-riseUp 0.4s ease 0.4s both' }}>
                {tags.map((t, i) => (
                  <span key={i} style={{ fontSize: 7.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: `${ac}18`, border: `1px solid ${ac}45`, color: hi, letterSpacing: '0.05em' }}>{t}</span>
                ))}
              </div>
              <div style={{ height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', animation: 'tv-riseUp 0.4s ease 0.48s both' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${ac}, ${hi})`, borderRadius: 3 }} />
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* LEFT */}
            <div style={{ width: '44%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '12px 10px 22px 16px', gap: 7 }}>

              <div style={{ animation: 'tv-slideL 0.4s ease 0.08s both' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 800, color: ac, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: ac, display: 'inline-block', flexShrink: 0 }} />
                  {tag}
                </span>
              </div>

              <div style={{ height: 2, width: '65%', borderRadius: 2, background: `linear-gradient(90deg, ${ac}, ${ac}30, transparent)`, animation: 'tv-lineWipe 0.5s ease 0.14s both' }} />

              <div style={{ animation: 'tv-slideL 0.5s cubic-bezier(0.22,1,0.36,1) 0.18s both' }}>
                <p style={{ fontSize: 'clamp(14px,1.9vw,22px)', fontWeight: 900, color: '#fff', lineHeight: 1.2, letterSpacing: '-0.02em', margin: 0 }}>
                  {name}
                </p>
              </div>

              <div style={{ animation: 'tv-riseUp 0.4s ease 0.28s both' }}>
                <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.52)', fontWeight: 400, lineHeight: 1.6, margin: 0 }}>{desc}</p>
              </div>

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', animation: 'tv-riseUp 0.4s ease 0.36s both' }}>
                {['HD Quality', 'Smart Tech', 'Pro Grade'].map((f, fi) => (
                  <span key={fi} style={{ fontSize: 8, fontWeight: 600, padding: '2px 9px', borderRadius: 4, background: `${ac}18`, border: `1px solid ${ac}45`, color: hi, letterSpacing: '0.06em' }}>{f}</span>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, animation: 'tv-numberRise 0.4s ease 0.44s both', marginTop: 2 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: ac, lineHeight: 1 }}>{num}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: 500 }}>/ {tot}</span>
              </div>

              <div style={{ height: 3, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${ac}, ${hi})`, borderRadius: 3 }} />
              </div>
            </div>

            {/* RIGHT */}
            <div style={{ width: '56%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '18px 16px 22px 6px' }}>
              <Corner size={18} color={ac} style={{ position: 'absolute', top: 16, right: 16, transform: 'rotate(90deg)', animation: 'tv-cornerSpin 3s ease-in-out infinite' }} />
              <Corner size={18} color={ac} style={{ position: 'absolute', bottom: 16, right: 16, transform: 'rotate(180deg)', animation: 'tv-cornerSpin 3s ease-in-out 0.75s infinite' }} />
              <Corner size={18} color={ac} style={{ position: 'absolute', bottom: 16, left: 6, transform: 'rotate(270deg)', animation: 'tv-cornerSpin 3s ease-in-out 1.5s infinite' }} />
              <Corner size={18} color={ac} style={{ position: 'absolute', top: 16, left: 6, animation: 'tv-cornerSpin 3s ease-in-out 2.25s infinite' }} />
              <img src={img} alt={name} style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', position: 'relative', zIndex: 2, animation: 'tv-zoomSpring 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.05s both' }} />
            </div>
          </>
        )}
      </div>

      {/* Ticker */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, height: 18, background: `${ac}18`, borderTop: `1px solid ${ac}35`, overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
        <div style={{ whiteSpace: 'nowrap', animation: 'tv-ticker 18s linear infinite', fontSize: 9, fontWeight: 600, color: hi, letterSpacing: '0.15em' }}>
          {'  ◆  RURUTEK Pvt Ltd ◆  ADVANCED SECURITY SOLUTIONS  ◆  SMART SURVEILLANCE  ◆  PTZ CAMERAS  ◆  HD STB  ◆  DOME CAMERAS   ◆  EXPLOSION PROOF  ◆  '}
        </div>
      </div>

    </div>
  );
}
