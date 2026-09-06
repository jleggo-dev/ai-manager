import { describe, expect, it } from 'vitest';
import { BREATH_PATTERNS } from './breathing.ts';
import { INTERVAL_TEMPLATES } from './interval.ts';
import { COACH_TOOLS, renderCoachToolCatalog } from './tool-catalog.ts';

/**
 * The owner's red line, applied to the tool catalog (2026-09-03, prompt-bias audit packet C):
 * the strings a model reads carry FACTS, DEFINITIONS, SAFETY BOUNDARIES and the OUTPUT CONTRACT —
 * never what to prefer, how many, which kind, or when.
 *
 * Every removal below shipped with the row that catches its return. The failures they guard are
 * real ones: "DO NOT SET IT for: strength, cardio, …" banned the metronome on six of the app's own
 * activity kinds, so a rower asking for a cadence click could not be given one; "a novelist gets
 * craft, never gratitude" forbade a legitimate pairing outright; "the safest default", "the
 * generic default" and "the one to build a daily practice on" each named a winner among equals.
 *
 * The rendered block is the surface that matters — a steer deleted from `COACH_TOOLS` but left in
 * `renderCoachToolCatalog`'s hand-written sections still reaches the coach — so most rows assert
 * against the render.
 */
describe('tool catalog carries facts, not picks', () => {
  const rendered = renderCoachToolCatalog();

  /** [id, the phrase that must be gone, why it was a pick] */
  const GONE: Array<[string, string, string]> = [
    ['TK-1', 'almost never a timer', 'tool choice stated as a frequency instead of a mapping'],
    ['TK-2', 'while you are still learning', 'how often a mood check may appear'],
    ['TK-2', 'Do NOT schedule it every day indefinitely', 'orders the check-in to stop'],
    ['TK-3', 'Never place two capture steps in a row', 'session layout by taste'],
    ['TK-4', "prefer the day's own meal-log tasks", 'routes photo steps for her'],
    ['TK-5', 'your own sentence always wins', 'names a winner, plus a frequency claim'],
    ['TK-5', 'for craft work it usually should', 'names a winner, plus a frequency claim'],
    ['TK-6', 'a novelist gets craft, never gratitude', 'forbids a legitimate pairing outright'],
    ['TK-6', 'Treat the banks as a fallback', 'ranks the banks below her own prompt'],
    ['TK-7', 'Pick from the family that matches', 'the same bank steer in the rendered header'],
    ['TK-7', 'beats any of them', 'the same bank steer in the rendered header'],
    ['TK-8', 'SET IT for:', 'a whitelist of activities for the metronome'],
    ['TK-8', 'DO NOT SET IT for:', 'a categorical ban on six of the app own activity kinds'],
    ['TK-9', 'set it below', 'a music-teaching opinion about tempo'],
    ['TK-10', 'only for longer sits', 'restricts when sitting bells may be used'],
    ['TK-11', 'omit them when the session already has its own warm-up', 'when a block may carry a warm-up'],
    ['TK-12', 'the one to build a daily practice on', 'names the single right daily breath pattern'],
    ['TK-13', 'the safest default', 'names a default breath pattern'],
    ['TK-14', 'the fastest way to settle', 'a comparative claim across patterns'],
    ['TK-15', 'the place to start if none of this is familiar', 'names the beginner pattern'],
    ['TK-16', 'for the end of the day, or sleep', 'restricts when the pattern may be used'],
    ['TK-17', 'three or four is plenty', 'a count'],
    ['TK-17', 'Keep it brief and only before effort', 'a count the catalog appended to a safety caution'],
    ['TK-18', 'the generic default', 'a default among interval shapes'],
    ['TK-18', 'it is meant to hurt', 'a sentiment the file own style rule bans'],
  ];

  it.each(GONE)('%s: the render no longer says "%s" (%s)', (_id, phrase) => {
    expect(rendered).not.toContain(phrase);
  });

  /** [id, the fact that replaced it] */
  const PRESENT: Array<[string, string]> = [
    ['TK-1', 'A duration alone does not pick the tool: meditate runs silence with bells'],
    ['TK-4', "A photo sent through the day's meal tasks is read into foods and priced for macros"],
    ['TK-5', 'when you set both, the detail prompt is the one they see'],
    ['TK-6', 'any bank is valid on any journal item'],
    ['TK-7', 'A prompt you write in "detail" replaces the bank\'s question when both are set.'],
    ['TK-8', 'It works on any step, whatever its tool'],
    ['TK-9', 'Where someone has settled on a tempo for a piece, get_repertoire has it on that item.'],
    ['TK-10', 'to add a bell every'],
    ['TK-12', 'equal in and out, about five and a half seconds each, no holds'],
    ['TK-13', 'even four counts all the way round — in, hold, out, hold'],
    ['TK-14', 'in for four, out for six — only the out-breath is stretched'],
    ['TK-15', 'in and out, same count, no holds'],
    ['TK-16', 'a long hold and a longer exhale — in for four, hold seven, out eight'],
    ['TK-17', 'two breaths in — a full one, then a short top-up — then one long release'],
    ['TK-18', 'hard effort with a real breather between'],
    ['TK-18', 'twenty on, ten off, eight rounds — four minutes'],
  ];

  it.each(PRESENT)('%s: the fact that replaced it is in the render — "%s"', (_id, phrase) => {
    expect(rendered).toContain(phrase);
  });

  /* ── The same removals at their source, so a re-edit of the data files is caught too ──────── */

  it('TK-2/TK-3: the feeling_log entry states its shape and schedules nothing', () => {
    const t = COACH_TOOLS.feeling_log;
    expect(t.summary).toBe(
      "a 20-second check-in — ONE word for how they're doing and how much room it's taking, plus an optional line",
    );
    expect(t.notWhen).toContain('a word and a size, never sentences — writing meant to be reread is journal');
    // ...and, since 2026-09-06, which HALF of the person it is about — a knee is not "settled".
    expect(t.notWhen).toContain('a check on a knee, a back, an ankle is checkoff');
  });

  it('TK-11: the interval trap places warm-up and cool-down without saying when to omit them', () => {
    expect(COACH_TOOLS.interval.notWhen).toContain('Warm-up and cool-down are optional and sit OUTSIDE the rounds');
    expect(COACH_TOOLS.interval.notWhen).not.toMatch(/omit them when/i);
  });

  it('TK-12..TK-17: no breath pattern summary ranks itself against the others', () => {
    const RANKING = /\b(default|best|fastest|safest|start here|the one to|plenty)\b/i;
    const offenders = BREATH_PATTERNS.filter((p) => RANKING.test(p.summary)).map((p) => `${p.id}: ${p.summary}`);
    expect(offenders).toEqual([]);
  });

  it('TK-18: no interval template summary calls itself the default', () => {
    const offenders = INTERVAL_TEMPLATES.filter((t) => /\bdefault\b/i.test(t.summary)).map((t) => t.label);
    expect(offenders).toEqual([]);
  });

  it('the metronome section still states its facts and its bounds', () => {
    expect(rendered).toContain('"metronome_bpm" (30-240) turns it on. Omit it and the step has no metronome.');
    expect(rendered).toContain('"metronome_meter" is beats per bar');
  });

  it('the sitting section still states the interval-bell bounds it now teaches', () => {
    expect(rendered).toContain('1 minute or more');
    expect(rendered).toContain('never longer than the sit; 5 when omitted');
    expect(rendered).toContain('Anything else is replaced with start_end.');
  });

  it("up_shift's own safety caution survives the trimmed catalog line", () => {
    expect(rendered).toContain('caution: Sit down for this one, and stop if you feel lightheaded.');
  });
});
