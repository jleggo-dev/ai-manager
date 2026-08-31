import { describe, it, expect } from 'vitest';
import {
  buildWatchWeek,
  watchSessionKind,
  watchSubtitle,
  WATCH_DETAIL_DAYS,
  WATCH_MAX_BLOCKS,
  WATCH_MAX_DAYS,
  WATCH_MAX_ITEMS_PER_BLOCK,
  WATCH_MAX_NAME_CHARS,
  WATCH_MAX_PAYLOAD_BYTES,
  WATCH_MAX_SESSIONS_PER_DAY,
  WATCH_PAYLOAD_VERSION,
  type WatchBlockSpec,
  type WatchDaySpec,
  type WatchExerciseSpec,
  type WatchIntervalSpec,
  type WatchOccurrenceInput,
  type WatchSessionSpec,
} from './watch-week.ts';
import { intervalTotalSeconds, singleSetPlan } from './interval.ts';
import type { OccurrenceSession, SessionItem } from './types/occurrence.ts';

const TODAY = '2026-09-07';
const STAMP = '2026-09-07T08:00:00.000Z';

function session(items: SessionItem[], label = 'Main'): OccurrenceSession {
  return { blocks: [{ label, items }], note: '', generated_at: STAMP, version: 1 };
}

function occ(over: Partial<WatchOccurrenceInput> = {}): WatchOccurrenceInput {
  return {
    occurrence_id: 'o1',
    title: 'Strength — lower',
    date: TODAY,
    status: 'pending',
    ...over,
  };
}

function build(occurrences: WatchOccurrenceInput[], todayISO = TODAY) {
  return buildWatchWeek({ todayISO, occurrences, generatedAt: STAMP });
}

/** A week at every cap at once — more than any real plan, which is the point: the bounds have to
 *  hold where nobody has ever been rather than only where everybody is. */
function pathologicalWeek(): WatchOccurrenceInput[] {
  const items = Array.from({ length: WATCH_MAX_ITEMS_PER_BLOCK }, (_, i) => ({
    name: `Bulgarian split squat variation ${i}`,
    sets: 4,
    reps: 12,
    load: '37.5 kg',
  }));
  const big: OccurrenceSession = {
    blocks: Array.from({ length: WATCH_MAX_BLOCKS }, (_, i) => ({ label: `Block ${i}`, items })),
    note: 'x'.repeat(2000),
    generated_at: STAMP,
    version: 1,
  };
  return Array.from({ length: WATCH_MAX_DAYS * WATCH_MAX_SESSIONS_PER_DAY }, (_, i) => {
    const day = String(7 + Math.floor(i / WATCH_MAX_SESSIONS_PER_DAY)).padStart(2, '0');
    return occ({ occurrence_id: `o${i}`, date: `2026-09-${day}`, session: big });
  });
}

/** Every session on the returned payload, flattened — most assertions want the sessions, not days. */
function sessionsOf(payload: ReturnType<typeof build>) {
  return payload.days.flatMap((d) => d.sessions);
}

/**
 * Presence-asserting accessors.
 *
 * `noUncheckedIndexedAccess` is on, and the alternative — optional chaining through every
 * assertion — would let a MISSING row pass as `undefined === undefined`. Throwing names the
 * missing thing instead, so a projection that returns nothing fails loudly rather than green.
 */
function sessionAt(payload: ReturnType<typeof build>, index = 0): WatchSessionSpec {
  const row = sessionsOf(payload)[index];
  if (!row) throw new Error(`expected a session at index ${index}`);
  return row;
}

function dayAt(payload: ReturnType<typeof build>, index: number): WatchDaySpec {
  const day = payload.days[index];
  if (!day) throw new Error(`expected a day at index ${index}`);
  return day;
}

function blocksOf(row: WatchSessionSpec): WatchBlockSpec[] {
  if (!row.blocks?.length) throw new Error(`expected blocks on ${row.title}`);
  return row.blocks;
}

function firstItem(row: WatchSessionSpec): WatchExerciseSpec {
  const item = blocksOf(row)[0]?.items[0];
  if (!item) throw new Error(`expected an item on ${row.title}`);
  return item;
}

