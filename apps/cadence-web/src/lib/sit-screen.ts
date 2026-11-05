/**
 * Whether the screen stays on during a sit or a breath pacer (owner, 2026-11-03).
 *
 * Every other clock holds the screen while it runs (tools/useKeepAwakeWhile.ts). A sit is
 * different: keep-awake means a lit screen, and a person sitting with their eyes closed did not
 * ask for a lamp for twenty minutes — their bells ring as notifications with the screen dark. This
 * is about THIS phone's screen, so it is a per-device preference in local storage like the other
 * `cadence.*` keys, never an account setting and never a migration.
 *
 * `dark` is the default, and also the answer when nothing is stored, the value is unreadable, or
 * the store throws (private mode, a disabled store).
 */
export const SIT_SCREEN_KEY = 'cadence.sitScreen';

export type SitScreen = 'dark' | 'on';

export const SIT_SCREEN_DEFAULT: SitScreen = 'dark';

export function readSitScreen(): SitScreen {
  try {
    return window.localStorage.getItem(SIT_SCREEN_KEY) === 'on' ? 'on' : SIT_SCREEN_DEFAULT;
  } catch {
    return SIT_SCREEN_DEFAULT;
  }
}

export function writeSitScreen(value: SitScreen): void {
  try {
    window.localStorage.setItem(SIT_SCREEN_KEY, value);
  } catch {
    /* storage unavailable — the screen keeps the default */
  }
}
