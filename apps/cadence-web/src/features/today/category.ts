import { isFoodTitle } from '../../components/occurrence-mod.ts';

/**
 * The icon families a task maps to on the sky-trail — and the "log something you did" sheet and
 * the do-now menu, which badge activities with the same iconography.
 *
 * Five families since 2026-08-31 (owner device round): piano practice wore the exercise glyph
 * because no `practice` family existed, and "Morning joint mobility" wore the mindset sun because
 * the word "morning" matched before "mobility" was ever tested. The AREA a row's goal carries
 * (movement | nourishment | mind | practice — the canonical areas, CLAUDE.md) is authoritative
 * when present; the title regex is only the fallback for rows without one, checked most-specific
 * first so a generic word can no longer shadow a concrete one.
 */
export type Category = 'mindset' | 'movement' | 'nutrition' | 'reflection' | 'practice';

/** The canonical goal areas, as the icon families they wear. */
export function categoryOfArea(area: 'movement' | 'nourishment' | 'mind' | 'practice'): Category {
  if (area === 'nourishment') return 'nutrition';
  if (area === 'mind') return 'mindset';
  if (area === 'practice') return 'practice';
  return 'movement';
}

export function categoryOf(title: string, area?: 'movement' | 'nourishment' | 'mind' | 'practice'): Category {
  if (area) return categoryOfArea(area);
  if (isFoodTitle(title)) return 'nutrition';
  const t = title.toLowerCase();
  // A weigh-in is a body measurement — nourishment's family, not a workout's.
  if (/weigh/.test(t)) return 'nutrition';
  if (/reflect|journal|gratitude|wind.?down|evening|night|sleep/.test(t)) return 'reflection';
  // Mind-specific words before the practice family: "Box breathing practice" is a mind thing
  // that happens to say practice (it wore a musical note for a day, 2026-08-31).
  if (/meditat|breath|calm/.test(t)) return 'mindset';
  // Movement before mindset: "Morning joint mobility" is a body thing that happens to say morning.
  if (/run|walk|jog|workout|strength|lift|ride|swim|cycl|mobility|yoga|stretch|cardio|hiit|zone|row|prehab/.test(t))
    return 'movement';
  if (
    /piano|guitar|violin|music|practi[cs]e|scales|repertoire|read|write|writ|draw|sketch|paint|language|study|chess|sing/.test(
      t,
    )
  )
    return 'practice';
  if (/mindset|focus|intention|morning|check-in/.test(t)) return 'mindset';
  return 'movement';
}

/* The glyph paths themselves live in glyphs.ts (activity-level resolution, `glyphOf`) — this
 * file only decides the FAMILY: which color world a row belongs to. */
