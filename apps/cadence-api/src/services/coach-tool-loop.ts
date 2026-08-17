import type { CoachActivityFrame } from '@cadence/shared';
import { logAi } from './ai-log.ts';
import {
  createCoachStreamAccumulateState,
  relayAndAccumulate,
  type CoachStreamAccumulateState,
  type CoachStreamResult,
  type RelayAndAccumulateOptions,
} from './coach-stream.ts';
import { FIND_TOOLS_NAME, USE_TOOL_NAME } from './coach-tool-tiers.ts';
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
 *
 * **READ THIS BEFORE TRUSTING A LATER ROUND.** Measured 2026-08-17 (live probe, deployed API,
 * throwaway user): the continuation does not deliver the tool result to the model. Rounds two,
 * three and four of one turn each reported the SAME 12,772 input tokens and each re-emitted the
 * identical call, byte for byte, under a fresh provider call id. Devs.ai v2 accepts our
 * `function_call_output` items (HTTP 200) and rebuilds the model's input from the stored thread
 * instead; nothing we send on `previous_response_id` reaches the prompt. So every round after the
 * first is a fresh generation of the SAME turn, which is why "she over-calls", why a continuation
 * writes a whole new opening line rather than resuming, and why the dangling-lookup nudge below
 * has to be a new turn rather than a note on this one. The loop keeps submitting because that is
 * the correct request to make and the day the provider honours it everything here starts working;
 * until then `callFingerprint` is what stops a mutation running four times.
 */
export const MAX_COACH_TOOL_ROUNDS = 3;

export interface CoachToolLoopDeps {
  /** The known tool names — calls outside this set are left alone (a profile toolJob, noise). */
  toolNames: Set<string>;
  /** Run the calls (the retrieval registry executor). */
  execute: (calls: CoachToolCall[]) => Promise<CoachToolOutput[]>;
  /** Submit outputs; resolves to the continuation stream's body. */
  submit: (
    responseId: string,
    outputs: CoachToolOutput[],
    /** Definitions `find_tools` revealed, declared on the continuation so she can call them BY NAME. */
    revealed?: unknown[],
  ) => Promise<ReadableStream<Uint8Array> | null>;
  /** Which real definitions a round's calls revealed. */
  revealedBy?: (calls: CoachToolCall[]) => unknown[];
  /**
   * Say something to her mid-turn that the USER never sees, and get her next response.
   *
   * Used for one thing: the dangling lookup. `<note>` turns are already app-authored and filtered
   * out of both the restored transcript and the capture window (routes/coach.ts, APP_AUTHORED), so
   * this is a word in her ear, not a message in the conversation.
   */
  nudge?: (text: string) => Promise<ReadableStream<Uint8Array> | null>;
}

/**
 * Same tool, same arguments. The one kind of repeat that can never be progress.
 *
 * Measured 2026-08-17 against the deployed API with a throwaway user: she called
 * `update_constraint {"constraint":"left ankle","action":"add",…}` on FOUR consecutive rounds,
 * byte-identical, under a fresh provider call id each time — and the provider reported the SAME
 * 12,772 input tokens for rounds two, three and four. The continuation is re-generating the same
 * turn from the same prompt; the tool result is not in it. The owner's turn at 07:51 the same
 * morning did it three times with a mutation: the constraint was removed for real on round one,
 * and rounds two and three ran the removal again against a file already clear, which is how the
 * log came to read "Removed it" and then "nothing on file matches" twice.
 *
 * So a repeat is answered with what the tool said the FIRST time, and the tool is not run again:
 * a write happens once per turn however many times she asks for it.
 */
function callFingerprint(call: CoachToolCall): string {
  return `${call.name}\u0000${(call.arguments ?? '').trim()}`;
}

