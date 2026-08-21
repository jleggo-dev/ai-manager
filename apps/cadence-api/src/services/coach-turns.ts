/**
 * What counts as part of the conversation.
 *
 * Deliberately import-free. This predicate feeds two things at once — the transcript the client
 * restores and the window the Broker extracts captures from — so it is worth being able to test in
 * isolation; while it sat next to the code that reads history, its unit test dragged in the AI
 * Admin client, the config module, and a database URL to check a regular expression.
 */

/**
 * Turns the app authored rather than the user. They must be invisible everywhere the conversation
 * is read back: in a restored transcript they render as a message in the user's own bubble that
 * they never wrote, and in the Broker's capture window they get extracted as something they said.
 *
 * `<context` and `<note>` are live — the injected packs, and the notes the app hands the coach
 * mid-conversation so she speaks to something that just happened (the Apple Health history a user
 * has this second agreed to share). **`<open>` is legacy** and deliberately kept: the
 * client briefly opened onboarding by asking the model to speak first, and sessions created in
 * that window still carry the nudge. The opening question is a constant now
 * (`@cadence/shared`'s OPENING_QUESTION, painted client-side and never sent), so nothing new
 * writes one — but dropping the pattern would make those existing transcripts render wrong.
 */
const APP_AUTHORED = /^\s*<(context|open|note)\b/;

export const isRealTurn = (m: { role?: string; content?: string }) =>
  (m.role === 'user' || m.role === 'assistant') && !APP_AUTHORED.test(m.content ?? '');

/** One turn as the client renders it. `assistant` becomes `coach` — to the user there is only her. */
export interface DisplayTurn {
  role: 'user' | 'coach';
  content: string;
}
