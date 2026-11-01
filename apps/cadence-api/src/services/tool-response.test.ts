import { describe, it, expect, vi } from 'vitest';
import {
  boundToolResponse,
  toolActionFaultText,
  toolChangeText,
  toolEmptyText,
  toolFaultText,
  toolNothingChangedText,
  toolOutputShape,
  TOOL_RESPONSE_LIMIT,
} from './tool-response.ts';
import { executeCoachToolCalls } from './coach-tools.ts';
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { COACH_ACTION_TOOLS } from './coach-actions.ts';

const HOW = 'see docs/cadence/TOOL-HARNESS.md → "Adding a tool: the checklist", step 4';

/**
 * The response audit — the gate this harness has never had.
 *
 * Descriptions get seven checks; what a tool HANDS BACK got none, and responses are the half the
 * model reasons over. The cost was the week's worst bug: both Apple Health reads threw, the throw
 * was swallowed as "(nothing on file for this yet)", and the coach told a user with thirty recorded
 * workouts that he had none. Four device rounds, because nothing anywhere said a tool had failed.
 */

describe('an error never looks like an empty result', () => {
  it('says the fault is ours, in words she can repeat honestly', () => {
    const t = toolFaultText('get_workout_history');
    expect(t).toContain('get_workout_history');
    expect(t).toMatch(/NOT an empty record/);
    expect(t).toMatch(/could not check it/i);
  });

  /** The two must not be confusable by a model skimming: no shared "nothing" phrasing. */
  it('shares no wording with the genuinely-empty answer', () => {
    expect(toolFaultText('x')).not.toMatch(/nothing on file/i);
    expect(toolEmptyText('x')).not.toMatch(/fault|could not/i);
  });

  /** The exact regression: a render that throws must reach her as a fault, never as "no data". */
  it('a throwing render reaches her as a fault, not as an empty record', async () => {
    const original = RETRIEVAL_FUNCTIONS.get_active_plan!.run;
    const spy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_active_plan!, 'render').mockImplementation(() => {
      throw new TypeError('startedAt.slice is not a function');
    });
    const runSpy = vi
      .spyOn(RETRIEVAL_FUNCTIONS.get_active_plan!, 'run')
      .mockResolvedValue({ plan: {}, activities: [] });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const [out] = await executeCoachToolCalls('u1', [{ toolCallId: '1', name: 'get_active_plan' }]);
      expect(out!.output, HOW).toMatch(/NOT an empty record/);
      expect(out!.output).not.toMatch(/nothing on file/i);
    } finally {
      spy.mockRestore();
      runSpy.mockRestore();
      quiet.mockRestore();
      RETRIEVAL_FUNCTIONS.get_active_plan!.run = original;
    }
  });
});

describe('a response is bounded, and says when it was cut', () => {
  it('leaves an ordinary response exactly as it was', () => {
    const small = 'Recorded workouts (last 7d):\n- 2026-08-15 · running · 77 min';
    expect(boundToolResponse(small)).toBe(small);
  });

  /** Silent truncation is a quiet lie about completeness — the cut has to be spoken. */
  it('cuts an enormous one and tells her it is partial, with what to do', () => {
    const huge = Array.from({ length: 4000 }, (_, i) => `- 2026-01-01 · run ${i} · 30 min`).join('\n');
    const out = boundToolResponse(huge);
    expect(out.length).toBeLessThan(huge.length);
    expect(out).toMatch(/TRUNCATED/);
    expect(out).toMatch(/narrower period/);
    expect(out, HOW).toMatch(/not describe this to the user as everything on file/);
  });

  it('cuts at a line boundary so a row is never half-shown and misread as data', () => {
    const rows = Array.from({ length: 4000 }, () => '- 2026-01-01 · running · 30 min · 5.2 km').join('\n');
    const body = boundToolResponse(rows).split('\n— TRUNCATED')[0]!;
    for (const line of body.split('\n')) expect(line).toBe('- 2026-01-01 · running · 30 min · 5.2 km');
  });

  it('is generous enough that nothing legitimate is near it', () => {
    // The largest render measured against the owner's real dossier was under 1,000 chars.
    expect(TOOL_RESPONSE_LIMIT).toBeGreaterThan(5_000);
  });
});

