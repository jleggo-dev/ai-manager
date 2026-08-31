// Load env before any route/service module reads process.env (Vercel entry is this file).
import './config.ts';

import express from 'express';
import { corsMiddleware } from './lib/cors.ts';
import healthRoutes from './routes/health.ts';
import coachRoutes from './routes/coach.ts';
import coachFoodRoutes from './routes/coach-food.ts';
import planRoutes from './routes/plan.ts';
import weekReviewRoutes from './routes/week-review.ts';
import planChangesRoutes from './routes/plan-changes.ts';
import planWatchRoutes from './routes/plan-watch.ts';
import weekRoutes from './routes/week.ts';
import reviewRoutes from './routes/review.ts';
import progressRoutes from './routes/progress.ts';
import progressExtrasRoutes from './routes/progress-extras.ts';
import nutritionRoutes from './routes/nutrition.ts';
import dietaryProfileRoutes from './routes/dietary-profile.ts';
import foodsRoutes from './routes/foods.ts';
import recipesRoutes from './routes/recipes.ts';
import mealPlansRoutes from './routes/meal-plans.ts';
import meRoutes from './routes/me.ts';
import healthDigestRoutes from './routes/health-digest.ts';
import workoutHistoryRoutes from './routes/workout-history.ts';
import progressLayoutRoutes from './routes/progress-layout.ts';
import deviceRoutes from './routes/devices.ts';
import notificationPrefsRoutes from './routes/notification-prefs.ts';
import coachMomentRoutes from './routes/coach-moments.ts';
import recapsRoutes from './routes/recaps.ts';
import journalRoutes from './routes/journal.ts';
import devRoutes from './routes/dev.ts';
import internalRoutes from './routes/internal.ts';

export function createApp() {
  const app = express();
  // Before json(): preflights carry no body, and SSE responses need the headers too.
  app.use(corsMiddleware());
  app.use(express.json({ limit: '2mb' }));

  app.use('/health', healthRoutes);
  app.use('/coach', coachRoutes);
  app.use('/coach', coachFoodRoutes);
  app.use('/plan', planRoutes);
  app.use('/plan', weekReviewRoutes);
  app.use('/plan', planChangesRoutes);
  app.use('/plan', planWatchRoutes);
  app.use('/plan/week', weekRoutes);
  app.use('/review', reviewRoutes);
  app.use('/progress', progressRoutes);
  app.use('/progress', progressExtrasRoutes);
  app.use('/journal', journalRoutes);
  app.use('/nutrition', nutritionRoutes);
  app.use('/nutrition', dietaryProfileRoutes);
  app.use('/nutrition/foods', foodsRoutes);
  app.use('/nutrition/recipes', recipesRoutes);
  app.use('/nutrition/meal-plans', mealPlansRoutes);
  app.use('/me', meRoutes);
  app.use('/me', healthDigestRoutes);
  app.use('/me', workoutHistoryRoutes);
  app.use('/me', progressLayoutRoutes);
  app.use('/me', deviceRoutes);
  app.use('/me', notificationPrefsRoutes);
  app.use('/me', coachMomentRoutes);
  app.use('/me', recapsRoutes);
  // Machine-to-machine (cron). Owns its own shared-secret gate — see routes/internal.ts.
  app.use('/internal', internalRoutes);
  app.use('/dev', devRoutes);

  return app;
}

/** Vercel Express/Services entry: default export must be the app (or a server). */
const app = createApp();
export default app;
