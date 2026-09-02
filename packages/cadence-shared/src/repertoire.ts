/**
 * Repertoire rotation + rendering — pure functions, shared so the API's prescribe path and any
 * future UI agree on what "due next" means.
 *
 * The rule is deliberately boring: among 'known' items, the one resting LONGEST is due, and an
 * item never practiced rests longer than any that has. Boring is the point — a rotation the user
 * can predict ("it cycles") is one they can trust, and the coach may still override it for a
 * stated reason (the tool hands her the facts plus the computed pick; she adjudicates —
 * TOOL-HARNESS.md's inversion, applied here).
 */
import type { RepertoireStatus } from './types/repertoire.ts';
import { type MetronomeSpec, DEFAULT_METER, normalizeMetronome } from './metronome.ts';

/** The slice of an item the rotation and renderers need — repos and tools both satisfy it. */
export interface RepertoireLike {
  label: string;
  status: RepertoireStatus;
  kind?: string | null;
  last_practiced_at?: string | null;
  learned_at?: string | null;
  started_at?: string;
  /** Durable per-item facts. The settled tempo rides here — see `settledTempo`. */
  meta?: Record<string, unknown> | null;
}

/* ── The settled tempo ───────────────────────────────────────────────────────────────────────
   Where the metronome's per-piece tempo lives, and the ONE place its meta keys are spelled. The
   dock used to keep this in localStorage alone, which meant a new phone lost the tempo you had
   settled on and the coach could never see it. `repertoire.meta` was reserved for exactly this
   from the start ("durable per-item facts (composer, book, settled metronome bpm)").

   Keys live here rather than at each call site for the same reason the weigh-in regex does: the
   web writes it, the API reads it, and the prescribe renderer prints it. Three spellings of
   'tempo_bpm' is a bug nobody sees until a tempo silently stops coming back. */
export const TEMPO_BPM_KEY = 'tempo_bpm';
export const TEMPO_METER_KEY = 'tempo_meter';

/** The settled tempo on an item, or undefined when there is none (or it is unusable). */
export function settledTempo(meta: Record<string, unknown> | null | undefined): MetronomeSpec | undefined {
  if (!meta) return undefined;
  const bpm = meta[TEMPO_BPM_KEY];
  const meter = meta[TEMPO_METER_KEY];
  return normalizeMetronome(typeof bpm === 'number' ? bpm : undefined, typeof meter === 'number' ? meter : undefined);
}

/** The meta PATCH recording a settled tempo. Merged into whatever meta already holds, never
 *  replacing it — a composer stored last month must survive tonight's tempo change. */
export function tempoMeta(spec: MetronomeSpec): Record<string, unknown> {
  return { [TEMPO_BPM_KEY]: spec.bpm, [TEMPO_METER_KEY]: spec.meter };
}

const time = (iso?: string | null): number => (iso ? new Date(iso).getTime() : Number.NaN);

/** Longest-rest-first: never-practiced beats practiced; ties break by started_at (oldest first),
 *  then by codepoint label order — locale-independent, so the pick is identical on a dev laptop
 *  and a UTC server rather than dependent on ICU data or row order. */
function byRest(a: RepertoireLike, b: RepertoireLike): number {
  const at = time(a.last_practiced_at);
  const bt = time(b.last_practiced_at);
  const aNever = Number.isNaN(at);
  const bNever = Number.isNaN(bt);
  if (aNever !== bNever) return aNever ? -1 : 1;
  if (!aNever && at !== bt) return at - bt;
  const as = time(a.started_at);
  const bs = time(b.started_at);
  if (!Number.isNaN(as) && !Number.isNaN(bs) && as !== bs) return as - bs;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/** The 'known' item resting longest — null when nothing is in the rotation pool. */
export function pickDueNext(items: RepertoireLike[]): RepertoireLike | null {
  const sorted = [...items.filter((i) => i.status === 'known')].sort(byRest);
  return sorted[0] ?? null;
}

/** "worked today" / "worked 3 days ago" — relative day-counts, never calendar dates: the server
 *  clock is UTC, and a local-looking date would be wrong for anyone west of it by evening. */
const practicedNote = (i: RepertoireLike, now: number): string => {
  const t = time(i.last_practiced_at);
  if (Number.isNaN(t)) return 'not worked yet while on file';
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  return days === 0 ? 'worked today' : days === 1 ? 'worked yesterday' : `worked ${days} days ago`;
};

/** "settled tempo 72 bpm" — the tempo they actually practise this at, so a prescription can meet
 *  them where they are instead of guessing. The meter is named only when it is not the common 4,
 *  where printing it would be noise on every line. */
const tempoNote = (i: RepertoireLike): string | null => {
  const t = settledTempo(i.meta);
  if (!t) return null;
  return t.meter === DEFAULT_METER ? `settled tempo ${t.bpm} bpm` : `settled tempo ${t.bpm} bpm, ${t.meter} to the bar`;
};

/** How many items a group may render before it cuts and says so — a two-year repertoire must not
 *  become a 200-line block in every prescribe prompt and context pack. */
const GROUP_CAP = 15;

/**
 * The compact text both consumers inject — get_repertoire's render and prescribe-session's
 * {{repertoire}} variable. One renderer so the coach in chat and the coach programming a session
 * read the same facts in the same words. Empty string when there is nothing on file. The known
 * group is ordered longest-rest first, so a cut can never drop the DUE NEXT item, and a cut
 * always says how much it dropped (a silent truncation is a quiet lie about completeness).
 * `now` is injectable for tests; callers omit it.
 */
export function renderRepertoire(items: RepertoireLike[], now = Date.now()): string {
  if (!items.length) return '';
  const due = pickDueNext(items);
  const line = (i: RepertoireLike): string => {
    const marks = [
      i.kind,
      practicedNote(i, now),
      tempoNote(i),
      due && i === due ? 'DUE NEXT by rotation' : null,
    ].filter(Boolean);
    return `  - ${i.label} (${marks.join('; ')})`;
  };
  const capped = (group: RepertoireLike[]): string[] => {
    const shown = group.slice(0, GROUP_CAP).map(line);
    if (group.length > GROUP_CAP) shown.push(`  …and ${group.length - GROUP_CAP} more on file`);
    return shown;
  };
  const working = items.filter((i) => i.status === 'working');
  const known = [...items.filter((i) => i.status === 'known')].sort(byRest);
  const parked = items.filter((i) => i.status === 'parked');
  const sections: string[] = [];
  if (working.length) sections.push(`Working on now:\n${capped(working).join('\n')}`);
  if (known.length)
    sections.push(
      `Known — the rotation pool for review and warm material, longest rest first:\n${capped(known).join('\n')}`,
    );
  if (parked.length) sections.push(`Set aside for now: ${parked.map((i) => i.label).join('; ')}`);
  return sections.join('\n');
}
