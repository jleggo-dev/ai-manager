import { describe, expect, it, vi } from 'vitest';
import { MAX_COACH_TOOL_ROUNDS, relayCoachTurnWithTools } from './coach-tool-loop.ts';

/**
 * The tool loop, against fabricated upstream streams. The live probe (#189-#191) proved the
 * upstream halves; these prove the RELAY's contract — the pieces a device test can't isolate:
 * exactly one [DONE] reaches the client, content accumulates across continuations, unknown tool
 * names are left alone, the round cap holds, and a failed fulfillment still ends the turn
 * cleanly. Stream shapes mirror the probe's captured stream (message.complete with an `output`
 * array carrying completed function_call items; the reply's text riding deltas).
 */

const enc = new TextEncoder();
const stream = (lines: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(enc.encode(lines.map((l) => `${l}\n`).join('')));
      ctrl.close();
    },
  });

const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;
/** `args` matters: a round that repeats a call byte for byte is treated as no progress made. */
const complete = (responseId: string, calls: Array<{ id: string; name: string; args?: string }> = []) =>
  `data: ${JSON.stringify({
    type: 'message.complete',
    text: '',
    responseId,
    output: calls.map((c) => ({
      type: 'function_call',
      call_id: c.id,
      name: c.name,
      arguments: c.args ?? '{}',
      status: 'completed',
    })),
  })}`;
const DONE = 'data: [DONE]';

function collectWrites() {
  const writes: string[] = [];
  return { writes, writeChunk: (t: string) => void writes.push(t) };
}

