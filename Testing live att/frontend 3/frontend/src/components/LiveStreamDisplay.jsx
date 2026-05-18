import { useEffect, useRef, useState } from 'react';
import api from '../services/api.js';

export default function LiveStreamDisplay({ camera }) {
  const imgRef = useRef(null);
  const [status, setStatus] = useState('connecting');
  const abortRef = useRef(null);
  const streamIdRef = useRef(null);

  useEffect(() => {
    if (!camera?.rtsp_url) return;

    let cancelled = false;

    async function run() {
      try {
        setStatus('connecting');

        // 1. Start stream on backend
        const { data } = await api.post('/streaming/start', { rtspUrl: camera.rtsp_url });
        if (cancelled) { api.post(`/streaming/stop/${data.streamId}`).catch(() => {}); return; }

        streamIdRef.current = data.streamId;

        // 2. Fetch MJPEG through Vite proxy (same origin = no mixed-content block)
        abortRef.current = new AbortController();
        const res = await fetch(
          `/api/streaming/stream/${data.streamId}`,
          { signal: abortRef.current.signal }
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        let buf = new Uint8Array(0);

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;

          // Append chunk
          const tmp = new Uint8Array(buf.length + value.length);
          tmp.set(buf);
          tmp.set(value, buf.length);
          buf = tmp;

          // Extract all complete JPEG frames
          let i = 0;
          while (i < buf.length - 1) {
            if (buf[i] === 0xFF && buf[i + 1] === 0xD8) {
              let j = i + 2;
              while (j < buf.length - 1) {
                if (buf[j] === 0xFF && buf[j + 1] === 0xD9) {
                  const frame = buf.slice(i, j + 2);
                  const url = URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' }));
                  if (imgRef.current) {
                    if (imgRef.current.src?.startsWith('blob:')) URL.revokeObjectURL(imgRef.current.src);
                    imgRef.current.src = url;
                    setStatus('live');
                  }
                  buf = buf.slice(j + 2);
                  i = 0;
                  break;
                }
                j++;
              }
              if (j >= buf.length - 1) break;
            } else {
              i++;
            }
          }

          if (buf.length > 5 * 1024 * 1024) buf = buf.slice(-2 * 1024 * 1024);
        }

        if (!cancelled) setStatus('ended');
      } catch (err) {
        if (err.name !== 'AbortError' && !cancelled) {
          console.error('[STREAM]', err.message);
          setStatus('error');
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      if (streamIdRef.current) {
        api.post(`/streaming/stop/${streamIdRef.current}`).catch(() => {});
        streamIdRef.current = null;
      }
      if (imgRef.current?.src?.startsWith('blob:')) {
        URL.revokeObjectURL(imgRef.current.src);
      }
    };
  }, [camera?.id]);

  const dotColor = status === 'live' ? '#22c55e' : status === 'error' ? '#ef4444' : '#eab308';

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <img
        ref={imgRef}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        alt=""
      />
      {/* Status badge */}
      <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '3px 8px' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 1 }}>
          {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : status === 'error' ? 'ERROR' : 'ENDED'}
        </span>
      </div>
      {/* Overlay when not live */}
      {status !== 'live' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
          <div style={{ textAlign: 'center', color: '#94a3b8' }}>
            {status === 'error' ? '⚠ Stream Error' : '⏳ Connecting...'}
          </div>
        </div>
      )}
    </div>
  );
}
