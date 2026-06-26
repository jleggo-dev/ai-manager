/**
 * Vercel Serverless Entry Point
 *
 * Exports the Express app as a Vercel serverless function handler.
 * Bootstrap runs once per cold start via the run-once flag.
 */

import app from '../backend/src/app.js';
import { seedLlmModels } from '../backend/src/services/llm-models-seed.js';
import { seedSettings } from '../backend/src/services/settings-seed.js';

let bootstrapped = false;

async function ensureBootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  try { await seedLlmModels(); } catch (_e) { /* non-fatal */ }
  try { await seedSettings(); } catch (_e) { /* non-fatal */ }
}

export default async function handler(req, res) {
  await ensureBootstrap();
  return app(req, res);
}
