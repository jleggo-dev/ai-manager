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
  if (/reflect|journal|gratitude|wind.?down|evening|night|sleep/.test(t)) return 'reflection';
  // Movement before mindset: "Morning joint mobility" is a body thing that happens to say morning.
  if (/run|walk|jog|workout|strength|lift|ride|swim|cycl|mobility|yoga|stretch|cardio|hiit|zone|row|prehab/.test(t))
    return 'movement';
  if (
    /piano|guitar|violin|music|practi[cs]e|scales|repertoire|read|write|writ|draw|sketch|paint|language|study|chess|sing/.test(
      t,
    )
  )
    return 'practice';
  if (/mindset|meditat|breath|calm|focus|intention|morning|check-in/.test(t)) return 'mindset';
  return 'movement';
}

/* ── Solid-white glyphs (filled silhouettes on the discs, 24×24 viewBox) ──────────────────
 * Non-figurative on purpose (owner, 2026-08-31): the old hand-drawn runner read as "a man
 * missing a leg", the apple as two apples. Objects over anatomy — a drawing of a thing can be
 * imperfect and still be that thing; a drawing of a person cannot. */
export const ICON: Record<Category, string> = {
  // A sun — the day being started on purpose.
  mindset:
    'M12 4a1 1 0 011 1v1a1 1 0 01-2 0V5a1 1 0 011-1zm0 12a1 1 0 011 1v1a1 1 0 01-2 0v-1a1 1 0 011-1zM4 11h1a1 1 0 010 2H4a1 1 0 010-2zm14 0h1a1 1 0 010 2h-1a1 1 0 010-2zM6.2 6.2a1 1 0 011.4 0l.7.7A1 1 0 016.9 8.3l-.7-.7a1 1 0 010-1.4zm9.3 9.3a1 1 0 011.4 0l.7.7a1 1 0 01-1.4 1.4l-.7-.7a1 1 0 010-1.4zm1.4-9.3a1 1 0 010 1.4l-.7.7a1 1 0 01-1.4-1.4l.7-.7a1 1 0 011.4 0zM6.9 15.7a1 1 0 010 1.4l-.7.7a1 1 0 01-1.4-1.4l.7-.7a1 1 0 011.4 0zM12 8a4 4 0 100 8 4 4 0 000-8z',
  // A dumbbell, built from plain rects (bar, two plates, two caps) — equipment, not anatomy,
  // and every coordinate checkable by arithmetic after a hand-drawn path shipped broken.
  movement: 'M8 11h8v2H8zM5 7.5h3v9H5zM16 7.5h3v9h-3zM3 9.5h2v5H3zM19 9.5h2v5h-2z',
  // Fork and knife (Material "restaurant", Apache-2.0) — a meal, with no botany to misread.
  nutrition:
    'M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z',
  // A crescent moon — the day being closed.
  reflection: 'M20 13.5A8 8 0 019 4.2a1 1 0 00-1.3-1.1A9.5 9.5 0 1021 15a1 1 0 00-1-1.5z',
  // A quarter note (Material "music_note", Apache-2.0) — piano, and every practice like it.
  practice: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
};
