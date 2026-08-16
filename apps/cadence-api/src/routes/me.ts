import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { resetUserData } from '../services/dev-reset.ts';
import { clearTrace } from '../services/dev-trace.ts';
import { AimError, purgeUserAiData } from '../ai/aim.ts';
import { clearHomeLocation, getUser, mergeBaseline, setHomeLocation } from '../repos/users.ts';
import {
  geocodeCity,
  reverseGeocode,
  getWeatherForUser,
  needsAppleAttribution,
  APPLE_WEATHER_ATTRIBUTION_URL,
} from '../services/weather/weather.ts';
import { getDayRecap } from '../services/day-recap.ts';
import { getNowMenu } from '../services/now-menu.ts';
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
 * GET /me/weather — current conditions at the user's home location (+ the city label, when the
 * provider gives one), for the Today header. Deterministic provider data; `available:false` when
 * there's no location or weather is unconfigured (the header then just shows the greeting — never
 * a fabricated location).
 *
 * `attribution` is a licence obligation, not decoration: Apple requires the Apple Weather mark and
 * a link to their data-source page wherever WeatherKit data is displayed. It is derived from the
 * SNAPSHOT rather than from config, because a cached snapshot can outlive a provider switch.
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
      source: w.source,
      attribution: needsAppleAttribution(w) ? { name: 'Apple Weather', url: APPLE_WEATHER_ATTRIBUTION_URL } : null,
    });
  } catch (err) {
    console.error('[GET /me/weather]', err);
    res.status(500).json({ error: 'failed to load weather' });
  }
});

/**
 * GET /me/now-menu — the ＋ sheet's present-tense section (REQ10 §6). Composed ahead and cached, so
 * this is a fast read; an empty list is a legitimate answer and simply hides the section.
 */
router.get('/now-menu', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ items: await getNowMenu(userId) });
  } catch (err) {
    console.error('[GET /me/now-menu]', err);
    res.json({ items: [] });
  }
});

/**
 * GET /me/today-brief — the Today header's one-line day recap (REQ8). Cached per user+day; returns
 * { recap: null } on any failure so the header just shows the date with no line.
 */
router.get('/today-brief', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ recap: await getDayRecap(userId) });
  } catch (err) {
    console.error('[GET /me/today-brief]', err);
    res.json({ recap: null });
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

    // The auto-detect path arrives as bare coordinates; name the place so the header can say
    // "Toronto, CA" instead of "Weather nearby". Best-effort — null keeps the old behaviour.
    if (!label) label = (await reverseGeocode(lat, lon)) ?? undefined;

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

/**
 * GET /me/constraints — what the plan is being built around, as the DATABASE holds it.
 *
 * Added because the coach was confidently wrong about it. Asked to drop the elbow, she said
 * "Done — I've removed the elbow tendinitis"; it was still there, `plan_around: true`, and she went
 * on repeating the claim in later turns even though the turn floor hands her the real list every
 * single message. Owner: *"I feel like we should surface the known constraints in the settings
 * (alongside equipment) that way I can validate them myself."*
 *
 * Which is the right instinct and a bigger point than one bug: **a fact that shapes every plan
 * should be visible to the person it is about, not only to the model.** Equipment already is.
 */
router.get('/constraints', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const u = await getUser(userId);
    res.json({ constraints: u?.baseline?.constraints ?? [] });
  } catch (err) {
    console.error('[GET /me/constraints]', err);
    res.status(500).json({ error: 'failed to read constraints' });
  }
});

/**
 * DELETE /me/constraints/:id — the user removing their own.
 *
 * Deliberately a plain delete with no judgement attached, unlike the coach's `update_constraint`,
 * which only deletes on an explicit "that was never true" (recovered ≠ mis-captured, owner ruling).
 * That care is right when a MODEL is inferring intent from prose. It is condescending when the
 * person whose elbow it is taps a button.
 */
router.delete('/constraints/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const id = String(req.params.id ?? '');
  try {
    const u = await getUser(userId);
    const before = u?.baseline?.constraints ?? [];
    const after = before.filter((c) => c.id !== id);
    if (after.length === before.length) return void res.status(404).json({ error: 'no such constraint' });
    await mergeBaseline(userId, { constraints: after });
    res.json({ constraints: after });
  } catch (err) {
    console.error('[DELETE /me/constraints/:id]', err);
    res.status(500).json({ error: 'failed to remove constraint' });
  }
});