describe('relayCoachTurnWithTools', () => {
  it('plain turn: relays deltas, suppresses upstream terminals, writes exactly one [DONE]', async () => {
    const { writes, writeChunk } = collectWrites();
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([delta('Hello'), delta(' there'), DONE, complete('r1'), DONE]),
      { toolNames: new Set(['get_weight']), execute: vi.fn(), submit: vi.fn() },
      { writeChunk },
    );
    expect(result.content).toBe('Hello there');
    expect(result.toolRounds).toBe(0);
    const dones = writes.filter((w) => w.includes('[DONE]'));
    expect(dones).toHaveLength(1);
    expect(writes[writes.length - 1]).toContain('[DONE]');
  });

  it('one tool round: fulfills the call, submits against the CURRENT response id, stitches the continuation', async () => {
    const { writes, writeChunk } = collectWrites();
    const execute = vi.fn(async (calls: Array<{ toolCallId: string; name: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'Weight: 88.5 kg' })),
    );
    const submit = vi.fn(async () => stream([delta('You are at 88.5 kg.'), complete('r2'), DONE]));
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([delta('Let me check your file… '), complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      { writeChunk },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual([{ toolCallId: 't1', name: 'get_weight', arguments: '{}' }]);
    // The call rides beside its result (#232); fourth argument is what find_tools revealed —
    // empty here, nothing was looked up. Fifth (M0, 2026-08-31): everything she said before the
    // call, so the continuation CONTINUES her words instead of regenerating the turn.
    expect(submit).toHaveBeenCalledWith(
      'r1',
      [{ toolCallId: 't1', output: 'Weight: 88.5 kg' }],
      [{ toolCallId: 't1', name: 'get_weight', arguments: '{}' }],
      [],
      'Let me check your file…',
    );
    expect(result.content).toBe('Let me check your file… You are at 88.5 kg.');
    expect(result.toolRounds).toBe(1);
    expect(writes.filter((w) => w.includes('[DONE]'))).toHaveLength(1);
  });

  /**
   * The turn's structure survives: each generation is its own segment, a `{"cadence":"segment"}`
   * frame closes the client's bubble between them, and nothing is ever glued. One accumulator
   * across rounds is how "…Tuesday's bike instead?Good catch — that solves two problems…"
   * reached a phone as one paragraph (2026-08-31).
   */
  it('keeps each generation as its own segment and tells the client where the seam is', async () => {
    const { writes, writeChunk } = collectWrites();
    const execute = vi.fn(async (calls: Array<{ toolCallId: string; name: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'Weight: 88.5 kg' })),
    );
    const submit = vi.fn(async () => stream([delta('You are at 88.5 kg.'), complete('r2'), DONE]));
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([delta('Let me check your file… '), complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      { writeChunk },
    );
    expect(result.segments).toEqual(['Let me check your file…', 'You are at 88.5 kg.']);
    const seams = writes.filter((w) => w.includes('"cadence":"segment"'));
    expect(seams).toHaveLength(1);
    // The seam closes round one's bubble before round two's text arrives.
    const seamAt = writes.findIndex((w) => w.includes('"cadence":"segment"'));
    const round2At = writes.findIndex((w) => w.includes('88.5 kg.'));
    expect(seamAt).toBeGreaterThan(-1);
    expect(seamAt).toBeLessThan(round2At);
  });

  it('a round with no text leaves no empty segment and no seam frame', async () => {
    const { writes, writeChunk } = collectWrites();
    const execute = vi.fn(async (calls: Array<{ toolCallId: string; name: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'ok' })),
    );
    const submit = vi.fn(async () => stream([delta('Done — noted.'), complete('r2'), DONE]));
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      { writeChunk },
    );
    expect(result.segments).toEqual(['Done — noted.']);
    expect(writes.filter((w) => w.includes('"cadence":"segment"'))).toHaveLength(0);
  });

  it('a plain turn still records its one generation as one segment', async () => {
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([delta('Hello'), delta(' there'), DONE, complete('r1'), DONE]),
      { toolNames: new Set(['get_weight']), execute: vi.fn(), submit: vi.fn() },
      {},
    );
    expect(result.segments).toEqual(['Hello there']);
  });

  it('a call whose name is not ours is left alone', async () => {
    const execute = vi.fn();
    const submit = vi.fn();
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([delta('Hi'), complete('r1', [{ id: 't9', name: 'some_profile_tool_job' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      {},
    );
    expect(execute).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(result.content).toBe('Hi');
  });

  it('caps the rounds: a model that never stops calling gets its last stream as the answer', async () => {
    let round = 0;
    const execute = vi.fn(async (calls: Array<{ toolCallId: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'x' })),
    );
    // Each round asks something NEW, so the no-progress guard stays out of the way and the cap is
    // the only thing that ends this turn.
    const submit = vi.fn(async (_responseId: string) => {
      round++;
      return stream([
        delta(`round${round} `),
        complete(`r${round + 1}`, [{ id: `t${round + 1}`, name: 'get_weight', args: `{"days":${round}}` }]),
        DONE,
      ]);
    });
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      {},
    );
    expect(result.toolRounds).toBe(MAX_COACH_TOOL_ROUNDS);
    expect(submit).toHaveBeenCalledTimes(MAX_COACH_TOOL_ROUNDS);
    // Each continuation names ITS round's response id, not the first one.
    expect(submit.mock.calls.map((c) => c[0])).toEqual(['r1', 'r2', 'r3']);
  });

  /**
   * The continuation is self-contained (#232) — there is no provider-side thread carrying the
   * earlier rounds, so the loop must re-send the whole exchange every time. Sending only the
   * newest round would hand round three an amnesia we built for it.
   */
  it('re-sends every earlier round of the exchange, not just the newest', async () => {
    let round = 0;
    const seen: Array<{ outputs: string[]; calls: string[] }> = [];
    const submit = vi.fn(
      async (_r: string, outputs: Array<{ toolCallId: string }>, calls: Array<{ toolCallId: string }>) => {
        seen.push({ outputs: outputs.map((o) => o.toolCallId), calls: calls.map((c) => c.toolCallId) });
        round++;
        // Each round asks something NEW: an identical repeat is now treated as no progress and
        // ends the turn (the dedupe guard), which would cut this test short at one round.
        return round < 3
          ? stream([
              complete(`r${round + 1}`, [{ id: `t${round + 1}`, name: 'get_weight', args: `{"days":${round}}` }]),
              DONE,
            ])
          : stream([delta('done'), complete('rX'), DONE]);
      },
    );
    await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      {
        toolNames: new Set(['get_weight']),
        execute: vi.fn(async (calls: Array<{ toolCallId: string }>) =>
          calls.map((c) => ({ toolCallId: c.toolCallId, output: `out-${c.toolCallId}` })),
        ),
        submit,
      },
      {},
    );

    expect(seen.map((s) => s.outputs)).toEqual([['t1'], ['t1', 't2'], ['t1', 't2', 't3']]);
    expect(seen.map((s) => s.calls)).toEqual([['t1'], ['t1', 't2'], ['t1', 't2', 't3']]);
  });

  it('a failed fulfillment ends the turn with what streamed — and still says done', async () => {
    const { writes, writeChunk } = collectWrites();
    const execute = vi.fn(async () => {
      throw new Error('registry down');
    });
    const submit = vi.fn();
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([delta('One sec… '), complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      { writeChunk },
    );
    expect(result.content).toBe('One sec… ');
    expect(submit).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.includes('[DONE]'))).toHaveLength(1);
  });

  /**
   * The over-calling turn, in miniature. On 2026-08-17 the coach called `update_constraint` with
   * byte-identical arguments on three consecutive rounds: the removal happened for real on round
   * one and ran twice more against a file already clear. Measured cause — the continuation does
   * not carry the tool result (same input-token count every round), so she asks again.
   */
  it('runs a repeated call ONCE and answers the repeat with the first result', async () => {
    const args = '{"constraint":"medical procedure","action":"remove"}';
    const execute = vi.fn(async (calls: Array<{ toolCallId: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'Removed "medical procedure" — verified gone.' })),
    );
    const submit = vi.fn(async () => stream([complete('r2', [{ id: 't2', name: 'update_constraint', args }]), DONE]));
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'update_constraint', args }]), DONE]),
      { toolNames: new Set(['update_constraint']), execute, submit },
      {},
    );
    // The mutation ran once; the second round never reached the tool and never reached the model.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toHaveLength(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.toolRounds).toBe(1);
  });

  /** `parallel_tool_calls` is on for the coach profile, so the same write can arrive twice at once. */
  it('runs a call once when the SAME batch asks for it twice', async () => {
    const args = '{"constraint":"left ankle","action":"add"}';
    const execute = vi.fn(async (calls: Array<{ toolCallId: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'Added "left ankle".' })),
    );
    const submit = vi.fn(async (_id: string, _outputs: Array<{ toolCallId: string; output: string }>) =>
      stream([delta('Done.'), complete('r2'), DONE]),
    );
    await relayCoachTurnWithTools(
      'u1',
      stream([
        complete('r1', [
          { id: 't1', name: 'update_constraint', args },
          { id: 't2', name: 'update_constraint', args },
        ]),
        DONE,
      ]),
      { toolNames: new Set(['update_constraint']), execute, submit },
      {},
    );
    expect(execute.mock.calls[0]![0]).toHaveLength(1);
    // Both call ids are still answered — the continuation may not leave one hanging.
    expect(submit.mock.calls[0]![1]).toEqual([
      { toolCallId: 't1', output: 'Added "left ankle".' },
      { toolCallId: 't2', output: 'Added "left ankle".' },
    ]);
  });

  /** A round that mixes something new with a repeat still answers EVERY call id it was given. */
  it('pairs a repeat with its own call id rather than dropping it', async () => {
    const same = '{"days":7}';
    const execute = vi.fn(async (calls: Array<{ toolCallId: string; name: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: `${c.name} says hi` })),
    );
    const submit = vi.fn(async (_id: string, _outputs: Array<{ toolCallId: string; output: string }>) =>
      submit.mock.calls.length === 1
        ? stream([
            complete('r2', [
              { id: 't2', name: 'get_recent_logs', args: same },
              { id: 't3', name: 'get_journal', args: '{"limit":5}' },
            ]),
            DONE,
          ])
        : stream([delta('ok'), complete('r3'), DONE]),
    );
    await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'get_recent_logs', args: same }]), DONE]),
      { toolNames: new Set(['get_recent_logs', 'get_journal']), execute, submit },
      {},
    );
    // Round two ran only the journal read, and still submitted an output for BOTH of its calls —
    // on top of round one's, because the continuation carries the whole turn (#232).
    expect(execute.mock.calls[1]![0].map((c) => c.name)).toEqual(['get_journal']);
    expect(submit.mock.calls[1]![1]).toEqual([
      { toolCallId: 't1', output: 'get_recent_logs says hi' },
      { toolCallId: 't3', output: 'get_journal says hi' },
      { toolCallId: 't2', output: 'get_recent_logs says hi' },
    ]);
  });

  it('reports the CURRENT response id per round to the stop hook', async () => {
    const ids: string[] = [];
    const execute = vi.fn(async (calls: Array<{ toolCallId: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'x' })),
    );
    const submit = vi.fn(async () => stream([delta('done'), complete('r2'), DONE]));
    await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      { onResponseId: (id) => void ids.push(id) },
    );
    expect(ids).toEqual(['r1', 'r2']);
  });
});

