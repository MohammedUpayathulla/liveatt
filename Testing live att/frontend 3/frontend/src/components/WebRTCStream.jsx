'use strict';
import { useEffect, useRef, useState } from 'react';

/**
 * WebRTCStream — plays a mediamtx WHEP stream in a <video> element.
 *
 * Flow: mediamtx RTSP ingest → WHEP endpoint → browser WebRTC peer → <video>
 *
 * Props:
 *   whepUrl  {string}  Full WHEP URL, e.g. http://172.16.1.157:8889/cam_01/whep
 *   style    {object}  Optional style overrides on the <video>
 */
export default function WebRTCStream({ whepUrl, style }) {
  const videoRef   = useRef(null);
  const pcRef      = useRef(null);
  const retryTimer = useRef(null);
  const [status, setStatus]   = useState('connecting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!whepUrl) return;

    let cancelled = false;

    async function connect() {
      // Clean up any previous peer connection
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setStatus('connecting');

      try {
        const pc = new RTCPeerConnection({
          iceServers: [],           // LAN — no STUN/TURN needed
          bundlePolicy: 'max-bundle',
          iceTransportPolicy: 'all',
        });
        pcRef.current = pc;

        // Add receive-only transceivers for video and audio
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        // Wire incoming tracks to the video element
        pc.ontrack = (evt) => {
          if (cancelled) return;
          if (evt.track.kind === 'video' && videoRef.current) {
            if (!videoRef.current.srcObject) {
              videoRef.current.srcObject = new MediaStream();
            }
            videoRef.current.srcObject.addTrack(evt.track);
            videoRef.current.play().catch(() => {});
            setStatus('live');
          }
        };

        // ICE failure → retry
        pc.oniceconnectionstatechange = () => {
          if (cancelled) return;
          const s = pc.iceConnectionState;
          if (s === 'failed' || s === 'disconnected' || s === 'closed') {
            setStatus('error');
            scheduleRetry();
          }
        };

        pc.onconnectionstatechange = () => {
          if (cancelled) return;
          if (pc.connectionState === 'failed') {
            setStatus('error');
            scheduleRetry();
          }
        };

        // Create SDP offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Wait for ICE gathering to complete
        await new Promise((resolve) => {
          if (pc.iceGatheringState === 'complete') { resolve(); return; }
          const check = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', check);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', check);
          // Safety timeout — proceed after 3 s regardless
          setTimeout(resolve, 3000);
        });

        if (cancelled) { pc.close(); return; }

        // Send offer to mediamtx WHEP endpoint directly
        const resp = await fetch(whepUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body:    pc.localDescription.sdp,
        });

        if (!resp.ok) {
          throw new Error(`WHEP ${resp.status} ${resp.statusText}`);
        }

        const answerSdp = await resp.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      } catch (err) {
        if (cancelled) return;
        console.error('[WebRTC]', err.message);
        setStatus('error');
        scheduleRetry();
      }
    }

    function scheduleRetry() {
      if (cancelled) return;
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => {
        if (!cancelled) {
          setAttempt((n) => n + 1);
        }
      }, 4000);
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer.current);
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [whepUrl, attempt]);

  const dotColor = status === 'live' ? '#22c55e' : status === 'error' ? '#ef4444' : '#eab308';

  return (
    <div style={{ width: '100%', height: '100%', background: '#000', position: 'relative' }}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
          ...(style || {}),
        }}
      />

      {/* Status badge */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '3px 8px',
        zIndex: 10,
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 1 }}>
          {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING' : 'RETRYING'}
        </span>
      </div>

      {/* Overlay while not live */}
      {status !== 'live' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.75)', zIndex: 9,
        }}>
          {status === 'error'
            ? <p style={{ color: '#94a3b8', fontSize: 12 }}>⚠ Stream error — retrying…</p>
            : <div style={{ width: 24, height: 24, border: '2px solid #334155', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          }
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
