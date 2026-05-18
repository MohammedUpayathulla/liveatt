import React, { useEffect, useRef } from 'react';

export default function IdleAnimation({ width = 320, height = 320 }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const lastRef   = useRef(0);
  const tickRef   = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = width  * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = width / 2, cy = height / 2;

    // ── particle ring config ──────────────────────────────────────
    const RINGS = [
      { r: width * 0.38, count: 36, speed: 0.004,  size: 2.2, alpha: 0.7  },
      { r: width * 0.28, count: 28, speed: -0.006, size: 1.8, alpha: 0.55 },
      { r: width * 0.18, count: 18, speed: 0.009,  size: 1.4, alpha: 0.45 },
    ];

    // ── data streams: arcs shooting out ──────────────────────────
    const STREAMS = Array.from({ length: 8 }, (_, i) => ({
      angle: (i / 8) * Math.PI * 2,
      t: Math.random(),
      speed: 0.008 + Math.random() * 0.006,
      len: 0.3 + Math.random() * 0.3,
    }));

    function lerp(a, b, t) { return a + (b - a) * t; }

    function hsl(h, s, l, a = 1) {
      return `hsla(${h},${s}%,${l}%,${a})`;
    }

    function drawFrame(ts) {
      // throttle to ~40fps on low-end devices
      if (ts - lastRef.current < 25) { rafRef.current = requestAnimationFrame(drawFrame); return; }
      lastRef.current = ts;
      tickRef.current += 1;
      const t = tickRef.current;

      ctx.clearRect(0, 0, width, height);

      // ── 1. central glow ──────────────────────────────────────────
      const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.22);
      g0.addColorStop(0,   'rgba(167,139,250,0.28)');
      g0.addColorStop(0.5, 'rgba(99,102,241,0.10)');
      g0.addColorStop(1,   'rgba(99,102,241,0)');
      ctx.fillStyle = g0;
      ctx.beginPath();
      ctx.arc(cx, cy, width * 0.22, 0, Math.PI * 2);
      ctx.fill();

      // ── 2. outer soft ring ───────────────────────────────────────
      const pulse = 0.85 + 0.15 * Math.sin(t * 0.06);
      const g1 = ctx.createRadialGradient(cx, cy, width * 0.30 * pulse, cx, cy, width * 0.48 * pulse);
      g1.addColorStop(0,   'rgba(139,92,246,0.14)');
      g1.addColorStop(1,   'rgba(139,92,246,0)');
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(cx, cy, width * 0.48 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // ── 3. rotating particle rings ───────────────────────────────
      RINGS.forEach((ring, ri) => {
        const baseAngle = t * ring.speed;
        for (let i = 0; i < ring.count; i++) {
          const a   = baseAngle + (i / ring.count) * Math.PI * 2;
          const px  = cx + Math.cos(a) * ring.r;
          const py  = cy + Math.sin(a) * ring.r;
          const hue = lerp(240, 290, i / ring.count);
          const bri = 0.6 + 0.4 * Math.sin(a * 3 + t * 0.08);

          ctx.beginPath();
          ctx.arc(px, py, ring.size * bri, 0, Math.PI * 2);
          ctx.fillStyle = hsl(hue, 80, 72, ring.alpha * bri);
          ctx.fill();

          // connect every 3rd dot with a faint arc line
          if (i % 3 === 0 && ri === 0) {
            const a2  = baseAngle + ((i + 3) / ring.count) * Math.PI * 2;
            const px2 = cx + Math.cos(a2) * ring.r;
            const py2 = cy + Math.sin(a2) * ring.r;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px2, py2);
            ctx.strokeStyle = hsl(hue, 70, 72, 0.15);
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      });

      // ── 4. data stream pulses ────────────────────────────────────
      STREAMS.forEach(s => {
        s.t += s.speed;
        if (s.t > 1 + s.len) s.t = -s.len;
        const progress = Math.max(0, Math.min(1, s.t));
        const r0 = width * 0.18;
        const r1 = width * 0.38;
        const startR = lerp(r0, r1, Math.max(0, s.t - s.len));
        const endR   = lerp(r0, r1, progress);
        if (endR <= startR) return;

        const x0 = cx + Math.cos(s.angle) * startR;
        const y0 = cy + Math.sin(s.angle) * startR;
        const x1 = cx + Math.cos(s.angle) * endR;
        const y1 = cy + Math.sin(s.angle) * endR;

        const sg = ctx.createLinearGradient(x0, y0, x1, y1);
        sg.addColorStop(0,   'rgba(196,181,253,0)');
        sg.addColorStop(0.6, 'rgba(167,139,250,0.6)');
        sg.addColorStop(1,   'rgba(255,255,255,0.95)');
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = sg;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // bright tip
        ctx.beginPath();
        ctx.arc(x1, y1, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.fill();
      });

      // ── 5. inner core ─────────────────────────────────────────────
      const corePulse = 0.8 + 0.2 * Math.sin(t * 0.10);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, width * 0.08 * corePulse);
      cg.addColorStop(0, 'rgba(255,255,255,0.95)');
      cg.addColorStop(0.4, 'rgba(196,181,253,0.8)');
      cg.addColorStop(1,   'rgba(139,92,246,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, width * 0.08 * corePulse, 0, Math.PI * 2);
      ctx.fillStyle = cg;
      ctx.fill();

      // ── 6. concentric thin rings ──────────────────────────────────
      [0.22, 0.31, 0.40].forEach((ratio, i) => {
        const spinA = t * (i % 2 === 0 ? 0.012 : -0.010) + i;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spinA);
        ctx.beginPath();
        ctx.arc(0, 0, width * ratio, 0, Math.PI * 2);
        ctx.setLineDash([4 + i * 3, 8 + i * 4]);
        ctx.strokeStyle = `rgba(139,92,246,${0.20 - i * 0.04})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });

      rafRef.current = requestAnimationFrame(drawFrame);
    }

    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block' }}
    />
  );
}
