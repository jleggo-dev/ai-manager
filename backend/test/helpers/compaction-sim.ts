/**
 * Rows the size production stores, for compaction tests (AI Admin DB, measured 2026-10-31):
 * user messages avg 87 chars (p90 181), her replies avg 446 (p90 893), injected context
 * ≈3.1k chars per turn (p90 12.5k), persona ~20k, the once-per-session blocks ~12.5k.
 */
import type { ChatMessageRow } from '../../src/types.ts';

export const APP = '^\\s*<(context|open|note)\\b';
export const PINNED = '^\\s*<context source="(registry-pack|capabilities|pick-protocol)"';
export const KEEP_NEWEST = '^\\s*<context source="(date|attachments|health-digest)"';

/**
 * The live coach policy (apps/cadence-api/src/services/coach-compaction-policy.ts), copied by hand
 * because the engine's tests do not import the app. The app pins its own copy in its own tests.
 */
export const LIVE_POLICY = {
  jobSlug: 'coach-compact',
  triggerTokens: 42_000,
  ceilingTokens: 50_000,
  keepLastNTurns: 20,
  keepTailUnits: 12_000,
  minRemovedUnits: 4_000,
  appRowPattern: APP,
  pinnedRowPattern: PINNED,
  keepNewestRowPattern: KEEP_NEWEST,
};

/** The policy every open session carried before P1b: a turn-counted tail and no guard. */
export const TURN_POLICY = {
  jobSlug: 'coach-compact',
  triggerTokens: 42_000,
  ceilingTokens: 50_000,
  keepLastNTurns: 20,
  minRemovedUnits: 0,
  appRowPattern: APP,
  pinnedRowPattern: PINNED,
};

export const SIZES = {
  avg: { user: 87, reply: 446, context: 3_100 },
  p90: { user: 181, reply: 893, context: 12_500 },
} as const;

export type Sizes = { user: number; reply: number; context: number };

/** A row maker with its own clock: one second between rows, so marks compare cleanly. */
export function rowFactory(start = Date.parse('2026-10-31T08:00:00Z')) {
  let clock = start;
  let n = 0;
  return (role: string, content: string): ChatMessageRow =>
    ({
      id: `r${++n}`,
      chat_session_id: 's1',
      role,
      content,
      created_at: new Date((clock += 1000)).toISOString(),
      workspace_id: 'w',
    }) as ChatMessageRow;
}

/** An injected block as `injectCoachContext` writes it, padded to `chars`. */
export const block = (source: string, chars: number) =>
  `<context source="${source}" version="1" built_at="2026-10-31T08:00:00.000Z">\n${'x'.repeat(chars)}\n</context>`;

/** Dialogue padded to `chars`, led by a marker a test can find in a transcript (`U12 `, `A12 `). */
export const said = (marker: string, chars: number) =>
  `${marker} ${'w'.repeat(Math.max(0, chars - marker.length - 1))}`;

/** The marker of a dialogue row made by `said`. */
export const markerOf = (m: ChatMessageRow) => m.content.split(' ', 1)[0] ?? '';
