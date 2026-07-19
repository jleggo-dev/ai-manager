import app from './app.ts';
import { getConfig } from './config.ts';
import { authStorage } from './db/tenant.ts';
import { getDefaultWorkspaceId } from './db/workspace-default.ts';
import { healthCheck } from './models/index.ts';
import { seedLlmModels } from './services/llm-models-seed.ts';
import { seedSettings } from './services/settings-seed.ts';
import { errorMessage } from './lib/error-message.ts';
import { startHealthCheckScheduler, stopHealthCheckScheduler } from './services/health-check-scheduler.ts';
import type { RequestAuthContext } from './types.ts';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function bootstrap() {
  console.log('\n  ── AI Manager Supabase ──');
  const tables = await healthCheck();
  for (const [t, ok] of Object.entries(tables)) {
    console.log(`    ${ok ? '✓' : '✗'} "${t}" ${ok ? 'reachable' : 'UNREACHABLE'}`);
  }

  let defaultWorkspaceId: string | null = null;
  try {
    defaultWorkspaceId = await getDefaultWorkspaceId();
  } catch (err) {
    console.warn(`[Seeds] Could not determine default workspace: ${errorMessage(err)}`);
  }

  if (defaultWorkspaceId) {
    console.log('\n  ── Bootstrap ──');
    const seedCtx: RequestAuthContext = {
      mode: 'api_key',
      workspaceId: defaultWorkspaceId,
      apiKeyId: SYSTEM_USER_ID,
      userId: SYSTEM_USER_ID,
    };
    await authStorage.run(seedCtx, async () => {
      try {
        await seedLlmModels();
      } catch (err) {
        console.warn(`  [LLM Models] ${errorMessage(err)}`);
      }
      try {
        await seedSettings();
      } catch (err) {
        console.warn(`  [Settings] ${errorMessage(err)}`);
      }
    });
  } else {
    console.warn('\n  ── Bootstrap SKIPPED (no default workspace) ──');
  }
}

let ready = false;

export function isReady(): boolean {
  return ready;
}

async function main() {
  try {
    await bootstrap();
    ready = true;
  } catch (err) {
    console.error('[bootstrap] Fatal error:', errorMessage(err));
    process.exit(1);
  }

  const { port } = getConfig();
  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const server = app.listen(port, () => {
    console.log(`\n  AI Admin API on http://localhost:${port}\n`);
    if (isServerless) {
      console.log('  [scheduler] Serverless detected — using Vercel Cron (/api/cron/tick) instead of setInterval');
    } else {
      startHealthCheckScheduler();
    }
  });

  function shutdown(signal: string) {
    console.log(`\n  ${signal} received, shutting down gracefully...`);
    ready = false;
    stopHealthCheckScheduler();
    server.close(() => {
      console.log('  Server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('  Forceful shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
