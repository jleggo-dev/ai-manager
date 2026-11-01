import type { Constraint, Equipment, Goal, GoalStatus } from '@cadence/shared';

/**
 * The facts the weekly fact review reads (HARNESS-V3 C7), as one numbered list. Pure: the reads
 * happen in fact-review.ts, from the same repos capture and the dedup script already read; this
 * file only turns those rows into lines the `fact-review` job can quote by id.
 *
 * What is in it, and why:
 * - constraints (`users.baseline.constraints`) — the list keeps no dates, so it goes in the order
 *   it was told (merge appends), oldest first.
 * - what they do now (`baseline.starting_point.doing_now`) — no dates either.
 * - equipment they own (`cadence.equipment`), with the day it was written down. A coach's
 *   recommendation (`owned: false`) is not something they told us, and a retired shoe is history,
 *   so neither is a fact to check.
 * - goals that are live (captured, confirmed, committed), with their day. A parked, completed or
 *   abandoned goal is set aside on purpose; a new goal beside it is not a duplicate.
 * - detours (`cadence.episodes`) over the last year and the next three months: type and dates only,
 *   which is all the row holds.
 *
 * What is NOT in it: allergies and dietary choices. Allergen flags are a union only the person may
 * clear; a weekly job asking "are you still allergic to peanuts?" is one step from clearing one,
 * so the review never sees them.
 *
 * Ids are local to one run — a letter for the kind and a number (c1, n1, e1, g1, d1). Short ids are
 * quoted reliably where uuids are not, and fact-review.ts resolves them back into the fact's own
 * words before anything is stored, so a stored finding never depends on them.
 */

export const REVIEW_FACT_KINDS = ['constraint', 'doing_now', 'equipment', 'goal', 'detour'] as const;
export type ReviewFactKind = (typeof REVIEW_FACT_KINDS)[number];

const ID_LETTER: Record<ReviewFactKind, string> = {
  constraint: 'c',
  doing_now: 'n',
  equipment: 'e',
  goal: 'g',
  detour: 'd',
};

/** Per-kind ceilings, so a long file costs a bounded prompt. Generous: nobody near them today. */
const MAX_PER_KIND: Record<ReviewFactKind, number> = {
  constraint: 30,
  doing_now: 15,
  equipment: 50,
  goal: 20,
  detour: 10,
};
/** One fact's words, at most. A goal brief can run long; the review needs the gist, not the essay. */
const MAX_TEXT = 200;

const LIVE_GOAL_STATUSES: readonly GoalStatus[] = ['captured', 'confirmed', 'committed'];

export interface ReviewFact {
  /** Run-local id the job quotes. */
  id: string;
  kind: ReviewFactKind;
  /** The fact in the words on file. */
  text: string;
  /** YYYY-MM-DD it was written down, when the store keeps it (equipment, goals); null otherwise. */
  added: string | null;
  /** Short plain notes from the row: status, end date, a detour's dates. */
  notes: string[];
}

/** A row as the repo returns it — `select *` carries `created_at` (a Date from the driver) beyond the shared type. */
type WithCreatedAt<T> = T & { created_at?: unknown };

export interface DossierSources {
  constraints: Constraint[];
  doingNow: string[];
  equipment: Array<WithCreatedAt<Equipment>>;
  goals: Array<WithCreatedAt<Goal>>;
  detours: Array<{ start: string; end: string; type: string }>;
  /** YYYY-MM-DD — decides whether a detour has ended, is on now, or is still ahead. */
  today: string;
}

/** YYYY-MM-DD from a Date, an ISO string, or nothing. */
export function dayOf(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

/** Add whole days to a YYYY-MM-DD, in UTC. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const clip = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
};

const byAdded = <T extends { created_at?: unknown }>(a: T, b: T): number =>
  (dayOf(a.created_at) ?? '').localeCompare(dayOf(b.created_at) ?? '');

function constraintNotes(c: Constraint): string[] {
  return [
    c.kind ?? null,
    c.status === 'quiet' ? 'quiet (known, settled for now)' : c.status === 'active' ? 'active' : null,
    c.until ? `until ${c.until}` : null,
    c.plan_around ? 'planned around' : null,
  ].filter((n): n is string => !!n);
}

function goalText(g: Goal): string {
  return g.brief?.trim() ? `${g.title} — ${g.brief}` : g.title;
}

function goalNotes(g: Goal): string[] {
  return [g.status, g.area, g.timeframe?.end ? `by ${g.timeframe.end}` : null].filter((n): n is string => !!n);
}

function detourNotes(d: { start: string; end: string }, today: string): string[] {
  const when = d.end < today ? 'ended' : d.start > today ? 'starts later' : 'on now';
  return [`${d.start} to ${d.end}`, when];
}

interface Draft {
  kind: ReviewFactKind;
  text: string;
  added: string | null;
  notes: string[];
}

function drafts(src: DossierSources): Draft[] {
  const constraints = src.constraints
    .filter((c) => c?.label?.trim())
    .map((c): Draft => ({ kind: 'constraint', text: c.label, added: null, notes: constraintNotes(c) }));
  const doingNow = src.doingNow
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s): Draft => ({ kind: 'doing_now', text: s, added: null, notes: [] }));
  const equipment = src.equipment
    .filter((e) => e?.name?.trim() && e.owned !== false && e.wear?.status !== 'retired')
    .sort(byAdded)
    .map((e): Draft => ({
      kind: 'equipment',
      text: e.name,
      added: dayOf(e.created_at),
      notes: e.category ? [e.category] : [],
    }));
  const goals = src.goals
    .filter((g) => g?.title?.trim() && LIVE_GOAL_STATUSES.includes(g.status))
    .sort(byAdded)
    .map((g): Draft => ({ kind: 'goal', text: goalText(g), added: dayOf(g.created_at), notes: goalNotes(g) }));
  const detours = [...src.detours]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((d): Draft => ({ kind: 'detour', text: `${d.type} detour`, added: null, notes: detourNotes(d, src.today) }));
  // Each kind is capped on its own, so a long equipment list can never crowd out the constraints.
  return [constraints, doingNow, equipment, goals, detours].flatMap((list) =>
    list.filter((d, i) => i < MAX_PER_KIND[d.kind]),
  );
}

/** Every fact, numbered within its kind, in the order the review should read them. */
export function buildReviewDossier(src: DossierSources): ReviewFact[] {
  const seen: Record<ReviewFactKind, number> = { constraint: 0, doing_now: 0, equipment: 0, goal: 0, detour: 0 };
  return drafts(src).map((d) => {
    seen[d.kind] += 1;
    return {
      id: `${ID_LETTER[d.kind]}${seen[d.kind]}`,
      kind: d.kind,
      text: clip(d.text),
      added: d.added,
      notes: d.notes,
    };
  });
}

/** One fact as the job reads it — and as a stored finding's evidence quotes it back. */
export function renderFact(f: ReviewFact): string {
  const tail = [f.added ? `added ${f.added}` : null, ...f.notes].filter(Boolean).join('; ');
  return `[${f.id}] ${f.kind}: "${f.text}"${tail ? ` — ${tail}` : ''}`;
}

export function renderDossier(facts: ReviewFact[]): string {
  return facts.map(renderFact).join('\n');
}
