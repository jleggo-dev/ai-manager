#!/usr/bin/env node
/**
 * CLI: Sync ai-admin.config.json to AI Admin via POST /api/sync
 * Usage: node scripts/ai-admin-sync.mjs [configPath] [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';

config();

const configPath = process.argv[2] || 'ai-admin.config.json';
const dryRun = process.argv.includes('--dry-run');
const baseUrl = process.env.AI_ADMIN_BASE_URL || 'http://localhost:3001';
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

const url = `${baseUrl.replace(/\/+$/, '')}/api/sync`;

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
  process.exit(body.errors > 0 ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
