import { QueryClient } from '@tanstack/react-query';
import { BOOT_CACHE_KEY, bootPlanStage, clearBootCache, persistBootCache, seedBootCache } from './boot-cache.ts';
import { localTodayIso, queryKeys } from './keys.ts';
import { readPersistedSession } from '../persisted-session.ts';
import { revivePlanSnapshot } from './usePlan.ts';

/**
 * The boot paint. These assert the two things that make it safe to put last launch's answers on
 * screen before the network — it is refused when it belongs to somebody else, and it is refused
 * when it is no longer true — and the one thing that makes it worth doing: the app has a plan to
 * render before a single request is sent.
 *
 * Dev mode (`?dev=1` is absent in jsdom, so `isDevMode()` is false) means `owner()` reads the
 * persisted Supabase session, which is what these stub in localStorage.
 */
const SB_KEY = `sb-${new URL(import.meta.env.VITE_CADENCE_SUPABASE_URL as string).hostname.split('.')[0]}-auth-token`;
/**
 * Sign this device in, the way supabase-js does. `base64-` because that is the encoding the
 * current client actually writes — testing the plain form only would let a decode regression pass.
 */
const signIn = (id: string, encode = true) => {
  const raw = JSON.stringify({ user: { id } });
  window.localStorage.setItem(SB_KEY, encode ? `base64-${btoa(raw)}` : raw);
  // Loud rather than silent: every ownership assertion below is vacuous if the key is wrong.
  expect(readPersistedSession()?.user?.id).toBe(id);
};

const day = (iso: string, isToday = false) => ({ date: iso, weekday: 'Mon', dayNum: 1, isToday, occurrences: [] });
const planOn = (dates: string[]) => ({
  hasPlan: true,
  stage: 'committed',
  activities: [],
  week: dates.map((d) => day(d)),
});

/** Take a snapshot the way the app does: settle the queries, then let the subscription write. */
async function snapshotOf(data: unknown, stage = 'committed') {
  const client = new QueryClient();
  const stop = persistBootCache(client);
  client.setQueryData(queryKeys.plan.all, data ?? { stage, week: [] });
  await new Promise((r) => setTimeout(r, 450));
  stop();
  client.clear();
}

beforeEach(() => {
  window.localStorage.clear();
  clearBootCache();
});

/** A snapshot holding a sky that the server answered `agoMs` ago. */
async function snapshotWeather(agoMs: number) {
  const client = new QueryClient();
  const stop = persistBootCache(client);
  client.setQueryData(queryKeys.plan.all, planOn([localTodayIso()]));
  client.setQueryData(
    queryKeys.weather.all,
    { available: true, temp_c: 19, conditions: 'clear' },
    { updatedAt: Date.now() - agoMs },
  );
  await new Promise((r) => setTimeout(r, 450));
  stop();
  client.clear();
}

/**
 * The sky is the one entry here with a shelf life. Everything else on the list is wrong only by
 * being out of date about something that changes slowly; weather is wrong by being weather.
 */
describe('the boot paint\u2019s sky', () => {
  it('paints the line the header last had', async () => {
    signIn('user-a');
    await snapshotWeather(5 * 60_000);

    const next = new QueryClient();
    seedBootCache(next);

    expect((next.getQueryData(queryKeys.weather.all) as { temp_c: number } | undefined)?.temp_c).toBe(19);
  });

  it('refuses one that has gone off', async () => {
    signIn('user-a');
    await snapshotWeather(61 * 60_000);

    const next = new QueryClient();
    seedBootCache(next);

    // Past the server's own hour, this is not a paint of what a fresh read would say — it is
    // yesterday's rain over today's sun, held for as long as the round trip takes.
    expect(next.getQueryData(queryKeys.weather.all)).toBeUndefined();
    expect(next.getQueryData(queryKeys.plan.all)).toBeDefined(); // one refusal costs the others nothing
  });
});

/**
 * The inversion (owner 2026-09-05): everything is painted, the exceptions are named.
 *
 * The row that matters most is the first one. `progress.window('month')` is what the Progress tab
 * actually reads, it was never on the old three-key allowlist, and so that whole tab cold-loaded
 * on every launch for as long as it existed — with nothing anywhere to say it was missing. A test
 * that only checked the listed keys would have passed throughout.
 */
