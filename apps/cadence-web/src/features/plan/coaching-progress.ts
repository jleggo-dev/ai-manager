import { useEffect, useState } from 'react';

/**
 * A cold prescribe-session can take ~a minute. Rather than a dead "loading…", narrate the REAL work
 * the coach does, in order — read the plan → review history → respect constraints → pick tools →
 * assemble — so the wait reads as the coach thinking, not the app hanging. Every line is true of what
 * `generateSession` actually does; the last one holds for the tail so we never over-promise "almost done".
 * The weather line only appears for an outdoor-sounding task (the coach only pulls weather for those).
 */
export function coachingMessages(title?: string): string[] {
  const t = title?.trim();
  const outdoor = !!t && /\b(run|jog|walk|hike|bike|cycl|ruck|swim|row)\b/i.test(t);
  return [
    t ? `Coaching your ${t}…` : 'Reading your plan…',
    'Reviewing your recent sessions…',
    'Keeping it safe for your body…',
    'Choosing your sets and timers…',
    ...(outdoor ? ["Checking today's conditions…"] : []),
    'Putting it together…',
  ];
}

/** Advance through `messages` on a timer while `active`, holding on the last (a long tail shouldn't loop). */
export function useRotatingMessage(active: boolean, messages: string[], intervalMs = 2800): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    setI(0);
    const id = setInterval(() => setI((n) => Math.min(n + 1, messages.length - 1)), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, messages.length]);
  return messages[Math.min(i, messages.length - 1)] ?? '';
}
