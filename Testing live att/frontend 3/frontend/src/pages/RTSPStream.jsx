import React, { useState, useRef, useEffect } from 'react';
import api from '../services/api.js';
import cfg from '../config.js';
import { getCameras } from '../services/api.js';

export default function RTSPStream() {
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [streamId, setStreamId] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const imgRef = useRef(null);
  const fetchAbortRef = useRef(null);

  // Load cameras from database
  useEffect(() => {
    loadCameras();
  }, []);

  const loadCameras = async () => {
    try {
      const data = await getCameras();
      const cameraList = Array.isArray(data) ? data : data.cameras || [];
      setCameras(cameraList);

      if (cameraList.length > 0) {
        setSelectedCameraId(cameraList[0].id);
        startStream(cameraList[0]);
      }
    } catch (err) {
      setError('Failed to load cameras: ' + err.message);
      console.error('[RTSP] Load cameras error:', err);
    }
  };

  // Start streaming
  const startStream = async (camera) => {
    if (!camera || !camera.rtsp_url) {
      setError('Camera RTSP URL not configured');
      return;
    }

    try {
      setStatus('connecting');
      setError(null);
      console.log('[RTSP] Starting stream from:', camera.rtsp_url);

      const response = await api.post('/streaming/start', {
        rtspUrl: camera.rtsp_url.trim(),
      });

      const { streamId: newStreamId } = response.data;
      setStreamId(newStreamId);
      setStatus('streaming');

      console.log('[RTSP] Stream started:', newStreamId);

      // Start fetching the stream
      fetchStream(newStreamId);
    } catch (err) {
      setError(err.message || 'Failed to start stream');
      setStatus('error');
      console.error('[RTSP] Start error:', err);
    }
  };

  // Fetch and display MJPEG stream
  const fetchStream = async (streamId) => {
    try {
      fetchAbortRef.current = new AbortController();

      const response = await fetch(`${cfg.API_BASE_URL}/streaming/stream/${streamId}`, {
        signal: fetchAbortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = new Uint8Array(0);

      console.log('[RTSP] Connected to stream:', streamId);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Append new data to buffer
        buffer = new Uint8Array([...buffer, ...value]);

        // Parse JPEG frames from multipart stream
        let frameFound = false;
        for (let i = 0; i < buffer.length - 1; i++) {
          // Look for JPEG start marker (0xFFD8)
          if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
            // Found JPEG start, look for end marker (0xFFD9)
            for (let j = i + 2; j < buffer.length - 1; j++) {
              if (buffer[j] === 0xFF && buffer[j + 1] === 0xD9) {
                // Found complete JPEG frame
                const jpegData = buffer.slice(i, j + 2);
                displayFrame(jpegData);

                // Remove processed data from buffer
                buffer = buffer.slice(j + 2);
                frameFound = true;
                i = -1; // Reset search position
                break;
              }
            }
            if (frameFound) break;
          }
        }

        // Keep buffer size reasonable
        if (buffer.length > 10 * 1024 * 1024) {
          buffer = buffer.slice(-5 * 1024 * 1024);
        }
      }

      console.log('[RTSP] Stream ended');
      setStatus('disconnected');
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[RTSP] Stream error:', err.message);
        setError(err.message || 'Stream error');
        setStatus('error');
      }
    }
  };

  // Display JPEG frame
  const displayFrame = (jpegData) => {
    try {
      const blob = new Blob([jpegData], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);

      if (imgRef.current) {
        // Clean up old URL
        if (imgRef.current.src && imgRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(imgRef.current.src);
        }
        imgRef.current.src = url;
        setStatus('live');
      }
    } catch (err) {
      console.error('[RTSP] Display error:', err);
    }
  };

  // Stop streaming
  const handleStopStream = async () => {
    if (!streamId) return;

    try {
      console.log('[RTSP] Stopping stream:', streamId);
      fetchAbortRef.current?.abort();

      await api.post(`/streaming/stop/${streamId}`);

      setStreamId(null);
      setStatus('idle');
      if (imgRef.current) {
        if (imgRef.current.src && imgRef.current.src.startsWith('blob:')) {
          URL.revokeObjectURL(imgRef.current.src);
        }
        imgRef.current.src = '';
      }
    } catch (err) {
      console.error('[RTSP] Stop error:', err);
    }
  };

  // Switch camera
  const handleSwitchCamera = async (cameraId) => {
    if (streamId) {
      await handleStopStream();
    }

    const camera = cameras.find((c) => c.id === cameraId);
    if (camera) {
      setSelectedCameraId(cameraId);
      startStream(camera);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamId) {
        handleStopStream();
      }
      fetchAbortRef.current?.abort();
    };
  }, []);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      margin: 0,
      padding: 0,
      background: '#000',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {status === 'idle' || !streamId ? (
        <div style={{ textAlign: 'center', color: '#64748b' }}>
          <svg
            style={{ width: '120px', height: '120px', margin: '0 auto 15px', opacity: 0.5 }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
            />
          </svg>
          <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold' }}>Loading stream...</p>
        </div>
      ) : (
        <img
          ref={imgRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#000',
          }}
          alt="RTSP Stream"
        />
      )}
    </div>
  );
}
