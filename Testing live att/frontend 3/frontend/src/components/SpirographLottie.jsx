import React, { useEffect, useRef } from 'react';

export default function SpirographLottie({ size = 340, style = {} }) {
  const canvasRef = useRef(null);
  const frameRef  = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = size, H = size;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = W / 2, cy = H / 2;
    const faceW = W * 0.30, faceH = H * 0.38;

    // Facial landmark dots (relative to face center)
    const landmarks = [
      // eyes
      { x: -faceW * 0.38, y: -faceH * 0.12 },
      { x:  faceW * 0.38, y: -faceH * 0.12 },
      // eye corners
      { x: -faceW * 0.55, y: -faceH * 0.10 },
      { x: -faceW * 0.22, y: -faceH * 0.10 },
      { x:  faceW * 0.22, y: -faceH * 0.10 },
      { x:  faceW * 0.55, y: -faceH * 0.10 },
      // nose
      { x:  0,            y:  faceH * 0.08  },
      { x: -faceW * 0.12, y:  faceH * 0.18  },
      { x:  faceW * 0.12, y:  faceH * 0.18  },
      // mouth
      { x: -faceW * 0.30, y:  faceH * 0.35  },
      { x:  0,            y:  faceH * 0.40  },
      { x:  faceW * 0.30, y:  faceH * 0.35  },
      // eyebrows
      { x: -faceW * 0.45, y: -faceH * 0.28  },
      { x: -faceW * 0.18, y: -faceH * 0.30  },
      { x:  faceW * 0.18, y: -faceH * 0.30  },
      { x:  faceW * 0.45, y: -faceH * 0.28  },
      // jaw
      { x: -faceW * 0.55, y:  faceH * 0.25  },
      { x:  faceW * 0.55, y:  faceH * 0.25  },
      { x:  0,            y:  faceH * 0.60  },
    ];

    let tick = 0;
    // scan line state
    let scanY = -faceH;
    let scanDir = 1;
    // recognition state: 0=scanning 1=matched
    let matchAlpha = 0;
    let matched = false;
    let matchTimer = 0;

    function drawCornerBrackets(x, y, w, h, color, alpha, lineLen = 18) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2.2;
      const corners = [
        [x - w, y - h, 1,  1],
        [x + w, y - h, -1, 1],
        [x - w, y + h, 1, -1],
        [x + w, y + h, -1,-1],
      ];
      corners.forEach(([cx2, cy2, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(cx2 + sx * lineLen, cy2);
        ctx.lineTo(cx2, cy2);
        ctx.lineTo(cx2, cy2 + sy * lineLen);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    function drawFaceOutline(alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, faceW, faceH, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    function draw() {
      tick++;
      ctx.clearRect(0, 0, W, H);

      // ── outer ring pulse ──────────────────────────────────────
      const ringPulse = 0.5 + 0.5 * Math.sin(tick * 0.04);
      const outerR = W * 0.44 + ringPulse * 4;
      const ringGrd = ctx.createRadialGradient(cx, cy, outerR - 12, cx, cy, outerR + 6);
      ringGrd.addColorStop(0, `rgba(56,189,248,${0.12 + ringPulse * 0.10})`);
      ringGrd.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.fillStyle = ringGrd;
      ctx.fill();

      // thin rotating ring
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tick * 0.012);
      ctx.strokeStyle = 'rgba(56,189,248,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 14]);
      ctx.beginPath();
      ctx.arc(0, 0, W * 0.43, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // ── face outline ──────────────────────────────────────────
      drawFaceOutline(0.55);

      // ── scan line ─────────────────────────────────────────────
      if (!matched) {
        scanY += scanDir * 1.8;
        if (scanY > faceH)  { scanDir = -1; }
        if (scanY < -faceH) { scanDir =  1; }

        const absY = cy + scanY;
        // clip to face ellipse
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, faceW + 2, faceH + 2, 0, 0, Math.PI * 2);
        ctx.clip();

        const scanGrd = ctx.createLinearGradient(cx - faceW, absY, cx + faceW, absY);
        scanGrd.addColorStop(0,   'rgba(56,189,248,0)');
        scanGrd.addColorStop(0.3, 'rgba(56,189,248,0.55)');
        scanGrd.addColorStop(0.5, 'rgba(125,211,252,0.85)');
        scanGrd.addColorStop(0.7, 'rgba(56,189,248,0.55)');
        scanGrd.addColorStop(1,   'rgba(56,189,248,0)');

        // glow band
        ctx.fillStyle = 'rgba(56,189,248,0.07)';
        ctx.fillRect(cx - faceW, absY - 18, faceW * 2, 36);

        // sharp line
        ctx.beginPath();
        ctx.moveTo(cx - faceW, absY);
        ctx.lineTo(cx + faceW, absY);
        ctx.strokeStyle = scanGrd;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
      }

      // ── landmark dots ─────────────────────────────────────────
      landmarks.forEach((lm, i) => {
        const lx = cx + lm.x, ly = cy + lm.y;
        // only show dots if scan line has passed them
        const inScan = !matched && (ly < cy + scanY + 10);
        const show   = matched || inScan;
        if (!show) return;

        const dotAlpha = matched ? (0.7 + 0.3 * Math.sin(tick * 0.05 + i)) : 0.65;
        const dotColor = matched ? '#a78bfa' : '#38bdf8';
        const dotR = matched ? 2.2 : 1.8;

        ctx.beginPath();
        ctx.arc(lx, ly, dotR, 0, Math.PI * 2);
        ctx.fillStyle = dotColor;
        ctx.globalAlpha = dotAlpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        // connection lines between nearby landmarks
        landmarks.forEach((lm2, j) => {
          if (j <= i) return;
          const lx2 = cx + lm2.x, ly2 = cy + lm2.y;
          const dist = Math.hypot(lx - lx2, ly - ly2);
          if (dist > faceW * 0.65) return;
          const show2 = matched || (!matched && ly2 < cy + scanY + 10);
          if (!show2) return;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx2, ly2);
          ctx.strokeStyle = matched ? 'rgba(167,139,250,0.25)' : 'rgba(56,189,248,0.20)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        });
      });

      // ── corner brackets ───────────────────────────────────────
      drawCornerBrackets(cx, cy, faceW * 0.88, faceH * 0.88,
        matched ? '#a78bfa' : '#38bdf8',
        matched ? 0.9 : 0.6 + 0.3 * Math.sin(tick * 0.05)
      );

      // ── match transition ──────────────────────────────────────
      matchTimer++;
      if (matchTimer > 280 && !matched) {
        matched = true; matchAlpha = 0;
      }
      if (matched) {
        matchAlpha = Math.min(1, matchAlpha + 0.025);

        // green verified ring
        ctx.save();
        ctx.globalAlpha = matchAlpha * (0.7 + 0.3 * Math.sin(tick * 0.06));
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, faceW * 1.18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // checkmark
        if (matchAlpha > 0.5) {
          ctx.save();
          ctx.globalAlpha = (matchAlpha - 0.5) * 2;
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - 16, cy + 2);
          ctx.lineTo(cx - 4,  cy + 14);
          ctx.lineTo(cx + 18, cy - 12);
          ctx.stroke();
          ctx.restore();
        }

        // "VERIFIED" text
        if (matchAlpha > 0.7) {
          ctx.save();
          ctx.globalAlpha = (matchAlpha - 0.7) * 3.3;
          ctx.fillStyle = '#4ade80';
          ctx.font = `bold ${size * 0.048}px monospace`;
          ctx.textAlign = 'center';
          ctx.letterSpacing = '3px';
          ctx.fillText('VERIFIED', cx, cy + faceH + size * 0.10);
          ctx.restore();
        }

        // after 3s reset
        if (matchTimer > 460) {
          matched = false; matchAlpha = 0; matchTimer = 0; scanY = -faceH;
        }
      }

      // ── status text ───────────────────────────────────────────
      if (!matched) {
        ctx.save();
        ctx.globalAlpha = 0.55 + 0.3 * Math.sin(tick * 0.08);
        ctx.fillStyle = '#38bdf8';
        ctx.font = `${size * 0.042}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('SCANNING...', cx, cy + faceH + size * 0.10);
        ctx.restore();
      }

      frameRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(frameRef.current);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, background: 'transparent', ...style }}
    />
  );
}
