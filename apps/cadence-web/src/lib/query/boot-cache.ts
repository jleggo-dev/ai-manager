/**
 * What the app knew last time, kept on the device — so opening Cadence paints a screen instead of
 * a wait.
 *
 * PERF-01/02 (#264) gave the plan and the dashboard a shared cache, and a *tab return* has painted
 * instantly ever since. None of it survived the process. A `QueryClient` is memory, and every way
 * into this app on a phone starts a fresh one: a cold launch, and — the case that reads as "it does
 * this every single time" — iOS reclaiming the WKWebView's content process while the app sits in
 * the background, which reloads the bundle from zero on the next glance at it. So the skeleton was
 * not a slow network. It was a cache that had never once been asked to outlive a launch, and no
 * amount of server speed could have fixed it: the first paint was ALWAYS a round trip away.
 *
 * This is the other half — the same trick `coach-transcript-cache.ts` already plays for the Coach
 * tab, generalized to the reads that gate the app's first screen. Its doctrine carries over word
 * for word:
 *
 * **The server is still the truth. This is a paint, not a store.** Every seeded entry is written
 * with its ORIGINAL timestamp, so react-query considers it stale on arrival and revalidates
 * immediately; whatever comes back replaces it. Nothing here is ever sent upstream, and a device
 * that lost this file has lost a screenful of pixels and nothing else.
 *
 * Scoped to a PERSON, not a phone, twice over: the key is registered in `USER_SCOPED_KEYS` (an
 * identity change wipes it), and every snapshot carries the id of the account it was taken from,
 * checked against the session already on disk before a single pixel is seeded. Belt AND braces,
 * because the seed happens before auth resolves — that is the entire point of it — so the usual
 * "clear on the next boot" guarantee lands one boot too late to be the only one.
 */
import type { QueryClient } from '@tanstack/react-query';
import { getDevAccount, isDevMode } from '../api/http.ts';
// From `persisted-session.ts`, NOT `supabase.ts`: importing the latter constructs the auth client,
// which this barrel's importers would then all inherit — and which throws outright without env.
import { readPersistedSession } from '../persisted-session.ts';
import { localTodayIso, queryKeys } from './keys.ts';
import { revivePlanSnapshot } from './usePlan.ts';

export const BOOT_CACHE_KEY = 'cadence.bootCache';

/** Bump when an entry's stored shape changes; an older snapshot is then simply not read. */
const VERSION = 2;

/**
 * How long a snapshot is worth painting. A week, because the honest bound here is *relevance*, not
 * decay: nothing in it is trusted, only shown for the moment before the server answers. Past a week
 * away from the app, the odds that what it holds still resembles the current week are low enough
 * that the skeleton is the more truthful screen.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A ceiling on what this may spend of a 5MB origin quota it SHARES with the coach transcript. Over
 * budget, the snapshot is dropped rather than trimmed: a half-written screen is worse than the
 * skeleton, and the transcript — the more personal and less reconstructible of the two — must never
 * be evicted to make room for a plan the server will re-send in 200ms.
 */
const MAX_BYTES = 400_000;

/**
 * The reads that gate the app's first screen, and nothing else.
 *
 * A deliberately short list. Everything on it is (a) already through the shared cache, (b) on
 * screen within a second of opening the app, and (c) cheap to be wrong about for that second
 * because it revalidates on arrival. A read that fails any of those three does not belong here —
 * this is the boot paint, not a general offline store, and the difference is what keeps it honest.
 */
interface PersistedQuery {
  /** Recomputed at read time as well as write time — `nutritionDay`'s key carries a date. */
  keyOf: () => readonly unknown[];
  /**
   * Adjust a snapshot for the time that has passed since it was taken, or return null to refuse
   * it. Only the plan needs one, and it needs it badly — see `revivePlanSnapshot`.
   */
  revive?: (data: unknown) => unknown | null;
}

const PERSISTED: PersistedQuery[] = [
  { keyOf: () => queryKeys.plan.all, revive: (d) => revivePlanSnapshot(d) },
  { keyOf: () => queryKeys.progress.all },
  // Today's food, because the trail's food strip is on the first screen and its own skeleton is
  // part of what the owner is looking at. Keyed by date, and the key is compared exactly on read,
  // so yesterday's day is never seeded as today's.
  { keyOf: () => queryKeys.nutritionDay.day(localTodayIso()) },
];

interface Entry {
  key: unknown[];
  data: unknown;
  /** When the server actually answered — seeded as-is so react-query knows this is stale. */
  at: number;
}
interface Snapshot {
  v: number;
  owner: string | null;
  at: number;
  /**
   * The last known plan stage, held SEPARATELY from the plan entry on purpose. Routing has to
   * survive a week the revive step refuses: a plan whose dates have rolled past is not paintable,
   * but "this account has a committed plan" is still true, and it is the fact that decides whether
   * the app opens on its shell or on a loading screen.
   */
  stage: string | null;
  entries: Entry[];
}

