import type { OccurrenceSession } from '@cadence/shared';
import type { UserRoutine } from '../../lib/api/user-routines.ts';

/**
 * Type-first entry (design B) — "What are you building?" Five families, the trail's own category
 * colours (matched from the drawn design, `Cadence Activity Builder.dc.html`), each holding 2
 * **starting points**: complete, already-runnable `OccurrenceSession`s built only from fields the
 * walkthrough player actually plays (see `builderSeeds.test.ts` — every item here is asserted
 * against `inferTool`/`deriveWalkthrough`, never just eyeballed).
 *
 * "Seed, never lock" (TURN 1's second law): picking one drops you straight into the builder with
 * these steps already there, and every number stays editable from the first tap.
 */
export type BuilderFamily = 'strength' | 'cardio' | 'mind' | 'writing' | 'practice';

export interface FamilyDef {
  id: BuilderFamily;
  label: string;
  hint: string;
  /** The family dot's colour — lifted from the design's own swatches, not invented here. */
  color: string;
  area: UserRoutine['area'];
}

export const FAMILIES: FamilyDef[] = [
  {
    id: 'strength',
    label: 'Strength',
    hint: 'sets & reps, circuits, holds',
    color: 'oklch(63% 0.15 68)',
    area: 'movement',
  },
  {
    id: 'cardio',
    label: 'Cardio & intervals',
    hint: 'a run, HIIT, EMOM, Tabata',
    color: 'oklch(58% 0.13 40)',
    area: 'movement',
  },
  { id: 'mind', label: 'Mind', hint: 'a sit, paced breathing, grounding', color: 'oklch(52% 0.09 152)', area: 'mind' },
  {
    id: 'writing',
    label: 'Writing',
    hint: 'journalling, morning pages, a free-write',
    // Writing saves under the 'mind' area (CLAUDE.md has no 'writing' area) — its own family
    // in the picker, folded into an existing bucket for the save.
    color: 'oklch(50% 0.09 300)',
    area: 'mind',
  },
  {
    id: 'practice',
    label: 'Practice',
    hint: 'an instrument, a language, a craft',
    color: 'oklch(50% 0.08 250)',
    area: 'practice',
  },
];

export interface BuilderSeed {
  id: string;
  family: BuilderFamily;
  title: string;
  /** One line under the title — what's in it, plain. */
  summary: string;
  session: OccurrenceSession;
}

function session(blocks: OccurrenceSession['blocks']): OccurrenceSession {
  return { blocks, note: '', generated_at: new Date(0).toISOString(), version: 1 };
}

