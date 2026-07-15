// Import config first so env (backend/.env + cadence .env) loads before the engine.
import { cadenceConfig } from './config.ts';
import { createApp } from './app.ts';

const app = createApp();
app.listen(cadenceConfig.port, () => {
  console.log(`[cadence-api] listening on :${cadenceConfig.port}`);
});
