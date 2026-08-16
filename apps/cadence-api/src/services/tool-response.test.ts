import { describe, it, expect, vi } from 'vitest';
import { boundToolResponse, toolEmptyText, toolFaultText, TOOL_RESPONSE_LIMIT } from './tool-response.ts';
import { executeCoachToolCalls } from './coach-tools.ts';
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';

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
