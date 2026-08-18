import type { ActiveEpisode } from '../../lib/api.ts';
import { barLine } from './detour-bar-line.ts';

/**
 * The detour, in full — what the one-line bar deliberately does not say.
 *
 * Design (2a, turn 2): the bar announces and *"the sheet behind the tap does the work"*. So this
 * is the state: what is still on, what is paused, the gear she was told about, and the two things
 * you can do about it. `DetourSetup`'s framing carries through — it names what is PRESERVED, never
 * what lapsed, and the plan is on hold rather than lost.
 */
export function DetourStateSheet({
  episode,
  busy,
  onCheckIn,
  onResume,
  onClose,
}: {
  episode: ActiveEpisode;
  busy: boolean;
  onCheckIn: () => void;
  onResume: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet detour-sheet" role="dialog" aria-label="Your detour">
        <div className="sheet-grab" aria-hidden />
        <div className="detour-sheet-h">
          <b>{barLine(episode)}</b>
          <span>Your usual plan is on hold, not lost. Do what you can — checking in keeps your streak alive.</span>
        </div>

        {/* What survives says itself; nothing here counts what was missed (BRAND.md). */}
        <div className="detour-sheet-kept">
          <span className="detour-sheet-label">Still on</span>
          <span>Meals, mindset and anything you can do where you are.</span>
        </div>

        <div className="detour-sheet-kept">
          <span className="detour-sheet-label">What you told me</span>
          <span>
            {episode.gearKnown
              ? 'I have your gear on file — say the word if that changed.'
              : "I don't know what you've got with you yet. Tell me and I'll shape the days around it."}
          </span>
        </div>

        <div className="detour-sheet-actions">
          <button className="detour-sheet-check" onClick={onCheckIn} disabled={busy}>
            Check in
          </button>
          <button className="detour-sheet-resume" onClick={onResume} disabled={busy}>
            {busy ? 'One moment…' : "I'm back — resume my plan"}
          </button>
        </div>
      </div>
    </>
  );
}
