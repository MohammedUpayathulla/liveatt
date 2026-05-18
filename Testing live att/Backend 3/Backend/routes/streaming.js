'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const ffmpegStream = require('../services/ffmpegStream');

/**
 * POST /api/streaming/start
 * Start streaming from RTSP URL
 * Body: { rtspUrl }
 * Response: { streamId }
 */
router.post('/start', async (req, res) => {
  try {
    const { rtspUrl } = req.body;

    if (!rtspUrl || !rtspUrl.startsWith('rtsp://')) {
      return res.status(400).json({ error: 'Invalid RTSP URL' });
    }

    const streamId = `stream-${uuidv4()}`;
    console.log(`[Stream API] Starting stream ${streamId} from ${rtspUrl}`);

    ffmpegStream.startStream(rtspUrl, streamId);

    res.json({
      streamId,
      rtspUrl,
      status: 'starting',
      fetchUrl: `/api/streaming/stream/${streamId}`,
    });
  } catch (err) {
    console.error('[Stream API] Start error:', err.message);
    res.status(500).json({ error: 'Failed to start stream', details: err.message });
  }
});

/**
 * GET /api/streaming/stream/:streamId
 * Fetch MJPEG stream
 * Response: multipart/x-mixed-replace stream
 */
router.get('/stream/:streamId', async (req, res) => {
  try {
    const { streamId } = req.params;

    const stdout = ffmpegStream.getStreamBuffer(streamId);
    if (!stdout) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    console.log(`[Stream API] Client connected to ${streamId}`);

    // Set multipart headers with correct MJPEG boundary
    const BOUNDARY = '--myboundary';
    res.setHeader('Content-Type', `multipart/x-mixed-replace; boundary=${BOUNDARY}`);
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let buffer = Buffer.alloc(0);

    stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Look for JPEG markers: 0xFFD8 (start) and 0xFFD9 (end)
      let i = 0;
      while (i < buffer.length - 1) {
        // Find JPEG start marker (0xFFD8)
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
          // Found JPEG start, now find end marker (0xFFD9)
          let j = i + 2;
          while (j < buffer.length - 1) {
            if (buffer[j] === 0xFF && buffer[j + 1] === 0xD9) {
              // Found complete JPEG frame
              const jpegData = buffer.slice(i, j + 2);

              // Send as multipart MJPEG frame
              const frameHeader = `${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegData.length}\r\n\r\n`;
              res.write(frameHeader);
              res.write(jpegData);
              res.write('\r\n');

              // Remove processed data from buffer
              buffer = buffer.slice(j + 2);
              i = 0; // Reset search position
              break;
            }
            j++;
          }

          if (j >= buffer.length - 1) break; // Incomplete frame, wait for more data
        } else {
          i++;
        }
      }

      // Keep buffer size reasonable (max 10MB)
      if (buffer.length > 10 * 1024 * 1024) {
        console.log(`[Stream API] Buffer overflow, trimming to 5MB`);
        buffer = buffer.slice(-5 * 1024 * 1024);
      }
    });

    stdout.on('end', () => {
      console.log(`[Stream API] Stream ${streamId} ended`);
      res.end();
    });

    stdout.on('error', (err) => {
      console.error(`[Stream API] Stream ${streamId} error:`, err.message);
      res.status(500).json({ error: 'Stream error' });
    });

    req.on('close', () => {
      console.log(`[Stream API] Client disconnected from ${streamId}`);
    });
  } catch (err) {
    console.error('[Stream API] Fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stream', details: err.message });
  }
});

/**
 * POST /api/streaming/stop/:streamId
 * Stop a stream
 */
router.post('/stop/:streamId', async (req, res) => {
  try {
    const { streamId } = req.params;
    const stopped = ffmpegStream.stopStream(streamId);

    if (!stopped) {
      return res.status(404).json({ error: 'Stream not found' });
    }

    res.json({ streamId, status: 'stopped' });
  } catch (err) {
    console.error('[Stream API] Stop error:', err.message);
    res.status(500).json({ error: 'Failed to stop stream' });
  }
});

/**
 * GET /api/streaming/list
 * List active streams
 */
router.get('/list', (req, res) => {
  try {
    const streams = ffmpegStream.getActiveStreams();
    res.json({ streams, count: streams.length });
  } catch (err) {
    console.error('[Stream API] List error:', err.message);
    res.status(500).json({ error: 'Failed to list streams' });
  }
});

module.exports = router;
