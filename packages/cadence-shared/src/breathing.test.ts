import { describe, it, expect } from 'vitest';
import { deriveWalkthrough, stepCaptureMode } from './walkthrough.ts';
import { COACH_TOOLS, SESSION_TOOL_KINDS, renderCoachToolCatalog } from './tool-catalog.ts';
import type { OccurrenceSession } from './types/occurrence.ts';
import {
  BREATH_PATTERNS,
  DEFAULT_CYCLES,
  MAX_HOLD_SECONDS,
  MAX_SESSION_SECONDS,
  MAX_UP_SHIFT_SECONDS,
  breathFullness,
  breathLogLine,
  clampCycles,
  cycleSeconds,
  isBreathPatternId,
  patternById,
  patternCounts,
  phaseAt,
  totalMinutes,
  totalSeconds,
} from './breathing.ts';

describe('the pattern bank', () => {
  it('ships nine patterns with unique ids', () => {
    const ids = BREATH_PATTERNS.map((p) => p.id);
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
  });

  it('gives every pattern at least one phase and a positive cycle length', () => {
    for (const p of BREATH_PATTERNS) {
      expect(p.phases.length).toBeGreaterThan(0);
      expect(cycleSeconds(p)).toBeGreaterThan(0);
    }
  });

  it('never ships a held phase longer than the cap', () => {
    for (const p of BREATH_PATTERNS) {
      for (const phase of p.phases) {
        expect(phase.seconds).toBeLessThanOrEqual(MAX_HOLD_SECONDS);
      }
    }
  });

  it('carries seated copy on every gated pattern', () => {
    for (const p of BREATH_PATTERNS.filter((x) => x.gated)) {
      expect(p.caution).toBeTruthy();
    }
  });

  it('models the double inhale as two separate in-phases', () => {
    const sigh = patternById('physiological_sigh');
    const inhales = sigh.phases.filter((p) => p.label.startsWith('In'));
    expect(inhales).toHaveLength(2);
    expect(sigh.phases[sigh.phases.length - 1]?.label).toBe('Out');
  });

  it('gives alternate-nostril a cue on the phases that switch sides', () => {
    const alt = patternById('alternate_nostril');
    expect(alt.phases.filter((p) => p.cue).length).toBeGreaterThanOrEqual(4);
  });
});

describe('patternById', () => {
  it('finds a known pattern', () => {
    expect(patternById('box').id).toBe('box');
  });

  it('falls back to the default rather than throwing on junk', () => {
    expect(patternById('not-a-pattern').id).toBe('coherent');
    expect(patternById(null).id).toBe('coherent');
    expect(patternById(undefined).id).toBe('coherent');
  });

  it('recognises valid ids', () => {
    expect(isBreathPatternId('wind_down')).toBe(true);
    expect(isBreathPatternId('nope')).toBe(false);
    expect(isBreathPatternId(null)).toBe(false);
  });
});

describe('cycle maths', () => {
  it('sums a cycle', () => {
    expect(cycleSeconds(patternById('box'))).toBe(16);
    expect(cycleSeconds(patternById('wind_down'))).toBe(19);
    expect(cycleSeconds(patternById('coherent'))).toBe(11);
  });

  it('multiplies out to a total', () => {
    expect(totalSeconds(patternById('box'), 4)).toBe(64);
  });

  it('floors minutes at 1 so a short run never reads as zero', () => {
    expect(totalMinutes(patternById('up_shift'), 3)).toBe(1);
  });
});

describe('clampCycles — the safety caps the coach cannot exceed', () => {
  it('defaults when the coach gives no count', () => {
    expect(clampCycles(patternById('box'), null)).toBe(DEFAULT_CYCLES);
    expect(clampCycles(patternById('box'), undefined)).toBe(DEFAULT_CYCLES);
  });

  it('floors at one — a step can never be empty', () => {
    expect(clampCycles(patternById('box'), 0)).toBe(1);
    expect(clampCycles(patternById('box'), -5)).toBe(1);
  });

  it('never lets a session exceed the cap', () => {
    for (const p of BREATH_PATTERNS) {
      const cap = p.gated ? MAX_UP_SHIFT_SECONDS : MAX_SESSION_SECONDS;
      expect(cycleSeconds(p) * clampCycles(p, 9999)).toBeLessThanOrEqual(cap);
    }
  });

  it('caps the energizing pattern far harder than the rest', () => {
    const up = patternById('up_shift');
    expect(cycleSeconds(up) * clampCycles(up, 100)).toBeLessThanOrEqual(MAX_UP_SHIFT_SECONDS);
    expect(clampCycles(up, 100)).toBeLessThan(clampCycles(patternById('box'), 100));
  });

  it('rounds a fractional count', () => {
    expect(clampCycles(patternById('box'), 3.4)).toBe(3);
    expect(clampCycles(patternById('box'), 3.6)).toBe(4);
  });

  it('survives NaN', () => {
    expect(clampCycles(patternById('box'), Number.NaN)).toBe(DEFAULT_CYCLES);
  });
});

