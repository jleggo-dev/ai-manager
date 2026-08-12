import { useEffect, useState } from 'react';
import { SignUpGate } from '../auth/SignUpGate.tsx';
import { CoachFaceProvider } from '../coach/CoachFaceProvider.tsx';
import type { PlanViewData } from '../../lib/api.ts';

/**
 * `?preview=plancard` (+ `&state=sparse` | `&state=dense`) — the pre-signup plan card against
 * fixtures, without auth or a built plan. The gate is the single highest-stakes screen in the
 * product and sits behind a full onboarding run; this is how its states get LOOKED at.
 *
 * Fixtures mirror the design file's frames: the novel plan (long + short whys, a suggested row),
 * `sparse` (one activity, four days — everything arrives open), `dense` (three goals — headers).
 */
const day = (
  date: string,
  weekday: string,
  dayNum: number,
  occs: { id: string; act: string }[],
): PlanViewData['week'][number] => ({
  date,
  weekday,
  dayNum,
  isToday: false,
  occurrences: occs.map((o) => ({
    occurrence_id: o.id,
    activity_id: o.act,
    title: '',
    kind: 'user' as const,
    status: 'pending' as const,
  })),
});

const NOVEL: PlanViewData = {
  hasPlan: true,
  stage: 'committed',
  version: 1,
  rationale:
    "You want a finished draft, and you can give me five weekday mornings before work. That's enough — comfortably — and here's the shape of it.\n\nA novel is roughly 80,000 words; 500 words a sitting across five mornings is about 10,000 a month, which lands a full draft around March. Mornings make the words. Two evenings study how your genre actually works, because pacing problems are cheaper to fix before you write them. Sunday steers. And I've added one two-minute habit of my own — the cheapest insurance on the whole plan, and you can tell me to drop it.",
  activities: [
    {
      activity_id: 'wr',
      title: 'Writing session',
      kind: 'user',
      cadence: '5 mornings',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      duration_min: 45,
      goal_id: 'g1',
      goal_title: 'Write a novel',
      area: 'practice',
      why: "Five hundred words a sitting is your working-day pace — you told me that, I didn't guess it. Five sittings a week is ten thousand words a month, and that's the whole plan: show up in the morning, and the arithmetic does the rest.",
    },
    {
      activity_id: 'rd',
      title: 'Reading in genre',
      kind: 'user',
      cadence: 'Tue + Thu eve',
      recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH',
      duration_min: 30,
      goal_id: 'g1',
      goal_title: 'Write a novel',
      area: 'practice',
      suggested: true,
      why: "You didn't ask for this one. You're writing a police procedural, so this is study, not leisure — two evenings with recent books in your genre, reading for how chapters end and where clues get planted. You steal structure, not sentences.",
    },
    {
      activity_id: 'rv',
      title: 'Review + revise',
      kind: 'user',
      cadence: 'Sundays',
      recurrence: 'FREQ=WEEKLY;BYDAY=SU',
      duration_min: 40,
      goal_id: 'g1',
      goal_title: 'Write a novel',
      area: 'practice',
      why: "One pass over the week's pages before the new week starts. Not polishing — catching where the story drifted while it's still cheap to steer.",
    },
    {
      activity_id: 'chk',
      title: 'Weekly check-in',
      kind: 'system',
      cadence: 'Sundays',
      recurrence: 'FREQ=WEEKLY;BYDAY=SU',
      duration_min: 5,
    },
  ],
  week: [
    day('2026-08-17', 'Mon', 17, [{ id: 'o1', act: 'wr' }]),
    day('2026-08-18', 'Tue', 18, [
      { id: 'o2', act: 'wr' },
      { id: 'o3', act: 'rd' },
    ]),
    day('2026-08-19', 'Wed', 19, [{ id: 'o4', act: 'wr' }]),
    day('2026-08-20', 'Thu', 20, [
      { id: 'o5', act: 'wr' },
      { id: 'o6', act: 'rd' },
    ]),
    day('2026-08-21', 'Fri', 21, [{ id: 'o7', act: 'wr' }]),
    day('2026-08-22', 'Sat', 22, []),
    day('2026-08-23', 'Sun', 23, [
      { id: 'o8', act: 'rv' },
      { id: 'o9', act: 'chk' },
    ]),
  ],
  consistency: { kept: 0, window: 7 },
};

