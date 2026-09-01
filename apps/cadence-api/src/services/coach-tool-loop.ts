import { resolveActivityNames, type CoachActivityFrame, type CoachToolStartFrame } from '@cadence/shared';
import { logAi } from './ai-log.ts';
import {
  coachTextSoFar,
  createCoachStreamAccumulateState,
  endCoachSegment,
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
 * **THE LATER ROUNDS WORK — measured 2026-08-23, and this comment used to say the opposite.** The
 * warning it replaces described the THREADED continuation, and it was written the same day #232
 * abandoned threading; it then outlived its subject by six days and cost a design review that
 * concluded Cadence needed a different LLM provider to run an agent loop at all.
 *
 * What the threaded shape did (2026-08-17, still true of `continueWithToolOutputs`): rounds two,
 * three and four each reported the SAME 12,772 input tokens against round one's 18,979 and
 * re-emitted the identical call byte for byte, because Devs.ai v2 accepted our
 * `function_call_output` items with a 200 and rebuilt the model's input from its own stored
 * thread, which they never joined.
 *
 * `continueWithToolResults` (#232) is what runs now: nothing threaded, the conversation from our
 * own database plus every round's exchange, each output beside the call that asked for it. Probed
 * live against the deployed API on 2026-08-23 (`probe-tool-result-lands.ts`): a nonce reachable
 * only through a tool's output came back in her prose, with no re-issued call. The result reaches
 * the model.
 *
 * **What still bites is a PARTIAL exchange.** `probe-tool-two-hops.ts` chained two tools and the
 * model composed hop two out of hop one's output — then refused the answer, saying it had "no
 * record" of asking hop one's question, and restarted the chain until the round cap. That was
 * AI Admin's route-side loop submitting only the newest round; the fix is in
 * `routes/chat-sessions/shared.ts`. This loop has always accumulated (`[...exchangeOutputs]`,
 * `[...exchangeCalls]`), and `coach-tool-loop.test.ts` pins it — "re-sends every earlier round of
 * the exchange, not just the newest". Keep it that way: an exchange with holes in it reads to a
 * careful model as a tampered transcript, which is exactly what it is.
 *
 * `callFingerprint` below stays for a different reason than it was written for — not because
 * results vanish, but because a model that repeats a call must not run a mutation twice.
 */
export const MAX_COACH_TOOL_ROUNDS = 3;

export interface CoachToolLoopDeps {
  /** The known tool names — calls outside this set are left alone (a profile toolJob, noise). */
  toolNames: Set<string>;
  /** Run the calls (the retrieval registry executor). */
  execute: (calls: CoachToolCall[]) => Promise<CoachToolOutput[]>;
  /** Submit the turn's tool exchange; resolves to the continuation stream's body. */
  submit: (
    responseId: string,
    /** EVERY round's outputs so far, not just this round's — the continuation is self-contained. */
    outputs: CoachToolOutput[],
    /** The calls those outputs answer, so each result travels beside its question (#232). */
    calls: CoachToolCall[],
    /** Definitions `find_tools` revealed, declared on the continuation so she can call them BY NAME. */
    revealed?: unknown[],
    /** What she has already said this turn — rides the continuation so it CONTINUES (M0). */
    assistantTextSoFar?: string,
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
  turn: {
    state: CoachStreamAccumulateState;
    fulfilled: Set<string>;
    revealed: unknown[];
    /** The whole turn's exchange so far — the continuation is self-contained (#232). */
    exchangeCalls: CoachToolCall[];
    exchangeOutputs: CoachToolOutput[];
  },
): Promise<CoachStreamResult | null> {
  const { state, fulfilled, revealed, exchangeCalls, exchangeOutputs } = turn;
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
    // The nudge goes out BEFORE the segment closes so the quote below still sees the turn's text.
    const saidSoFar = coachTextSoFar(state);
    // The nudge's reply is a new generation: close the bubble the turn was filling first.
    endCoachSegment(state, options.writeChunk);
    // Same continuity the continuation now gets (M0): a nudge that cannot see what she already
    // said produces a full re-answer, and re-answers are the glue this turn's fixes exist to end.
    const said = saidSoFar
      ? `What you have said to the user so far this turn: «${saidSoFar.slice(0, 1500)}». Do not repeat it. `
      : '';
    const body = await deps.nudge(
      '<note>You called find_tools and then answered without calling any of the tools it gave you, ' +
        'so NOTHING was actually done. If the user asked you to change something, call that tool now ' +
        'by its own name. If you already told them it was done, correct that plainly in one line once ' +
        `it really is. ${said}Do not mention this note.</note>`,
    );
    if (!body) return null;
    result = await relayAndAccumulate(body, { ...options, state, suppressDone: true });
    // The nudge may itself produce the call she skipped — fulfil it, exactly as a normal round.
    const late = state.functionCalls.filter((c) => !fulfilled.has(c.toolCallId) && deps.toolNames.has(c.name));
    if (late.length && state.currentResponseId) {
      const outputs = await deps.execute(late);
      for (const c of late) fulfilled.add(c.toolCallId);
      if (outputs.length) {
        exchangeCalls.push(...late);
        exchangeOutputs.push(...outputs);
        const after = await deps.submit(
          state.currentResponseId,
          [...exchangeOutputs],
          [...exchangeCalls],
          revealed,
          coachTextSoFar(state),
        );
        if (after) {
          endCoachSegment(state, options.writeChunk);
          result = await relayAndAccumulate(after, { ...options, state, suppressDone: true });
        }
      }
    }
  } catch (e) {
    // The turn already has an answer; a failed nudge must never cost her that.
    console.warn('[coach-tools] dangling-lookup nudge failed:', e);
  }
  return result;
}

/**
 * The turn ran tools and then said NOTHING — end it with words anyway.
 *
 * Measured on the owner's account (2026-08-20, 12:25 and 12:31): find_tools -> a read -> find_tools
 * again -> round cap -> loop breaks. No prose ever streamed, so nothing persisted, the healer found
 * nothing to recover, and the phone showed "something hiccuped" / silence after "calling a tool".
 * Two model bills, zero words. The wandering itself is a persona/selection problem; a turn that
 * ends in SILENCE is an engine one, and this is the engine's half: one forced continuation that
 * says answer now, plainly, from what you already have.
 *
 * Runs after the dangling-lookup nudge (which may itself have produced the missing prose) and only
 * when the turn is still textless. If she answers with another tool call instead of words, it goes
 * unfulfilled by design — the budget is spent; the note says so; a second lap is how this bug
 * happened. Costs one extra model call, only on the failure path.
 */
async function nudgeSilentTurn(
  userId: string,
  deps: CoachToolLoopDeps,
  options: Omit<RelayAndAccumulateOptions, 'state' | 'suppressDone'>,
  state: CoachStreamAccumulateState,
): Promise<CoachStreamResult | null> {
  if (!deps.nudge || state.content.trim() || state.functionCalls.length === 0) return null;

  void logAi(userId, {
    kind: 'coach_tool',
    input: { calls: state.functionCalls.map((c) => ({ name: c.name, arguments: null })) },
    output: { results: [] },
    meta: { count: 0, names: state.functionCalls.map((c) => c.name), silentTurn: true },
  }).catch(() => {});

  try {
    const body = await deps.nudge(
      '<note>You have used all your tool budget for this turn and have not said a single word to ' +
        'the user yet — from their side the screen is blank. Answer them NOW, in plain words, from ' +
        'what you already have (your context and the tool results above). Do not call any tools. ' +
        'If you could not find what they asked for, say so honestly and say what you CAN see. Do ' +
        'not mention this note.</note>',
    );
    if (!body) return null;
    return await relayAndAccumulate(body, { ...options, state, suppressDone: true });
  } catch (e) {
    console.warn('[coach-tools] silent-turn nudge failed:', e);
    return null;
  }
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
  /**
   * So does the exchange itself. The continuation carries no provider-side thread (#232), so every
   * round has to re-send the whole turn — history, then each call beside the result it got. Drop
   * round one from round two's request and she is answering with an amnesia we built for her.
   */
  const exchangeCalls: CoachToolCall[] = [];
  const exchangeOutputs: CoachToolOutput[] = [];

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

    /**
     * Tell the user something is happening, while it happens — the FIRST of two frames per round.
     *
     * Owner: *"they usually tell me when they're calling a tool. This would help us diagnose and it
     * would also tell the user something is happening (or happened)."* For a long time only the
     * "happened" half existed: the sole activity frame was written AFTER execution, so the slowest
     * part of every round — the tool actually running — showed nothing. This `tool_start` frame is
     * written the moment the calls are parsed, before any of them run: it claims only "doing this
     * now", which is true even of a call that goes on to fail. The post-execution `tool` frame
     * below stays as the confirmation — "this finished" — and older clients that only know that
     * frame keep working unchanged (unknown cadence values fall through their parsers).
     *
     * `cadence` frames, not content deltas, so the parser can tell them from her prose and they can
     * never end up inside the reply.
     */
    try {
      // Announce only what will actually RUN — a repeat served from `served` does no work and must
      // not claim any. Unwrapped: a `use_tool` call names the META tool on the wire, and printing
      // that gave every read the same "looking something up"; resolveActivityNames looks through
      // to the real target. The post frame gets the identical treatment.
      const startFrame: CoachToolStartFrame = { cadence: 'tool_start', names: resolveActivityNames(fresh) };
      options.writeChunk?.(`data: ${JSON.stringify(startFrame)}\n\n`);
    } catch {
      /* client gone; the turn continues server-side regardless */
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
     * The SECOND frame of the round: confirmation. Written after execution on purpose — this one
     * claims the work HAPPENED, and a call that failed must not leave that claim on screen (a
     * thrown execute breaks out above and this line never runs). The new client reads it as
     * completion for the `tool_start` above; older clients still render it as the activity line
     * they have always shown. Same names, same resolution, as the start frame.
     */
    try {
      const frame: CoachActivityFrame = { cadence: 'tool', names: resolveActivityNames(fresh) };
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

    exchangeCalls.push(...pending);
    exchangeOutputs.push(...outputs);

    try {
      body = await deps.submit(
        state.currentResponseId,
        [...exchangeOutputs],
        [...exchangeCalls],
        revealed,
        coachTextSoFar(state),
      );
    } catch (e) {
      console.warn('[coach-tools] continuation failed — ending the turn with what streamed:', e);
      break;
    }
    // The continuation is a new generation, not more of the last one: close the bubble. Rounds
    // glued into one string is how four drafts of an answer became one paragraph (2026-08-31).
    endCoachSegment(state, options.writeChunk);
    toolRounds++;
  }

  const nudged = await nudgeDanglingLookup(userId, deps, options, {
    state,
    fulfilled,
    revealed,
    exchangeCalls,
    exchangeOutputs,
  });
  if (nudged) result = nudged;

  // Whatever happened above, a turn that ran tools may not end in silence.
  const spoke = await nudgeSilentTurn(userId, deps, options, state);
  if (spoke) result = spoke;

  // Flush the last generation into the segment record. No frame — [DONE] closes the client's
  // final bubble; this is only the transcript keeping its structure.
  endCoachSegment(state);

  // The one real terminal, whatever happened above — the client is waiting on it.
  try {
    options.writeChunk?.('data: [DONE]\n\n');
  } catch {
    /* client already gone; the result still persists server-side */
  }

  return { ...result, toolRounds };
}
