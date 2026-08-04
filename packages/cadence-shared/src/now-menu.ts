/* ════════════════════════════════════════════════════════════════
   The "Do something now" menu (REQ10 §6, REQ9 §3.1)
   ════════════════════════════════════════════════════════════════ */

/**
 * The present-tense half of the ＋ sheet: three to five things the coach picked for **this** person
 * to do right now — grounding options for someone anxious, a stretch or twenty extra pushups for
 * an athlete whose session felt light, ten Hail Marys for someone with a practice.
 *
 * The shell law that produced it (REQ9 §3.1): **nothing pillar-flavoured ships in the frame.** The
 * ＋ is neutral and already means "something outside the plan is happening"; the sheet does the
 * tense split as two labelled sections, present above past, because a log can wait a tap and
 * someone who needs three minutes cannot.
 *
 * Two rules make it trustworthy:
 *
 *   • **The coach writes the label; the app derives the meta.** "Three long exhales" is the
 *     coach's sentence and its own explanation — a menu of your own named practices needs no
 *     glyph to carry meaning. But "under a minute · no scores" is computed from the parameters
 *     that will actually play, so the promise on the row can never disagree with what happens
 *     when you tap it.
 *   • **Composed ahead, cached, zero model calls at tap time.** Nobody mid-spiral waits eight
 *     seconds for a menu.
 */

import { BREATH_PATTERNS, cycleSeconds, clampCycles, patternById } from './breathing.ts';
import { GROUNDING_NAMES, isGroundingGame, type GroundingGame } from './grounding.ts';
import { clampSitMinutes } from './meditate.ts';
import type { SessionItemTool } from './types/occurrence.ts';

/** Which pillar the row's puck is toned from. `null` = a plan activity whose area we inherit. */
export type NowMenuArea = 'movement' | 'nourishment' | 'mind' | 'practice';

/** What a row launches. A tool with parameters, or an activity that already exists in the plan. */
export type NowMenuAction =
  | { kind: 'tool'; tool: SessionItemTool; params: Record<string, string | number | undefined> }
  | { kind: 'activity'; activityId: string };

export interface NowMenuItem {
  /** Stable within a menu build — the client keys rows on it. */
  id: string;
  /** The coach's own words. Never a verb the coach didn't write. */
  label: string;
  area: NowMenuArea;
  action: NowMenuAction;
  /** At most one per menu: the coach's judgment that this person should have one tap, not a list. */
  pinned?: boolean;
  /** The coach's one line under a pinned item. Ignored on ordinary rows. */
  coachLine?: string;
}

export interface NowMenu {
  items: NowMenuItem[];
  generated_at: string;
}

/** Design's redline: three to five rows before the free line. Zero is a legitimate menu. */
export const MAX_NOW_ITEMS = 5;

/** A coach-written journal question is the one free-text parameter that reaches the page verbatim. */
export const MAX_JOURNAL_PROMPT = 140;

/**
 * Coerce a row's parameters. Every other param is an id or a number that its renderer clamps
 * (`patternById`, `clampCycles`, `clampSitMinutes`), but `journal_prompt` is copy the coach wrote
 * and the page shows as-is — so it gets the same trim-and-cap the label gets, right here, and an
 * empty one is dropped rather than rendered as a blank question. Junk values (objects, booleans,
 * nulls) are discarded instead of reaching a renderer that assumed a string.
 */
function sanitizeParams(params: unknown): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {};
  if (!params || typeof params !== 'object') return out;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[key] = key === 'journal_prompt' ? trimmed.slice(0, MAX_JOURNAL_PROMPT) : trimmed;
    }
  }
  return out;
}

/**
 * The question a journal row opens with. The coach's own sentence beats a bank id — the same
 * promise the tool catalog makes ("your sentence always wins"), kept in one place so the menu and
 * the session can't disagree about it. Returns nulls when the coach named neither, which is a real
 * state: the page opens blank with its own picker.
 */
export function journalOpener(params: Record<string, string | number | undefined>): {
  prompt: string | null;
  bank: string | null;
} {
  const written = typeof params.journal_prompt === 'string' ? params.journal_prompt : '';
  const bank = typeof params.journal_bank === 'string' ? params.journal_bank : '';
  return { prompt: written || null, bank: written ? null : bank || null };
}

/**
 * The meta line under a row, derived from what will actually play — never from coach copy.
 * Returns `undefined` when there is nothing honest to say (a plan activity we don't own the
 * parameters for), and the row simply shows no meta.
 */
