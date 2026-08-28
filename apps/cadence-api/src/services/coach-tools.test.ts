import { describe, it, expect, vi } from 'vitest';
import { executeCoachToolCalls } from './coach-tools.ts';
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';

/**
 * MP0e, wired through to where it actually bites: a ROUND of parallel model tool calls.
 * `coach-tool-loop.ts` already notes parallel tool calls are on for this profile, "so two
 * identical calls can arrive together" — and since `get_nutrition` took a `view` parameter
 * (nutrition-facade.ts), two DIFFERENT calls sharing one name is not a hypothetical: a turn that
 * needs both what they ate and their targets is an ordinary one, and the model can reasonably ask
 * for both views in a single round.
 *
 * Before the fix, `executeCoachToolCalls` rendered every read off `results[c.name]` —
 * `select-and-run.ts`'s `executeCalls` only ever kept ONE value per function name, whichever call
 * happened to run last. So the FIRST toolCallId's response would be the SECOND call's answer:
 * silently attributed to the wrong question, with no error anywhere to notice it by.
 *
 * `get_nutrition`'s own `run`/`render`/`rows` all dispatch on `view` (nutrition-facade.ts) and
 * `rows` in particular expects the SHAPE `run` returns, not just its `view` tag — so all three are
 * spied here rather than letting the real dispatch run: this is a test of `coach-tools.ts`'s
 * call-to-output wiring, not of the facade's own routing.
 */
describe('a round with two same-name calls, different arguments (MP0e)', () => {
  it('each call gets its own answer, not whichever ran last', async () => {
    const runSpy = vi
      .spyOn(RETRIEVAL_FUNCTIONS.get_nutrition!, 'run')
      .mockImplementation(async (_userId, params) => ({ view: (params as { view?: string } | undefined)?.view }));
    const renderSpy = vi
      .spyOn(RETRIEVAL_FUNCTIONS.get_nutrition!, 'render')
      .mockImplementation((r) => `view=${(r as { view?: string }).view}`);
    const rowsSpy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_nutrition!, 'rows').mockReturnValue(1);

    try {
      const [logOut, targetsOut] = await executeCoachToolCalls('u1', [
        { toolCallId: 'call-log', name: 'get_nutrition', arguments: '{"view":"log"}' },
        { toolCallId: 'call-targets', name: 'get_nutrition', arguments: '{"view":"targets"}' },
      ]);

      expect(logOut!.toolCallId).toBe('call-log');
      expect(logOut!.output).toContain('view=log');
      expect(targetsOut!.toolCallId).toBe('call-targets');
      expect(targetsOut!.output).toContain('view=targets');
      // The regression this pins: on the pre-fix code both of the above read "view=targets" —
      // whichever call `results[fn]` happened to hold by the time rendering ran.
      expect(logOut!.output).not.toBe(targetsOut!.output);
    } finally {
      runSpy.mockRestore();
      renderSpy.mockRestore();
      rowsSpy.mockRestore();
    }
  });

  /**
   * The same collision on the FAULT side: if the FIRST of two same-name calls is the one that
   * throws, the fix must not let the second call's success paper over it (or vice versa). Each
   * toolCallId is independent — one throwing must not change what the other reports.
   */
  it('one call throwing does not change the other’s answer, either direction', async () => {
    const runSpy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_nutrition!, 'run').mockImplementation(async (_userId, params) => {
      const view = (params as { view?: string } | undefined)?.view;
      if (view === 'log') throw new Error('db down');
      return { view };
    });
    const renderSpy = vi
      .spyOn(RETRIEVAL_FUNCTIONS.get_nutrition!, 'render')
      .mockImplementation((r) => `view=${(r as { view?: string }).view}`);
    const rowsSpy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_nutrition!, 'rows').mockReturnValue(1);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const [logOut, targetsOut] = await executeCoachToolCalls('u1', [
        { toolCallId: 'call-log', name: 'get_nutrition', arguments: '{"view":"log"}' },
        { toolCallId: 'call-targets', name: 'get_nutrition', arguments: '{"view":"targets"}' },
      ]);

      // The throwing call reads as a FAULT (undefined on perCall), never as the other call's data
      // and never as a silent empty result.
      expect(logOut!.toolCallId).toBe('call-log');
      expect(logOut!.output).toMatch(/NOT an empty record|could not check/i);
      expect(logOut!.output).not.toContain('view=targets');
      // The call that succeeded is unaffected by its neighbour's failure.
      expect(targetsOut!.toolCallId).toBe('call-targets');
      expect(targetsOut!.output).toContain('view=targets');
    } finally {
      runSpy.mockRestore();
      renderSpy.mockRestore();
      rowsSpy.mockRestore();
      quiet.mockRestore();
    }
  });
});
