import { renderFact, type ReviewFact } from './fact-review-dossier.ts';

/**
 * What the `fact-review` job hands back, checked before anything is written (HARNESS-V3 C7).
 * Pure. The job runs a strict schema, but the provider has been measured ignoring one (2026-10-29),
 * so every field is checked here as if no schema existed.
 *
 * The rule that matters: **evidence is required**, the same rule as "guards report evidence". A
 * finding that cannot say which facts it rests on, in the facts' own ids, is a guess — and a guess
 * turned into a question would have the coach asking someone about a disagreement that is not in
 * their file. Such findings are dropped and counted, never repaired.
 */

export const FINDING_KINDS = ['contradiction', 'stale', 'duplicate'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export interface FactFinding {
  fact_ids: string[];
  kind: FindingKind;
  evidence: string;
  question: string;
}

/** Why a finding was dropped — every reason counted, so a run that drops everything says why. */
export interface DroppedCounts {
  /** Evidence missing, empty, or quoting none of the finding's own fact ids. */
  no_evidence: number;
  /** A fact id that is not in the dossier — the model invented or misread one. */
  unknown_fact: number;
  /** Not an object, no fact ids, a kind outside the three, or no usable question. */
  bad_shape: number;
  /** The same question twice in one answer. */
  repeated: number;
}

export interface CheckedFindings {
  findings: FactFinding[];
  dropped: DroppedCounts;
  /** False when the answer was not JSON with a findings list at all. */
  parsed: boolean;
}

/** A question the coach can say in one breath. Longer is a paragraph, not a question. */
export const MAX_QUESTION_CHARS = 240;

const isKind = (v: unknown): v is FindingKind =>
  typeof v === 'string' && (FINDING_KINDS as readonly string[]).includes(v);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does the evidence quote at least one of the finding's facts by id? An id counts as a whole word
 * only, in either case — "[e1]" and "E1" cite e1; "e12" and "ce1" do not.
 */
export function evidenceCitesIds(evidence: string, ids: string[]): boolean {
  return ids.some((id) => new RegExp(`(^|[^A-Za-z0-9])${escapeRe(id)}(?![A-Za-z0-9])`, 'i').test(evidence));
}

/** The comparison form of a question: case, spacing and closing punctuation do not make it new. */
export function normQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[\s?.!]+$/, '')
    .trim();
}

/** The findings array, from `{ findings: [...] }`, a bare array, or a JSON string of either. */
function findingsList(raw: unknown): unknown[] | null {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object' && Array.isArray((v as { findings?: unknown }).findings))
    return (v as { findings: unknown[] }).findings;
  return null;
}

type Verdict = FactFinding | keyof Omit<DroppedCounts, 'repeated'>;

function checkOne(item: unknown, known: ReadonlySet<string>): Verdict {
  if (!item || typeof item !== 'object') return 'bad_shape';
  const o = item as Record<string, unknown>;
  const ids = Array.isArray(o.fact_ids)
    ? [...new Set(o.fact_ids.filter((x): x is string => typeof x === 'string').map((x) => x.trim()))].filter(Boolean)
    : [];
  const question = typeof o.question === 'string' ? o.question.replace(/\s+/g, ' ').trim() : '';
  if (!ids.length || !isKind(o.kind) || !question || question.length > MAX_QUESTION_CHARS) return 'bad_shape';
  if (ids.some((id) => !known.has(id))) return 'unknown_fact';
  const evidence = typeof o.evidence === 'string' ? o.evidence.trim() : '';
  if (!evidence || !evidenceCitesIds(evidence, ids)) return 'no_evidence';
  return { fact_ids: ids, kind: o.kind, evidence, question };
}

/** Check the job's answer against the dossier it was given. Order is kept: the job lists the clearest first. */
export function checkFindings(raw: unknown, facts: ReviewFact[]): CheckedFindings {
  const dropped: DroppedCounts = { no_evidence: 0, unknown_fact: 0, bad_shape: 0, repeated: 0 };
  const list = findingsList(raw);
  if (!list) return { findings: [], dropped, parsed: false };
  const known = new Set(facts.map((f) => f.id));
  const seen = new Set<string>();
  const findings: FactFinding[] = [];
  for (const item of list) {
    const v = checkOne(item, known);
    if (typeof v === 'string') {
      dropped[v] += 1;
      continue;
    }
    const key = normQuestion(v.question);
    if (seen.has(key)) {
      dropped.repeated += 1;
      continue;
    }
    seen.add(key);
    findings.push(v);
  }
  return { findings, dropped, parsed: true };
}

export interface Selection {
  write: FactFinding[];
  /** Already waiting as an open fact-review follow-up — asked once is enough. */
  already_open: number;
  /** Over this run's room. */
  over_cap: number;
}

/**
 * Which findings become follow-ups: not one already open (same question, by `normQuestion`), and
 * no more than `room` — the run's cap, less what is still open from earlier weeks.
 */
export function selectFindings(findings: FactFinding[], openQuestions: string[], room: number): Selection {
  const open = new Set(openQuestions.map(normQuestion));
  const fresh = findings.filter((f) => !open.has(normQuestion(f.question)));
  const take = Math.max(0, room);
  return {
    write: fresh.slice(0, take),
    already_open: findings.length - fresh.length,
    over_cap: Math.max(0, fresh.length - take),
  };
}

/**
 * The evidence as stored: the job's own sentence, then each fact it cites in that fact's own words.
 * The ids mean nothing after this run, so the stored row carries the facts themselves.
 */
export function storedEvidence(finding: FactFinding, facts: ReviewFact[]): string {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const cited = finding.fact_ids.map((id) => byId.get(id)).filter((f): f is ReviewFact => !!f);
  return [`${finding.kind}: ${finding.evidence}`, ...cited.map(renderFact)].join('\n');
}
