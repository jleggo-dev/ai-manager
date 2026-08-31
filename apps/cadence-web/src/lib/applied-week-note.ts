/**
 * The applied week's handoff to the conversation (owner pick "B", 2026-08-31): after the user
 * taps Apply on a week the coach drew, she should OPEN the next chat visit with one line about
 * it — not a system line in the transcript, not silence. The flag rides localStorage so it
 * survives a relaunch; it is a garnish, so every touch is try/caught — a blocked store costs
 * the greeting, never the apply. The coach independently sees the changed plan via the turn
 * floor, so losing the flag loses only the proactive first line.
 */
const KEY = 'cadence.applied-week-note';

export function markWeekApplied(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked — the turn floor still tells her the plan changed */
  }
}

/** True once per apply: reads and clears, so the greeting cannot repeat. */
export function consumeWeekApplied(): boolean {
  try {
    if (localStorage.getItem(KEY) !== '1') return false;
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
