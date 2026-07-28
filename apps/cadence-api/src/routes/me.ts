import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { resetUserData } from '../services/dev-reset.ts';
import { clearTrace } from '../services/dev-trace.ts';
import { AimError, purgeUserAiData } from '../ai/aim.ts';
import { clearHomeLocation, getUser, setHomeLocation } from '../repos/users.ts';
import { geocodeCity, getWeatherForUser } from '../services/weather/weather.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { homeLocationBodySchema } from '../validation/location.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * GET /me/location — coarse home location + timezone (for Settings + first-run).
 * 200 with nulls when unset — never 404 for a missing preference.
 */
router.get('/location', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const user = await getUser(userId);
    res.json({
      home_location: user?.home_location ?? null,
      timezone: user?.timezone ?? null,
    });
  } catch (err) {
    console.error('[GET /me/location]', err);
    res.status(500).json({ error: 'failed to load location' });
  }
});

/**
 * GET /me/weather — current conditions at the user's home location (+ the OWM city label), for the
 * Today header. Deterministic OWM data; `available:false` when there's no location or weather is
 * unconfigured (the header then just shows the greeting — never a fabricated location).
 */
router.get('/weather', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const w = await getWeatherForUser(userId);
    if (!w) return void res.json({ available: false });
    res.json({
      available: true,
      temp_c: Math.round(w.tempC),
      conditions: w.conditions,
      label: w.label ?? null,
      precip_chance: w.precipChance,
    });
  } catch (err) {
    console.error('[GET /me/weather]', err);
    res.status(500).json({ error: 'failed to load weather' });
  }
});

/**
 * POST /me/location — persist coarse geolocation (+ optional city label + IANA timezone).
 * Browser geolocation is client-side; city-only falls back to OpenWeatherMap geocoding.
 */
router.post('/location', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(homeLocationBodySchema, req.body);
    const timezone = body.timezone?.trim() || null;
    let lat = body.lat;
    let lon = body.lon;
    let label = body.label?.trim() || body.city?.trim() || undefined;

    if ((lat == null || lon == null) && label) {
      const geo = await geocodeCity(label);
      if (!geo) return void res.status(400).json({ error: "couldn't find that city — try another spelling" });
      lat = geo.lat;
      lon = geo.lon;
      label = geo.label;
    }
    if (lat == null || lon == null) return void res.status(400).json({ error: 'provide lat+lon or a city/label' });

    const location = { lat, lon, ...(label ? { label } : {}) };
    await setHomeLocation(userId, location, timezone);
    res.json({ home_location: location, timezone });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/location]', err);
    res.status(500).json({ error: 'failed to save location' });
  }
});

/** DELETE /me/location — forget stored home location (and timezone). */
router.delete('/location', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await clearHomeLocation(userId, true);
    res.json({ home_location: null, timezone: null });
  } catch (err) {
    console.error('[DELETE /me/location]', err);
    res.status(500).json({ error: 'failed to clear location' });
  }
});

/**
 * DELETE /me/data — "Start over": wipe THIS user's Cadence data (goals, plan, chat, logs,
 * baseline). Real-auth allowed (unlike the dev-gated /dev/reset). Guarded server-side by a
 * typed confirmation phrase — the client can't fat-finger this into existence. Order matters:
 * purge provider-side chats FIRST (a mid-flight failure then leaves local data intact and the
 * whole thing retryable, rather than local-wiped with provider copies retained). This is NOT
 * account deletion — the Supabase login survives; the UI copy says so.
 */
router.delete('/data', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  if (req.body?.confirm !== 'start over') {
    return void res.status(400).json({ error: 'confirmation phrase required' });
  }
  try {
    await purgeUserAiData(userId);
    await resetUserData(userId);
    clearTrace(userId);
    res.json({ ok: true });
  } catch (err) {
    const aim = AimError.fromUnknown(err);
    console.error('[DELETE /me/data]', aim.kind, aim.message);
    res.status(aim.httpStatus).json({
      error: 'start over failed — nothing was partially deleted locally; try again',
      kind: aim.kind,
    });
  }
});

export default router;
