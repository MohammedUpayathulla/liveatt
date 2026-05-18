import React, { useState, useRef, useEffect, memo } from 'react';

const CameraStream = memo(function CameraStream({
  cameraId,
  cameraName = 'Camera',
  location = '',
  isActive = true,
  detectedPerson = null,
  flashDetection = false,
}) {
  const [offline, setOffline] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(true);

  const flashTimer = useRef(null);
  const imgRef = useRef(null);

  // Flash effect
  useEffect(() => {
    if (flashDetection) {
      setShowFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setShowFlash(false), 1200);
    }
    return () => clearTimeout(flashTimer.current);
  }, [flashDetection]);

  // MJPEG stream setup - works in all browsers
  useEffect(() => {
    if (!isActive || !imgRef.current) return;

    const mjpegUrl = `/api/cameras/${cameraId}/stream`;

    const img = imgRef.current;
    img.src = mjpegUrl;

    const handleLoad = () => {
      setOffline(false);
      setVideoPlaying(true);
      console.log(`[MJPEG] cam${cameraId} loaded`);
    };

    const handleError = () => {
      setOffline(true);
      setVideoPlaying(false);
      console.error(`[MJPEG] cam${cameraId} failed to load from ${mjpegUrl}`);
    };

    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);

    return () => {
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };
  }, [cameraId, isActive]);

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-slate-950 border-2 transition-all duration-300 ${
        showFlash
          ? 'border-green-500 shadow-[0_0_16px_rgba(34,197,94,0.5)]'
          : 'border-slate-700'
      }`}
      style={{ aspectRatio: '16/9' }}
    >
      {/* MJPEG Stream */}
      {isActive && !offline && (
        <img
          ref={imgRef}
          className="w-full h-full object-contain"
          alt={cameraName}
          style={{ willChange: 'transform' }}
        />
      )}

      {/* Offline overlay */}
      {(offline || !isActive) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 gap-3">
          <svg
            className="w-12 h-12 text-slate-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
          <p className="text-slate-500 text-sm font-medium">
            {!isActive ? 'Camera Inactive' : 'Stream Offline'}
          </p>
          {offline && isActive && (
            <button
              onClick={() => setOffline(false)}
              className="mt-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg font-medium transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Top-left badges */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5">
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            videoPlaying && !offline ? 'bg-green-500 animate-pulse' : 'bg-red-500'
          }`}
        />
        <span className="text-white text-xs font-semibold bg-black/50 px-2 py-0.5 rounded-md backdrop-blur-sm">
          {cameraName}
        </span>
        {isActive && !offline && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium bg-green-900/70 text-green-300">
            MJPEG
          </span>
        )}
      </div>

      {/* Detected person overlay */}
      {detectedPerson && !offline && isActive && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 py-3">
          <div className="flex items-center gap-3">
            {detectedPerson.image_path ? (
              <img
                src={`/${detectedPerson.image_path}`}
                alt={detectedPerson.name}
                className="w-12 h-12 rounded-full object-cover border-2 border-green-500 flex-shrink-0"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center flex-shrink-0 text-green-400 font-bold text-lg uppercase">
                {(detectedPerson.name || 'U').charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-white text-sm font-bold truncate leading-tight">
                {detectedPerson.name || 'Unknown'}
              </p>
              <p className="text-slate-300 text-xs truncate">
                {detectedPerson.employee_code || ''}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-green-400 text-xs font-medium">
                  {detectedPerson.confidence
                    ? `${Math.round(detectedPerson.confidence * 100)}% match`
                    : 'Detected'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flash overlay */}
      {showFlash && (
        <div className="absolute inset-0 border-4 border-green-500 rounded-xl pointer-events-none animate-pulse opacity-60" />
      )}
    </div>
  );
});

export default CameraStream;
