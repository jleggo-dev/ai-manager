import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { authMiddleware } from './middleware/auth.ts';
import { getAuthContext } from './db/tenant.ts';
import authRouter from './routes/auth.ts';
import workspacesRouter from './routes/workspaces.ts';
import apiKeysRouter from './routes/api-keys.ts';
import providersRouter from './routes/providers.ts';
import aiProfilesRouter from './routes/ai-profiles.ts';
import processingJobsRouter from './routes/processing-jobs.ts';
import processingJobGroupsRouter from './routes/processing-job-groups.ts';
import diagnosticLogsRouter from './routes/diagnostic-logs.ts';
import chatSessionsRouter from './routes/chat-sessions.ts';
import aiMatcherRouter from './routes/ai-matcher.ts';
import appSettingsRouter from './routes/app-settings.ts';
import callingApplicationsRouter from './routes/calling-applications.ts';
import userCredentialsRouter from './routes/user-credentials.ts';
import workflowsRouter from './routes/workflows.ts';
import userDataRouter from './routes/user-data.ts';
import healthChecksRouter from './routes/health-checks.ts';
import widgetHealthChecksRouter from './routes/widget-health-checks.ts';
import cronRouter from './routes/cron.ts';
import adminUsersRouter from './routes/admin-users.ts';

import { healthCheck } from './models/index.ts';
import { getRateLimits } from './lib/rate-limit-settings.ts';
import { validateCursorParam } from './lib/pagination.ts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: API_VERSION } = require('../../package.json');

const app = express();

app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? '1'));

/* Vercel Services: backend routePrefix strips so Express still sees /api/... */
app.use((req: Request, _res: Response, next: NextFunction) => {
  const prefix = '/_/backend';
  const raw = req.originalUrl || req.url || '';
  if (raw === prefix || raw.startsWith(`${prefix}/`) || raw.startsWith(`${prefix}?`)) {
    const rest = raw.slice(prefix.length) || '/';
    req.url = rest;
    req.originalUrl = rest;
  }
  next();
});

app.use(helmet());

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-API-Version', API_VERSION);
  next();
});

const jsonBodyLimit = process.env.API_JSON_BODY_LIMIT || '1mb';
app.use(express.json({ limit: jsonBodyLimit }));

app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  const errRecord = err as Error & { type?: string };
  if (errRecord.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  if (errRecord.type === 'entity.too.large') {
    return res.status(413).json({
      error: `Request payload too large (limit: ${jsonBodyLimit}).`,
    });
  }
  return next(err);
});

const ipKey = (req: Request): string => {
  return ipKeyGenerator(req.ip ?? '127.0.0.1');
};

const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: async () => (await getRateLimits()).global,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — try again in a minute.' },
  keyGenerator: ipKey,
});
app.use(globalLimiter);

const llmKey = (req: Request): string => {
  const ctx = getAuthContext();
  if (ctx?.mode === 'api_key' && ctx.apiKeyId) {
    return `apikey:${ctx.apiKeyId}`;
  }
  if (ctx?.mode === 'jwt' && ctx.userId) {
    return `user:${ctx.userId}`;
  }
  return ipKey(req);
};

const llmLimiter = rateLimit({
  windowMs: 60_000,
  limit: async (_req: Request): Promise<number> => {
    const limits = await getRateLimits();
    const rCtx = getAuthContext();
    if (rCtx?.mode === 'jwt' && limits.llmUser) return limits.llmUser;
    if (rCtx?.mode === 'api_key' && limits.llmUser) return limits.llmUser;
    return limits.llm;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Rate limit reached for AI endpoints — try again shortly.' },
  keyGenerator: llmKey,
});

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: async () => (await getRateLimits()).auth,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many auth attempts — try again in a minute.' },
  keyGenerator: ipKey,
});

app.get('/api/health', async (_req: Request, res: Response) => {
  const tables = await healthCheck();
  const allOk = Object.values(tables).every(Boolean);
  res.json({ status: allOk ? 'ok' : 'degraded', version: API_VERSION });
});

app.get('/api/health/chromium', async (_req: Request, res: Response) => {
  const { probeBrowserAvailability, getBrowserDiagnostics } = await import('./lib/browser.ts');
  const diag = getBrowserDiagnostics();
  const available = await probeBrowserAvailability();
  res.json({ available, ...diag });
});

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/cron', cronRouter);

app.use(authMiddleware);
app.use(validateCursorParam);

app.use('/api/workspaces', workspacesRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/api-keys', apiKeysRouter);
app.use('/api/providers', providersRouter);
app.use('/api/ai-profiles', aiProfilesRouter);
app.use('/api/processing-jobs', processingJobsRouter);
app.use('/api/processing-job-groups', processingJobGroupsRouter);
app.use('/api/diagnostic-logs', diagnosticLogsRouter);
app.use('/api/chat-sessions', llmLimiter, chatSessionsRouter);
app.use('/api/ai-matcher', llmLimiter, aiMatcherRouter);
app.use('/api/settings', appSettingsRouter);
app.use('/api/calling-applications', callingApplicationsRouter);
app.use('/api/user-credentials', userCredentialsRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/user-data', userDataRouter);
app.use('/api/health-checks', healthChecksRouter);
app.use('/api/widget-health-checks', widgetHealthChecksRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[unhandled]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default app;
