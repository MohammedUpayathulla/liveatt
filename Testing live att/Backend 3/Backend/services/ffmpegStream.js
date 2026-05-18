'use strict';

const { spawn } = require('child_process');
const path = require('path');

const activeStreams = new Map();

/**
 * Start FFmpeg stream from RTSP URL
 * Returns streamId to fetch stream from
 */
function startStream(rtspUrl, streamId) {
  if (activeStreams.has(streamId)) {
    console.log(`[FFmpeg] Stream ${streamId} already running`);
    return streamId;
  }

  console.log(`[FFmpeg] Starting stream ${streamId} from ${rtspUrl}`);

  try {
    const ffmpegPath = process.platform === 'win32' ? 'C:\\ffmpeg\\bin\\ffmpeg.exe' : 'ffmpeg';
    const ffmpeg = spawn(ffmpegPath, [
      '-rtsp_transport', 'tcp',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-i', rtspUrl,
      '-vf', 'scale=640:480',
      '-f', 'mjpeg',
      '-q:v', '15',
      '-r', '10',
      'pipe:1',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = Buffer.alloc(0);
    let frameCount = 0;

    ffmpeg.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      frameCount++;
    });

    ffmpeg.stderr.on('data', (data) => {
      console.log(`[FFmpeg ${streamId}] ${data.toString().trim()}`);
    });

    ffmpeg.on('error', (err) => {
      console.error(`[FFmpeg ${streamId}] Error:`, err.message);
      activeStreams.delete(streamId);
    });

    ffmpeg.on('exit', (code) => {
      console.log(`[FFmpeg ${streamId}] Exited with code ${code}`);
      activeStreams.delete(streamId);
    });

    activeStreams.set(streamId, {
      process: ffmpeg,
      rtspUrl,
      buffer,
      frameCount,
      createdAt: Date.now(),
      lastFrameAt: Date.now(),
    });

    return streamId;
  } catch (err) {
    console.error(`[FFmpeg] Failed to start stream ${streamId}:`, err.message);
    throw err;
  }
}

/**
 * Get stream data buffer
 */
function getStreamBuffer(streamId) {
  const stream = activeStreams.get(streamId);
  if (!stream) return null;

  stream.lastFrameAt = Date.now();
  return stream.process.stdout;
}

/**
 * Stop stream
 */
function stopStream(streamId) {
  const stream = activeStreams.get(streamId);
  if (!stream) {
    console.log(`[FFmpeg] Stream ${streamId} not found`);
    return false;
  }

  console.log(`[FFmpeg] Stopping stream ${streamId}`);
  stream.process.kill('SIGTERM');
  activeStreams.delete(streamId);
  return true;
}

/**
 * Get active streams
 */
function getActiveStreams() {
  return Array.from(activeStreams.entries()).map(([id, data]) => ({
    streamId: id,
    rtspUrl: data.rtspUrl,
    duration: Date.now() - data.createdAt,
    frameCount: data.frameCount,
  }));
}

/**
 * Stop all streams (cleanup)
 */
function stopAllStreams() {
  console.log(`[FFmpeg] Stopping all ${activeStreams.size} streams`);
  activeStreams.forEach((stream, streamId) => {
    stream.process.kill('SIGTERM');
  });
  activeStreams.clear();
}

module.exports = {
  startStream,
  getStreamBuffer,
  stopStream,
  getActiveStreams,
  stopAllStreams,
};