describe('the boot paint persists what nobody listed', () => {
  /** Settle an arbitrary set of queries and let the subscription write them. */
  async function snapshotKeys(entries: [readonly unknown[], unknown, number?][]) {
    const client = new QueryClient();
    const stop = persistBootCache(client);
    for (const [key, data, agoMs] of entries) {
      client.setQueryData(key, data, agoMs ? { updatedAt: Date.now() - agoMs } : undefined);
    }
    await new Promise((r) => setTimeout(r, 450));
    stop();
    client.clear();
  }

  it('paints the Progress tab’s own windowed key', async () => {
    signIn('user-a');
    await snapshotKeys([[queryKeys.progress.window('month'), { kept: 3 }]]);

    const next = new QueryClient();
    seedBootCache(next);

    expect(next.getQueryData(queryKeys.progress.window('month'))).toEqual({ kept: 3 });
  });

  it('paints a key invented after this file was written', async () => {
    signIn('user-a');
    // No policy, no allowlist entry, nothing: the default is to paint it. That IS the ruling.
    await snapshotKeys([[['somethingNobodyHasWrittenYet', 7], { ok: true }]]);

    const next = new QueryClient();
    seedBootCache(next);

    expect(next.getQueryData(['somethingNobodyHasWrittenYet', 7])).toEqual({ ok: true });
  });

  it('never writes a denied answer to disk', async () => {
    signIn('user-a');
    await snapshotKeys([
      [queryKeys.dailyCheckin.all, true],
      [queryKeys.progressLayout.draft, { widgets: [] }],
      [queryKeys.progressLayout.all, { widgets: ['rings'] }],
    ]);

    // Not merely refused on the way out — absent from the file, so a later build cannot paint it.
    expect(window.localStorage.getItem(BOOT_CACHE_KEY)).not.toContain('dailyCheckin');

    const next = new QueryClient();
    seedBootCache(next);
    // A stale "the check-in is due" would OPEN the check-in; the layout beside it is fine to paint.
    expect(next.getQueryData(queryKeys.dailyCheckin.all)).toBeUndefined();
    expect(next.getQueryData(queryKeys.progressLayout.draft)).toBeUndefined();
    expect(next.getQueryData(queryKeys.progressLayout.all)).toEqual({ widgets: ['rings'] });
  });

  it('refuses yesterday’s food day by name, however fresh the snapshot', async () => {
    signIn('user-a');
    // Local, like the policy it is testing. toISOString() is UTC, so west of Greenwich this
    // resolved to the SAME string as localTodayIso() late in the evening — the test seeded one
    // key twice and then asked it to be both undefined and {kcal:300}. CI runs at UTC+0 and
    // never saw it; it failed on a developer's machine at 20:12 EDT (2026-09-06).
    const yesterday = localTodayIso(new Date(Date.now() - 864e5));
    await snapshotKeys([
      [queryKeys.nutritionDay.day(yesterday), { kcal: 2100 }],
      [queryKeys.nutritionDay.day(localTodayIso()), { kcal: 300 }],
    ]);

    const next = new QueryClient();
    seedBootCache(next);

    expect(next.getQueryData(queryKeys.nutritionDay.day(yesterday))).toBeUndefined();
    expect(next.getQueryData(queryKeys.nutritionDay.day(localTodayIso()))).toEqual({ kcal: 300 });
  });

  it('drops the heavy tail over budget instead of the whole screen', async () => {
    signIn('user-a');
    // Photos outrank nothing and are the first to go; the week is rank 0 and must survive. The
    // old file dropped BOTH — a snapshot over budget wrote nothing at all.
    const huge = { photos: Array.from({ length: 4000 }, (_, i) => ({ url: 'x'.repeat(120), i })) };
    await snapshotKeys([
      [queryKeys.plan.all, planOn([localTodayIso()])],
      [queryKeys.progressPhotos.all, huge],
    ]);

    const next = new QueryClient();
    seedBootCache(next);

    expect(next.getQueryData(queryKeys.plan.all)).toBeDefined();
    expect(next.getQueryData(queryKeys.progressPhotos.all)).toBeUndefined();
  });
});

