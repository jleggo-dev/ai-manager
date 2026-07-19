// Local / `npm start` entry. Vercel loads `src/app.ts` (default export) instead.
import app from './app.ts';
import { cadenceConfig } from './config.ts';

const port = Number(process.env.PORT) || cadenceConfig.port;
app.listen(port, () => {
  console.log(`[cadence-api] listening on :${port}`);
});