describe('phaseAt — the player position', () => {
  const box = patternById('box');

  it('starts on the first phase', () => {
    const at = phaseAt(box, 4, 0);
    expect(at.phase.label).toBe('In');
    expect(at.cycle).toBe(0);
    expect(at.remaining).toBe(4);
    expect(at.progress).toBe(0);
    expect(at.done).toBe(false);
  });

  it('walks the phases in order within a cycle', () => {
    expect(phaseAt(box, 4, 2).phase.label).toBe('In');
    expect(phaseAt(box, 4, 5).phase.label).toBe('Hold');
    expect(phaseAt(box, 4, 9).phase.label).toBe('Out');
    expect(phaseAt(box, 4, 13).phase.label).toBe('Hold');
  });

  it('counts down within a phase', () => {
    expect(phaseAt(box, 4, 1).remaining).toBe(3);
    expect(phaseAt(box, 4, 3.5).remaining).toBeCloseTo(0.5);
  });

  it('advances the cycle', () => {
    expect(phaseAt(box, 4, 16).cycle).toBe(1);
    expect(phaseAt(box, 4, 16).phase.label).toBe('In');
    expect(phaseAt(box, 4, 33).cycle).toBe(2);
  });

  it('reports done at the end and stays done', () => {
    expect(phaseAt(box, 2, 32).done).toBe(true);
    expect(phaseAt(box, 2, 999).done).toBe(true);
  });

  it('is a pure function of time — the same elapsed always gives the same position', () => {
    expect(phaseAt(box, 4, 9)).toEqual(phaseAt(box, 4, 9));
  });

  it('treats negative elapsed as the start', () => {
    expect(phaseAt(box, 4, -3).phase.label).toBe('In');
    expect(phaseAt(box, 4, -3).done).toBe(false);
  });

  it('handles a fractional-second pattern', () => {
    const coherent = patternById('coherent');
    expect(phaseAt(coherent, 2, 5).phase.label).toBe('In');
    expect(phaseAt(coherent, 2, 6).phase.label).toBe('Out');
  });

  it('respects the clamp — elapsed past the CLAMPED run is done', () => {
    const up = patternById('up_shift');
    expect(phaseAt(up, 500, MAX_UP_SHIFT_SECONDS + 1).done).toBe(true);
  });
});

describe('presentation helpers', () => {
  it('renders counts', () => {
    expect(patternCounts(patternById('wind_down'))).toBe('4 · 7 · 8');
    expect(patternCounts(patternById('coherent'))).toBe('5.5 · 5.5');
  });

  it('logs a completed run plainly', () => {
    expect(breathLogLine(patternById('box'), 6, 6)).toBe('Box · 6 rounds');
  });

  it('gives partial credit without shame', () => {
    expect(breathLogLine(patternById('box'), 2, 6)).toBe('Box · 2 of 6 rounds · that counts');
  });

  it('never reports more than were played', () => {
    expect(breathLogLine(patternById('box'), 99, 6)).toBe('Box · 6 rounds');
  });
});

/* ── The projection: a coach's item → a playable step ─────────────────────────────────────── */

const session = (item: Record<string, unknown>): OccurrenceSession => ({
  blocks: [{ label: 'Practice', items: [{ name: 'Settle', ...item }] as never }],
  note: '',
  generated_at: '2026-08-01T00:00:00.000Z',
  version: 1,
});

