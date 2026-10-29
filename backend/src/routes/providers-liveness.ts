/**
 * Routes – Provider model liveness
 * ---------------------------------
 * `POST /api/providers/:id/liveness` sends one minimal completion per distinct model the
 * provider's active profiles point at and stores the report; `GET` returns the last report.
 * Mounted from providers.ts. The check runs only when asked — nothing schedules it.
 */

import { Router, Request, Response } from 'express';
import { getProvider } from '../models/providers.ts';
import { listAiProfiles } from '../models/ai-profiles.ts';
import { getSetting, upsertSetting } from '../models/app-settings.ts';
import { createLlmClientForProvider } from '../integrations/client-factory.ts';
import { requireRole } from '../middleware/require-role.ts';
import { livenessSettingKey, runProviderLiveness, type ProviderLivenessReport } from '../services/model-liveness.ts';

const router = Router();

/** Every active profile in the workspace; a provider can be a failover for any of them. */
async function allProfiles() {
  return listAiProfiles(undefined, { limit: 500 });
}

router.post('/:id/liveness', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  let provider;
  try {
    provider = await getProvider(id);
  } catch (_err) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  if (!provider.api_key) {
    return res.status(400).json({ error: 'Provider has no API key configured' });
  }
  try {
    const client = createLlmClientForProvider(provider);
    const profiles = await allProfiles();
    const report = await runProviderLiveness(provider, profiles, client);
    await upsertSetting(livenessSettingKey(id), report, `Last model liveness check for provider ${provider.name}`);
    return res.json(report);
  } catch (err) {
    console.error('[POST /providers/:id/liveness]', err);
    return res.status(500).json({ error: 'Model liveness check failed' });
  }
});

router.get('/:id/liveness', async (req: Request, res: Response) => {
  try {
    const row = await getSetting(livenessSettingKey(req.params.id as string));
    if (!row || !row.value || typeof row.value !== 'object') {
      return res.status(404).json({ error: 'No liveness check has run for this provider' });
    }
    return res.json(row.value as ProviderLivenessReport);
  } catch (err) {
    console.error('[GET /providers/:id/liveness]', err);
    return res.status(500).json({ error: 'Failed to read liveness report' });
  }
});

export default router;
