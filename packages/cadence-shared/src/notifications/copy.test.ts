/**
 * The catalog, checked against the brand — every kind, every variant, every register.
 *
 * This is the test that makes BRAND.md executable. A notification cannot be recalled, arrives with
 * no app around it to soften a phrasing, and is the one surface where a wrong sentence reaches
 * someone who is not currently choosing to hear from Cadence. So the rules are asserted over the
 * WHOLE catalog by enumeration rather than sampled kind by kind: adding a tenth nudge without
 * adding it to `NUDGE_KINDS` fails the exhaustiveness check below, and adding it correctly puts it
 * straight under every voice rule.
 */
import { describe, it, expect } from 'vitest';
import { NUDGE_KINDS, type NudgeKind } from './kinds.ts';
import { nudgeCopy, type NudgeCopyInput } from './copy.ts';
import { voiceViolations } from './voice.ts';
import type { NudgeRegister } from './pillar.ts';

const REGISTERS: NudgeRegister[] = ['body', 'mind', 'neutral'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Every input the catalog can be asked for, spread wide enough that each variant in each rotation
 * is actually exercised — seven weekdays is more than any variant list has entries, so every
 * branch of `pickVariant` is reached.
 */
function allInputs(): NudgeCopyInput[] {
  const out: NudgeCopyInput[] = [];
  for (const weekday of WEEKDAYS) {
    out.push({ kind: 'weekly_checkin', weekday });
    out.push({ kind: 'morning_adjust', done: 2, planned: 4, weekday });
    out.push({ kind: 'morning_adjust', done: 0, planned: 1, weekday });
    out.push({
      kind: 'weather_move',
      activityTitle: 'Easy run',
      conditionLabel: 'Rain',
      whenLabel: '6',
      altLabel: 'lunch',
      altConditionLabel: 'dry',
      altTempC: 18,
      weekday,
    });
    for (const register of REGISTERS) {
      out.push({
        kind: 'almost_time',
        activityId: 'a1',
        activityTitle: register === 'mind' ? 'Your evening sit' : 'Your Tuesday run',
        hour: 7,
        minute: 30,
        register,
        weekday,
      });
      out.push({
        kind: 'before_quiet_hours',
        activityId: 'a1',
        activityTitle: register === 'mind' ? 'Four breaths' : 'stretch',
        minutesUntilQuiet: 45,
        register,
        weekday,
      });
      for (const weeksOut of [6, 3, 1, 0]) {
        out.push({
          kind: 'milestone_waypoint',
          label: register === 'mind' ? 'morning pages' : 'race day',
          weeksOut,
          register,
          totalDays: 30,
          weekday,
        });
        out.push({
          kind: 'milestone_waypoint',
          label: 'race day',
          weeksOut,
          register,
          detail: 'Taper starts on the 24th.',
          weekday,
        });
      }
    }
  }
  for (const streakDays of [1, 12, 40]) {
    out.push({ kind: 'freeze_save', streakDays, savedDate: `2026-08-0${(streakDays % 9) + 1}` });
  }
  for (const episodeId of ['ep-1', 'ep-2', 'ep-3']) out.push({ kind: 'detour_ending', episodeId });
  for (const thresholdDay of [3, 7]) out.push({ kind: 're_entry', thresholdDay });
  return out;
}

const INPUTS = allInputs();

describe('the catalog is complete', () => {
  it('has copy for every kind, and every kind it has copy for is in the catalog', () => {
    const covered = new Set<NudgeKind>(INPUTS.map((i) => i.kind));
    expect([...covered].sort()).toEqual([...NUDGE_KINDS].sort());
  });

  it('never returns an empty title or body', () => {
    for (const input of INPUTS) {
      const { title, body } = nudgeCopy(input);
      expect(title.trim().length, `empty title for ${input.kind}`).toBeGreaterThan(0);
      expect(body.trim().length, `empty body for ${input.kind}`).toBeGreaterThan(0);
    }
  });

  it('leaves no unfilled template holes', () => {
    // A stray {time} on a lock screen is the most obviously machine-written failure there is.
    for (const input of INPUTS) {
      const { title, body } = nudgeCopy(input);
      expect(`${title} ${body}`, `unfilled placeholder in ${input.kind}`).not.toMatch(/[{}]/);
    }
  });
});

describe('voice — every rule, over the whole catalog', () => {
  it('breaks none of them', () => {
    const failures: string[] = [];
    for (const input of INPUTS) {
      const { title, body } = nudgeCopy(input);
      for (const text of [title, body]) {
        for (const rule of voiceViolations(text)) {
          failures.push(`[${input.kind}] "${text}" breaks ${rule.id}: ${rule.why}`);
        }
      }
    }
    expect([...new Set(failures)]).toEqual([]);
  });

  it('speaks as "I", never as "we" and never about itself in the third person', () => {
    const all = INPUTS.map((i) => nudgeCopy(i))
      .flatMap((c) => [c.title, c.body])
      .join(' ');
    expect(all).not.toMatch(/\bwe\b|\bour\b/i);
    expect(all).not.toMatch(/\bcadence\b|\bthe coach\b/i);
    // …and where the coach does refer to itself, it is as "I".
    expect(nudgeCopy({ kind: 'freeze_save', streakDays: 12, savedDate: '2026-08-06' }).body).toMatch(/\bI\b/);
  });

  it('counts what happened — never a percent, never "only"', () => {
    const { title, body } = nudgeCopy({ kind: 'morning_adjust', done: 2, planned: 4, weekday: 3 });
    expect(title).toBe('Yesterday: 2 of 4');
    expect(`${title} ${body}`).not.toMatch(/%|only/i);
  });

  it('carries no exclamation marks anywhere', () => {
    for (const input of INPUTS) {
      const { title, body } = nudgeCopy(input);
      expect(`${title}${body}`, `exclamation in ${input.kind}`).not.toContain('!');
    }
  });
});

describe('never send — the list, enforced', () => {
  const everything = INPUTS.map((i) => nudgeCopy(i))
    .flatMap((c) => [c.title, c.body])
    .join('\n');

  it('never warns that a streak is about to break, and never counts down to one', () => {
    expect(everything).not.toMatch(/streak[^\n]*\b(break|broken|lost|ends?|expire|at risk)\b/i);
    expect(everything).not.toMatch(/\b\d+ days? (left|to go|remaining) (to|before)[^\n]*streak/i);
  });

  it('never shames with a percentage', () => {
    expect(everything).not.toMatch(/\d+\s?%/);
  });

  it('has no generic daily "time to work out"', () => {
    expect(everything).not.toMatch(/time to (work ?out|exercise|train)|get moving|workout time/i);
  });

  it('never infers a wellbeing state from absence', () => {
    // re_entry is the nudge most tempted by this: it exists BECAUSE someone has been quiet.
    for (const thresholdDay of [3, 7]) {
      const { body } = nudgeCopy({ kind: 're_entry', thresholdDay });
      expect(body).not.toMatch(/\b(ok|okay|alright|struggling|hope you|everything alright|feeling)\b/i);
    }
  });

  it('proposes no detour in the re-entry nudge — the user explains the gap first', () => {
    for (const thresholdDay of [3, 7]) {
      expect(nudgeCopy({ kind: 're_entry', thresholdDay }).body).not.toMatch(/detour/i);
    }
  });
});

describe('the copy the catalog specifies', () => {
  it('almost_time titles the activity in the user’s own words', () => {
    const c = nudgeCopy({
      kind: 'almost_time',
      activityId: 'a1',
      activityTitle: 'Your Tuesday run',
      hour: 7,
      minute: 30,
      register: 'body',
      weekday: 3,
    });
    expect(c.title).toBe('Your Tuesday run');
    expect(c.body).toContain('7:30');
  });

  it('before_quiet_hours agrees its verb with the user’s own phrasing', () => {
    const singular = nudgeCopy({
      kind: 'before_quiet_hours',
      activityId: 'a1',
      activityTitle: 'stretch',
      minutesUntilQuiet: 45,
      register: 'body',
      weekday: 3,
    });
    const plural = nudgeCopy({
      kind: 'before_quiet_hours',
      activityId: 'a1',
      activityTitle: 'Four breaths',
      minutesUntilQuiet: 30,
      register: 'mind',
      weekday: 3,
    });
    expect(singular.title).toBe('Your stretch still fits');
    expect(plural.title).toBe('Four breaths still fit'); // not "Your Four breaths still fits"
    expect(plural.body).toContain('half an hour');
  });

  it('frames before_quiet_hours as fitting, never as running out', () => {
    for (const input of INPUTS.filter((i) => i.kind === 'before_quiet_hours')) {
      const { title, body } = nudgeCopy(input);
      expect(`${title} ${body}`).not.toMatch(/\b(left to|running out|last chance|deadline|before it's too late)\b/i);
    }
  });

  it('milestone_waypoint counts down in words, and reads as anticipation', () => {
    expect(
      nudgeCopy({ kind: 'milestone_waypoint', label: 'race day', weeksOut: 3, register: 'body', weekday: 3 }).title,
    ).toBe('Three weeks to race day');
    expect(
      nudgeCopy({ kind: 'milestone_waypoint', label: 'morning pages', weeksOut: 1, register: 'mind', weekday: 3 })
        .title,
    ).toBe('One week of morning pages left');
    expect(
      nudgeCopy({ kind: 'milestone_waypoint', label: 'race day', weeksOut: 0, register: 'body', weekday: 3 }).title,
    ).toBe('Tomorrow: race day');
  });

  it('freeze_save celebrates the save and says nothing about risk', () => {
    const { title, body } = nudgeCopy({ kind: 'freeze_save', streakDays: 12, savedDate: '2026-08-06' });
    expect(title).toBe("Streak's safe");
    expect(body).toContain('12 days, still counting');
    expect(body).not.toMatch(/\b(nearly|almost|close to|next time|careful)\b/i);
  });

  it('detour_ending offers both options as equals', () => {
    const { title, body } = nudgeCopy({ kind: 'detour_ending', episodeId: 'ep-1' });
    expect(title).toBe('Your detour ends tomorrow');
    expect(body.toLowerCase()).toMatch(/ease back in/);
    expect(body.toLowerCase()).toMatch(/(more time|longer|keep the detour)/);
    expect(body.toLowerCase()).toMatch(/(both are fine|either is fine)/);
  });

  it('re_entry decays: one honest line, one softer, and nothing beyond', () => {
    const three = nudgeCopy({ kind: 're_entry', thresholdDay: 3 }).body;
    const seven = nudgeCopy({ kind: 're_entry', thresholdDay: 7 }).body;
    expect(three).not.toBe(seven);
    expect(three).toMatch(/haven't seen you/i);
    expect(seven.length).toBeLessThanOrEqual(three.length); // softer, and shorter
  });

  it('weather_move speaks the temperature and asks rather than tells', () => {
    const { title, body } = nudgeCopy({
      kind: 'weather_move',
      activityTitle: 'run',
      conditionLabel: 'Rain',
      whenLabel: '6',
      altLabel: 'lunch',
      altConditionLabel: 'dry',
      altTempC: 18.4,
      weekday: 3,
    });
    expect(title).toBe('Rain at 6 tomorrow');
    expect(body).toContain('18 degrees'); // spoken, not "18°C"
    expect(body.trim().endsWith('?')).toBe(true);
  });
});

describe('rotation is deterministic', () => {
  it('says the same thing for the same activity on the same weekday, forever', () => {
    const input: NudgeCopyInput = {
      kind: 'almost_time',
      activityId: 'a1',
      activityTitle: 'Your Tuesday run',
      hour: 7,
      minute: 0,
      register: 'body',
      weekday: 3,
    };
    expect(nudgeCopy(input)).toEqual(nudgeCopy(input));
  });

  it('does not say the identical thing on every weekday', () => {
    const bodies = new Set(
      WEEKDAYS.map(
        (weekday) =>
          nudgeCopy({
            kind: 'almost_time',
            activityId: 'a1',
            activityTitle: 'Your run',
            hour: 7,
            minute: 0,
            register: 'body',
            weekday,
          }).body,
      ),
    );
    expect(bodies.size).toBeGreaterThan(1);
  });

  it('does not hand two different activities an identical script', () => {
    const forActivity = (activityId: string) =>
      WEEKDAYS.map(
        (weekday) =>
          nudgeCopy({
            kind: 'almost_time',
            activityId,
            activityTitle: 'Your run',
            hour: 7,
            minute: 0,
            register: 'body',
            weekday,
          }).body,
      ).join('|');
    expect(forActivity('a1')).not.toBe(forActivity('a2'));
  });
});
