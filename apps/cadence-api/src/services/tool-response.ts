/**
 * What a tool hands BACK — the surface with the worst record and, until now, no guard at all.
 *
 * Tool descriptions have seven CI checks (jargon, when-to-use, worked examples, defaults,
 * tiebreaks, length, safety gate). Tool RESPONSES had none — and responses are the half the model
 * actually reasons over. The asymmetry cost us the week's most expensive bug: both Apple Health
 * reads threw on a Date the row type called a string, the throw was swallowed as
 * "(nothing on file for this yet)", and the coach told a user with thirty recorded workouts that
 * he had none. Four device rounds to find, because nothing anywhere said a tool had failed.
 *
 * Two rules, and this module exists so they are enforced in one place rather than remembered in
 * six:
 *
 *  1. **An error never looks like an empty result.** "Nothing on file" is a fact about the user.
 *     "I could not read it" is a fact about us. Collapsing them puts a lie in her voice, and she
 *     will say it confidently because nothing told her otherwise.
 *  2. **A response is bounded.** An unbounded render is an unbounded prompt: a year of food logs
 *     or a long journal can crowd out the conversation it was fetched to serve. Anthropic caps
 *     Claude Code's tool results at 25,000 tokens; Cloudflare truncates every result and tells the
 *     model how to narrow. Both are right, and the telling matters as much as the cutting — a
 *     silent truncation is a quiet lie about completeness.
 */

/**
 * ~2,000 tokens. Generous next to a single turn and mean next to a year of anything: the largest
 * render measured against the owner's real dossier was under 1,000 characters, so nothing legitimate
 * is near this. It exists for the pathological case, not the ordinary one.
 */
export const TOOL_RESPONSE_LIMIT = 7_400;

/** Said out loud when a tool did not answer because it BROKE. Never phrased as an empty record. */
export function toolFaultText(what: string): string {
  return (
    `${what} could not be read just now — this is a fault on our side, NOT an empty record. ` +
    'Do not tell the user they have nothing here; say you could not check it right now.'
  );
}

/** Said when the tool worked and there is genuinely nothing — a fact about them, not about us. */
export function toolEmptyText(what?: string): string {
  return what ? `(${what}: nothing on file for this yet)` : '(nothing on file for this yet)';
}

/**
 * Cut an over-long response at a line boundary and SAY SO, with what to do about it.
 *
 * The note is addressed to her rather than to a log, because she is the one who can act on it: a
 * narrower window is usually one parameter away, and a model that knows it is holding a partial
 * answer can say "the last month" instead of implying it read everything.
 */
export function boundToolResponse(text: string, limit = TOOL_RESPONSE_LIMIT): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  // Prefer a clean line break so a row is never sliced in half and misread as data.
  const cut = head.lastIndexOf('\n');
  const kept = cut > limit * 0.6 ? head.slice(0, cut) : head;
  return (
    `${kept}\n— TRUNCATED — this is only the first part. Ask for a narrower period or fewer items ` +
    'if you need the rest, and do not describe this to the user as everything on file.'
  );
}