/**
 * The dangling lookup: she calls `find_tools`, gets the instructions, and then answers as if she
 * had used them. It happened on 2026-08-16 — she told the owner a constraint was removed and
 * nothing had been. `find_tools` already ends with "call use_tool now" and she ignored it, which
 * makes sense if the cause is structural: a continuation is a fresh generation, so the round that
 * ignores the instruction is not the round that read it.
 *
 * Owner: "we can tell Cadence programmatically that she never called the tool and get her to call
 * it… We don't need to tell the user it's dangling."
 */
describe('a lookup that never became a call', () => {
  const deps = (nudgeBody: ReadableStream<Uint8Array> | null, execute = vi.fn()) => ({
    toolNames: new Set(['find_tools', 'use_tool']),
    execute,
    submit: vi.fn(),
    nudge: vi.fn().mockResolvedValue(nudgeBody),
  });

  it('nudges her when find_tools is called and use_tool never follows', async () => {
    const d = deps(stream([delta('Removed it.'), complete('r2'), DONE]));
    await relayCoachTurnWithTools(
      'u1',
      stream([delta('Let me look.'), complete('r1', [{ id: 't1', name: 'find_tools' }]), DONE]),
      { ...d, execute: vi.fn().mockResolvedValue([{ toolCallId: 't1', output: 'update_constraint: …' }]) },
      {},
    );
    expect(d.nudge).toHaveBeenCalledTimes(1);
    expect(String(d.nudge.mock.calls[0]![0])).toMatch(/NOTHING was actually done/);
  });

  /** The user must never see it — a `<note>` is a word in her ear, not a message in the chat. */
  it('sends the nudge as an app-authored note', async () => {
    const d = deps(stream([delta('ok'), complete('r2'), DONE]));
    await relayCoachTurnWithTools(
      'u1',
      stream([delta('x'), complete('r1', [{ id: 't1', name: 'find_tools' }]), DONE]),
      { ...d, execute: vi.fn().mockResolvedValue([{ toolCallId: 't1', output: 'x' }]) },
      {},
    );
    expect(String(d.nudge.mock.calls[0]![0])).toMatch(/^<note>/);
    expect(String(d.nudge.mock.calls[0]![0])).toMatch(/Do not mention this note/);
  });

  it('does not nudge when she used the tool she looked up', async () => {
    const d = deps(null);
    await relayCoachTurnWithTools(
      'u1',
      stream([
        delta('x'),
        complete('r1', [
          { id: 't1', name: 'find_tools' },
          { id: 't2', name: 'use_tool' },
        ]),
        DONE,
      ]),
      {
        ...d,
        execute: vi.fn().mockResolvedValue([
          { toolCallId: 't1', output: 'a' },
          { toolCallId: 't2', output: 'b' },
        ]),
        submit: vi.fn().mockResolvedValue(null),
      },
      {},
    );
    expect(d.nudge).not.toHaveBeenCalled();
  });

  /**
   * The success path since #231: `find_tools` declares the real definitions and she calls one BY
   * NAME. A check that only looked for `use_tool` fired here — telling her, wrongly, that nothing
   * had been done and to call it again. That is an over-call we caused.
   */
  it('does not nudge when she called a revealed tool by its own name', async () => {
    const d = deps(null);
    const def = { type: 'function', function: { name: 'get_journal', description: 'x', parameters: {} } };
    await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'find_tools', args: '{"query":"writing"}' }]), DONE]),
      {
        ...d,
        toolNames: new Set(['find_tools', 'use_tool', 'get_journal']),
        execute: vi.fn(async (calls: Array<{ toolCallId: string }>) =>
          calls.map((c) => ({ toolCallId: c.toolCallId, output: 'x' })),
        ),
        submit: vi.fn(async () =>
          stream([delta('Here it is.'), complete('r2', [{ id: 't2', name: 'get_journal' }]), DONE]),
        ),
        revealedBy: () => [def],
      },
      {},
    );
    expect(d.nudge).not.toHaveBeenCalled();
  });

  it('does not nudge a turn that never looked anything up', async () => {
    const d = deps(null);
    await relayCoachTurnWithTools('u1', stream([delta('just talking'), complete('r1'), DONE]), d, {});
    expect(d.nudge).not.toHaveBeenCalled();
  });

  /**
   * The consent-seeking stop (2026-08-31, the prehab turn): she looked the tool up and then
   * ASKED — "Want me to drop the standalone mobility from Monday?" — which is confirm-before-
   * committing working. The nudge fired anyway, told her nothing was done, and pushed her into
   * `propose_plan_change` with empty edits plus an apology. A turn whose words end in a question
   * is waiting on the user, not dangling.
   */
  it('does not nudge when her words so far end in a question to the user', async () => {
    const d = deps(null);
    await relayCoachTurnWithTools(
      'u1',
      stream([
        delta('Want me to drop the standalone mobility from Monday?'),
        complete('r1', [{ id: 't1', name: 'find_tools' }]),
        DONE,
      ]),
      { ...d, execute: vi.fn().mockResolvedValue([{ toolCallId: 't1', output: 'propose_plan_change: …' }]) },
      {},
    );
    expect(d.nudge).not.toHaveBeenCalled();
  });

  it('still nudges when the question mark is only mid-text and the turn ends declarative', async () => {
    const d = deps(stream([delta('Doing it now.'), complete('r2'), DONE]));
    await relayCoachTurnWithTools(
      'u1',
      stream([
        delta('Odd pairing, right? Removed the standalone mobility for you.'),
        complete('r1', [{ id: 't1', name: 'find_tools' }]),
        DONE,
      ]),
      { ...d, execute: vi.fn().mockResolvedValue([{ toolCallId: 't1', output: 'x' }]) },
      {},
    );
    expect(d.nudge).toHaveBeenCalledTimes(1);
  });

  it('ignores closing quotes and emphasis after the question mark', async () => {
    const d = deps(null);
    await relayCoachTurnWithTools(
      'u1',
      stream([delta('Here is the trade. Shall I make it?”'), complete('r1', [{ id: 't1', name: 'find_tools' }]), DONE]),
      { ...d, execute: vi.fn().mockResolvedValue([{ toolCallId: 't1', output: 'x' }]) },
      {},
    );
    expect(d.nudge).not.toHaveBeenCalled();
  });

  /** The turn already has an answer; a failed nudge must never cost her that. */
  it('keeps the reply when the nudge itself fails', async () => {
    const d = deps(null);
    d.nudge = vi.fn().mockRejectedValue(new Error('provider down'));
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await relayCoachTurnWithTools(
        'u1',
        stream([delta('Removed it.'), complete('r1', [{ id: 't1', name: 'find_tools' }]), DONE]),
        { ...d, execute: vi.fn().mockResolvedValue([{ toolCallId: 't1', output: 'x' }]) },
        {},
      );
      expect(r.content).toContain('Removed it.');
    } finally {
      quiet.mockRestore();
    }
  });
});