function intervalOf(row: WatchSessionSpec): WatchIntervalSpec {
  if (!row.interval) throw new Error(`expected an interval on ${row.title}`);
  return row.interval;
}

describe('watchSessionKind', () => {
  it('reads an interval from the numbers even when the tool tag is missing', () => {
    const s = session([{ name: 'HIIT', interval_work_sec: 40, interval_recover_sec: 20, interval_rounds: 6 }]);
    expect(watchSessionKind('Morning intervals', s)).toBe('interval');
  });

  it('prefers the interval face over the hand-off when a run is prescribed as rounds', () => {
    // Hill repeats: the title says "run" but the prescription is an interval, and the interval
    // is the thing our player can actually run.
    const s = session([{ name: 'Hill repeats', tool: 'interval', interval_work_sec: 45, interval_rounds: 8 }]);
    expect(watchSessionKind('Hill run', s)).toBe('interval');
  });

  it('calls an all-mind session a sit', () => {
    const s = session([{ name: 'Sit', tool: 'meditate', duration_min: 10 }]);
    expect(watchSessionKind('Morning sit', s)).toBe('sit');
  });

  it('keeps a walking meditation on the sit face, not the hand-off', () => {
    const s = session([{ name: 'Walking meditation', tool: 'meditate', duration_min: 15 }]);
    expect(watchSessionKind('Walking meditation', s)).toBe('sit');
  });

  it('tracks anything prescribed by distance', () => {
    const s = session([{ name: 'Easy effort', distance_km: 5 }]);
    expect(watchSessionKind('Long one', s)).toBe('tracked');
  });

  it('tracks on the title alone when there is no prescription yet', () => {
    expect(watchSessionKind('Evening run', null)).toBe('tracked');
    expect(watchSessionKind('Swim', undefined)).toBe('tracked');
    expect(watchSessionKind('Morning ride', undefined)).toBe('tracked');
  });

  it('does not mistake a word that merely contains a hand-off word', () => {
    // "row" inside "throwing" would hand a strength session to Apple's Workout app.
    expect(watchSessionKind('Throwing drills', session([{ name: 'Med ball throws' }]))).toBe('strength');
  });

  it('falls back to strength for a session with no prescription and no hand-off word', () => {
    expect(watchSessionKind('Strength — lower', null)).toBe('strength');
  });

  it('does not call a mixed mind/physical session a sit', () => {
    const s = session([
      { name: 'Box breathing', tool: 'breathing' },
      { name: 'Goblet squats', sets: 3, reps: 8 },
    ]);
    expect(watchSessionKind('Mixed', s)).toBe('strength');
  });
});

