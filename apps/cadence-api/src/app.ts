// Load env before any route/service module reads process.env (Vercel entry is this file).
import './config.ts';

import express from 'express';
import healthRoutes from './routes/health.ts';
import coachRoutes from './routes/coach.ts';
import planRoutes from './routes/plan.ts';
import reviewRoutes from './routes/review.ts';
import progressRoutes from './routes/progress.ts';
import nutritionRoutes from './routes/nutrition.ts';
import foodsRoutes from './routes/foods.ts';
import meRoutes from './routes/me.ts';
import devRoutes from './routes/dev.ts';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/health', healthRoutes);
  app.use('/coach', coachRoutes);
  app.use('/plan', planRoutes);
  app.use('/review', reviewRoutes);
  app.use('/progress', progressRoutes);
  app.use('/nutrition', nutritionRoutes);
  app.use('/nutrition/foods', foodsRoutes);
  app.use('/me', meRoutes);
  app.use('/dev', devRoutes);

  return app;
}

/** Vercel Express/Services entry: default export must be the app (or a server). */
const app = createApp();
export default app;
