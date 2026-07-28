import { isFoodTitle } from '../../components/occurrence-mod.ts';

/**
 * The four icon families a task maps to on the sky-trail — and the "log something you did" sheet,
 * which badges plan activities with the same iconography. There's no `area` on a plan occurrence
 * yet, so we infer the family from the title (v1). Kept in its own module (not TodayTrail.tsx) so
 * both a component file and the sheet can share it without tripping react-refresh.
 */
export type Category = 'mindset' | 'movement' | 'nutrition' | 'reflection';

export function categoryOf(title: string): Category {
  if (isFoodTitle(title)) return 'nutrition';
  const t = title.toLowerCase();
  if (/reflect|journal|gratitude|wind.?down|evening|night|sleep/.test(t)) return 'reflection';
  if (/mindset|meditat|breath|calm|focus|intention|morning|check-in/.test(t)) return 'mindset';
  if (/run|walk|jog|workout|strength|lift|ride|swim|cycl|mobility|yoga|stretch|cardio|hiit|zone|row/.test(t))
    return 'movement';
  return 'movement';
}

/* ── Solid-white glyphs (filled silhouettes on the discs) ─────────────────────────────── */
export const ICON: Record<Category, string> = {
  mindset:
    'M12 4a1 1 0 011 1v1a1 1 0 01-2 0V5a1 1 0 011-1zm0 12a1 1 0 011 1v1a1 1 0 01-2 0v-1a1 1 0 011-1zM4 11h1a1 1 0 010 2H4a1 1 0 010-2zm14 0h1a1 1 0 010 2h-1a1 1 0 010-2zM6.2 6.2a1 1 0 011.4 0l.7.7A1 1 0 016.9 8.3l-.7-.7a1 1 0 010-1.4zm9.3 9.3a1 1 0 011.4 0l.7.7a1 1 0 01-1.4 1.4l-.7-.7a1 1 0 010-1.4zm1.4-9.3a1 1 0 010 1.4l-.7.7a1 1 0 01-1.4-1.4l.7-.7a1 1 0 011.4 0zM6.9 15.7a1 1 0 010 1.4l-.7.7a1 1 0 01-1.4-1.4l.7-.7a1 1 0 011.4 0zM12 8a4 4 0 100 8 4 4 0 000-8z',
  movement:
    'M14.5 5.5a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0zM9 9.2l3.4-1.3a1.6 1.6 0 011.7.4l2 2.1 2.1.8a1 1 0 01-.7 1.9l-2.5-1a1.6 1.6 0 01-.5-.4l-.8-.9-1 3 2.2 2.4.9 3.6a1.1 1.1 0 01-2.1.6l-.9-3.4-2.9-3a1.6 1.6 0 01-.4-1.4l.3-1.6-1.6.6-1.2 2.2a1 1 0 01-1.8-.9l1.4-2.6a1.6 1.6 0 01.9-.7z',
  nutrition:
    'M12 6.5c.7-1.6 2.3-2.6 3.9-2.3-.2 1.2-1 2.3-2.1 2.8 1.8-.3 3.6.7 4.4 2.4 1 2.4.1 5.6-1.7 7.8-.8 1-1.7 1.6-2.6 1.4-.6-.1-1-.4-1.9-.4s-1.3.3-1.9.4c-.9.2-1.8-.4-2.6-1.4C5.9 17.4 5 14.2 6 11.8c.8-1.8 2.7-2.8 4.6-2.3-.7-.4-1.3-1.1-1.6-1.9 1.3-.2 2.6.3 3 .9z',
  reflection: 'M20 13.5A8 8 0 019 4.2a1 1 0 00-1.3-1.1A9.5 9.5 0 1021 15a1 1 0 00-1-1.5z',
};