describe('buildWatchWeek — detail depth', () => {
  it("carries today's prescription in full", () => {
    const s = session([{ name: 'Goblet squats', sets: 3, reps: 8, load: '24 kg' }]);
    const row = sessionAt(build([occ({ session: s })]));
    expect(row.detailed).toBe(true);
    expect(row.blocks).toEqual([
      { label: 'Main', items: [{ name: 'Goblet squats', sets: 3, reps: 8, load: '24 kg' }] },
    ]);
  });

  it('leaves a far day as a row: classified, named, but not playable', () => {
    const s = session([{ name: 'Goblet squats', sets: 3, reps: 8 }]);
    const payload = build([occ({ date: '2026-09-11', session: s })]);
    const row = sessionAt(payload);
    expect(row.blocks).toBeUndefined();
    expect(row.detailed).toBe(false);
    // Classification still happened — the row knows what it is, it just cannot be started.
    expect(row.kind).toBe('strength');
    expect(row.title).toBe('Strength — lower');
  });

  it("carries a composed workout so Apple's app can be offered as an alternative", () => {
    const s = session([{ name: 'Easy effort', distance_km: 5 }]);
    const row = sessionAt(build([occ({ title: 'Long run', session: s })]));
    expect(row.kind).toBe('tracked');
    expect(row.workout?.body).toEqual({ type: 'goal', goal: { kind: 'distance', km: 5 } });
    expect(row.workout?.activity).toBe('running');
  });

  it('keeps a tracked session startable even with nothing composed', () => {
    // Our own live session measures, it does not follow a script — so it needs the occurrence id
    // and nothing else. A far day, or a prescription Apple cannot represent, both still start.
    const far = sessionAt(build([occ({ date: '2026-09-11', title: 'Long run', session: null })]));
    expect(far.kind).toBe('tracked');
    expect(far.detailed).toBe(true);
    expect(far.workout).toBeUndefined();

    const vague = sessionAt(build([occ({ title: 'Long run', session: session([{ name: 'Run' }]) })]));
    expect(vague.detailed).toBe(true);
    expect(vague.workout).toBeUndefined();
  });

  it('sends a tracked session as a composed workout, never as blocks', () => {
    const s = session([{ name: 'Easy effort', distance_km: 5 }]);
    const row = sessionAt(build([occ({ title: 'Long run', session: s })]));
    expect(row.blocks).toBeUndefined();
  });

  it('details exactly WATCH_DETAIL_DAYS days forward', () => {
    const s = session([{ name: 'Goblet squats', sets: 3, reps: 8 }]);
    const dates = ['2026-09-07', '2026-09-08', '2026-09-09'];
    const payload = build(dates.map((date, i) => occ({ occurrence_id: `o${i}`, date, session: s })));
    expect(sessionsOf(payload).map((r) => r.detailed)).toEqual([true, true, false]);
    expect(WATCH_DETAIL_DAYS).toBe(2);
  });

  it('never details a past day — nothing on a wrist can act on it', () => {
    const s = session([{ name: 'Goblet squats', sets: 3, reps: 8 }]);
    const payload = build([
      occ({ occurrence_id: 'past', date: '2026-09-06', status: 'done', session: s }),
      occ({ occurrence_id: 'now', date: TODAY, session: s }),
    ]);
    const past = sessionsOf(payload).find((r) => r.occurrenceId === 'past');
    expect(past?.blocks).toBeUndefined();
    expect(past?.detailed).toBe(false);
    expect(past?.subtitle).toBe('done');
  });
});

describe('buildWatchWeek — the interval prescription', () => {
  it('carries the clamped five and agrees with the phone player on the clock', () => {
    const s = session([
      { name: 'HIIT', tool: 'interval', interval_work_sec: 40, interval_recover_sec: 20, interval_rounds: 6 },
    ]);
    const row = sessionAt(build([occ({ title: 'Morning intervals', session: s })]));
    expect(row.interval).toEqual({ warmupSec: 0, workSec: 40, recoverSec: 20, rounds: 6, cooldownSec: 0 });
    // The load-bearing property: what the wrist counts is what the phone counted.
    const seconds = intervalTotalSeconds(singleSetPlan({ workSec: 40, recoverSec: 20, rounds: 6 }));
    expect(row.minutes).toBe(Math.round(seconds / 60));
  });

  it('clamps coach output rather than passing it through', () => {
    const s = session([
      { name: 'Absurd', tool: 'interval', interval_work_sec: 9_999, interval_rounds: 999, interval_recover_sec: -5 },
    ]);
    const row = sessionAt(build([occ({ session: s })]));
    const interval = intervalOf(row);
    expect(interval.workSec).toBeLessThanOrEqual(600);
    expect(interval.rounds).toBeLessThanOrEqual(20);
    expect(interval.recoverSec).toBeGreaterThanOrEqual(0);
  });

  it('sends an interval session as the five, not as blocks', () => {
    const s = session([{ name: 'HIIT', tool: 'interval', interval_work_sec: 40, interval_rounds: 6 }]);
    const row = sessionAt(build([occ({ session: s })]));
    expect(row.interval).toBeDefined();
    expect(row.blocks).toBeUndefined();
  });
});

