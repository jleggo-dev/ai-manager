import type { ActiveEpisode } from '../../lib/api.ts';
import { barLine } from './detour-bar-line.ts';

/**
 * One line of glass under the header — the whole cost a disruption is allowed to charge the plan.
 *
 * It replaces two full-width cards. Design (Plan Screen 2a, turn 2): *"One butter bar, 34px of
 * glass under the header, is the most any of this ever costs the plan — it announces, and the
 * sheet behind the tap does the work… It never carries reasons, chips or buttons; that was the
 * card, and the card was the problem."* The cards pushed the first node of the plan off the
 * screen to say something a sentence says.
 *
 * A 6px dot carries the state — forest while a detour is live — because the sentence is already
 * the word for it.
 */
export function DetourBar({
  episode,
  dark,
  onOpen,
}: {
  /** The live detour. */
  episode: ActiveEpisode;
  /** True where the sky behind the bar is a night one — this is glass over the trail. */
  dark: boolean;
  onOpen: () => void;
}) {
  return (
    <button className={`detour-bar${dark ? ' detour-bar-dark' : ''}`} onClick={onOpen}>
      <span className="detour-bar-dot" aria-hidden />
      <span className="detour-bar-line">{barLine(episode)}</span>
      <span className="detour-bar-chev" aria-hidden>
        ›
      </span>
    </button>
  );
}