export const SEEDS: BuilderSeed[] = [
  // ── Strength ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'strength_basics',
    family: 'strength',
    title: 'Full-body basics',
    summary: 'warm-up · 3×8 main lift · stretch',
    session: session([
      {
        label: 'Warm-up',
        items: [{ name: 'Warm-up', tool: 'read', detail: 'A few minutes of easy movement.', duration_min: 3 }],
      },
      { label: 'Main lift', items: [{ name: 'Main lift', tool: 'reps', sets: 3, reps: 8, load: 'bodyweight' }] },
      { label: 'Stretch', items: [{ name: 'Stretch', tool: 'timer', duration_min: 5 }] },
    ]),
  },
  {
    id: 'strength_circuit',
    family: 'strength',
    title: 'Circuit starter',
    summary: 'warm-up · 3-round circuit · cool-down',
    session: session([
      {
        label: 'Warm-up',
        items: [{ name: 'Warm-up', tool: 'read', detail: 'Loosen up before the first round.', duration_min: 2 }],
      },
      {
        label: 'Circuit',
        mode: 'circuit',
        rounds: 3,
        items: [
          { name: 'Push-ups', reps: 12 },
          { name: 'Squats', reps: 15 },
        ],
      },
      { label: 'Cool-down', items: [{ name: 'Cool-down', tool: 'timer', duration_min: 3 }] },
    ]),
  },
  // ── Cardio & intervals ──────────────────────────────────────────────────────────────────────
  {
    id: 'cardio_intervals',
    family: 'cardio',
    title: 'Interval run',
    summary: 'warm-up · 6 × 40/20 · cool-down',
    session: session([
      {
        label: 'Warm-up',
        items: [{ name: 'Warm-up', tool: 'read', detail: 'Easy pace until you feel loose.', duration_min: 3 }],
      },
      {
        label: 'Intervals',
        items: [
          { name: 'Intervals', tool: 'interval', interval_work_sec: 40, interval_recover_sec: 20, interval_rounds: 6 },
        ],
      },
      { label: 'Cool-down', items: [{ name: 'Cool-down', tool: 'timer', duration_min: 3 }] },
    ]),
  },
  {
    id: 'cardio_tabata',
    family: 'cardio',
    title: 'Tabata blast',
    summary: 'warm-up · 8 × 20/10 · cool-down',
    session: session([
      {
        label: 'Warm-up',
        items: [{ name: 'Warm-up', tool: 'read', detail: 'Get the heart rate up gently first.', duration_min: 2 }],
      },
      {
        label: 'Intervals',
        items: [
          { name: 'Intervals', tool: 'interval', interval_work_sec: 20, interval_recover_sec: 10, interval_rounds: 8 },
        ],
      },
      { label: 'Cool-down', items: [{ name: 'Cool-down', tool: 'timer', duration_min: 2 }] },
    ]),
  },
  // ── Mind ────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'mind_breathe_settle',
    family: 'mind',
    title: 'Breathe and settle',
    summary: 'paced breathing · quiet sit',
    session: session([
      {
        label: 'Breathe',
        items: [{ name: 'Breathe', tool: 'breathing', breath_pattern: 'coherent', breath_cycles: 6 }],
      },
      {
        label: 'Quiet sit',
        items: [{ name: 'Quiet sit', tool: 'meditate', duration_min: 10, meditate_bells: 'start_end' }],
      },
    ]),
  },
  {
    id: 'mind_grounding_break',
    family: 'mind',
    title: 'Grounding break',
    summary: 'a noticing game · paced breathing',
    session: session([
      { label: 'Grounding', items: [{ name: 'Grounding', tool: 'grounding', grounding_game: 'senses' }] },
      {
        label: 'Breathe',
        items: [{ name: 'Breathe', tool: 'breathing', breath_pattern: 'extended_exhale', breath_cycles: 6 }],
      },
    ]),
  },
  // ── Writing ─────────────────────────────────────────────────────────────────────────────────
  {
    id: 'writing_morning_pages',
    family: 'writing',
    title: 'Morning pages',
    summary: 'settle in · a timed write',
    session: session([
      {
        label: 'Settle in',
        items: [
          {
            name: 'Settle in',
            tool: 'read',
            detail: 'Find a quiet spot. No editing — just get it down.',
            duration_min: 1,
          },
        ],
      },
      {
        label: 'Morning pages',
        items: [
          {
            name: 'Morning pages',
            tool: 'journal',
            detail: 'Write whatever comes, three pages worth.',
            duration_min: 10,
          },
        ],
      },
    ]),
  },
  {
    id: 'writing_evening_reflection',
    family: 'writing',
    title: 'Evening reflection',
    summary: 'settle in · a free write',
    session: session([
      {
        label: 'Settle in',
        items: [{ name: 'Settle in', tool: 'read', detail: 'A minute to let the day settle.', duration_min: 1 }],
      },
      {
        label: 'Evening reflection',
        items: [
          {
            name: 'Evening reflection',
            tool: 'journal',
            detail: 'What went well today? What is still sitting with you?',
          },
        ],
      },
    ]),
  },
  // ── Practice ────────────────────────────────────────────────────────────────────────────────
  {
    id: 'practice_scales_repertoire',
    family: 'practice',
    title: 'Scales + repertoire',
    summary: 'warm-up · scales ♩ 72 · piece · note',
    session: session([
      {
        label: 'Posture + hands',
        items: [
          {
            name: 'Posture + hands',
            tool: 'read',
            detail: 'Bench height, wrists level, shoulders down.',
            duration_min: 1,
          },
        ],
      },
      {
        label: 'Scales',
        items: [{ name: 'Scales — C, G, D', tool: 'timer', duration_min: 10, metronome_bpm: 72, metronome_meter: 4 }],
      },
      { label: 'Repertoire', items: [{ name: 'Repertoire', tool: 'timer', duration_min: 12 }] },
      {
        label: 'Practice note',
        items: [
          {
            name: 'Practice note',
            tool: 'journal',
            detail: 'What clicked today? What is still stiff?',
            duration_min: 2,
          },
        ],
      },
    ]),
  },
  {
    id: 'practice_study_block',
    family: 'practice',
    title: 'Study block',
    summary: 'settle · 25 min timer · recall write-up',
    session: session([
      {
        label: 'Settle',
        items: [{ name: 'Settle', tool: 'read', detail: 'Close other tabs. One thing at a time.', duration_min: 1 }],
      },
      { label: 'Study', items: [{ name: 'Study', tool: 'timer', duration_min: 25 }] },
      {
        label: 'Recall write-up',
        items: [
          {
            name: 'Recall write-up',
            tool: 'journal',
            detail: 'What do you remember, without looking back?',
            duration_min: 4,
          },
        ],
      },
    ]),
  },
];

export function seedsForFamily(family: BuilderFamily): BuilderSeed[] {
  return SEEDS.filter((s) => s.family === family);
}

export function familyOf(id: BuilderFamily): FamilyDef {
  return FAMILIES.find((f) => f.id === id) ?? (FAMILIES[0] as FamilyDef);
}