describe('buildWatchWeek — minutes', () => {
  it('sums the items own durations', () => {
    const s = session([
      { name: 'Warm-up', duration_min: 5 },
      { name: 'Main', duration_min: 20 },
    ]);
    expect(sessionAt(build([occ({ session: s })])).minutes).toBe(25);
  });

  it("falls back to the commitment's duration when the prescription has no clock", () => {
    const s = session([{ name: 'Goblet squats', sets: 3, reps: 8 }]);
    expect(sessionAt(build([occ({ session: s, duration_min: 26 })])).minutes).toBe(26);
  });

  it('answers zero rather than inventing a number', () => {
    const s = session([{ name: 'Goblet squats', sets: 3, reps: 8 }]);
    const row = sessionAt(build([occ({ session: s })]));
    expect(row.minutes).toBe(0);
    expect(row.subtitle).not.toContain('min');
  });
});

describe('watchSubtitle — count what happened', () => {
  it('says what a session is, never what is left', () => {
    expect(
      watchSubtitle({
        kind: 'interval',
        minutes: 14,
        status: 'pending',
        interval: { warmupSec: 0, workSec: 40, recoverSec: 20, rounds: 6, cooldownSec: 0 },
      }),
    ).toBe('14 min · 6 rounds');
  });

  it('singularises a single round', () => {
    expect(
      watchSubtitle({
        kind: 'interval',
        minutes: 1,
        status: 'pending',
        interval: { warmupSec: 0, workSec: 40, recoverSec: 20, rounds: 1, cooldownSec: 0 },
      }),
    ).toBe('1 min · 1 round');
  });

  it('says what a tracked session is, without naming another app', () => {
    // It used to read "opens Workout". We run these ourselves now, so the row says the session.
    expect(watchSubtitle({ kind: 'tracked', minutes: 30, status: 'pending' })).toBe('30 min');
    expect(watchSubtitle({ kind: 'tracked', minutes: 0, status: 'pending' })).toBe('track it');
  });

  it('counts the things in a strength session', () => {
    const blocks = [{ label: 'Main', items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }];
    expect(watchSubtitle({ kind: 'strength', minutes: 26, status: 'pending', blocks })).toBe('26 min · 3 things');
  });

  it('reports an outcome for a finished session and never a score', () => {
    expect(watchSubtitle({ kind: 'strength', minutes: 26, status: 'done' })).toBe('done');
    expect(watchSubtitle({ kind: 'strength', minutes: 26, status: 'skipped' })).toBe('skipped');
  });

  it('never carries a banned word', () => {
    const rendered = [
      watchSubtitle({ kind: 'strength', minutes: 26, status: 'done' }),
      watchSubtitle({ kind: 'tracked', minutes: 30, status: 'pending' }),
      watchSubtitle({ kind: 'strength', minutes: 0, status: 'pending' }),
    ].join(' ');
    for (const banned of ['captured', 'streak', 'journey', 'unlock', 'empower', 'left', 'remaining']) {
      expect(rendered.toLowerCase()).not.toContain(banned);
    }
  });
});

