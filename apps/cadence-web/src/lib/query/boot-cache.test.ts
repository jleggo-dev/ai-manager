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
