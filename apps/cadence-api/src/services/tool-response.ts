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
 *     silent truncation is a quiet lie about completeness. Since HARNESS-V3 P5 this covers what
 *     ACTIONS hand back too, not only reads (coach-tools.ts).
 *  3. **An action says what changed** (HARNESS-V3 C4). Every action that changes data — or puts
 *     something on their screen to accept — answers in one of three shapes, decided by its first
 *     line: `changed:` lines (`toolChangeText`), one `nothing changed:` line (`toolNothingChangedText`),
 *     or a fault (`toolActionFaultText`). Her confirmation to the user is then read from facts the
 *     tool stated, not inferred from prose. coach-action-contract.test.ts walks every action.
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

/** The words every fault carries, read or action, so the two kinds of fault are one shape. */
const FAULT_MARK = 'this is a fault on our side';

/**
 * Said when an ACTION broke — it threw, or a write it depends on failed in a way the tool could not
 * check. Nothing is claimed either way about what landed, because a throw partway through can leave
 * part of a change behind. `verb` names the act ("logged", "composed"); `next` is what she should
 * do about it.
 */
export function toolActionFaultText(verb = 'done', next = 'tell the user plainly and offer to try again.'): string {
  return `That could not be ${verb} just now — ${FAULT_MARK}; ${next}`;
}

/** What an action that changed something hands back. */
export interface ToolChange {
  /** What is now different, one fact per line — read back from the store where the tool can. */
  changed: [string, ...string[]];
  /** What the call left as it was, named so she does not have to guess. */
  unchanged?: string[];
  /** Next steps for THIS result (TOOL-HARNESS.md, Responses), after the facts. */
  next?: string[];
}

/**
 * `changed:` lines, then `unchanged:` lines, then her next steps. The `changed` list cannot be
 * empty — by type — because a call that changed nothing says so with `toolNothingChangedText`.
 */
export function toolChangeText({ changed, unchanged = [], next = [] }: ToolChange): string {
  return [...changed.map((c) => `changed: ${c}`), ...unchanged.map((u) => `unchanged: ${u}`), ...next]
    .filter(Boolean)
    .join('\n');
}

/**
 * Said when the call changed nothing — bad input, nothing matched, already that way, or a write
 * that verifiably did not take. `reason` says which, in words she can repeat; `next` is optional.
 */
export function toolNothingChangedText(reason: string, next: string[] = []): string {
  return [`nothing changed: ${reason}`, ...next].filter(Boolean).join('\n');
}

export type ToolOutputShape = 'changed' | 'nothing-changed' | 'fault' | 'unshaped';

/** Which of the three shapes an action's answer takes, by its first line; 'unshaped' if none. */
export function toolOutputShape(text: string): ToolOutputShape {
  const first = text.split('\n', 1)[0] ?? '';
  if (first.startsWith('changed: ')) return 'changed';
  if (first.startsWith('nothing changed: ')) return 'nothing-changed';
  if (first.includes(FAULT_MARK)) return 'fault';
  return 'unshaped';
}