describe('deriveWalkthrough — breathing', () => {
  it('plays the pattern the coach named', () => {
    const step = deriveWalkthrough(session({ tool: 'breathing', breath_pattern: 'box', breath_cycles: 6 })).steps[0];
    expect(step?.tool.kind).toBe('breathing');
    if (step?.tool.kind === 'breathing') {
      expect(step.tool.pattern.id).toBe('box');
      expect(step.tool.cycles).toBe(6);
    }
  });

  it('falls back to the default pattern when the coach invents one', () => {
    const step = deriveWalkthrough(session({ tool: 'breathing', breath_pattern: 'wim_hof' })).steps[0];
    if (step?.tool.kind === 'breathing') expect(step.tool.pattern.id).toBe('coherent');
  });

  it('clamps an unsafe cycle count at projection time', () => {
    const step = deriveWalkthrough(session({ tool: 'breathing', breath_pattern: 'up_shift', breath_cycles: 999 }))
      .steps[0];
    if (step?.tool.kind === 'breathing') {
      expect(cycleSeconds(step.tool.pattern) * step.tool.cycles).toBeLessThanOrEqual(MAX_UP_SHIFT_SECONDS);
    }
  });

  it('computes minutes from the pattern, ignoring any stated duration', () => {
    const step = deriveWalkthrough(
      session({ tool: 'breathing', breath_pattern: 'box', breath_cycles: 6, duration_min: 45 }),
    ).steps[0];
    expect(step?.minutes).toBe(2); // 16s × 6 = 96s
  });

  it('is NEVER inferred — a bare duration is still a timer', () => {
    const step = deriveWalkthrough(session({ duration_min: 5 })).steps[0];
    expect(step?.tool.kind).toBe('timer');
  });

  it('captures nothing structured — the log records rounds, not the person', () => {
    expect(stepCaptureMode({ kind: 'breathing', pattern: patternById('box'), cycles: 6 })).toBe('done');
  });
});

describe('the coach catalog', () => {
  it('lists breathing as a tool the coach may compose', () => {
    expect(SESSION_TOOL_KINDS).toContain('breathing');
    expect(COACH_TOOLS.breathing.reads).toContain('breath_pattern');
  });

  it('teaches every pattern id, so the coach never has to guess a name', () => {
    const rendered = renderCoachToolCatalog();
    for (const p of BREATH_PATTERNS) expect(rendered).toContain(p.id);
  });

  it('warns the coach about the one gated pattern', () => {
    const rendered = renderCoachToolCatalog();
    expect(rendered).toMatch(/caution/i);
  });

  it('tells the coach not to confuse breathing with a timer', () => {
    expect(COACH_TOOLS.breathing.notWhen).toMatch(/timer/i);
  });
});

describe('breathFullness — what the animated form follows', () => {
  it('fills through an in-breath and empties through an out-breath', () => {
    const box = patternById('box');
    expect(breathFullness(box, 0, 0)).toBe(0);
    expect(breathFullness(box, 0, 1)).toBe(1);
    expect(breathFullness(box, 2, 0)).toBe(1);
    expect(breathFullness(box, 2, 1)).toBe(0);
  });

  it('holds at full after an in-breath and at empty after an out-breath', () => {
    const box = patternById('box');
    expect(breathFullness(box, 1, 0.5)).toBe(1); // hold after In
    expect(breathFullness(box, 3, 0.5)).toBe(0); // hold after Out
  });

  it('treats the double breath as ONE continuous inhale — the top-up never collapses the form', () => {
    const sigh = patternById('physiological_sigh'); // In 3 · In again 1 · Out 6
    expect(breathFullness(sigh, 0, 0)).toBe(0);
    expect(breathFullness(sigh, 0, 1)).toBeCloseTo(0.75); // first inhale ends 3/4 full
    expect(breathFullness(sigh, 1, 0)).toBeCloseTo(0.75); // top-up STARTS there, not at zero
    expect(breathFullness(sigh, 1, 1)).toBe(1);
  });

  it('never goes backwards across the sigh boundary (the bug browser-verification caught)', () => {
    const sigh = patternById('physiological_sigh');
    expect(breathFullness(sigh, 1, 0)).toBeGreaterThanOrEqual(breathFullness(sigh, 0, 1) - 1e-9);
  });

  it('restarts each side of alternate-nostril, which is two separate breaths', () => {
    const alt = patternById('alternate_nostril'); // In Hold Out In Hold Out
    expect(breathFullness(alt, 3, 0)).toBe(0);
    expect(breathFullness(alt, 3, 1)).toBe(1);
  });

  it('stays within 0..1 for every phase of every pattern', () => {
    for (const p of BREATH_PATTERNS) {
      for (let i = 0; i < p.phases.length; i += 1) {
        for (const prog of [0, 0.5, 1]) {
          const f = breathFullness(p, i, prog);
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('is total on a bad index', () => {
    expect(breathFullness(patternById('box'), 99, 0.5)).toBe(0);
  });
});
