/**
 * Routes – Health Checks
 * -----------------------
 * Admin-only endpoints for the Health Checker feature.
 * Mounted from table-scoped sub-routers (provider keys, profiles,
 * checks/runs, dashboard). Static paths mount before /:id routes.
 */

import { Router } from 'express';
import { requireRole } from '../middleware/require-role.ts';
import providerKeysRouter from './health-checks/provider-keys.ts';
import profilesRouter from './health-checks/profiles.ts';
import checksRouter from './health-checks/checks.ts';
import dashboardRouter from './health-checks/dashboard.ts';

const router = Router();
router.use(requireRole('owner', 'admin'));

router.use(providerKeysRouter);
router.use(profilesRouter);
router.use(dashboardRouter);
router.use(checksRouter);

export default router;
