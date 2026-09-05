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
 * **Everything is painted; the exceptions are named** (owner, 2026-09-05: "if we're waiting to
 * load data — do it in the background, refresh the front-end later"). This began as an allowlist
 * of three keys, which quietly meant every OTHER screen still opened on a loader: the Progress tab
 * reads `progress.window('month')` and the list held `progress.all`, so the dashboard cold-loaded
 * on every launch for as long as it has existed. An allowlist cannot tell you what is missing from
 * it. So the whole query cache goes to disk now, and `boot-policy.ts` holds the two tables that
 * say what may not — and how long each family stays worth painting.
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
import { queryKeys } from './keys.ts';
import { isDenied, policyFor } from './boot-policy.ts';

export const BOOT_CACHE_KEY = 'cadence.bootCache';

/**
 * Bump when an entry's stored shape changes; an older snapshot is then simply not read.
 *
 * Exported so no test can hand-copy it. `App.test.tsx` writes a snapshot by hand to drive the
 * screen machine, and its literal `v: 2` silently stopped matching the moment this went to 3 —
 * the fixture then tested the refusal path while claiming to test the paint.
 */
export const BOOT_CACHE_VERSION = 3;
const VERSION = BOOT_CACHE_VERSION;

/**
 * How long a snapshot is worth painting. A week, because the honest bound here is *relevance*, not
 * decay: nothing in it is trusted, only shown for the moment before the server answers. Past a week
 * away from the app, the odds that what it holds still resembles the current week are low enough
 * that the skeleton is the more truthful screen.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A ceiling on what this may spend of a 5MB origin quota it SHARES with the coach transcript. The
 * transcript — the more personal and less reconstructible of the two — must never be evicted to
 * make room for a plan the server will re-send in 200ms, so this budget is fixed and this file
 * lives inside it.
 *
 * Over budget it TRIMS, by `rank`, rather than dropping everything. The old file dropped the whole
 * snapshot, on the reasoning that half a screen is worse than a skeleton — sound when all three
 * entries were one screen, wrong now that the cache holds a dozen families: keeping the week and
 * losing the photos is the trade a phone should make, and losing both to keep neither is not.
 */
const MAX_BYTES = 400_000;

/** Envelope room for `v`/`owner`/`at`/`stage` and the JSON around the entries. */
const ENVELOPE_BYTES = 512;

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
      if (!Array.isArray(entry.key) || entry.key.length === 0) continue;
      // Checked again on the way OUT, not only on the way in: a family denied since this snapshot
      // was written is still sitting in it, and the ruling has to bind the old file too.
      if (isDenied(entry.key)) continue;
      const policy = policyFor(entry.key);
      if (Date.now() - entry.at > policy.ttlMs) continue;
      const data = policy.revive ? policy.revive(entry.data, entry.at, entry.key) : entry.data;
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

/**
 * Every settled answer in the cache, most-worth-painting first, cut to fit the budget.
 *
 * Sized per entry and filled greedily rather than re-serialized in a loop: this runs behind a
 * 400ms debounce on a cache that fires a dozen events in a frame, and `JSON.stringify` of the
 * whole payload is the expensive part. An entry too big for what is left is SKIPPED, not a stop —
 * one oversized dashboard must not cost every cheaper screen behind it.
 */
function collect(queryClient: QueryClient): Entry[] {
  const found: { entry: Entry; rank: number; bytes: number }[] = [];
  for (const query of queryClient.getQueryCache().getAll()) {
    const key = query.queryKey;
    if (!Array.isArray(key) || key.length === 0) continue;
    if (isDenied(key)) continue;
    const state = query.state;
    if (state.status !== 'success' || state.data === undefined) continue;
    const entry: Entry = { key: [...key], data: state.data, at: state.dataUpdatedAt };
    try {
      found.push({ entry, rank: policyFor(key).rank, bytes: JSON.stringify(entry).length + 1 });
    } catch {
      /* a payload that will not serialize (a cycle, a Map) simply is not painted */
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.bytes - b.bytes);

  let budget = MAX_BYTES - ENVELOPE_BYTES;
  const kept: Entry[] = [];
  for (const { entry, bytes } of found) {
    if (bytes > budget) continue;
    budget -= bytes;
    kept.push(entry);
  }
  return kept;
}

function snapshot(queryClient: QueryClient): void {
  try {
    const entries = collect(queryClient);
    const plan = queryClient.getQueryData(queryKeys.plan.all) as { stage?: string } | undefined;
    if (!entries.length && !plan?.stage) return;
    const payload: Snapshot = {
      v: VERSION,
      owner: owner(),
      at: Date.now(),
      stage: plan?.stage ?? bootPlanStage(),
      entries,
    };
    window.localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify(payload));
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
