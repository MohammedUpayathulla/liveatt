import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  // Load .env so we can read VITE_ vars at config time (process.env doesn't have them)
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  const BACKEND_PORT = parseInt(env.VITE_BACKEND_PORT, 10) || 5005;
  const BACKEND_HOST = env.VITE_BACKEND_HOST || 'localhost';
  const DEV_PORT     = parseInt(env.VITE_DEV_PORT,     10) || 3000;

  // Proxy target — always the raw HTTP Node backend (server-to-server, no HTTPS needed).
  // VITE_API_BASE_URL is kept for backward compat; VITE_BACKEND_HOST:PORT is preferred.
  const backendBase = env.VITE_API_BASE_URL
    ? env.VITE_API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')
    : `http://${BACKEND_HOST}:${BACKEND_PORT}`;

  return {
    plugins: [react(), basicSsl()],
    base: '/LiveAttendance/',

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      minify: 'terser',
      terserOptions: {
        compress: { drop_console: true },
      },
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react':  ['react', 'react-dom', 'react-router-dom'],
            'vendor-socket': ['socket.io-client'],
            'vendor-axios':  ['axios'],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },

    server: {
      port: DEV_PORT,
      host: '0.0.0.0',
      https: true,
      middlewareMode: false,
      preTransformRequests: true,
      proxy: {
        // MJPEG streams — more-specific paths matched before generic /api
        '/api/streaming': {
          target: backendBase,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path,
          ws: false,
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              proxyRes.socket && proxyRes.socket.setNoDelay(true);
            });
          },
        },
        '/api/cameras': {
          target: backendBase,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path,
          ws: false,
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              const ct = proxyRes.headers['content-type'] || '';
              if (ct.includes('multipart/x-mixed-replace')) {
                proxyRes.socket && proxyRes.socket.setNoDelay(true);
              }
            });
          },
        },
        '/api': {
          target: backendBase,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path,
          ws: false,
        },
        '/socket.io': {
          target: backendBase,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
        '/uploads': {
          target: backendBase,
          changeOrigin: true,
          secure: false,
        },
      },
    },

    optimizeDeps: {
      include: ['react', 'react-dom', 'react-router-dom', 'socket.io-client', 'axios'],
    },
  };
});
