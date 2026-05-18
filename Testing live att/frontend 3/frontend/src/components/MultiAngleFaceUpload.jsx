import React, { useState, useRef } from 'react';

/**
 * Multi-angle face upload component supporting 5 angles:
 * Straight, Up, Down, Left, Right
 */
export default function MultiAngleFaceUpload({
  capturedFiles,
  previewUrls,
  faceChecking,
  faceError,
  touched,
  errs,
  onFileChange,
  onDrop,
  onRemove,
  streamActive,
  videoRef,
  onCapture,
}) {
  const [photoMode, setPhotoMode] = useState('upload');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRefs = {
    straight: useRef(null),
    up: useRef(null),
    down: useRef(null),
    left: useRef(null),
    right: useRef(null),
  };

  const angles = [
    { key: 'straight', label: 'Straight', icon: '→' },
    { key: 'up', label: 'Up', icon: '↑' },
    { key: 'down', label: 'Down', icon: '↓' },
    { key: 'left', label: 'Left', icon: '←' },
    { key: 'right', label: 'Right', icon: '→' },
  ];

  const completedCount = angles.filter((a) => capturedFiles[a.key]).length;

  return (
    <div>
      <label className="text-slate-300 text-sm font-medium mb-3 block">
        Face Images (5 Angles) <span className="text-red-400">*</span>
      </label>
      <p className="text-slate-500 text-xs mb-4">
        Capture faces from {5 - completedCount} more angle{5 - completedCount !== 1 ? 's' : ''} for better recognition • {completedCount}/5 complete
      </p>

      {/* Progress bar */}
      <div className="w-full h-2 bg-slate-700 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${(completedCount / 5) * 100}%` }}
        />
      </div>

      {/* 5 Angle slots */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        {angles.map(({ key, label, icon }) => (
          <div key={key} className="flex flex-col items-center gap-2">
            <div className="text-2xl opacity-60">{icon}</div>
            <label
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDrop(e, key);
              }}
              className={`w-full aspect-square rounded-lg border-2 border-dashed cursor-pointer flex items-center justify-center transition-colors overflow-hidden relative group ${
                previewUrls[key]
                  ? `border-slate-600 ${capturedFiles[key] ? 'border-green-500' : faceError[key] ? 'border-red-500' : 'border-blue-500'}`
                  : dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-slate-600 hover:border-slate-500 bg-slate-900/50'
              }`}
            >
              {previewUrls[key] ? (
                <>
                  <img
                    src={previewUrls[key]}
                    alt={label}
                    className={`w-full h-full object-cover ${faceError[key] ? 'opacity-40' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      onRemove(key);
                    }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >×</button>
                  {faceChecking[key] && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-1 text-center p-2">
                  <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="text-xs text-slate-400 font-medium">{label}</span>
                </div>
              )}
              <input
                ref={fileInputRefs[key]}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFileChange(e, key)}
              />
            </label>
            {faceChecking[key] && <span className="text-xs text-blue-400">Checking...</span>}
            {faceError[key] && <span className="text-xs text-red-400">✗ No face</span>}
            {capturedFiles[key] && !faceError[key] && <span className="text-xs text-green-400">✓</span>}
          </div>
        ))}
      </div>

      {/* Mode toggle */}
      <button
        type="button"
        onClick={() => setPhotoMode(photoMode === 'upload' ? 'webcam' : 'upload')}
        className="w-full px-3 py-2 mb-3 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
            d={photoMode === 'upload'
              ? "M15 10l4.553-2.277A1 1 0 0121 8.68v6.64a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
              : "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
            }
          />
        </svg>
        {photoMode === 'upload' ? 'Switch to Webcam' : 'Switch to Upload'}
      </button>

      {/* Webcam section */}
      {photoMode === 'webcam' && (
        <div className="border border-slate-700 rounded-lg p-3 bg-slate-900/50 space-y-3">
          <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-700" style={{ aspectRatio: '4/3' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              disablePictureInPicture
              className="w-full h-full object-cover"
              style={{ willChange: 'transform', transform: 'translateZ(0)' }}
            />
          </div>
          {streamActive && (
            <div className="grid grid-cols-5 gap-2">
              {angles.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => onCapture(key)}
                  disabled={!!capturedFiles[key]}
                  className={`py-2 text-xs font-medium rounded-lg transition-colors ${
                    capturedFiles[key]
                      ? 'bg-green-600/30 text-green-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  {capturedFiles[key] ? '✓' : ''} {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {touched.photo && errs.photo && (
        <p className="mt-2 text-red-400 text-xs">{errs.photo}</p>
      )}
    </div>
  );
}
