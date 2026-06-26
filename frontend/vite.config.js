import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Reuse the same Supabase project as the API: read backend/.env and map to VITE_* so
 * `import.meta.env.VITE_SUPABASE_*` works without duplicating keys in frontend/.env.
 * Explicit frontend/.env values still win (set after this block).
 */
/**
 * CI / Vercel: `backend/.env` is not in the repo; same AI_MANAGER_* vars as the API are
 * injected at build time — map them so `import.meta.env.VITE_SUPABASE_*` is defined.
 */
function syncAiManagerSupabaseFromProcessEnv() {
  if (!process.env.VITE_SUPABASE_URL && process.env.AI_MANAGER_SUPABASE_URL) {
    process.env.VITE_SUPABASE_URL = process.env.AI_MANAGER_SUPABASE_URL;
  }
  if (!process.env.VITE_SUPABASE_ANON_KEY && process.env.AI_MANAGER_SUPABASE_ANON_KEY) {
    process.env.VITE_SUPABASE_ANON_KEY = process.env.AI_MANAGER_SUPABASE_ANON_KEY;
  }
}

function applyBackendSupabaseToViteEnv() {
  const backendEnvPath = resolve(__dirname, '../backend/.env');
  if (!existsSync(backendEnvPath)) return;
  const raw = readFileSync(backendEnvPath, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key === 'AI_MANAGER_SUPABASE_URL' && !process.env.VITE_SUPABASE_URL) {
      process.env.VITE_SUPABASE_URL = val;
    }
    if (key === 'AI_MANAGER_SUPABASE_ANON_KEY' && !process.env.VITE_SUPABASE_ANON_KEY) {
      process.env.VITE_SUPABASE_ANON_KEY = val;
    }
    if (key === 'VITE_DEV_API_KEY' && val && !process.env.VITE_DEV_API_KEY) {
      if (process.env.NODE_ENV === 'production' || process.env.CI) {
        throw new Error(
          '[vite] FATAL: VITE_DEV_API_KEY is set during a production build. '
          + 'This would embed a secret in the client bundle. '
          + 'Remove it from backend/.env or unset it in CI before building.',
        );
      }
      process.env.VITE_DEV_API_KEY = val;
    }
  }
}

applyBackendSupabaseToViteEnv();
syncAiManagerSupabaseFromProcessEnv();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});
