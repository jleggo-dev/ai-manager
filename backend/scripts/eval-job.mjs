#!/usr/bin/env node
/**
 * CLI: Run job eval against AI Admin API (for CI).
 * Usage: node scripts/eval-job.mjs <jobId> [--base-url URL]
 */
import { config } from 'dotenv';

config();

const jobId = process.argv[2];
const baseUrl = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : process.env.AI_ADMIN_BASE_URL || 'http://localhost:3001';

const apiKey = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || process.env.TEST_API_KEY;

if (!jobId) {
  console.error('Usage: node scripts/eval-job.mjs <jobId>');
  process.exit(1);
}
if (!apiKey) {
  console.error('Set AI_ADMIN_API_KEY or VITE_DEV_API_KEY');
  process.exit(1);
}

const url = `${baseUrl.replace(/\/+$/, '')}/api/processing-jobs/${jobId}/eval`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ callingApplication: 'ci-eval' }),
  });
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
  process.exit(body.failed > 0 ? 1 : 0);
} catch (err) {
  console.error(err);
  process.exit(1);
}
