import { io } from 'socket.io-client';
import cfg from '../config.js';

// Socket.IO event name constants
export const FACE_DETECTED     = 'face_detected';
export const ATTENDANCE_MARKED = 'attendance_marked';
export const FACE_PRESENT      = 'face_present';
export const CAMERA_STATUS     = 'camera_status';
export const CAMERAS_UPDATED   = 'cameras_updated';

// Singleton socket — all settings from central config
export const socket = io(cfg.SOCKET.url, {
  path:                 cfg.SOCKET.path,
  transports:           cfg.SOCKET.transports,
  reconnectionAttempts: cfg.SOCKET.reconnectionAttempts,
  reconnectionDelay:    cfg.SOCKET.reconnectionDelay,
  reconnectionDelayMax: cfg.SOCKET.reconnectionDelayMax,
  timeout:              cfg.SOCKET.timeout,
  autoConnect: true,
});

socket.on('connect', () => {
  socket.emit('join_web');
  console.log('[Socket] Connected, joined web_clients room');
});

socket.on('disconnect', (reason) => {
  console.warn('[Socket] Disconnected:', reason);
});

export default socket;
