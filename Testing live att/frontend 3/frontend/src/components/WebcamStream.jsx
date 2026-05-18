
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../services/socket.js';

const WEBCAM_CAM_ID = 'webcam';
// Send frames every 200 ms (5 fps).  The Python worker can process at most
// ~5–8 fps anyway (InsightFace inference time).  Sending faster only floods
// the Socket.IO bus and queues frames that arrive slower than they are
// processed, building up latency.  5 fps matches processing capacity while
// keeping the overlay responsive.
const FRAME_MS = 200;

export default function WebcamStream({ detectedPerson, pythonConnected }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);
  // framesSent removed — updating it on every interval caused a React re-render
  // every 200 ms, re-rendering the entire component (video element included)
  // and causing visible flicker.  The "Sending frames" badge is shown based on
  // `active && pythonConnected` which doesn't change per-frame.

  // Start webcam
  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Don't await play() — autoPlay handles it; manual play() can race with unmount
        videoRef.current.play().catch(() => {});
      }
      setActive(true);
      setError(null);
    } catch (err) {
      // Ignore interrupted-play errors (component remount); only surface real denials
      if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
        setError('Webcam access denied. Please allow camera permission in your browser.');
      } else if (!err.message?.includes('interrupted') && !err.message?.includes('removed')) {
        setError('Webcam error: ' + err.message);
      }
    }
  }, []);

  // Stop webcam
  const stop = useCallback(() => {
    clearInterval(intervalRef.current);
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setActive(false);
  }, []);

  // Auto-start on mount
  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  // Initialise canvas dimensions once so we don't force re-layout every frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 640;
      canvas.height = 480;
    }
  }, []);

  // Cache the 2D context across renders — getContext() is cheap but avoids
  // repeated object creation inside the hot interval path.
  const ctxRef = useRef(null);

  // Send frames to server when active
  useEffect(() => {
    if (!active) return;
    intervalRef.current = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      // Reuse cached context; fall back to fresh lookup if canvas changed.
      if (!ctxRef.current || ctxRef.current.canvas !== canvas) {
        ctxRef.current = canvas.getContext('2d');
      }
      const ctx = ctxRef.current;
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, 640, 480);
      // JPEG at 70% quality — good balance of size vs accuracy
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const frame = dataUrl.split(',')[1];
      socket.emit('webcam_frame', { camera_id: WEBCAM_CAM_ID, frame });
      // Removed setFramesSent() — state update caused a re-render every frame.
    }, FRAME_MS);
    return () => clearInterval(intervalRef.current);
  }, [active]);

  return (
    <div
      className="relative rounded-xl overflow-hidden bg-slate-900 border border-slate-700"
      style={{ aspectRatio: '16/9' }}
    >
      {/* Label */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded text-xs text-white font-medium">
        <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400 animate-pulse' : 'bg-slate-400'}`} />
        Webcam
      </div>

      {/* AI connection status + frame indicator (top-right) */}
      <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
        <div
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
            pythonConnected
              ? 'bg-green-900/70 text-green-300'
              : 'bg-red-900/70 text-red-300'
          }`}
        >
          <div className={`w-1.5 h-1.5 rounded-full ${pythonConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
          {pythonConnected ? 'AI Connected' : 'AI Offline'}
        </div>
        {active && pythonConnected && (
          <div className="flex items-center gap-1 bg-blue-900/70 px-2 py-0.5 rounded text-xs text-blue-300">
            <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Sending frames
          </div>
        )}
        {active && !pythonConnected && (
          <div className="bg-yellow-900/70 px-2 py-0.5 rounded text-xs text-yellow-300">
            Start python main.py
          </div>
        )}
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
          <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
              d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={start}
            className="mt-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg"
          >
            Retry
          </button>
        </div>
      ) : (
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          muted
          playsInline
        />
      )}

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Detection overlay */}
      {detectedPerson && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <div className="flex items-center gap-3">
            {detectedPerson.image_path ? (
              <img
                src={`/${detectedPerson.image_path}`}
                className="w-11 h-11 rounded-full object-cover border-2 border-green-500 flex-shrink-0"
                alt={detectedPerson.name}
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-green-600/30 border-2 border-green-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {(detectedPerson.name || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-white text-sm font-bold leading-tight">{detectedPerson.name}</p>
              <p className="text-green-400 text-xs">
                {detectedPerson.employee_code && `${detectedPerson.employee_code} · `}
                {Math.round((detectedPerson.confidence || 0) * 100)}% match
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
