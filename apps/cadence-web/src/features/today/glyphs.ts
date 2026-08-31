import { isFoodTitle } from '../../components/occurrence-mod.ts';
import { type Category, categoryOf } from './category.ts';

/**
 * Activity-level glyphs (2026-08-31, from the owner's design project "Cadence Plan Rebalance"):
 * one glyph per kind of activity, not per family — box breathing wore a musical note because the
 * word "practice" in its title out-ranked "breathing", and every run/lift/ride wore the same
 * dumbbell. A title (plus its goal's area) now resolves to the most specific glyph that matches,
 * and only falls back to its family's default.
 *
 * All paths are filled silhouettes in a 24×24 viewBox, drawn white on the trail's discs and
 * inked in family colors on the plan sheets. Sources: the design project's own SVGs, Material
 * Symbols (Apache-2.0), and rect-arithmetic shapes — never hand-guessed curves (two shipped
 * broken that way).
 */
export type Glyph = { d: string; cat: Category };

export const GLYPH = {
  /** Material "wb_sunny" — clear air between rays and disc (the old sun read as a lightbulb). */
  sun: 'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
  /** Crescent moon — nighttime routines (wind-down, sleep, evening). Owner likes this one. */
  moon: 'M20 13.5A8 8 0 019 4.2a1 1 0 00-1.3-1.1A9.5 9.5 0 1021 15a1 1 0 00-1-1.5z',
  /** Material "air" — three wind lines, for breathing ("breath or wind", owner 2026-08-31). */
  wind: 'M14.5 17c0 1.65-1.35 3-3 3s-3-1.35-3-3h2c0 .55.45 1 1 1s1-.45 1-1-.45-1-1-1H2v-2h9.5c1.65 0 3 1.35 3 3zM19 6.5C19 4.57 17.43 3 15.5 3S12 4.57 12 6.5h2c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S16.33 8 15.5 8H2v2h13.5c1.93 0 3.5-1.57 3.5-3.5zm-.5 4.5H2v2h16.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5h-2c0 1.93 1.57 3.5 3.5 3.5s3.5-1.57 3.5-3.5-1.57-3.5-3.5-3.5z',
  /** Bowl with steam (design project) — a meal, no botany to misread as two apples. */
  bowl: 'M4 12h16a8 8 0 01-8 8 8 8 0 01-8-8zm4-3a4 4 0 018 0h-2a2 2 0 00-4 0H8z',
  /** Material "speed" — a gauge, for weigh-ins and measurements. */
  gauge:
    'M20.38 8.57l-1.23 1.85a8 8 0 01-.22 7.58H5.07A8 8 0 0115.58 6.85l1.85-1.23A10 10 0 003.35 19a2 2 0 001.72 1h13.85a2 2 0 001.74-1 10 10 0 00-.28-10.43zM10.59 15.41a2 2 0 002.83 0l5.66-8.49-8.49 5.66a2 2 0 000 2.83z',
  /** Dumbbell (design project) — bar, plates, caps, every coordinate a rect. */
  dumbbell: 'M3 10h2v4H3zM19 10h2v4h-2zM6 8h2v8H6zM16 8h2v8h-2zM8 11h8v2H8z',
  /** Mountain range (design project) — hills, intervals, climbs. */
  mountain: 'M3 18l6-9 4 5 5-8 3 12H3z',
  /** Material "pedal_bike" — a bicycle with no rider, for rides / rows / cross-training. */
  bike: 'M18.18 10l-1.7-4.68A2.008 2.008 0 0014.6 4H12v2h2.6l1.46 4h-4.81l-.36-1H12V7H7v2h1.75l1.82 5H9.9c-.44-2.23-2.31-3.88-4.65-3.99C2.45 9.87 0 12.2 0 15c0 2.8 2.2 5 5 5 2.46 0 4.45-1.69 4.9-4h4.2c.44 2.23 2.31 3.88 4.65 3.99 2.8.13 5.25-2.19 5.25-5 0-2.8-2.2-5-5-5h-.82zM7.82 16c-.4 1.17-1.49 2-2.82 2-1.68 0-3-1.32-3-3s1.32-3 3-3c1.33 0 2.42.83 2.82 2H5v2h2.82zm6.28-2h-1.4l-.73-2H15c-.44.58-.76 1.25-.9 2zm4.9 4c-1.68 0-3-1.32-3-3 0-.93.41-1.73 1.05-2.28l.96 2.64 1.88-.68-.97-2.67c.03 0 .06-.01.08-.01 1.68 0 3 1.32 3 3s-1.32 3-3 3z',
  /** Material "route" — a winding path between two waypoints: a run or walk is ground you cover
   *  (the anatomical runner is retired: owner, "I really don't like the man missing a leg"). */
  route:
    'M19 15.18V7c0-2.21-1.79-4-4-4s-4 1.79-4 4v10c0 1.1-.9 2-2 2s-2-.9-2-2v-5.18c1.16-.41 2-1.51 2-2.82 0-1.66-1.34-3-3-3s-3 1.34-3 3c0 1.31.84 2.41 2 2.82V17c0 2.21 1.79 4 4 4s4-1.79 4-4V7c0-1.1.9-2 2-2s2 .9 2 2v8.18c-1.16.41-2 1.51-2 2.82 0 1.66 1.34 3 3 3s3-1.34 3-3c0-1.31-.84-2.41-2-2.82z',
  /** Joint axis — four spokes around a hub, for mobility / stretching / prehab. Rects + one
   *  circle; the gap between spoke and hub is arithmetic (spokes end 1.5 units out). */
  axis: 'M11 4h2v4h-2zM11 16h2v4h-2zM4 11h4v2H4zM16 11h4v2h-4zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  /** Eighth note (design project) — music practice. */
  note: 'M9 4h9v3.2l-6.5 1V16a3.2 3.2 0 11-2.5-3.1V4z',
  /** Material "book" — reading, study, languages. */
  book: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
  /** Material "edit" — a pen, for journaling / writing / drawing ("shouldn't a journal be a
   *  book or a pen?" — owner 2026-08-31; the moon stays for pure nighttime routines). */
  pen: 'M3 17.25V21h3.75L17.81 10.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  /** Material "chat_bubble" — the weekly check-in is a conversation with her. */
  bubble: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
  /** Material "star" — bests and firsts (a shelf of accomplishments is not a music practice;
   *  the note glyph it briefly wore was the piano-as-exercise mistake all over again). */
  star: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
} as const;

