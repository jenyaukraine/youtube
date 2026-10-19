import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Собирается в static/app, FastAPI отдаёт по /app/ (и по / после переключения).
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  build: { outDir: '../static/app', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8010',
      '/ws': { target: 'ws://127.0.0.1:8010', ws: true },
      '/katya.css': 'http://127.0.0.1:8010',
      '/katya-fx.js': 'http://127.0.0.1:8010',
    },
  },
});
