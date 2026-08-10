/**
 * Teaching the coach to hand the client its own affordances.
 *
 * This lives in CODE and rides in as a context block at session open, for the same reason
 * `coach-capabilities.ts` does: the persona is edited in AI Admin Build Rules, but the renderer
 * for these blocks ships here. A format written into the persona drifts the moment the client's
 * parser changes, and a coach emitting a shape the client can't read is a turn full of raw JSON.
 *
 * The intake script below is a **script, not a state machine** — that is the whole point of the
 * redesign. The client no longer knows the questions; it renders whatever comes back. So the
 * coach may skip a question already answered, reorder, follow up, or ask something not on the
 * list, and nothing downstream breaks. What the client does insist on is the shape, which is why
 * the rules about the fence are stated flatly and the vocabulary is only two layouts.
 *
 * Mirrors `@cadence/shared`'s `coach-picks.ts` parser. Change one, change both.
 */
import { COACH_PICKS_FENCE, OPENING_QUESTION } from '@cadence/shared';

/** Question order for a first conversation. Suggested, in the coach's own judgement. */
const INTAKE_SCRIPT: string[] = [
  'how many days a week they can honestly give it (tiles: 2 / 3 / 4 / 5+, with a short hint under each)',
  'what time of day works best (list, single)',
  'what they are working around — an injury, a day that is always gone, a hard stretch (list, multi)',
  'what they have to work with — shoes, a journal, a kettlebell, a gym (list, multi)',
  'their name, and age/height/weight if the goal needs it (no picks — let them type)',
  'when you have enough to build a first week: the confirmation turn (layout "confirm", progress 0.9)',
];

const RULES: string[] = [
  `Put the block at the very END of the turn, fenced as \`\`\`${COACH_PICKS_FENCE}\`\`\`, containing ONE JSON object and nothing else.`,
  'Never mention the block, the picks, or "options" in your prose — the user sees buttons, not a format.',
  'Ask ONE question per turn. Two or three sentences at most before the block.',
  'layout "list" for labelled choices; layout "tiles" for short scalars (counts, days, ratings) — a tile label is one or two characters and carries a "hint" line.',
  'layout "confirm" is the ONE exception and takes no options: it tells the app to show everything it has captured so far — goals, about them, what you work around, what they have to work with — for them to check and correct. Use it exactly once, when you have enough to build a first week, with prose like "Before I build anything — here\'s everything I\'ve heard. Tap anything that\'s off." Do not list the captures yourself in that turn; the app renders them.',
  'DEFAULT TO PICKS. Most intake questions have a small, guessable answer set, and those all get a block. Leaving it off is the exception you justify, not the easy option — a bare question makes someone type what they could have tapped.',
  'A narrowing follow-up — how many, how often, how long, how far along, which end of a range — is a TILES question, always. "How many days a week?" is tiles 2/3/4/5+. "Roughly when?" is tiles of months. "Where are you starting from?" is tiles. Do not ask these as open prose.',
  'Never ask two open, pick-less questions in a row during the first conversation. If the last turn had no block, this one needs one.',
  'multi: true only when several answers can be true at once.',
  '"say" is the user\'s own words for that option — it is dropped into their composer and they can edit it, so write it as something a person would actually type.',
  'With "lead" (e.g. "I\'d like to") the "say" fragments are joined into one sentence; without it a single "say" is used verbatim, so make it a whole sentence.',
  '"area" is one of movement | nourishment | mind | practice, and only colours a dot.',
  '"progress" is your own read of how far through this first conversation you are, 0 to 1.',
  'Omit the block ONLY when a menu would genuinely put words in their mouth — "why does this matter to you?", "how did that go?", anything whose answer is theirs alone. Not merely because a question feels conversational.',
  'Never offer more than six options. Never add a "something else" row: typing is always available and the composer already says so.',
];

const EXAMPLE = `\`\`\`${COACH_PICKS_FENCE}
{"layout":"list","multi":true,"lead":"I'd like to","progress":0.2,"options":[
{"label":"Run a first 10k","say":"run a first 10k","area":"movement"},
{"label":"Eat better","say":"eat better","area":"nourishment"},
{"label":"A steadier mind","say":"build a steadier mind","area":"mind"},
{"label":"The daily pages","say":"keep up the daily pages","area":"practice"}]}
\`\`\``;

/**
 * The context block. `intent` only changes the script half: an ongoing conversation gets the same
 * vocabulary (that is the point — one chat, one set of affordances) without a first-run running order.
 */
export function renderPickProtocol(opts: { intent?: string } = {}): string {
  const lines: string[] = [
    '== QUICK PICKS (how to hand the app tappable answers) ==',
    "You may attach a set of quick picks to any turn. They appear as buttons; tapping one writes plain words into the user's composer, which they can edit before sending. They are a shortcut for typing — never a gate, and never a form.",
    ...RULES.map((r) => `- ${r}`),
    '',
    'Example turn: "So — what would you like to work on? Pick as many as you like, or just tell me."',
    EXAMPLE,
  ];
  if (opts.intent === 'onboarding') {
    lines.push(
      '',
      '== FIRST CONVERSATION — a suggested running order, not a checklist ==',
      // The app paints question 1 itself and never sends it upstream, so from the coach's side the
      // conversation opens mid-flow with an answer to a question it did not ask. Quote it verbatim
      // (from @cadence/shared, so the two can never drift) or it asks the same thing again.
      `The app has ALREADY asked the opening question and shown its own picks: "${OPENING_QUESTION}" — ` +
        'their first message is the answer to it. Do not ask it again, and do not re-greet them; ' +
        'acknowledge what they said in a few words and move to the next question.',
      ...INTAKE_SCRIPT.map((s, i) => `${i + 1}. ${s}`),
      'Skip anything they have already told you, reorder when the conversation goes somewhere, and follow up when an answer needs one. When you have enough to build a first week, say so and stop asking.',
    );
  }
  return lines.join('\n');
}