const SPARSE: PlanViewData = {
  ...NOVEL,
  rationale:
    "One thing, on purpose. You're eight weeks out from a stress fracture, and the plan's whole job right now is \"don't get hurt again\". Four short runs a week rebuilds the habit and the bone at the same rate — anything more this month works against you. We add when your body says so, not the calendar.",
  activities: [
    {
      activity_id: 'run',
      title: 'Easy run',
      kind: 'user',
      cadence: '4 days',
      recurrence: 'FREQ=WEEKLY;BYDAY=TU,TH,SA,SU',
      duration_min: 20,
      goal_id: 'g2',
      goal_title: 'Run again',
      area: 'movement',
      why: 'Twenty minutes keeps every run below the effort where your shin starts arguing. Boring is the point — the interesting version is how you got here.',
    },
  ],
  week: [
    day('2026-08-17', 'Mon', 17, []),
    day('2026-08-18', 'Tue', 18, [{ id: 's1', act: 'run' }]),
    day('2026-08-19', 'Wed', 19, []),
    day('2026-08-20', 'Thu', 20, [{ id: 's2', act: 'run' }]),
    day('2026-08-21', 'Fri', 21, []),
    day('2026-08-22', 'Sat', 22, [{ id: 's3', act: 'run' }]),
    day('2026-08-23', 'Sun', 23, [{ id: 's4', act: 'run' }]),
  ],
};

const DENSE: PlanViewData = {
  ...NOVEL,
  rationale:
    'Two goals and a steadier head all fit in one week, but only if neither is greedy — three writing mornings, not five, because the run owns the others. Here is how the pieces share it.',
  week: [
    day('2026-08-17', 'Mon', 17, [{ id: 'd1', act: 'wr3' }]),
    day('2026-08-18', 'Tue', 18, [
      { id: 'd2', act: 'int' },
      { id: 'd3', act: 'hip' },
      { id: 'd4', act: 'br' },
    ]),
    day('2026-08-19', 'Wed', 19, [{ id: 'd5', act: 'wr3' }]),
    day('2026-08-20', 'Thu', 20, []),
    day('2026-08-21', 'Fri', 21, [{ id: 'd6', act: 'wr3' }]),
    day('2026-08-22', 'Sat', 22, [
      { id: 'd7', act: 'long' },
      { id: 'd8', act: 'hip' },
      { id: 'd9', act: 'br' },
    ]),
    day('2026-08-23', 'Sun', 23, [{ id: 'd10', act: 'chk' }]),
  ],
  activities: [
    {
      activity_id: 'int',
      title: 'Intervals',
      kind: 'user',
      cadence: 'Tue am',
      recurrence: 'FREQ=WEEKLY;BYDAY=TU',
      duration_min: 30,
      goal_id: 'g10',
      goal_title: 'Your 10k',
      area: 'movement',
      why: 'Speed is the missing piece between you and a 62-minute 10k — one hard day a week is enough to move it.',
    },
    {
      activity_id: 'long',
      title: 'Long run',
      kind: 'user',
      cadence: 'Sat am',
      recurrence: 'FREQ=WEEKLY;BYDAY=SA',
      duration_min: 70,
      goal_id: 'g10',
      goal_title: 'Your 10k',
      area: 'movement',
      why: "The distance itself. It grows ten percent a week and never faster — that's the knee rule, not a slogan.",
    },
    {
      activity_id: 'hip',
      title: 'Hip mobility',
      kind: 'user',
      cadence: 'after runs',
      recurrence: 'FREQ=WEEKLY;BYDAY=TU,SA',
      duration_min: 3,
      goal_id: 'g10',
      goal_title: 'Your 10k',
      area: 'movement',
      suggested: true,
      why: "You didn't ask for this one. Your knee history points at hips, and three minutes while you're already warm is the cheapest fix I know.",
    },
    {
      activity_id: 'br',
      title: 'Breath after runs',
      kind: 'user',
      cadence: 'Tue + Sat',
      recurrence: 'FREQ=WEEKLY;BYDAY=TU,SA',
      duration_min: 5,
      goal_id: 'g11',
      goal_title: 'A steadier mind',
      area: 'mind',
      why: 'Glued to the run on purpose — a habit stacked on an existing one survives about twice as long as one asked to stand alone.',
    },
    {
      activity_id: 'wr3',
      title: 'Writing session',
      kind: 'user',
      cadence: '3 mornings',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      duration_min: 30,
      goal_id: 'g12',
      goal_title: 'Your pages',
      area: 'practice',
      why: 'Three mornings, not five — the run owns the others. Both goals fit in one week, but only if neither is greedy.',
    },
    {
      activity_id: 'chk',
      title: 'Weekly check-in',
      kind: 'system',
      cadence: 'Sundays',
      recurrence: 'FREQ=WEEKLY;BYDAY=SU',
      duration_min: 10,
    },
  ],
};

export function PlanCardPreview() {
  const [ready, setReady] = useState(false);
  const state = new URLSearchParams(window.location.search).get('state') ?? 'novel';
  const fixture = state === 'sparse' ? SPARSE : state === 'dense' ? DENSE : NOVEL;

  useEffect(() => {
    const orig = window.fetch;
    window.fetch = (async (u: RequestInfo | URL, o?: RequestInit) => {
      if (String(u).includes('/plan')) return new Response(JSON.stringify(fixture), { status: 200 });
      return orig(u, o);
    }) as typeof window.fetch;
    setReady(true);
    return () => {
      window.fetch = orig;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return null;
  return (
    <CoachFaceProvider>
      <SignUpGate />
    </CoachFaceProvider>
  );
}
