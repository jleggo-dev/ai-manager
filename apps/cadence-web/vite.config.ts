import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The commit this bundle was built from, for the build line at the foot of Settings
 * (lib/build.ts). Vercel names it; a local build asks git; anything else says so rather than
 * failing the build over a label.
 */
function buildStamp(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || gitShortSha();
  const day = new Date().toISOString().slice(0, 10);
  return `${sha ?? 'unknown'} · ${day}`;
}

function gitShortSha(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __CADENCE_BUILD__: JSON.stringify(buildStamp()) },
  server: {
    port: 3100,
    proxy: {
      '/api': { target: 'http://localhost:3101', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
