import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Собирается в static/app; FastAPI отдаёт эту сборку по «/».
export default defineConfig({
  plugins: [react()],
  base: '/app/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../static/app', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8010',
      '/ws': { target: 'ws://127.0.0.1:8010', ws: true },
      '/Katya-Browser-Bridge.zip': 'http://127.0.0.1:8010',
    },
  },
});