/**
 * Whose snapshot this is. In dev mode there is no Supabase session and two interchangeable test
 * accounts behind a header — so the dev slug IS the identity, or account-2 would open account-1's
 * week for a beat on every switch, which is exactly the confusion this file exists to prevent.
 */
function owner(): string | null {
  if (isDevMode()) return `dev:${getDevAccount()}`;
  return readPersistedSession()?.user?.id ?? null;
}

function read(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(BOOT_CACHE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Snapshot>;
    if (s.v !== VERSION) return null;
    if (typeof s.at !== 'number' || Date.now() - s.at > MAX_AGE_MS) return null;
    // The check that makes the pre-auth paint safe: a snapshot belongs to an account, and the
    // account signed in on this device right now is readable from disk without asking the network.
    if ((s.owner ?? null) !== owner()) return null;
    return {
      v: VERSION,
      owner: s.owner ?? null,
      at: s.at,
      stage: typeof s.stage === 'string' ? s.stage : null,
      entries: Array.isArray(s.entries) ? s.entries : [],
    };
  } catch {
    return null; // private mode, a disabled store, a key from an older build — "nothing remembered"
  }
}

/**
 * The plan stage this device last saw, or null.
 *
 * Read by App's screen machine so a returning user opens on their shell rather than on a skeleton
 * that resolves to the same shell a second later. Deliberately narrow: the caller routes INTO the
 * plan on this and never out of it — sending someone back to "meet Cadence" on the strength of a
 * cached value is the 2026-08-19 failure (onboarding restarted at a signed-in owner) with a new
 * cause, and no paint is worth reopening that door.
 */
let booted: Snapshot | null = null;
export function bootPlanStage(): string | null {
  booted ??= read();
  return booted?.stage ?? null;
}

/**
 * Put last launch's answers into the cache, synchronously, before React's first render.
 *
 * Call this at module load — ahead of `createRoot`, so the first frame the webview paints is
 * already the real screen. An entry whose key no longer matches (yesterday's food) or whose reviver
 * refuses it (a week that has rolled over) is skipped; the rest still land.
 */
export function seedBootCache(queryClient: QueryClient): void {
  const snap = read();
  booted = snap;
  if (!snap) return;
  for (const entry of snap.entries) {
    try {
      const target = PERSISTED.find((p) => JSON.stringify(p.keyOf()) === JSON.stringify(entry.key));
      if (!target) continue; // a key that has since changed shape or left the list
      const data = target.revive ? target.revive(entry.data) : entry.data;
      if (data === null || data === undefined) continue;
      // `updatedAt` is the ORIGINAL answer's time, not now. That is what makes this
      // stale-while-revalidate rather than a lie with a week's shelf life: every seeded query is
      // already past its staleTime, so the first mount refetches it.
      queryClient.setQueryData(entry.key, data, { updatedAt: entry.at });
    } catch {
      /* one bad entry must not cost the others */
    }
  }
}

function snapshot(queryClient: QueryClient): void {
  try {
    const entries: Entry[] = [];
    for (const p of PERSISTED) {
      const key = p.keyOf();
      const state = queryClient.getQueryState(key);
      if (state?.status !== 'success' || state.data === undefined) continue;
      entries.push({ key: [...key], data: state.data, at: state.dataUpdatedAt });
    }
    const plan = queryClient.getQueryData(queryKeys.plan.all) as { stage?: string } | undefined;
    if (!entries.length && !plan?.stage) return;
    const payload: Snapshot = {
      v: VERSION,
      owner: owner(),
      at: Date.now(),
      stage: plan?.stage ?? bootPlanStage(),
      entries,
    };
    const raw = JSON.stringify(payload);
    if (raw.length > MAX_BYTES) return; // see MAX_BYTES — drop, never trim
    window.localStorage.setItem(BOOT_CACHE_KEY, raw);
    booted = payload;
  } catch {
    /* over quota or storage disabled — the server still has every one of these answers */
  }
}

/**
 * Keep the snapshot current for the life of this launch.
 *
 * Coalesced behind a timer rather than written per event, for the same reason the transcript cache
 * writes on a settled turn and never per streaming delta: `localStorage.setItem` is synchronous and
 * serializes the whole payload, and a plan mutation can fire a dozen cache events in a frame.
 *
 * Returns its unsubscribe for tests. Nothing in the app unsubscribes — this lives as long as the
 * page does, which is exactly as long as it is useful.
 */
export function persistBootCache(queryClient: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      snapshot(queryClient);
    }, 400);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

/** Forget the boot paint (sign-out, "start over"). The identity sweep calls this by key. */
export function clearBootCache(): void {
  try {
    booted = null;
    window.localStorage.removeItem(BOOT_CACHE_KEY);
  } catch {
    /* nothing to do and nothing at stake */
  }
}
