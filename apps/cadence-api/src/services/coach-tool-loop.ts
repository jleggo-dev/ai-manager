import type { CoachActivityFrame } from '@cadence/shared';
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
}

export async function relayCoachTurnWithTools(
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

  // The one real terminal, whatever happened above — the client is waiting on it.
  try {
    options.writeChunk?.('data: [DONE]\n\n');
  } catch {
    /* client already gone; the result still persists server-side */
  }

  return { ...result, toolRounds };
}