describe('boot cache', () => {
  it('paints the previous launch into a fresh client, marked stale so it revalidates', async () => {
    signIn('user-a');
    const today = localTodayIso();
    await snapshotOf(planOn([today]));

    const next = new QueryClient();
    seedBootCache(next);

    const seeded = next.getQueryData(queryKeys.plan.all) as { week: { isToday: boolean }[] } | undefined;
    expect(seeded?.week[0]?.isToday).toBe(true);
    expect(bootPlanStage()).toBe('committed');
    // The whole contract: seeded with the ORIGINAL answer's timestamp, so it is already past the
    // 30s staleTime and the first mount refetches rather than trusting this for half a minute.
    const state = next.getQueryState(queryKeys.plan.all);
    expect(state?.dataUpdatedAt).toBeLessThan(Date.now());
    expect(next.getQueryState(queryKeys.plan.all)?.isInvalidated).toBe(false);
  });

  it('refuses a snapshot belonging to a different account', async () => {
    signIn('user-a');
    await snapshotOf(planOn([localTodayIso()]));

    signIn('user-b'); // same phone, next person
    const next = new QueryClient();
    seedBootCache(next);

    expect(next.getQueryData(queryKeys.plan.all)).toBeUndefined();
    expect(bootPlanStage()).toBeNull();
  });

  it('reads the plain (un-encoded) session form too', async () => {
    signIn('user-a', false);
    await snapshotOf(planOn([localTodayIso()]));
    const next = new QueryClient();
    seedBootCache(next);
    expect(next.getQueryData(queryKeys.plan.all)).toBeDefined();
  });

  it('refuses to paint with no session on the device at all', async () => {
    signIn('user-a');
    await snapshotOf(planOn([localTodayIso()]));
    window.localStorage.removeItem(SB_KEY); // signed out

    const next = new QueryClient();
    seedBootCache(next);
    expect(next.getQueryData(queryKeys.plan.all)).toBeUndefined();
  });

  it('keeps the ROUTE when the cached week has rolled past, but paints nothing', async () => {
    signIn('user-a');
    await snapshotOf(planOn(['2020-01-01', '2020-01-02']));

    const next = new QueryClient();
    seedBootCache(next);

    // No stale week on screen — but the app still opens on its shell instead of a skeleton.
    expect(next.getQueryData(queryKeys.plan.all)).toBeUndefined();
    expect(bootPlanStage()).toBe('committed');
  });

  it('drops a snapshot written by an older build', async () => {
    signIn('user-a');
    window.localStorage.setItem(
      BOOT_CACHE_KEY,
      JSON.stringify({ v: 0, owner: 'user-a', at: Date.now(), stage: 'committed', entries: [] }),
    );
    const next = new QueryClient();
    seedBootCache(next);
    expect(bootPlanStage()).toBeNull();
  });

  it('survives a corrupt or unreadable snapshot without throwing', () => {
    signIn('user-a');
    window.localStorage.setItem(BOOT_CACHE_KEY, 'not json');
    const next = new QueryClient();
    expect(() => seedBootCache(next)).not.toThrow();
    expect(bootPlanStage()).toBeNull();
  });
});

describe('revivePlanSnapshot', () => {
  it("re-derives isToday from each day's own date", () => {
    const today = localTodayIso();
    const revived = revivePlanSnapshot(planOn(['2020-01-01', today]));
    expect(revived?.week.map((d) => d.isToday)).toEqual([false, true]);
  });

  it("yesterday's TODAY does not survive into today", () => {
    const today = localTodayIso();
    const stale = { ...planOn(['2020-01-01', today]), week: [day('2020-01-01', true), day(today)] };
    expect(revivePlanSnapshot(stale)?.week.map((d) => d.isToday)).toEqual([false, true]);
  });

  it('refuses a week that no longer contains today', () => {
    expect(revivePlanSnapshot(planOn(['2020-01-01']))).toBeNull();
    expect(revivePlanSnapshot(undefined)).toBeNull();
    expect(revivePlanSnapshot({ hasPlan: true })).toBeNull();
  });
});