export type GlyphName = keyof typeof GLYPH;

/** Family defaults, for titles no specific rule recognises. */
const FAMILY_DEFAULT: Record<Category, GlyphName> = {
  mindset: 'sun',
  movement: 'route',
  nutrition: 'bowl',
  reflection: 'moon',
  practice: 'note',
};

/** Most-specific first — a title is one activity, and the first rule that recognises it wins.
 *  Breath outranks the word "practice" ("Box breathing practice" wore a musical note for a day). */
const RULES: Array<[RegExp, GlyphName]> = [
  [/weigh|body.?weight|scale/, 'gauge'],
  [/breath|meditat|box.?breathing/, 'wind'],
  [/journal|diary/, 'pen'],
  [/wind.?down|sleep|bedtime|night.?routine/, 'moon'],
  [/check.?in/, 'bubble'],
  [/mobility|stretch|yoga|prehab|foam|joint/, 'axis'],
  [/hill|interval|sprint|stairs|climb/, 'mountain'],
  [/bike|cycl|\brow\b|rowing|swim|elliptical|cross.?train|spin\b/, 'bike'],
  [/\brun\b|running|jog|walk|hike|ruck/, 'route'],
  [/strength|lift|weights|gym|obstacle|deadlift|squat|press|pull.?up|carry|grip/, 'dumbbell'],
  [/read|study|language|vocab/, 'book'],
  [/writ|draw|sketch|paint/, 'pen'],
  [/piano|guitar|violin|music|scales|repertoire|sing|song/, 'note'],
];

/**
 * The glyph an activity wears, everywhere one is drawn. `cat` is the family (colors); `d` is the
 * path. The goal's area stays authoritative for the FAMILY; the title picks the specific glyph
 * within (or across — a breathing drill under a movement goal still gets wind, colored movement).
 */
export function glyphOf(title: string, area?: 'movement' | 'nourishment' | 'mind' | 'practice'): Glyph {
  const cat = categoryOf(title, area);
  const t = title.toLowerCase();
  if (isFoodTitle(title) || /meal|breakfast|lunch|dinner|snack|nutrition|hydrat|water/.test(t))
    return { d: GLYPH.bowl, cat };
  for (const [re, name] of RULES) if (re.test(t)) return { d: GLYPH[name], cat };
  return { d: GLYPH[FAMILY_DEFAULT[cat]], cat };
}