describe('buildWatchWeek — the week itself', () => {
  it('stamps the version so a watch can refuse a payload it does not know', () => {
    const payload = build([occ()]);
    expect(payload.version).toBe(WATCH_PAYLOAD_VERSION);
    expect(payload.generatedAt).toBe(STAMP);
  });

  it('keeps empty days so the rest-day face lands on the right heading', () => {
    const payload = build([
      occ({ occurrence_id: 'a', date: '2026-09-07' }),
      occ({ occurrence_id: 'b', date: '2026-09-09' }),
    ]);
    expect(payload.days.map((d) => d.date)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
    expect(dayAt(payload, 1).sessions).toEqual([]);
  });

  it('marks today, and only today', () => {
    const payload = build([occ({ date: '2026-09-07' }), occ({ occurrence_id: 'b', date: '2026-09-08' })]);
    expect(payload.days.filter((d) => d.isToday).map((d) => d.date)).toEqual([TODAY]);
  });

  it('names the weekday from the calendar date, not from an instant', () => {
    // 2026-09-07 is a Monday. Parsed as an instant and formatted west of Greenwich this reads
    // Sunday — the off-by-one that puts a session on the wrong row.
    const payload = build([occ({ date: '2026-09-07' })]);
    expect(dayAt(payload, 0).weekday).toBe('Monday');
  });

  it('sorts days in date order regardless of input order', () => {
    const payload = build([
      occ({ occurrence_id: 'c', date: '2026-09-09' }),
      occ({ occurrence_id: 'a', date: '2026-09-07' }),
      occ({ occurrence_id: 'b', date: '2026-09-08' }),
    ]);
    expect(payload.days.map((d) => d.date)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09']);
  });

  it('drops occurrences outside the window rather than growing the payload', () => {
    const payload = build([occ({ date: '2026-10-30' }), occ({ occurrence_id: 'b', date: '2026-01-01' })]);
    expect(payload.days).toEqual([]);
  });

  it('never returns more than WATCH_MAX_DAYS days', () => {
    const occurrences = Array.from({ length: 20 }, (_, i) => {
      const day = String(7 + i).padStart(2, '0');
      return occ({ occurrence_id: `o${i}`, date: `2026-09-${day}` });
    });
    expect(build(occurrences).days.length).toBeLessThanOrEqual(WATCH_MAX_DAYS);
  });

  it('bounds sessions per day, blocks and items — the transport has a ceiling', () => {
    const manyItems = Array.from({ length: 40 }, (_, i) => ({ name: `Item ${i}` }));
    const manyBlocks: OccurrenceSession = {
      blocks: Array.from({ length: 20 }, (_, i) => ({ label: `Block ${i}`, items: manyItems })),
      note: '',
      generated_at: STAMP,
      version: 1,
    };
    const occurrences = Array.from({ length: 30 }, (_, i) => occ({ occurrence_id: `o${i}`, session: manyBlocks }));
    const payload = build(occurrences);
    const day = dayAt(payload, 0);
    expect(day.sessions.length).toBe(WATCH_MAX_SESSIONS_PER_DAY);
    const first = sessionAt(payload, 0);
    expect(blocksOf(first).length).toBe(WATCH_MAX_BLOCKS);
    expect(blocksOf(first)[0]?.items.length).toBe(WATCH_MAX_ITEMS_PER_BLOCK);
  });

  it('holds the byte ceiling at full bound — the transport refuses a payload, not a field', () => {
    // WCSession.updateApplicationContext throws past its payload limit and then delivers NOTHING,
    // so a pathological week has to lose detail rather than lose the sync.
    const bytes = JSON.stringify(build(pathologicalWeek())).length;
    expect(bytes).toBeLessThanOrEqual(WATCH_MAX_PAYLOAD_BYTES);
  });

  it('sheds detail from the far end first, and never sheds a row', () => {
    const payload = build(pathologicalWeek());
    // The week's shape survives whole — every day still present, every session still listed.
    expect(payload.days.length).toBe(WATCH_MAX_DAYS);
    for (const day of payload.days) expect(day.sessions.length).toBe(WATCH_MAX_SESSIONS_PER_DAY);
    // Today's first session keeps its prescription; tomorrow's tail is what paid.
    expect(dayAt(payload, 0).sessions[0]?.blocks).toBeDefined();
    expect(dayAt(payload, 1).sessions.at(-1)?.blocks).toBeUndefined();
  });

  it('tells the truth after shedding — a bare row never claims to be startable', () => {
    for (const day of build(pathologicalWeek()).days) {
      for (const row of day.sessions) {
        if (row.kind === 'tracked') continue; // measured, not scripted — it needs only its id
        if (!row.blocks && !row.interval) {
          expect(row.detailed).toBe(false);
          expect(row.subtitle).not.toContain('things');
        }
      }
    }
  });

  it('drops the coach note and the per-item cues — nothing on the wrist reads them', () => {
    const s: OccurrenceSession = {
      blocks: [
        {
          label: 'Main',
          items: [
            {
              name: 'Goblet squats',
              sets: 3,
              reps: 8,
              detail: 'chest up, slow on the way down',
              video_query: 'goblet squat form',
            },
          ],
        },
      ],
      note: 'Progression rationale the phone shows and the wrist never will',
      generated_at: STAMP,
      version: 1,
    };
    const json = JSON.stringify(build([occ({ session: s })]));
    expect(json).not.toContain('chest up');
    expect(json).not.toContain('video_query');
    expect(json).not.toContain('Progression rationale');
  });

  it('truncates a name too long for a 41mm screen', () => {
    const long = 'Single-arm half-kneeling bottoms-up kettlebell press with a pause';
    const s = session([{ name: long, sets: 3, reps: 8 }]);
    const row = sessionAt(build([occ({ session: s })]));
    const name = firstItem(row).name;
    expect(name.length).toBeLessThanOrEqual(WATCH_MAX_NAME_CHARS);
    expect(name.endsWith('…')).toBe(true);
  });

  it("drops the app's own tracking rows — nothing on a wrist opens a food log", () => {
    const payload = build([
      occ({ occurrence_id: 'food', title: 'Food log', kind: 'system' }),
      occ({ occurrence_id: 'weigh', title: 'Weigh-in', kind: 'system' }),
      occ({ occurrence_id: 'real', title: 'Strength — lower', kind: 'user' }),
    ]);
    expect(sessionsOf(payload).map((r) => r.occurrenceId)).toEqual(['real']);
  });

  it('keeps an occurrence whose kind is unknown — better shown than hidden', () => {
    const payload = build([occ({ occurrence_id: 'unknown' })]);
    expect(sessionsOf(payload).map((r) => r.occurrenceId)).toEqual(['unknown']);
  });

  it('survives a malformed occurrence instead of failing the whole sync', () => {
    const payload = build([
      { occurrence_id: '', title: 'No id', date: TODAY, status: 'pending' },
      occ({ occurrence_id: 'good' }),
    ]);
    expect(sessionsOf(payload).map((r) => r.occurrenceId)).toEqual(['good']);
  });

  it('answers an empty week with an empty payload, not a throw', () => {
    expect(build([])).toEqual({ version: WATCH_PAYLOAD_VERSION, generatedAt: STAMP, days: [] });
  });

  it('omits absent quantities rather than sending zeros', () => {
    const s = session([{ name: 'Plank', duration_min: 1 }]);
    const item = firstItem(sessionAt(build([occ({ session: s })])));
    expect(item).toEqual({ name: 'Plank', durationSec: 60 });
    expect('sets' in item).toBe(false);
    expect('reps' in item).toBe(false);
  });

  it('drops a block whose items all vanished rather than sending an empty heading', () => {
    const s: OccurrenceSession = {
      blocks: [
        { label: 'Empty', items: [] },
        { label: 'Main', items: [{ name: 'Goblet squats', sets: 3, reps: 8 }] },
      ],
      note: '',
      generated_at: STAMP,
      version: 1,
    };
    const row = sessionAt(build([occ({ session: s })]));
    expect(row.blocks?.map((b) => b.label)).toEqual(['Main']);
  });
});

describe('the activity a tracked session carries', () => {
  it('names the activity on every session, composed workout or not', () => {
    // Read by the watch's live tracker to configure HKWorkoutSession. Taking it off the composed
    // spec instead would file an unprescribed "Evening run" in Health as an unnamed workout with
    // no route — the exact defect the wider vocabulary was built to fix.
    const bare = sessionAt(build([occ({ title: 'Evening run', session: null })]));
    expect(bare.workout).toBeUndefined();
    expect(bare.activity).toBe('running');
    expect(bare.location).toBe('outdoor');
  });

  it('carries it for guided sessions too', () => {
    const row = sessionAt(
      build([occ({ title: 'Strength — lower', session: session([{ name: 'Goblet squats', sets: 3, reps: 8 }]) })]),
    );
    expect(row.activity).toBe('traditionalStrengthTraining');
    // "Usually indoors" is not knowledge — the session, not the sport, decides.
    expect(row.location).toBe('unknown');
  });

  it('marks an indoor machine as indoor, so no route is recorded for it', () => {
    const row = sessionAt(build([occ({ title: 'Elliptical intervals', session: null })]));
    expect(row.location).toBe('indoor');
  });
});