/** Names `find_tools` handed her this turn — calling one of them BY NAME is the follow-through. */
function revealedNames(revealed: unknown[]): string[] {
  return revealed
    .map((d) => (d as { function?: { name?: string } }).function?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/**
 * A turn that looked a tool up and never ran it.
 *
 * The tail costs this: she can complete hop one and stop. On 2026-08-16 that is exactly what
 * happened — `find_tools {"query":"update constraints remove injury"}` returned `update_constraint`
 * with full instructions, nothing followed, and she told the owner the constraint was removed. The
 * hierarchy worked; the follow-through did not. What was missing is that the drop was INVISIBLE —
 * a dangling intent nobody could count — so this records a machine-checkable signal and then says
 * one word in her ear.
 *
 * **What counts as follow-through changed under this check and the check did not follow.** Since
 * #231 `find_tools` DECLARES the real definitions on the continuation and its own return text says
 * *"call the one you need directly, by its own name"* — `use_tool` is the fallback now, not the
 * expected next step. A condition that only looked for `use_tool` therefore fired on the SUCCESS
 * path: she looked a tool up, called it by name, it worked, and this told her *"NOTHING was actually
 * done… call use_tool now"* and spent a model call doing it. That is the shape of the bug the owner
 * suspected — *"we give her an indicator it didn't work so she tries again"* — so a by-name call of
 * anything the lookup revealed is follow-through, and only a lookup with no call after it is not.
 */
async function nudgeDanglingLookup(
  userId: string,
  deps: CoachToolLoopDeps,
  options: Omit<RelayAndAccumulateOptions, 'state' | 'suppressDone'>,
  turn: { state: CoachStreamAccumulateState; fulfilled: Set<string>; revealed: unknown[] },
): Promise<CoachStreamResult | null> {
  const { state, fulfilled, revealed } = turn;
  const called = new Set(state.functionCalls.map((c) => c.name));
  if (!called.has(FIND_TOOLS_NAME) || !deps.nudge) return null;
  if (called.has(USE_TOOL_NAME) || revealedNames(revealed).some((n) => called.has(n))) return null;

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
   * fact and the correction belongs in her ear, not on the user's screen.
   *
   * Why it happens at all is structural rather than lazy, and now measured: a continuation is a
   * FRESH generation of the same prompt (see `callFingerprint`), so the round that ignores an
   * instruction is not the round that read it. A new turn is the only thing that carries one.
   *
   * Costs one extra model call, and only on the failure path.
   */
  let result: CoachStreamResult | null = null;
  try {
    const body = await deps.nudge(
      '<note>You called find_tools and then answered without calling any of the tools it gave you, ' +
        'so NOTHING was actually done. If the user asked you to change something, call that tool now ' +
        'by its own name. If you already told them it was done, correct that plainly in one line once ' +
        'it really is. Do not mention this note.</note>',
    );
    if (!body) return null;
    result = await relayAndAccumulate(body, { ...options, state, suppressDone: true });
    // The nudge may itself produce the call she skipped — fulfil it, exactly as a normal round.
    const late = state.functionCalls.filter((c) => !fulfilled.has(c.toolCallId) && deps.toolNames.has(c.name));
    if (late.length && state.currentResponseId) {
      const outputs = await deps.execute(late);
      for (const c of late) fulfilled.add(c.toolCallId);
      if (outputs.length) {
        const after = await deps.submit(state.currentResponseId, outputs, revealed);
        if (after) result = await relayAndAccumulate(after, { ...options, state, suppressDone: true });
      }
    }
  } catch (e) {
    // The turn already has an answer; a failed nudge must never cost her that.
    console.warn('[coach-tools] dangling-lookup nudge failed:', e);
  }
  return result;
}

export async function relayCoachTurnWithTools(
  userId: string,
  firstBody: ReadableStream<Uint8Array> | null | undefined,
  deps: CoachToolLoopDeps,
  options: Omit<RelayAndAccumulateOptions, 'state' | 'suppressDone'> = {},
): Promise<CoachStreamResult & { toolRounds: number }> {
  const state = createCoachStreamAccumulateState();
  const fulfilled = new Set<string>();
  /** What each distinct call already answered this turn, keyed by `callFingerprint`. */
  const served = new Map<string, string>();
  let body = firstBody;
  let result: CoachStreamResult = { ...state, firstTokenMs: null, clientDropped: false };
  let toolRounds = 0;
  // Revealed definitions accumulate: a tool found on round one stays callable on round three.
  const revealed: unknown[] = [];

  for (let round = 0; round <= MAX_COACH_TOOL_ROUNDS; round++) {
    result = await relayAndAccumulate(body, { ...options, state, suppressDone: true });

    const pending = state.functionCalls.filter((c) => !fulfilled.has(c.toolCallId) && deps.toolNames.has(c.name));
    if (!pending.length || round === MAX_COACH_TOOL_ROUNDS || !state.currentResponseId) break;

    /**
     * A round that asks only for what it already asked for is a round that learned nothing, and
     * another one cannot go differently — so this is where the turn ends rather than three rounds
     * later. Recorded, because "she over-called" was invisible until someone read the log by hand.
     *
     * `seen` covers the same repeat WITHIN one batch: parallel tool calls are on for this profile,
     * so two identical calls can arrive together, and a write must not run twice for that either.
     */
    const seen = new Set<string>();
    const fresh = pending.filter((c) => {
      const fp = callFingerprint(c);
      if (served.has(fp) || seen.has(fp)) return false;
      seen.add(fp);
      return true;
    });
    if (!fresh.length) {
      void logAi(userId, {
        kind: 'coach_tool',
        input: { calls: pending.map((c) => ({ name: c.name, arguments: c.arguments ?? null })) },
        output: { results: [] },
        meta: { count: 0, names: pending.map((c) => c.name), repeatedCalls: true },
      }).catch(() => {});
      break;
    }

    let outputs: CoachToolOutput[] = [];
    try {
      outputs = await deps.execute(fresh);
    } catch (e) {
      console.warn('[coach-tools] execution failed — ending the turn with what streamed:', e);
      break;
    }
    for (const o of outputs) {
      const call = fresh.find((c) => c.toolCallId === o.toolCallId);
      if (call) served.set(callFingerprint(call), o.output);
    }
    // A repeat still gets ITS OWN output, paired to its own call id: the continuation must answer
    // every call the model made, or the one left unanswered is a call she will simply make again.
    for (const c of pending) {
      if (served.has(callFingerprint(c)) && !outputs.some((o) => o.toolCallId === c.toolCallId)) {
        outputs.push({ toolCallId: c.toolCallId, output: served.get(callFingerprint(c))! });
      }
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
      // What actually RAN — a repeat served from `served` did no work and must not claim any.
      const frame: CoachActivityFrame = { cadence: 'tool', names: fresh.map((c) => c.name) };
      options.writeChunk?.(`data: ${JSON.stringify(frame)}\n\n`);
    } catch {
      /* client gone; the turn continues server-side regardless */
    }

    for (const def of deps.revealedBy?.(pending) ?? []) {
      const name = (def as { function?: { name?: string } }).function?.name;
      if (name && !revealed.some((d) => (d as { function?: { name?: string } }).function?.name === name)) {
        revealed.push(def);
      }
    }

    try {
      body = await deps.submit(state.currentResponseId, outputs, revealed);
    } catch (e) {
      console.warn('[coach-tools] continuation failed — ending the turn with what streamed:', e);
      break;
    }
    toolRounds++;
  }

  const nudged = await nudgeDanglingLookup(userId, deps, options, { state, fulfilled, revealed });
  if (nudged) result = nudged;

  // The one real terminal, whatever happened above — the client is waiting on it.
  try {
    options.writeChunk?.('data: [DONE]\n\n');
  } catch {
    /* client already gone; the result still persists server-side */
  }

  return { ...result, toolRounds };
}
