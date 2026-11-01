/**
 * The smoke subset of the tool-selection eval, and the floor it is held to (HARNESS-V3 C5.2).
 *
 * WHAT IT IS FOR. A full `eval:tools` run is every case, ~25 minutes and ~1.7M prompt tokens. That
 * is the right instrument for a before/after pair on a harness change, and the wrong one for "did
 * the model we just pointed the coach at break her tools?". The smoke subset answers the second
 * question for about a fifth of the cost, and `repoint-profile.ts --verify` runs it on every model
 * change (C5.3).
 *
 * HOW THE CASES WERE CHOSEN. Widest spread for the fewest turns: both instrument checks, always-on
 * and on-demand actions, on-demand reads, restraint cases, at least one argument check per kind,
 * and the near-miss pairs where one sentence decides between two tools. Cases the model on file
 * already missed in the last full run (2026-09-15: A13, A16, A20–A23, A27–A29) are left out on
 * purpose: a case today's model already fails cannot tell a worse model apart from this one, and
 * it pulls the smoke F1 under the full-run F1 it is compared with. Run the full set for those.
 *
 * THE FLOOR. Proposed in C5.2: the last full run's F1 minus 5 points, which leaves room for the ±3
 * points two runs of the same code differ by. Read from `eval-tool-selection.baseline.json`. When
 * that file also holds a `smokeF1` (a smoke run on a pointer the owner trusts), the floor is that
 * minus 5 instead — a smoke F1 compared with a smoke F1. With neither number on file there is no
 * default and `--floor` must be given.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Thirteen cases, about a fifth of the full set. Each line says what the case covers that the
 * others do not. Pairs are noted: the two halves of a pair differ by one phrase and must land on
 * different tools.
 */
export const SMOKE_IDS = [
  // Instrument check: the plainest always-on action. `graderVerdict` names this case.
  'CAN-POS',
  // Instrument check the other way: a turn that needs no tool at all.
  'CAN-NEG',
  // Always-on `update_goal`, with an argument check (retarget). Pair: C7.
  'A5',
  // Always-on `log_session` on the verbatim 2026-08-15 turn; forbids the food tools. Pair: C2.
  'A7',
  // Always-on `log_meal`, with an argument check (the food named). Pair: B9.
  'A15',
  // On-demand action `shape_week` (pause), reached through find_tools; argument check. Pair: A26.
  'A25',
  // On-demand action `edit_calendar` (delete one day); forbids the pause and the plan tools.
  'A26',
  // On-demand read `get_nutrition` with its `view` argument (recipes), the facade tiebreak.
  'B2',
  // On-demand read `preview_meal`; forbids `log_meal` — price it, do not write it down.
  'B9',
  // On-demand read `get_calendar`; forbids `shape_week` — look at a week, do not build it.
  'B13',
  // Restraint, verbatim incident: "i had to skip it" once logged a meal. Forbids the food tools.
  'C2',
  // Restraint, an owner ruling: never change a goal on her own reading that it looks too hard.
  'C7',
  // Restraint: tomorrow is already in front of her. Forbids the calendar read and every write.
  'C21',
] as const;

/** Points under the reference F1 a run may score before the floor fails it (C5.2, R5 unruled). */
export const FLOOR_MARGIN = 5;

/**
 * Per-turn token estimate for `--dry`. Prompt: the 2026-09-15 full run took 1.64M prompt tokens
 * over 66 turns (median 24,737 a turn, TOOL-HARNESS.md); 25,000 rounds that up for what has been
 * added since. Completion: ~1,300 a turn, measured on the first runs (2026-08-16).
 */
export const PROMPT_TOKENS_PER_TURN = 25_000;
export const COMPLETION_TOKENS_PER_TURN = 1_300;

export const BASELINE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'eval-tool-selection.baseline.json',
);

/** The committed reference numbers. F1 values are percentage points (82.9 means 82.9%). */
export interface EvalBaseline {
  fullRunF1: number | null;
  measuredAt: string | null;
  commit: string | null;
  cases: number | null;
  model?: string | null;
  source?: string | null;
  smokeF1?: number | null;
  smokeMeasuredAt?: string | null;
}

