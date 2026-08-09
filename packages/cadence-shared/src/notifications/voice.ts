/* ════════════════════════════════════════════════════════════════
   The voice guard — brand rules, as a function a test can run
   ════════════════════════════════════════════════════════════════ */

/**
 * A notification is the lowest-context, highest-stakes surface Cadence has. It arrives with no
 * screen around it, often on a lock screen, often at a bad moment, and it cannot be taken back.
 * Every other surface can be read charitably because the app is right there explaining itself; a
 * notification is read alone.
 *
 * So the rules in BRAND.md are not advice here — they are a gate. This module makes them
 * executable: `voiceViolations()` returns every rule a string breaks, and the copy tests assert
 * that the ENTIRE catalog (every kind, every variant, every substitution) returns nothing. That
 * makes the brand a build failure rather than a review comment, which is the only form a rule
 * survives in.
 *
 * The rules are deliberately about the shapes that hurt, not a general style checker. Each one
 * traces to a specific harm a person would actually feel at 9pm.
 */

export interface VoiceRule {
  id: string;
  /** What the rule protects against, in one line — read straight off a failing test. */
  why: string;
  pattern: RegExp;
}

export const VOICE_RULES: readonly VoiceRule[] = [
  {
    id: 'exclamation',
    why: 'BRAND.md: warm, level, unhyped — no exclamation marks, no confetti cannon.',
    pattern: /!/,
  },
  {
    id: 'third-person-self',
    why: 'The coach speaks as "I" — never "Cadence", never "the coach", never "the app".',
    pattern: /\b(cadence|the coach|the app|your app)\b/i,
  },
  {
    id: 'plural-self',
    why: 'One coach, speaking as "I". "We" turns a coach into a company. ("Let\'s" is fine.)',
    pattern: /\b(we|we'll|we've|we're|our|ours)\b/i,
  },
  {
    id: 'percent',
    why: 'Count what happened ("2 of 4"), never a percentage — a percent is a grade.',
    pattern: /%|\bper ?cent\b|\bpercent\b/i,
  },
  {
    id: 'only',
    why: '"Only" turns a count into a verdict. "2 of 4" is information; "only 2 of 4" is a mark.',
    pattern: /\bonly\b/i,
  },
  {
    id: 'streak-break',
    why: 'No streak countdown, no break warning. freeze_save celebrates a save; nothing warns.',
    pattern:
      /\bstreak\b[^.?!]*\b(break|breaks|breaking|broken|lost|lose|losing|end|ends|ending|over|gone|risk|at risk|expire)\b|\b(break|lose|losing|save)\b[^.?!]*\byour streak\b|\bdon't break\b|\bkeep (it|your streak) alive\b/i,
  },
  {
    id: 'behind',
    why: 'Nothing about falling behind or catching up as an obligation — the plan bends.',
    pattern: /\b(falling behind|fallen behind|behind schedule|catch up on|you're behind|off track|slipping)\b/i,
  },
  {
    id: 'failure',
    why: 'A missed day is information, not failure. Never name it as a lapse.',
    pattern: /\b(failed|failure|you missed|missed again|skipped again|lapse|relapsed on|gave up|quit on)\b/i,
  },
  {
    id: 'wellbeing-inference',
    why: 'Absence is not evidence about a person. Never infer a mood or a struggle from silence.',
    pattern: /\b(are you (ok|okay|alright)|is everything (ok|okay)|you seem|struggling|hope you're|feeling low)\b/i,
  },
  {
    id: 'coercion',
    why: 'Bodies end in an invitation, not an order. No obligation language, no guilt.',
    pattern:
      /\b(you (must|need to|should|have to|owe)|don't forget|make sure you|remember to|no excuses|get it done|push through|last chance)\b/i,
  },
  {
    id: 'banned-metaphor',
    why: 'BRAND.md veto list: the music metaphor never reaches schema, prompts, or product copy.',
    pattern: /\b(beats|instruments|tempo changes)\b/i,
  },
  {
    id: 'banned-cliche',
    why: 'BRAND.md veto list: wellness clichés.',
    pattern: /\b(unlock|unlocks|unlocked|empower|empowers|empowering|journey|transform|transforms)\b/i,
  },
  {
    id: 'surveillance',
    why: 'BRAND.md veto list: "captured" is surveillance framing and is banned in user copy.',
    pattern: /\bcaptur(e|ed|es|ing)\b/i,
  },
  {
    id: 'generic-prompt',
    why: 'No generic daily "time to work out" — a nudge names the user\'s own thing or says nothing.',
    pattern: /\b(time to (work ?out|exercise|train)|get moving|let's get (moving|started)|workout time)\b/i,
  },
];

/** Every rule `text` breaks. Empty means the string is safe to put on a lock screen. */
export function voiceViolations(text: string): VoiceRule[] {
  return VOICE_RULES.filter((r) => r.pattern.test(text));
}

/** Convenience for assertions and for a future dev-only copy linter. */
export function isInVoice(text: string): boolean {
  return voiceViolations(text).length === 0;
}
