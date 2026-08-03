/* ════════════════════════════════════════════════════════════════
   Chained practices — the trees, not a new engine (REQ9 §4.8)
   ════════════════════════════════════════════════════════════════ */

/**
 * The evening review, the thought-reframe, and worry-park-then-revisit: multi-step practices that
 * REQ9 §4.8 defines as *ordered chains of existing tools on a deterministic tree*, not as new
 * machinery. So a practice is exactly that — a named `OccurrenceSession` template the app expands.
 * The walkthrough already plays ordered steps, every tool already logs, journal steps already
 * reach the store. Adding a practice is adding a tree.
 *
 * That has a consequence worth stating: **the coach cannot invent a practice.** It picks one by
 * name from this file, the same way it picks a breath pattern or a grounding game — which is what
 * keeps a stepped sequence (the thing most likely to drift into pseudo-therapy if freely
 * generated) reviewed, deterministic, and inside REQ9 §1's register.
 *
 * The reframe deliberately never says "CBT", never diagnoses, and never claims the thought is
 * false — it asks what is *actually* true, which is the honest version and the one BRAND allows.
 */

import type { OccurrenceSession, SessionItem } from './types/occurrence.ts';

export type PracticeId = 'evening_review' | 'thought_reframe' | 'worry_park';

export interface Practice {
  id: PracticeId;
  /** User-facing name — the coach's words for it, plain. */
  name: string;
  /** One line the coach reads when choosing. */
  summary: string;
  /** Roughly how long, for the menu's derived meta line. */
  minutes: number;
  items: SessionItem[];
}

export const PRACTICES: readonly Practice[] = [
  {
    id: 'evening_review',
    name: 'Evening review',
    summary: 'a short end-of-day pass: settle, notice how the day sat, keep one good thing, park what is circling',
    minutes: 8,
    items: [
      {
        name: 'Settle first',
        tool: 'breathing',
        breath_pattern: 'extended_exhale',
        breath_cycles: 5,
        detail: 'Before looking back at the day, let it slow down a little.',
      },
      { name: 'How did today sit?', tool: 'feeling_log' },
      { name: 'Three good things', tool: 'journal', journal_bank: 'three_good_things' },
      { name: 'Anything circling?', tool: 'journal', journal_bank: 'park_a_worry' },
    ],
  },
  {
    id: 'thought_reframe',
    name: 'The loudest thought',
    summary:
      'takes one loud thought and walks it: what happened, what you told yourself, what is actually true. Use when a specific thought keeps returning — never as a daily habit',
    minutes: 10,
    items: [
      {
        name: 'A few breaths first',
        tool: 'breathing',
        breath_pattern: 'coherent',
        breath_cycles: 5,
        detail: 'This one asks you to look at something squarely. Get steady first.',
      },
      {
        name: 'What happened?',
        tool: 'journal',
        detail: 'Just the facts of it — what actually happened, as plainly as you can.',
      },
      {
        name: 'What did you tell yourself?',
        tool: 'journal',
        detail: 'And what did you say to yourself about it? Write it in your own words.',
      },
      { name: "What's actually true?", tool: 'journal', journal_bank: 'whats_actually_true' },
      {
        name: 'The smallest next thing',
        tool: 'journal',
        journal_bank: 'smallest_next_thing',
      },
    ],
  },
  {
    id: 'worry_park',
    name: 'Park it',
    summary:
      'write the worry down once, then do something ordinary with your attention — for a mind that will not put something down',
    minutes: 6,
    items: [
      { name: 'Write it once', tool: 'journal', journal_bank: 'park_a_worry' },
      {
        name: 'Now somewhere else',
        tool: 'grounding',
        grounding_game: 'senses',
        detail: "It's written down. It will keep.",
      },
      {
        name: 'A slower breath',
        tool: 'breathing',
        breath_pattern: 'extended_exhale',
        breath_cycles: 6,
      },
    ],
  },
];

const BY_ID = new Map<string, Practice>(PRACTICES.map((p) => [p.id, p]));

export function isPracticeId(v: string | null | undefined): v is PracticeId {
  return typeof v === 'string' && BY_ID.has(v);
}

export function practiceById(id: string | null | undefined): Practice | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/**
 * Expand a practice into a session the walkthrough can play. One block, because a practice is one
 * sequence — the block label carries the practice's name so the header reads as itself. Returns
 * null for an unknown id rather than inventing a shape.
 */
export function expandPractice(id: string | null | undefined): OccurrenceSession | null {
  const practice = practiceById(id);
  if (!practice) return null;
  return {
    blocks: [{ label: practice.name, items: practice.items.map((i) => ({ ...i })) }],
    note: '',
    generated_at: new Date().toISOString(),
    version: 1,
  };
}
