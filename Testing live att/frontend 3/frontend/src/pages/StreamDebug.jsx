import React, { useState, useRef, useEffect } from 'react';
import api from '../services/api.js';
import cfg from '../config.js';

export default function StreamDebug() {
  const [cameras, setCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState([]);
  const imgRef = useRef(null);
  const abortRef = useRef(null);

  const log = (msg, type = 'info') => {
    console.log(msg);
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  useEffect(() => {
    log('Loading cameras...');
    api.get('/cameras').then(r => {
      const cams = r.data.cameras || [];
      log(`Loaded ${cams.length} cameras`);
      cams.forEach(c => log(`  - Camera ${c.id}: ${c.name} (rtsp: ${c.rtsp_url ? 'YES' : 'NO'})`));
      setCameras(cams);
      if (cams.length > 0) setSelectedCam(cams[0]);
    }).catch(err => log(`Error loading cameras: ${err.message}`, 'error'));
  }, []);

  const startStream = async () => {
    if (!selectedCam?.rtsp_url) {
      log('No RTSP URL selected', 'error');
      return;
    }

    log(`Starting stream for: ${selectedCam.name}`);
    log(`RTSP URL: ${selectedCam.rtsp_url}`);
    setStatus('connecting');

    try {
      // Step 1: Request stream start
      log('Calling POST /api/streaming/start...');
      const startRes = await api.post('/streaming/start', {
        rtspUrl: selectedCam.rtsp_url,
      });

      const streamId = startRes.data.streamId;
      log(`Stream started: ${streamId}`);
      setStatus('fetching');

      // Step 2: Fetch stream
      log(`Fetching from /api/streaming/stream/${streamId}...`);
      abortRef.current = new AbortController();

      const streamRes = await fetch(`${cfg.API_BASE_URL}/streaming/stream/${streamId}`, {
        signal: abortRef.current.signal,
      });

      if (!streamRes.ok) {
        throw new Error(`HTTP ${streamRes.status}`);
      }

      log('Stream response OK, reading frames...');
      const reader = streamRes.body.getReader();
      let buffer = new Uint8Array(0);
      let frameCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          log('Stream ended');
          break;
        }

        buffer = new Uint8Array([...buffer, ...value]);
        log(`Received chunk: ${value.length} bytes, buffer: ${buffer.length}`);

        // Parse JPEG frames
        let i = 0;
        while (i < buffer.length - 1) {
          if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
            log(`Found JPEG start at position ${i}`);
            let j = i + 2;
            while (j < buffer.length - 1) {
              if (buffer[j] === 0xFF && buffer[j + 1] === 0xD9) {
                const jpegData = buffer.slice(i, j + 2);
                const blob = new Blob([jpegData], { type: 'image/jpeg' });
                const url = URL.createObjectURL(blob);

                if (imgRef.current?.src?.startsWith('blob:')) {
                  URL.revokeObjectURL(imgRef.current.src);
                }

                if (imgRef.current) {
                  imgRef.current.src = url;
                }

                frameCount++;
                if (frameCount === 1) {
                  log(`FIRST FRAME DISPLAYED! (${jpegData.length} bytes)`);
                  setStatus('live');
                } else if (frameCount % 5 === 0) {
                  log(`Frame ${frameCount} displayed`);
                }

                buffer = buffer.slice(j + 2);
                i = 0;
                break;
              }
              j++;
            }
            if (j >= buffer.length - 1) break;
          } else {
            i++;
          }
        }
      }
    } catch (err) {
      log(`Error: ${err.message}`, 'error');
      setStatus('error');
    }
  };

  const stopStream = () => {
    log('Stopping stream...');
    abortRef.current?.abort();
    if (imgRef.current?.src?.startsWith('blob:')) {
      URL.revokeObjectURL(imgRef.current.src);
    }
    imgRef.current.src = '';
    setStatus('idle');
  };

  return (
    <div style={{ padding: 20, background: '#0f172a', color: '#fff', minHeight: '100vh' }}>
      <h1>Stream Debug Test</h1>

      <div style={{ marginBottom: 20 }}>
        <label>Select Camera: </label>
        <select value={selectedCam?.id || ''} onChange={e => setSelectedCam(cameras.find(c => c.id == e.target.value))}>
          <option value="">-- Select --</option>
          {cameras.map(c => <option key={c.id} value={c.id}>{c.name} ({c.rtsp_url ? '✓' : '✗'})</option>)}
        </select>
      </div>

      {selectedCam && (
        <div style={{ marginBottom: 20, padding: 10, background: '#1e293b', borderRadius: 8 }}>
          <p><strong>Selected:</strong> {selectedCam.name}</p>
          <p><strong>RTSP URL:</strong> {selectedCam.rtsp_url || '❌ NOT SET'}</p>
          <p><strong>Status:</strong> {status}</p>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <button onClick={startStream} disabled={!selectedCam?.rtsp_url || status === 'live'} style={{ padding: 10, marginRight: 10, cursor: 'pointer' }}>
          Start Stream
        </button>
        <button onClick={stopStream} disabled={status !== 'live' && status !== 'fetching' && status !== 'connecting'} style={{ padding: 10, cursor: 'pointer' }}>
          Stop Stream
        </button>
      </div>

      <div style={{ marginBottom: 20, display: 'flex', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <h3>Stream Display</h3>
          <img
            ref={imgRef}
            style={{
              width: '100%',
              maxHeight: 400,
              background: '#000',
              border: '2px solid #333',
              borderRadius: 8,
            }}
            alt="stream"
          />
        </div>

        <div style={{ flex: 1, maxWidth: 500 }}>
          <h3>Debug Logs</h3>
          <div style={{
            background: '#1e293b',
            padding: 10,
            borderRadius: 8,
            maxHeight: 400,
            overflow: 'auto',
            fontSize: 11,
            fontFamily: 'monospace',
          }}>
            {logs.map((log, i) => (
              <div key={i} style={{ marginBottom: 4, color: log.includes('Error') ? '#ff6b6b' : '#00ff00' }}>
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