/**
 * Revealing the REAL definition, which is what ToolSearch does and what we were not doing.
 *
 * Measured 2026-08-17, once the continuation finally carried tools: she called `find_tools` on
 * round after round and never once called `use_tool`. Not "she cannot" any more — "she will not
 * use a stringly-typed proxy", which is exactly what a generic `use_tool(name, arguments)` is.
 * Owner, the day before: *"progressive disclosure … surely is working for Anthropic's Claude for
 * actions. The problem is something in our design."*
 */
describe('what find_tools reveals becomes callable by name', () => {
  it('carries the revealed definitions onto the continuation', async () => {
    const submit = vi.fn(async () => stream([delta('ok'), complete('r2'), DONE]));
    const revealedDef = { type: 'function', function: { name: 'get_journal', description: 'x', parameters: {} } };
    await relayCoachTurnWithTools(
      'u1',
      stream([delta('Looking.'), complete('r1', [{ id: 't1', name: 'find_tools' }]), DONE]),
      {
        toolNames: new Set(['find_tools']),
        execute: vi.fn().mockResolvedValue([{ toolCallId: 't1', output: 'get_journal: …' }]),
        submit,
        revealedBy: () => [revealedDef],
      },
      {},
    );
    expect(submit).toHaveBeenCalledWith('r1', expect.anything(), expect.anything(), [revealedDef], expect.any(String));
  });

  /** A tool found on round one must still be callable on round three. */
  it('keeps revealed definitions for the rest of the turn, without duplicating them', async () => {
    let n = 0;
    const submit = vi.fn(async () => {
      n++;
      return n < 2
        ? stream([complete(`r${n + 1}`, [{ id: `t${n + 1}`, name: 'find_tools', args: `{"query":"q${n}"}` }]), DONE])
        : stream([delta('done'), complete('rX'), DONE]);
    });
    const def = { type: 'function', function: { name: 'get_journal', description: 'x', parameters: {} } };
    await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'find_tools' }]), DONE]),
      {
        toolNames: new Set(['find_tools']),
        execute: vi.fn(async (calls: Array<{ toolCallId: string }>) =>
          calls.map((c) => ({ toolCallId: c.toolCallId, output: 'x' })),
        ),
        submit,
        revealedBy: () => [def],
      },
      {},
    );
    // Same definition revealed twice, declared once.
    const lastCall = submit.mock.calls[submit.mock.calls.length - 1] as unknown as unknown[];
    expect(lastCall[3]).toEqual([def]);
  });

  it('declares nothing extra on a turn that looked nothing up', async () => {
    const submit = vi.fn(async () => stream([delta('ok'), complete('r2'), DONE]));
    await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      {
        toolNames: new Set(['get_weight']),
        execute: vi.fn().mockResolvedValue([{ toolCallId: 't1', output: '88kg' }]),
        submit,
        revealedBy: () => [],
      },
      {},
    );
    expect(submit).toHaveBeenCalledWith('r1', expect.anything(), expect.anything(), [], expect.any(String));
  });
});