export function nowMenuMeta(action: NowMenuAction): string | undefined {
  if (action.kind !== 'tool') return undefined;
  const p = action.params;
  switch (action.tool) {
    case 'breathing': {
      const pattern = patternById(typeof p.breath_pattern === 'string' ? p.breath_pattern : undefined);
      const cycles = clampCycles(pattern, typeof p.breath_cycles === 'number' ? p.breath_cycles : undefined);
      const secs = cycleSeconds(pattern) * cycles;
      return secs < 60 ? 'under a minute' : `about ${Math.round(secs / 60)} min`;
    }
    case 'meditate': {
      const mins = clampSitMinutes(typeof p.duration_min === 'number' ? p.duration_min : undefined);
      const bells = p.meditate_bells;
      const bellText = bells === 'none' ? 'no bells' : bells === 'interval' ? 'interval bells' : 'one bell';
      return `${mins} min · ${bellText}`;
    }
    case 'grounding': {
      // "no scores" is the promise that matters most on this row — it is the reassurance someone
      // reaching for it in a bad moment needs before they tap, not after.
      const game = typeof p.grounding_game === 'string' && isGroundingGame(p.grounding_game) ? p.grounding_game : null;
      return game ? `${GROUNDING_NAMES[game].toLowerCase()} · no scores` : 'no scores';
    }
    case 'journal':
      return 'a line or two';
    case 'timer': {
      const mins = typeof p.duration_min === 'number' ? Math.max(1, Math.round(p.duration_min)) : null;
      return mins ? `${mins} min` : undefined;
    }
    case 'reps': {
      const sets = typeof p.sets === 'number' ? p.sets : null;
      const reps = typeof p.reps === 'number' ? p.reps : null;
      return sets && reps ? `${sets}×${reps}` : reps ? `${reps} reps` : undefined;
    }
    default:
      return undefined;
  }
}

const TOOL_AREAS: Partial<Record<SessionItemTool, NowMenuArea>> = {
  breathing: 'mind',
  meditate: 'mind',
  grounding: 'mind',
  journal: 'mind',
};

/** The area a tool row is toned from, when the coach didn't say. */
export function areaForTool(tool: SessionItemTool): NowMenuArea {
  return TOOL_AREAS[tool] ?? 'movement';
}

/**
 * Coerce composed output into a menu the sheet can render. Applies the three refinements Design
 * proposed and REQ10 §6 accepted:
 *
 *   • **Zero items is legitimate** — an empty menu hides the section rather than inventing filler.
 *     Someone with nothing sensible to offer right now is a real state, not an error.
 *   • **Stale rows are dropped at read time**, never rendered — an item pointing at a deleted
 *     activity or an unknown tool disappears rather than failing under a thumb.
 *   • **At most one pin.** A second "one tap between you and the thing" is just a list again.
 */
export function normalizeNowMenu(
  raw: { items?: unknown[] } | null | undefined,
  knownTools: readonly string[],
  knownActivityIds: readonly string[],
): NowMenuItem[] {
  const items = Array.isArray(raw?.items) ? raw.items : [];
  const seen = new Set<string>();
  const out: NowMenuItem[] = [];
  let pinned = false;

  for (const entry of items) {
    if (out.length >= MAX_NOW_ITEMS) break;
    // Guard the entry itself, not just its fields: one null row must never take the menu down.
    if (!entry || typeof entry !== 'object') continue;
    const it = entry as Partial<NowMenuItem> & { action?: Partial<NowMenuAction> };
    const label = typeof it.label === 'string' ? it.label.trim().slice(0, 60) : '';
    const action = it.action;
    if (!label || !action) continue;

    let resolved: NowMenuAction | null = null;
    if (action.kind === 'tool' && typeof action.tool === 'string' && knownTools.includes(action.tool)) {
      resolved = { kind: 'tool', tool: action.tool as SessionItemTool, params: sanitizeParams(action.params) };
    } else if (
      action.kind === 'activity' &&
      typeof action.activityId === 'string' &&
      knownActivityIds.includes(action.activityId)
    ) {
      resolved = { kind: 'activity', activityId: action.activityId };
    }
    if (!resolved) continue; // stale or unknown — dropped, never rendered

    const key = resolved.kind === 'tool' ? `${resolved.tool}:${JSON.stringify(resolved.params)}` : resolved.activityId;
    if (seen.has(key)) continue;
    seen.add(key);

    const item: NowMenuItem = {
      id: `n${out.length + 1}`,
      label,
      area: isArea(it.area) ? it.area : resolved.kind === 'tool' ? areaForTool(resolved.tool) : 'movement',
      action: resolved,
    };
    if (it.pinned && !pinned) {
      item.pinned = true;
      pinned = true;
      if (typeof it.coachLine === 'string' && it.coachLine.trim()) item.coachLine = it.coachLine.trim().slice(0, 120);
    }
    out.push(item);
  }

  // A pin is the sheet's dominant first action, so it leads regardless of the order it arrived in.
  return out.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
}

function isArea(v: unknown): v is NowMenuArea {
  return v === 'movement' || v === 'nourishment' || v === 'mind' || v === 'practice';
}

/** The breath-pattern ids a composer may reference — handed to the job so it can't invent one. */
export const NOW_MENU_BREATH_IDS = BREATH_PATTERNS.map((p) => p.id);

/** The grounding games a composer may reference. */
export const NOW_MENU_GROUNDING_GAMES = Object.keys(GROUNDING_NAMES) as GroundingGame[];