export function readBaseline(file = BASELINE_PATH): EvalBaseline {
  return JSON.parse(readFileSync(file, 'utf8')) as EvalBaseline;
}

/** The default floor for a smoke run, and a sentence saying where it came from. */
export function smokeFloor(b: EvalBaseline): { floor: number; from: string } | null {
  if (typeof b.smokeF1 === 'number') {
    return {
      floor: round1(b.smokeF1 - FLOOR_MARGIN),
      from: `smoke run ${b.smokeF1} on ${b.smokeMeasuredAt ?? '(date not recorded)'} minus ${FLOOR_MARGIN}`,
    };
  }
  if (typeof b.fullRunF1 === 'number') {
    return {
      floor: round1(b.fullRunF1 - FLOOR_MARGIN),
      from: `full run ${b.fullRunF1} on ${b.measuredAt ?? '(date not recorded)'} (${b.cases ?? '?'} cases, ${b.model ?? 'model not recorded'}) minus ${FLOOR_MARGIN}`,
    };
  }
  return null;
}

/**
 * `--floor` takes percentage points, the unit the report prints. A value of 1 or less is almost
 * certainly a fraction (0.8 meant as 80%), and taking it literally would pass every run, so it is
 * refused rather than guessed at.
 */
export function parseFloor(raw: string): { floor: number } | { error: string } {
  const n = Number(raw);
  if (!raw.trim() || !Number.isFinite(n)) return { error: `--floor needs a number, got "${raw}"` };
  if (n <= 1) return { error: `--floor is in percentage points (e.g. 77.9), got ${raw} — did you mean ${n * 100}?` };
  if (n > 100) return { error: `--floor is a percentage, got ${raw}` };
  return { floor: n };
}

/** Pass when F1 (percentage points) is at or above the floor; the gap is how far under it is. */
export function floorVerdict(f1: number, floor: number): { pass: boolean; gap: number } {
  return { pass: f1 >= floor, gap: round1(Math.max(0, floor - f1)) };
}

export function tokenEstimate(cases: number): { prompt: number; completion: number } {
  return { prompt: cases * PROMPT_TOKENS_PER_TURN, completion: cases * COMPLETION_TOKENS_PER_TURN };
}

const fmt = (n: number): string => n.toLocaleString('en-US');

/** `--dry`'s cost line: this selection, and the full set beside it so the ratio is visible. */
export function printEstimate(n: number, total: number): void {
  const sel = tokenEstimate(n);
  const all = tokenEstimate(total);
  console.log(
    `\nEstimated cost: ${n} turn(s) × ~${fmt(PROMPT_TOKENS_PER_TURN)} ≈ ${fmt(sel.prompt)} prompt + ` +
      `${fmt(sel.completion)} completion tokens.`,
  );
  if (n !== total) {
    console.log(
      `The full set is ${total} cases ≈ ${fmt(all.prompt)} prompt tokens; this selection is ` +
        `${((n / total) * 100).toFixed(0)}% of it.`,
    );
  }
}

/** Prints the floor verdict; false when the run is under it or produced no F1 at all. */
export function reportFloor(f1: number | null, floor: { floor: number; from: string }, smoke: boolean): boolean {
  console.log('\n══ FLOOR ══');
  if (f1 === null) {
    console.log(`  no F1 — the grader halted the run, so it cannot meet the floor of ${floor.floor}% (${floor.from})`);
    return false;
  }
  const v = floorVerdict(f1, floor.floor);
  console.log(
    v.pass
      ? `  ✓ F1 ${f1.toFixed(1)}% is at or above the floor of ${floor.floor}% (${floor.from})`
      : `  ✗ F1 ${f1.toFixed(1)}% is ${v.gap} points UNDER the floor of ${floor.floor}% (${floor.from})`,
  );
  if (smoke) {
    console.log('  If the model that answered is one you trust, record this F1 as "smokeF1" (and the date as');
    console.log('  "smokeMeasuredAt") in eval-tool-selection.baseline.json: a smoke run is then held to a smoke run.');
  }
  return v.pass;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