/**
 * A turn that ran tools may not end in silence — the engine's half of the 2026-08-20 failure
 * (find_tools → a read → find_tools → cap → NOTHING streamed → nothing persisted → the healer had
 * nothing to recover → "something hiccuped"). The wandering is a selection problem; the silence
 * was ours.
 */
describe('silent-turn nudge', () => {
  it('a capped turn with no prose gets one forced answer, and it becomes the result', async () => {
    const execute = vi.fn(async (calls: Array<{ toolCallId: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'x' })),
    );
    let round = 0;
    // Every round: tool calls only, not one delta of prose — the owner's exact shape.
    const submit = vi.fn(async () => {
      round++;
      return stream([
        complete(`r${round + 1}`, [{ id: `t${round + 1}`, name: 'get_weight', args: `{"r":${round}}` }]),
        DONE,
      ]);
    });
    const nudge = vi.fn(async (_note: string) => stream([delta('Here is what I can see: 82kg, target 78.'), DONE]));

    const { writes, writeChunk } = collectWrites();
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit, nudge },
      { writeChunk },
    );

    expect(nudge).toHaveBeenCalledTimes(1);
    expect(nudge.mock.calls[0]![0]).toContain('have not said a single word');
    expect(result.content).toContain('82kg');
    // Still exactly one terminal, after the nudge's prose.
    expect(writes.filter((w) => w.includes('[DONE]'))).toHaveLength(1);
  });

  it('never fires when the turn already spoke', async () => {
    const execute = vi.fn(async (calls: Array<{ toolCallId: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'x' })),
    );
    const submit = vi.fn(async () => stream([delta('Done — logged it.'), DONE]));
    const nudge = vi.fn();
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit, nudge },
      {},
    );
    expect(result.content).toBe('Done — logged it.');
    expect(nudge).not.toHaveBeenCalled();
  });

  it('never fires on a plain turn with no tools at all', async () => {
    const nudge = vi.fn();
    const result = await relayCoachTurnWithTools(
      'u1',
      stream([delta('Hi'), DONE]),
      { toolNames: new Set(['get_weight']), execute: vi.fn(), submit: vi.fn(), nudge },
      {},
    );
    expect(result.content).toBe('Hi');
    expect(nudge).not.toHaveBeenCalled();
  });
});