describe('every tool path is bounded, not just the ones someone remembered', () => {
  it('bounds a read that returns an enormous render', async () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `- row ${i}`).join('\n');
    const runSpy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_active_plan!, 'run').mockResolvedValue({});
    const spy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_active_plan!, 'render').mockReturnValue(huge);
    try {
      const [out] = await executeCoachToolCalls('u1', [{ toolCallId: '1', name: 'get_active_plan' }]);
      expect(out!.output.length, HOW).toBeLessThan(huge.length);
      expect(out!.output).toMatch(/TRUNCATED/);
    } finally {
      spy.mockRestore();
      runSpy.mockRestore();
    }
  });

  it('an empty render still answers in words rather than with silence', async () => {
    const runSpy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_active_plan!, 'run').mockResolvedValue({});
    const spy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_active_plan!, 'render').mockReturnValue('');
    try {
      const [out] = await executeCoachToolCalls('u1', [{ toolCallId: '1', name: 'get_active_plan' }]);
      // An empty string upstream reads as a tool that silently failed; she should say "nothing yet".
      expect(out!.output.trim().length).toBeGreaterThan(0);
      expect(out!.output).toMatch(/nothing on file/i);
    } finally {
      spy.mockRestore();
      runSpy.mockRestore();
    }
  });
});

/**
 * Actions too (HARNESS-V3 C4, gap 1). `actionOutputs` used to pass straight through — the one path
 * in the harness where a tool could hand her text of any length. The catch path is bounded as well,
 * so nothing an action produces, thrown or returned, escapes the limit.
 */
describe('what an action hands back is bounded too', () => {
  it('cuts an action that returns an enormous answer, and says it was cut', async () => {
    const huge = Array.from({ length: 5000 }, (_, i) => `changed: row ${i}`).join('\n');
    const spy = vi.spyOn(COACH_ACTION_TOOLS.log_session!, 'run').mockResolvedValue(huge);
    try {
      const [out] = await executeCoachToolCalls('u1', [{ toolCallId: '1', name: 'log_session' }]);
      expect(out!.output.length, HOW).toBeLessThanOrEqual(TOOL_RESPONSE_LIMIT + 200);
      expect(out!.output).toMatch(/TRUNCATED/);
      expect(out!.output.startsWith('changed: row 0')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('an action that throws reaches her as a fault, in the fault shape, and bounded', async () => {
    const spy = vi.spyOn(COACH_ACTION_TOOLS.log_session!, 'run').mockRejectedValue(new Error('db down'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const [out] = await executeCoachToolCalls('u1', [{ toolCallId: '1', name: 'log_session' }]);
      expect(out!.output).toBe(toolActionFaultText());
      expect(toolOutputShape(out!.output)).toBe('fault');
      expect(out!.output.length).toBeLessThan(TOOL_RESPONSE_LIMIT);
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
  });
});

/**
 * The three shapes an action answers in (HARNESS-V3 C4, gap 3). The first line decides which, so a
 * model skimming — or a log reader — can tell "it changed", "it did not" and "it broke" apart from
 * the first few words. coach-action-contract.test.ts holds every action to these.
 */
describe('an action says what changed, what did not, or that it broke', () => {
  it('writes one changed: line per fact, then unchanged: lines, then her next steps', () => {
    const out = toolChangeText({
      changed: ['"Read 50 books" now aims at 50 books (was 100).'],
      unchanged: ['their current week — it still holds the sessions built before this.'],
      next: ['Say what changed.'],
    });
    expect(out.split('\n')).toEqual([
      'changed: "Read 50 books" now aims at 50 books (was 100).',
      'unchanged: their current week — it still holds the sessions built before this.',
      'Say what changed.',
    ]);
    expect(toolOutputShape(out)).toBe('changed');
  });

  it('says nothing changed, and why, on its first line', () => {
    const out = toolNothingChangedText('no goal was named.', ['Ask which goal they mean.']);
    expect(out).toBe('nothing changed: no goal was named.\nAsk which goal they mean.');
    expect(toolOutputShape(out)).toBe('nothing-changed');
  });

  it('an action fault is a fault — and shares the read fault its marker', () => {
    expect(toolOutputShape(toolActionFaultText())).toBe('fault');
    expect(toolOutputShape(toolActionFaultText('That could not be logged', 'point them at the Food screen.'))).toBe(
      'fault',
    );
    expect(toolOutputShape(toolFaultText('get_workout_history'))).toBe('fault');
    expect(toolActionFaultText()).not.toMatch(/nothing on file|nothing changed/i);
  });

  /** Table: the first line decides, and near-misses are not mistaken for a shape. */
  it.each([
    ['changed: x', 'changed'],
    ['changed: x\nnothing changed: y', 'changed'],
    ['nothing changed: x\nchanged: y', 'nothing-changed'],
    ['Changed: x', 'unshaped'], // capital — not the helper's output
    ['unchanged: x', 'unshaped'], // a call that only lists what stayed is not a change
    ['Done — x\nchanged: y', 'unshaped'], // the shape is the FIRST line, not any line
    ['changed:x', 'unshaped'], // no space: hand-typed, not the helper
    ['Nothing was changed: x', 'unshaped'], // the old wording, before the helper
    ['', 'unshaped'],
  ] as const)('%j → %s', (text, shape) => {
    expect(toolOutputShape(text)).toBe(shape);
  });
});
