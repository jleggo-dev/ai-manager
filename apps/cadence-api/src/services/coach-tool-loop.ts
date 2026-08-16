import type { CoachActivityFrame } from '@cadence/shared';
import { logAi } from './ai-log.ts';
import {
  createCoachStreamAccumulateState,
  relayAndAccumulate,
  type CoachStreamResult,
  type RelayAndAccumulateOptions,
} from './coach-stream.ts';
import type { CoachToolCall, CoachToolOutput } from './coach-tools.ts';

/**
 * The tool loop, driven from Cadence's own relay — the port the live probe (#189-#191) cleared
 * the way for. The engine attaches the coach's tool definitions to the request
 * (`sendChatMessage({ extraTools })`); when the model calls one, the completed response carries
 * the call in its output, this loop fulfills it against the retrieval registry, submits the
 * result as a continuation (a NEW response threaded on the previous one — #190), and pumps the
 * next stream to the same client connection. To the person on the phone it is one reply that
 * paused for a beat while she checked their file.
 *
 * The terminal contract is the sharp edge: the web client resolves the ENTIRE turn on the first
 * `data: [DONE]` it sees, so every round runs with `suppressDone` and only this loop — after the
 * last round — writes the one real terminal.
 *
 * Bounded rounds, and the bound is a feature: a model that keeps calling tools past the cap gets
 * its last stream relayed as the answer. Fulfillment or continuation failures also end the loop
 * with whatever content exists — a reply that stops after "let me check" is recoverable by the
 * user asking again; a hung stream is not.
 */
export const MAX_COACH_TOOL_ROUNDS = 3;

export interface CoachToolLoopDeps {
  /** The known tool names — calls outside this set are left alone (a profile toolJob, noise). */
  toolNames: Set<string>;
  /** Run the calls (the retrieval registry executor). */
  execute: (calls: CoachToolCall[]) => Promise<CoachToolOutput[]>;
  /** Submit outputs; resolves to the continuation stream's body. */
  submit: (responseId: string, outputs: CoachToolOutput[]) => Promise<ReadableStream<Uint8Array> | null>;
  /**
   * Say something to her mid-turn that the USER never sees, and get her next response.
   *
   * Used for one thing: the dangling lookup. `<note>` turns are already app-authored and filtered
   * out of both the restored transcript and the capture window (routes/coach.ts, APP_AUTHORED), so
   * this is a word in her ear, not a message in the conversation.
   */
  nudge?: (text: string) => Promise<ReadableStream<Uint8Array> | null>;
}

