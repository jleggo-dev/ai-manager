#!/usr/bin/env node
/**
 * CLI: Sync ai-admin.config.json to AI Admin via POST /api/sync
 *
 * Usage (from repo root):
 *   node backend/scripts/ai-admin-sync.mjs config/ai-admin/ai-admin.config.json [--dry-run] [--fail-on-drift]
 *
 * Env: AI_ADMIN_BASE_URL, AI_ADMIN_API_KEY (or VITE_DEV_API_KEY / TEST_API_KEY).
 * Loads backend/.env when present. Production Vercel hosts need `/_/backend` on the base URL
 * (auto-appended when missing, same as sync-jobs.ts).
 *
 * --fail-on-drift implies --dry-run and exits 2 when any entity would create or update.
 */
import { readFileSync, existsSync } from 'node:fs';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = path.join(root, 'backend/.env');
if (existsSync(envPath)) config({ path: envPath });
else config();

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const configPath = args[0] || path.join(root, 'config/ai-admin/ai-admin.config.json');
const failOnDrift = process.argv.includes('--fail-on-drift');
const dryRun = process.argv.includes('--dry-run') || failOnDrift;

const rawBase = process.env.AI_ADMIN_BASE_URL || 'http://localhost:3001';
const baseUrl =
  rawBase.includes('/_/backend') || rawBase.includes('localhost') || rawBase.includes('127.0.0.1')
    ? rawBase.replace(/\/+$/, '')
    : rawBase.replace(/\/+$/, '') + '/_/backend';
const apiKey = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || process.env.TEST_API_KEY;

if (!apiKey) {
  console.error('Set AI_ADMIN_API_KEY or VITE_DEV_API_KEY');
  process.exit(1);
}

let syncConfig;
try {
  syncConfig = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error(`Failed to read ${configPath}:`, err.message);
  process.exit(1);
}

const url = `${baseUrl}/api/sync`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...syncConfig, dryRun }),
  });
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
  if (body.errors > 0) process.exit(1);
  if (failOnDrift) {
    const drifted = (Array.isArray(body.diff) ? body.diff : []).filter(
      (d) => d.action === 'create' || d.action === 'update',
    );
    if (drifted.length > 0) {
      console.error(`DRIFT: ${drifted.length} entit(y/ies) differ from live`);
      process.exit(2);
    }
    console.log('No config drift detected (all skip).');
  }
  process.exit(0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
