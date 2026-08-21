/**
 * Cron Route – scheduled ticks
 * ----------------------------
 * Health checks, and the provider model refresh.
 *
 * Protected by CRON_SECRET as a Bearer token. Vercel Cron attaches it automatically; anything
 * else — including Supabase `pg_cron` calling in over `pg_net`, which is how the model tick is
 * scheduled — must send it explicitly. Every other caller gets a 401.
 */

import { Router, Request, Response } from 'express';
import { listDueChecks } from '../models/health-checks.ts';
import { runAndRecordCheck } from '../services/health-checker.ts';
import { decryptProviderRow } from '../models/providers.ts';
import { syncProviderModels } from '../services/model-sync.ts';
import { runWithAuth } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import type { ProviderRow } from '../types.ts';

const router = Router();

/** How many vanished model ids the response lists before truncating. Enough to act on, not a dump. */
const MISSING_REPORT_CAP = 50;

function verifyCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers['authorization'];
  return auth === `Bearer ${secret}`;
}

router.get('/tick/health', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = { healthChecks: 0, errors: 0 };

  try {
    const dueChecks = await listDueChecks();
    results.healthChecks = dueChecks.length;

    if (dueChecks.length > 0) {
      const settled = await Promise.allSettled(dueChecks.map((check) => runAndRecordCheck(check)));
      results.errors = settled.filter((r) => r.status === 'rejected').length;
    }
  } catch (err: unknown) {
    console.error('[cron] health-check tick error:', err);
    results.errors++;
  }

  console.log(`[cron] health tick: ${results.healthChecks} checks, ${results.errors} errors`);
  res.json({ ok: true, ...results });
});

/**
 * `GET /api/cron/tick/models` — refresh every provider's model catalog.
 *
 * Model discovery existed only as an admin button, and nobody pressed it: measured 2026-08-20, the
 * cached catalog held 66 models while Devs.ai served 467, so every model added since the last
 * manual press was invisible to anyone choosing one. A stale list is worse than no list — it looks
 * authoritative while quietly omitting the option you wanted.
 *
 * Additive: `syncProviderModels` upserts and never deletes, because Devs.ai silently removes ids
 * and pruning could yank a model a live profile points at. Anything that vanished comes back in
 * `missing` for a human to judge, and is logged here rather than acted on.
 *
 * One provider failing must not stop the rest — each is settled independently.
 */
router.get('/tick/models', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const summary: Array<Record<string, unknown>> = [];
  let errors = 0;
  try {
    /**
     * A cron carries no request identity, so providers are read with the service client — the
     * same posture `listDueChecks` already takes for the health tick. The UPSERTS, though, go
     * through `tenantFrom`, so each provider's own `workspace_id` becomes the context it syncs
     * under: cross-workspace scoping stays intact even though nobody is signed in.
     */
    const { data, error } = await getServiceSupabase().from('providers').select('*');
    if (error) throw new Error(`provider list: ${error.message}`);
    const providers = (data ?? []).map((p) => decryptProviderRow(p as ProviderRow));
    const withKeys = providers.filter((p): p is ProviderRow => !!p?.api_key);

    const settled = await Promise.allSettled(
      withKeys.map((p) =>
        runWithAuth({ mode: 'api_key', workspaceId: p.workspace_id as string, apiKeyId: 'cron:models' }, () =>
          syncProviderModels(p),
        ),
      ),
    );
    for (const [i, r] of settled.entries()) {
      const name = withKeys[i]?.name ?? 'unknown';
      if (r.status === 'fulfilled') {
        summary.push({
          provider: name,
          synced: r.value.synced,
          discovered: r.value.discovered,
          /**
           * The IDS, not a count. `missing` exists so a HUMAN can judge whether anything still
           * points at a model that vanished — and "43" cannot be judged. Reported as a bare number
           * on 2026-08-21 and the owner's response was, correctly, that it was gibberish: a count
           * with no referent tells you something is wrong and gives you no way to look at it.
           * Capped so a provider that drops half its catalog cannot produce an unbounded response.
           */
          missingCount: r.value.missing.length,
          missing: r.value.missing.slice(0, MISSING_REPORT_CAP),
          ...(r.value.missing.length > MISSING_REPORT_CAP
            ? { missingTruncated: r.value.missing.length - MISSING_REPORT_CAP }
            : {}),
          source: r.value.discoverySource,
        });
        if (r.value.missing.length) {
          console.warn(
            `[cron] models: "${name}" no longer lists ${r.value.missing.length}:`,
            r.value.missing.join(', '),
          );
        }
      } else {
        errors++;
        summary.push({ provider: name, error: String(r.reason).slice(0, 200) });
      }
    }
  } catch (err: unknown) {
    console.error('[cron] model tick error:', err);
    errors++;
  }

  console.log(`[cron] model tick: ${summary.length} providers, ${errors} errors`);
  res.json({ ok: errors === 0, providers: summary, errors });
});

export default router;
