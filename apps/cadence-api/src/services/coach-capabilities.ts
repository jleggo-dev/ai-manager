/**
 * What Cadence can actually do — the coach's own capability manifest (deterministic app code).
 *
 * Why this lives in CODE and not in the persona: features ship here, but the persona is edited in
 * AI Admin Build Rules. A capability list written into `config.systemPrompt` drifts the moment a
 * feature lands or is pulled, and a coach that confidently offers something the build can't do is
 * worse than one that says "not yet". So the manifest is version-controlled beside the features and
 * injected as a context block at session open; the persona only says HOW to talk about it.
 *
 * Nomenclature: the UI word "Tools" is already taken — it means the user's `equipment` ("Tools —
 * what you're working with"). These are the coach's OWN abilities, so every user-facing phrasing
 * here is "what I can do", never "my tools" and never "features".
 *
 * NOT_YET is load-bearing, not decoration: it is the honest-answer list. Without it the coach
 * either invents an integration or stonewalls, and both cost trust when someone asks "can you
 * pull my Strava runs?" — a question that is really a feature request worth hearing.
 */
import { renderToolCatalogBrief } from '@cadence/shared';

export interface CapabilityGroup {
  /** Short heading — plain words, the way the coach would say it out loud. */
  heading: string;
  /** One line per ability. Written as the coach's own "I can ..." claims. */
  can: string[];
}

/**
 * Grounded in what the API actually exposes today (routes/ + services/). Adding a route or an
 * AI Admin job that a user can *feel* means adding a line here — otherwise the coach can't offer it.
 */
export const CAPABILITIES: CapabilityGroup[] = [
  {
    heading: 'Talking and remembering',
    can: [
      'talk through what you are building and turn it into goals with a why beside each',
      'remember what you told me — your goals, what you are working around, what you have to work with — so you never repeat yourself',
      'pressure-test a goal against where you actually are, and right-size it with stepping-stones',
    ],
  },
  {
    heading: 'Your rhythm',
    can: [
      'build a weekly rhythm from your goals, and rebuild it right here in the conversation when something changes — you never have to go to a screen for it',
      'set up a detour for travel, illness, or a rough stretch — your plan pauses, it never resets',
      'prescribe a specific session for today, and log what you actually did when you tell me',
      'change ONE thing in the plan without rebuilding it — move, retime, resize, drop or add a session, or swap what one contains (dead hangs instead of farmers carries)',
      'give you a weekly check-in on how you showed up, and flag what I am noticing',
    ],
  },
  {
    heading: 'Food',
    can: [
      'log a meal from a photo, a label, or you just telling me what you ate',
      'work out what to eat from a photo of your fridge, and build a meal plan or a recipe around it',
      'find or structure a recipe and tell you what is in it',
    ],
  },
  {
    heading: 'What I can read',
    can: [
      'read a photo of the gym you are standing in, so a detour plan fits the actual equipment',
      'use your local weather and time zone when it changes what today should look like',
      'read your recent activity and workouts from Apple Health — on iPhone, no setup',
      'nudge you with a notification, if you have turned those on',
    ],
  },
];

/**
 * Things people ask for that this build genuinely cannot do. Honest "no, not yet" beats a
 * hallucinated yes, and beats a flat refusal that loses the request. Keep this list SHORT and
 * true — it is only for asks that come up, not an inventory of everything Cadence isn't.
 */
export const NOT_YET: string[] = [
  'connect to Strava, Garmin, Whoop, Fitbit, or any tracker other than Apple Health',
  'read Google Fit or Android health data',
  'talk to you by voice, or call you',
  'see your calendar, email, or messages',
  'order food, book a class, or buy anything',
  'coach a group, or share your plan with another person',
];

/**
 * Rendered as a context block, so it reads as data the coach was handed — not as prose it wrote.
 * Two halves, because users ask two different questions: "can you do X?" (the product) and "can we
 * put some breathwork in?" (the session tools). The second half comes from `renderToolCatalogBrief`
 * — the SAME catalog the session-authoring job is given, so the chat coach can never offer a step
 * the app has no renderer for.
 */
export function renderCapabilities(opts: { healthAvailable?: boolean; healthAnswered?: boolean } = {}): string {
  const lines: string[] = ['== WHAT CADENCE CAN DO (this build — authoritative; do not invent beyond it) =='];
  for (const g of CAPABILITIES) {
    lines.push(`${g.heading}: ${g.can.join('; ')}.`);
  }
  // Two DIFFERENT facts, and collapsing them told the coach a lie. "We already asked" was being
  // sent as "not on this device", so after someone dismissed the offer once she started saying
  // "Apple Health only works on iPhone" — to a user holding an iPhone with access already granted.
  if (opts.healthAvailable !== true) {
    lines.push('Not on this device: Apple Health — do not offer to read their activity here.');
  } else {
    // What she used to be told — "it will appear for them to confirm" — made her promise a card
    // and then wait for it. On device 2026-08-15 she said "a prompt will show up for you to
    // confirm"; no prompt could appear, and she sat waiting for a confirmation that was never
    // coming while their workouts were one tool call away. The app now asks iOS for permission
    // on its own (iOS shows its sheet once and answers silently forever after), so there is no
    // card in this loop and nothing for her to announce.
    lines.push(
      'Apple Health: you READ IT YOURSELF (get_workout_history, get_health_history). Just look — ' +
        'never ask permission, never offer to connect it, and NEVER say a prompt or confirmation ' +
        'will appear; the app handles device access and no card is coming. An empty read means ' +
        'nothing recorded yet, not a missing permission.',
    );
  }
  /**
   * This list describes abilities; it must never become a script for describing them.
   *
   * Observed 2026-08-16. The user said "let's change the farmer carries to dead hangs", then "can
   * you change the plan? like in the app?" — and she answered with this manifest, near verbatim:
   * *"Yes — right here. We talk through what should change, I put up a card showing the edit, and
   * you tap to apply it… What do you want to adjust?"* She never called the tool, and she asked
   * them to name the change they had just named. From the user's side that is a coach who cannot
   * do it and cannot remember being asked. The capability was real; the reach for it was not.
   */
  lines.push(
    'DO THESE, DO NOT DESCRIBE THEM: when they ask for something above, call the tool in that same ' +
      'reply. Explaining the mechanism ("I put up a card, you tap it") is not doing it and reads as ' +
      'a no. Never make them repeat a change they already named — propose it, and let the card be ' +
      'what they correct.',
  );
  lines.push(`Cannot do yet: ${NOT_YET.join('; ')}.`);
  lines.push(
    'If they ask for something on the "cannot do yet" list, or for anything not above: say plainly that ' +
      'you cannot do it yet, ask what they were hoping it would do for them, and tell them you will pass it on. ' +
      'Never promise a date, and never say "the team" or "a future version" — just that you cannot yet.',
    '',
    renderToolCatalogBrief(),
  );
  return lines.join('\n');
}