export async function relayCoachTurnWithTools(
  userId: string,
  firstBody: ReadableStream<Uint8Array> | null | undefined,
  deps: CoachToolLoopDeps,
  options: Omit<RelayAndAccumulateOptions, 'state' | 'suppressDone'> = {},
): Promise<CoachStreamResult & { toolRounds: number }> {
  const state = createCoachStreamAccumulateState();
  const fulfilled = new Set<string>();
  let body = firstBody;
  let result: CoachStreamResult = { ...state, firstTokenMs: null, clientDropped: false };
  let toolRounds = 0;

  for (let round = 0; round <= MAX_COACH_TOOL_ROUNDS; round++) {
    result = await relayAndAccumulate(body, { ...options, state, suppressDone: true });

    const pending = state.functionCalls.filter((c) => !fulfilled.has(c.toolCallId) && deps.toolNames.has(c.name));
    if (!pending.length || round === MAX_COACH_TOOL_ROUNDS || !state.currentResponseId) break;

    let outputs: CoachToolOutput[] = [];
    try {
      outputs = await deps.execute(pending);
    } catch (e) {
      console.warn('[coach-tools] execution failed — ending the turn with what streamed:', e);
      break;
    }
    for (const c of pending) fulfilled.add(c.toolCallId);
    if (!outputs.length) break;

    /**
     * Tell the user something is happening, while it happens.
     *
     * Owner: *"they usually tell me when they're calling a tool. This would help us diagnose and it
     * would also tell the user something is happening (or happened)."* Every failure this week was
     * invisible work — she said a session was logged and none was, said a constraint was removed
     * and it was not. "Writing that down…" followed by silence is a question the user can ask.
     *
     * A `cadence` frame, not a content delta, so the parser can tell it from her prose and it can
     * never end up inside the reply. Written AFTER execution rather than before, because a call
     * that fails instantly should not leave a claim on screen that it happened.
     */
    try {
      const frame: CoachActivityFrame = { cadence: 'tool', names: pending.map((c) => c.name) };
      options.writeChunk?.(`data: ${JSON.stringify(frame)}\n\n`);
    } catch {
      /* client gone; the turn continues server-side regardless */
    }

    try {
      body = await deps.submit(state.currentResponseId, outputs);
    } catch (e) {
      console.warn('[coach-tools] continuation failed — ending the turn with what streamed:', e);
      break;
    }
    toolRounds++;
  }

  /**
   * A turn that looked a tool up and never ran it.
   *
   * The two-hop tail (`find_tools` → `use_tool`) buys reads that cost nothing until asked for, and
   * it costs this: she can complete hop one and stop. On 2026-08-16 that is exactly what happened —
   * `find_tools {"query":"update constraints remove injury"}` returned `update_constraint` with
   * full instructions, no `use_tool` followed, and she told the owner the constraint was removed.
   * The hierarchy worked; the follow-through did not.
   *
   * `find_tools` already ends with "call use_tool now", so more prose is not the answer. What was
   * missing is that the drop was INVISIBLE — a dangling intent nobody could count. This is a
   * machine-checkable signal, recorded so the eval and any future fix have something to measure.
   */
  const called = new Set(state.functionCalls.map((c) => c.name));
  if (called.has('find_tools') && !called.has('use_tool') && deps.nudge && toolRounds <= MAX_COACH_TOOL_ROUNDS) {
    void logAi(userId, {
      kind: 'coach_tool',
      input: { calls: [...called].map((name) => ({ name, arguments: null })) },
      output: { results: [] },
      meta: { count: 0, names: [...called], danglingLookup: true },
    }).catch(() => {});

    /**
     * She looked it up and then answered as if she had used it. Tell her, and let her fix it.
     *
     * Owner: *"we can tell Cadence programmatically that she never called the tool and get her to
     * call it… We don't need to tell the user it's dangling."* Exactly — this is a machine-checked
     * fact (she called `find_tools`, no `use_tool` followed) and the correction belongs in her ear,
     * not on the user's screen.
     *
     * Why it happens at all is probably structural rather than lazy: a continuation is a FRESH
     * generation, so round two behaves like it is answering the question rather than resuming a
     * task it had started — the same mechanism behind the duplicated replies. An instruction inside
     * `find_tools` ("call use_tool now") cannot fix that, because the round that ignores it is a
     * different generation from the one that read it. A new turn can.
     *
     * Costs one extra model call, and only on the failure path.
     */
    try {
      const body = await deps.nudge(
        '<note>You called find_tools and then answered without calling use_tool, so NOTHING was ' +
          'actually done. If the user asked you to change something, call use_tool now with the tool ' +
          'find_tools gave you. If you already told them it was done, correct that plainly in one ' +
          'line once it really is. Do not mention this note.</note>',
      );
      if (body) {
        result = await relayAndAccumulate(body, { ...options, state, suppressDone: true });
        // The nudge may itself produce the call she skipped — fulfil it, exactly as a normal round.
        const late = state.functionCalls.filter((c) => !fulfilled.has(c.toolCallId) && deps.toolNames.has(c.name));
        if (late.length && state.currentResponseId) {
          const outputs = await deps.execute(late);
          for (const c of late) fulfilled.add(c.toolCallId);
          if (outputs.length) {
            const after = await deps.submit(state.currentResponseId, outputs);
            if (after) result = await relayAndAccumulate(after, { ...options, state, suppressDone: true });
          }
        }
      }
    } catch (e) {
      // The turn already has an answer; a failed nudge must never cost her that.
      console.warn('[coach-tools] dangling-lookup nudge failed:', e);
    }
  }

  // The one real terminal, whatever happened above — the client is waiting on it.
  try {
    options.writeChunk?.('data: [DONE]\n\n');
  } catch {
    /* client already gone; the result still persists server-side */
  }

  return { ...result, toolRounds };
}
