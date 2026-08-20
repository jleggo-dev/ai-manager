/**
 * Thread mode — what a turn sends when the PROVIDER keeps the conversation.
 *
 * The Devs.ai v2 spec is explicit about its two execution modes: a request carrying
 * `previous_response_id` (or `conversation`) joins a long-lived ThreadWorkflow that already holds
 * the prior turns; a request carrying neither is a one-shot. The engine has always used the
 * one-shot shape — full history in `input`, every turn — which is correct, provider-agnostic, and
 * increasingly expensive: one real coach conversation reached 119,605 prompt tokens per turn,
 * paying for its whole past on every message.
 *
 * Threading inverts that: the server prepends what it already has, so `input` must carry ONLY what
 * it has not seen. Sending the full transcript alongside a thread pointer is not belt-and-braces —
 * measured 2026-08-16, the thread simply wins and the input items are ignored, so anything that
 * exists only locally (an injected context turn, an edited history) silently never reaches the
 * model. One mode or the other, never both; this module is the "only the new part" arithmetic.
 *
 * What counts as new: everything after the last assistant turn in the local transcript. The last
 * assistant row marks the last completed response — i.e. the newest thing the server thread is
 * known to contain — and whatever follows it locally (the user's message, context blocks injected
 * between turns by the Broker) has never been sent. System rows ride separately: the spec says
 * instructions are NOT carried over between threaded responses, so they are re-sent on every turn —
 * which is also what keeps a persona refresh (session-persona-refresh.ts) effective mid-thread.
 */
import type { ChatMessage } from '../types.ts';

/**
 * The messages a threaded turn actually sends: every system row (lifted into `instructions` by
 * `messagesToV2Request`), plus everything after the last assistant row (never seen by the thread).
 *
 * With no assistant row yet there is no thread to lean on — the caller should not be threading at
 * all — but the honest degenerate answer is "everything", which is exactly what a first turn sends.
 */
export function sliceForThread(messages: ChatMessage[]): ChatMessage[] {
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') {
      lastAssistant = i;
      break;
    }
  }
  const instructions = messages.filter((m) => m.role === 'system');
  const fresh = messages.slice(lastAssistant + 1).filter((m) => m.role !== 'system');
  return [...instructions, ...fresh];
}
