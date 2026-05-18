import React, { useRef, useState, useEffect, useCallback } from 'react';
import WebRTCStream from './WebRTCStream.jsx';

export default function ROIDrawer({
  cameraId,
  whepUrl,
  streamWidth = 640,
  streamHeight = 480,
  existingROI = null,
  onROISet,
  onClose,
}) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);
  const rafRef       = useRef(null);

  // Keep ROI in both state (for re-render of coords display) AND refs (for callbacks
  // that must always see the latest value without being re-created).
  const [currentROI, setCurrentROI] = useState(existingROI || null);
  const [previewROI, setPreviewROI] = useState(null);
  const currentROIRef = useRef(existingROI || null);
  const previewROIRef = useRef(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const startPosRef = useRef({ x: 0, y: 0 });

  const isPortrait = streamHeight > streamWidth;

  // Canvas pixel size — managed via ref + direct DOM, never via JSX props
  const canvasSizeRef = useRef({ w: streamWidth, h: streamHeight });

  // ── Core paint function — reads from refs so it is always current ────────────
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const roi   = previewROIRef.current || currentROIRef.current;
    const isPrev = !!previewROIRef.current;
    const { w, h } = canvasSizeRef.current;
    const sx = streamWidth  / w;
    const sy = streamHeight / h;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, w, h);
    if (!roi) return;

    const dx = roi.x      / sx;
    const dy = roi.y      / sy;
    const dw = roi.width  / sx;
    const dh = roi.height / sy;

    // 4-rect vignette — no clearRect inside ROI, so no intermediate transparent flash
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0,       0,       w,           dy);
    ctx.fillRect(0,       dy,      dx,          dh);
    ctx.fillRect(dx + dw, dy,      w - dx - dw, dh);
    ctx.fillRect(0,       dy + dh, w,           h - dy - dh);

    const color = isPrev ? '#22d3ee' : '#00ffff';
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(dx, dy, dw, dh);

    const hs = 10;
    ctx.fillStyle = color;
    [[dx, dy], [dx + dw, dy], [dx, dy + dh], [dx + dw, dy + dh]].forEach(([hx, hy]) => {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    });
  }, [streamWidth, streamHeight]);

  const schedulePaint = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(paint);
  }, [paint]);

  // ── ResizeObserver — sets canvas size directly on DOM, never via JSX ─────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width < 1 || height < 1) return;
      const w = Math.round(width), h = Math.round(height);
      const prev = canvasSizeRef.current;
      if (prev.w === w && prev.h === h) return;
      canvasSizeRef.current = { w, h };
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = w; canvas.height = h; }
      schedulePaint();   // uses refs — always has latest ROI
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedulePaint]);

  // ── Repaint when ROI changes ─────────────────────────────────────────────────
  useEffect(() => {
    currentROIRef.current = currentROI;
    schedulePaint();
  }, [currentROI, schedulePaint]);

  useEffect(() => {
    previewROIRef.current = previewROI;
    schedulePaint();
  }, [previewROI, schedulePaint]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // ── Mouse / touch handlers ───────────────────────────────────────────────────
  function getStreamPos(e) {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const { w, h } = canvasSizeRef.current;
    return {
      x: (clientX - rect.left) * (streamWidth  / w),
      y: (clientY - rect.top)  * (streamHeight / h),
    };
  }

  function onMouseDown(e) {
    e.preventDefault();
    const pos = getStreamPos(e);
    startPosRef.current = { x: pos.x, y: pos.y };
    setIsDrawing(true);
    previewROIRef.current = null;
    setPreviewROI(null);
  }

  function onMouseMove(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos  = getStreamPos(e);
    const sx   = startPosRef.current;
    const next = {
      x:      Math.min(sx.x, pos.x),
      y:      Math.min(sx.y, pos.y),
      width:  Math.abs(pos.x - sx.x),
      height: Math.abs(pos.y - sx.y),
    };
    previewROIRef.current = next;
    setPreviewROI(next);
  }

  function onMouseUp(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos    = getStreamPos(e);
    const sx     = startPosRef.current;
    const x      = Math.min(sx.x, pos.x);
    const y      = Math.min(sx.y, pos.y);
    const width  = Math.abs(pos.x - sx.x);
    const height = Math.abs(pos.y - sx.y);
    if (width > 10 && height > 10) {
      const roi = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
      currentROIRef.current = roi;
      setCurrentROI(roi);
    }
    previewROIRef.current = null;
    setPreviewROI(null);
    setIsDrawing(false);
  }

  const displayROI  = previewROI || currentROI;
  const containerStyle = isPortrait
    ? { width: '100%', maxWidth: `${Math.round((streamWidth / streamHeight) * 480)}px` }
    : { width: '100%' };

  return (
    <div className="flex flex-col gap-4 h-full">
      <p className="text-slate-400 text-sm">
        Drag on the stream to draw a Region of Interest. Only faces inside the ROI will be processed.
        {isPortrait && <span className="ml-2 text-amber-400 text-xs">(Portrait camera)</span>}
      </p>

      <div className="flex justify-center">
        <div
          ref={containerRef}
          className="relative bg-slate-950 rounded-xl overflow-hidden border border-slate-700 cursor-crosshair select-none"
          style={{ ...containerStyle, aspectRatio: `${streamWidth}/${streamHeight}` }}
        >
          {/* WebRTC stream via mediamtx WHEP — low-latency, no MJPEG issues */}
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
            {whepUrl
              ? <WebRTCStream whepUrl={whepUrl} style={{ objectFit: 'fill' }} />
              : <div className="w-full h-full flex items-center justify-center bg-slate-950">
                  <span className="text-slate-500 text-xs">No stream URL</span>
                </div>
            }
          </div>
          {/* Canvas overlay — sits above the video for ROI drawing */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ willChange: 'transform', transform: 'translateZ(0)', zIndex: 1 }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={onMouseDown}
            onTouchMove={onMouseMove}
            onTouchEnd={onMouseUp}
          />
        </div>
      </div>

      <div className="bg-slate-800 rounded-lg px-4 py-3 text-sm text-slate-300 font-mono">
        {displayROI ? (
          <span>
            ROI: x={Math.round(displayROI.x)}, y={Math.round(displayROI.y)},{' '}
            w={Math.round(displayROI.width)}, h={Math.round(displayROI.height)}
            <span className="ml-3 text-slate-500 text-xs">
              (stream space {streamWidth}×{streamHeight})
            </span>
          </span>
        ) : (
          <span className="text-slate-500">No ROI set — drag on the stream to draw one</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => currentROI && onROISet(currentROI)}
          disabled={!currentROI}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 active:scale-95 active:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all duration-75 touch-manipulation"
        >
          Save ROI
        </button>
        <button
          onClick={() => { currentROIRef.current = null; setCurrentROI(null); setPreviewROI(null); }}
          disabled={!currentROI}
          className="px-5 py-2 bg-slate-700 hover:bg-slate-600 active:scale-95 active:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all duration-75 touch-manipulation"
        >
          Clear ROI
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto px-5 py-2 bg-slate-700 hover:bg-slate-600 active:scale-95 active:bg-slate-800 text-white text-sm font-medium rounded-lg transition-all duration-75 touch-manipulation"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
