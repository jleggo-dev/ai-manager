/**
 * Routes – Health Check Profiles
 */

import { Router, Request, Response } from 'express';
import { validateBody } from '../../middleware/validate.ts';
import {
  createHcProfile,
  updateHcProfile,
  listHcProfiles,
  deleteHcProfile,
  createHealthCheck,
  updateHealthCheck,
  listHealthChecks,
} from '../../models/health-checks.ts';
import { createProfileSchema, updateProfileSchema, logHealthCheckError } from './shared.ts';

const router = Router();

router.get('/profiles', async (_req: Request, res: Response) => {
  try {
    const profiles = await listHcProfiles();
    res.json({ data: profiles });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profiles', validateBody(createProfileSchema), async (req: Request, res: Response) => {
  try {
    const row = await createHcProfile(req.body);

    try {
      await createHealthCheck({
        health_check_profile_id: row.id,
        name: row.name,
        test_message: 'Hello, please confirm you are operational.',
        cadence_minutes: 5,
        outage_cadence_minutes: 2,
        is_active: true,
      } as Record<string, unknown>);
    } catch (checkErr: unknown) {
      console.warn('[POST /profiles] Profile created but auto-check failed:', checkErr);
    }

    res.status(201).json(row);
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/profiles/:id', validateBody(updateProfileSchema), async (req: Request, res: Response) => {
  try {
    const row = await updateHcProfile(req.params.id as string, req.body);

    const syncFields: Record<string, unknown> = {};
    if (req.body.name) syncFields.name = req.body.name;
    if (req.body.is_active !== undefined) syncFields.is_active = req.body.is_active;

    if (Object.keys(syncFields).length > 0) {
      const checks = await listHealthChecks();
      const linked = checks.find((c) => c.health_check_profile_id === req.params.id);
      if (linked) {
        await updateHealthCheck(linked.id, syncFields).catch((err: unknown) => {
          console.warn('[PUT /profiles/:id] Syncing linked check failed:', err);
        });
      }
    }

    res.json(row);
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/profiles/:id', async (req: Request, res: Response) => {
  try {
    await deleteHcProfile(req.params.id as string);
    res.json({ success: true });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profiles/backfill-checks', async (_req: Request, res: Response) => {
  try {
    const profiles = await listHcProfiles();
    const checks = await listHealthChecks();
    const profilesWithChecks = new Set(checks.map((c) => c.health_check_profile_id));
    let created = 0;

    for (const profile of profiles) {
      if (profilesWithChecks.has(profile.id)) continue;
      await createHealthCheck({
        health_check_profile_id: profile.id,
        name: profile.name,
        test_message: 'Hello, please confirm you are operational.',
        cadence_minutes: 5,
        outage_cadence_minutes: 2,
        is_active: profile.is_active,
      } as Record<string, unknown>);
      created++;
    }

    res.json({ success: true, created, total_profiles: profiles.length });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
