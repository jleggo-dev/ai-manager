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

/** The slice of an item the rotation and renderers need — repos and tools both satisfy it. */
export interface RepertoireLike {
  label: string;
  status: RepertoireStatus;
  kind?: string | null;
  last_practiced_at?: string | null;
  learned_at?: string | null;
  started_at?: string;
}

const time = (iso?: string | null): number => {
  if (!iso) return Number.NaN;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
};

/**
 * The 'known' item resting longest — null when nothing is in the rotation pool.
 * Never-practiced beats practiced; ties break by started_at (oldest first), then label, so the
 * pick is stable run-to-run rather than dependent on row order.
 */
export function pickDueNext(items: RepertoireLike[]): RepertoireLike | null {
  const pool = items.filter((i) => i.status === 'known');
  if (!pool.length) return null;
  return [...pool].sort((a, b) => {
    const at = time(a.last_practiced_at);
    const bt = time(b.last_practiced_at);
    const aNever = Number.isNaN(at);
    const bNever = Number.isNaN(bt);
    if (aNever !== bNever) return aNever ? -1 : 1;
    if (!aNever && at !== bt) return at - bt;
    const as = time(a.started_at);
    const bs = time(b.started_at);
    if (!Number.isNaN(as) && !Number.isNaN(bs) && as !== bs) return as - bs;
    return a.label.localeCompare(b.label);
  })[0]!;
}

const shortDate = (iso?: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const practicedNote = (i: RepertoireLike): string => {
  const d = shortDate(i.last_practiced_at);
  return d ? `last worked ${d}` : 'not worked yet while on file';
};

/**
 * The compact text both consumers inject — get_repertoire's render and prescribe-session's
 * {{repertoire}} variable. One renderer so the coach in chat and the coach programming a session
 * read the same facts in the same words. Empty string when there is nothing on file.
 */
export function renderRepertoire(items: RepertoireLike[]): string {
  if (!items.length) return '';
  const due = pickDueNext(items);
  const group = (status: RepertoireStatus): RepertoireLike[] => items.filter((i) => i.status === status);
  const line = (i: RepertoireLike): string => {
    const marks = [i.kind, practicedNote(i), due && i === due ? 'DUE NEXT by rotation' : null].filter(Boolean);
    return `  - ${i.label} (${marks.join('; ')})`;
  };
  const sections: string[] = [];
  const working = group('working');
  const known = group('known');
  const parked = group('parked');
  if (working.length) sections.push(`Working on now:\n${working.map(line).join('\n')}`);
  if (known.length)
    sections.push(`Known — the rotation pool for review and warm material:\n${known.map(line).join('\n')}`);
  if (parked.length) sections.push(`Set aside for now: ${parked.map((i) => i.label).join('; ')}`);
  return sections.join('\n');
}
