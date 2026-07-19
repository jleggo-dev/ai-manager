import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3100,
    // Proxy API calls to cadence-api in dev so the browser never holds secrets.
    proxy: {
      '/api': { target: 'http://localhost:3101', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
