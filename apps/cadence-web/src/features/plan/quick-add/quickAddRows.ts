import type { NutritionDayData, PlanViewData } from '../../../lib/api.ts';

/**
 * What the ＋ sheet offers — derived from what the user ALREADY tracks, never a menu of
 * hypotheticals (owner, 2026-09-01). Three rules, all enforced here:
 *
 *   1. A row appears only when its tracking signal is live: water needs a pour in the trailing
 *      window, a meal needs recent food, a weight needs a weigh-in on the plan, a workout needs a
 *      movement commitment, a photo needs the opt-in. No signal, no row — the sheet must never
 *      invite someone to start tracking something from a quick-add menu.
 *   2. Nothing the plan already gives a button for: the old sheet listed every plan activity to
 *      tick, which duplicated the trail's own rows. The weight row applies the same rule per-day —
 *      on a day the trail carries a weigh-in of its own, quick add stands down.
 *   3. The coach's present-tense menu earns its own row, "Calming techniques", only when she
 *      actually composed items for THIS user (device-test ruling, 2026-09-01) — a top-level
 *      section of mind tools nobody prescribed broke the sheet's law the same way an untracked
 *      hypothetical would. `hasCalming` is the sheet's own already-fetched signal, handed in the
 *      same no-claim way as `photosEnabled`.
 *
 * Pure derivation, no fetching: the sheet hands in whatever it holds, and every absent input is a
 * no-claim (no row), never a hint.
 */

export type QuickAddArea = 'movement' | 'practice';

export type QuickAddRow =
  | { kind: 'water' }
  | { kind: 'meal' }
  | { kind: 'weight' }
  /** An off-plan add for an area the plan shows they work in — `toward` names the goal when the
   *  area has exactly one, so "Piano · toward Learn piano" can say what it feeds. `noun` is the
   *  row's own label (see `nounForArea` below): the thing itself, never a generic verb phrase. */
  | { kind: 'add'; area: QuickAddArea; toward?: string; noun: string }
  /** The coach's present-tense menu, demoted to one master row like everything else (device-test
   *  ruling, 2026-09-01) rather than a top-level section: tapping it opens the items as a
   *  sub-screen (DoNowSection.tsx, now purely presentational). */
  | { kind: 'calming' }
  | { kind: 'photo' };

/** Same reading CaptureSheet uses — a weigh row is named, not flagged. */
const isWeighTitle = (t: string) => /weigh/i.test(t);

/** Trailing words a title wears for the trail's own grammar but that add nothing once the row is
 *  named on its own screen — "Piano practice" is a person's piano, "Evening session" is nobody's
 *  noun at all. Stripped one at a time so "Practice session" still yields something. */
const GENERIC_SUFFIX_WORDS = new Set(['practice', 'session']);

/** The generic floor for an area — what the row says when no single activity (practice) or type
 *  (movement) owns it. */
const AREA_FALLBACK: Record<QuickAddArea, string> = { movement: 'A workout', practice: 'A practice' };

/**
 * Strips a trailing generic word (repeatedly, so "Evening practice session" still lands on
 * "Evening"), and reports `null` when doing so leaves nothing distinctive — a title that IS just
 * "Practice" is not a noun, it's the same fallback the area already offers.
 */
function stripGenericSuffix(title: string): string | null {
  const words = title.trim().split(/\s+/).filter(Boolean);
  let last = words[words.length - 1];
  while (words.length > 1 && last !== undefined && GENERIC_SUFFIX_WORDS.has(last.toLowerCase())) {
    words.pop();
    last = words[words.length - 1];
  }
  if (words.length === 0 || last === undefined) return null;
  if (words.length === 1 && GENERIC_SUFFIX_WORDS.has(last.toLowerCase())) return null;
  return words.join(' ');
}

/**
 * Movement titles ("Easy run", "Hotel HIIT") are task names — they already sit on the trail
 * wearing that exact name on their own button, so showing one verbatim here would be a SECOND row
 * with the SAME name doing a DIFFERENT thing (an off-plan extra, not completing the task). The
 * design's own screen-1 examples agree: movement nouns are the TYPE of the thing ("A run", "A
 * workout"), never the task's own name. Word families borrowed from glyphs.ts's own run/walk/
 * ride/swim/row rules, so the sheet's nouns and the trail's glyphs never disagree about a title.
 */
const MOVEMENT_TYPE_RULES: Array<[RegExp, string]> = [
  [/\brun\b|running|jog/, 'A run'],
  [/walk|hike|ruck/, 'A walk'],
  [/\bride\b|riding|cycl|bike|spin\b/, 'A ride'],
  [/swim/, 'A swim'],
  [/\brow\b|rowing/, 'A row'],
  [/lift|strength/, 'A workout'],
];

function movementTypeNoun(title: string): string {
  const t = title.toLowerCase();
  for (const [re, noun] of MOVEMENT_TYPE_RULES) if (re.test(t)) return noun;
  return AREA_FALLBACK.movement;
}

/**
 * The row's own name for an area — split by what a title IS there:
 *
 *   - **Practice** titles carry the instrument/craft itself ("Piano practice" → "Piano") — that
 *     IS the noun the design wants, so a lone distinct title becomes the row's name, its generic
 *     suffix stripped. More than one distinct title (nothing to single out) falls back to the
 *     area's floor, "A practice".
 *   - **Movement** titles are task names that collide with the trail's own button (see
 *     `MOVEMENT_TYPE_RULES` above) — the raw title never becomes the noun. Every activity's title
 *     maps to a TYPE noun instead; one distinct type across all of them names the row, more than
 *     one falls back to "A workout".
 *
 * Never a per-activity row either way (that gate lives in the loop below, unchanged) — one noun
 * stands for the whole area.
 */
function nounForArea(area: QuickAddArea, activities: { title: string }[]): string {
  const titles = activities.map((a) => a.title.trim()).filter(Boolean);

  if (area === 'movement') {
    const [onlyType, ...restTypes] = [...new Set(titles.map(movementTypeNoun))];
    return onlyType && restTypes.length === 0 ? onlyType : AREA_FALLBACK.movement;
  }

  const [onlyTitle, ...restTitles] = [...new Set(titles)];
  if (!onlyTitle || restTitles.length > 0) return AREA_FALLBACK.practice;
  return stripGenericSuffix(onlyTitle) ?? AREA_FALLBACK.practice;
}

export function deriveQuickAddRows(input: {
  plan: PlanViewData | null;
  day: NutritionDayData | null;
  photosEnabled: boolean;
  /** Does the coach's fetched now-menu carry at least one tool item? Optional — an omitted or
   *  false value is a no-claim, same as every other gate in this function. */
  hasCalming?: boolean;
}): QuickAddRow[] {
  const { plan, day, photosEnabled, hasCalming } = input;
  const rows: QuickAddRow[] = [];

  if (day?.has_recent_water === true) rows.push({ kind: 'water' });
  if (day?.has_recent_food === true) rows.push({ kind: 'meal' });

  if (plan) {
    const tracksWeight = plan.activities.some((a) => a.kind === 'system' && isWeighTitle(a.title));
    const todayHasWeighRow = (plan.week ?? []).some(
      (d) => d.isToday && d.occurrences.some((o) => isWeighTitle(o.title)),
    );
    if (tracksWeight && !todayHasWeighRow) rows.push({ kind: 'weight' });

    for (const area of ['movement', 'practice'] as const) {
      const inArea = plan.activities.filter((a) => a.kind === 'user' && a.area === area);
      if (inArea.length === 0) continue;
      const goals = [...new Set(inArea.map((a) => a.goal_title).filter((t): t is string => !!t))];
      rows.push({
        kind: 'add',
        area,
        toward: goals.length === 1 ? goals[0] : undefined,
        noun: nounForArea(area, inArea),
      });
    }
  }

  if (hasCalming) rows.push({ kind: 'calming' });
  if (photosEnabled) rows.push({ kind: 'photo' });
  return rows;
}
