import { type ActiveEpisode } from '../../lib/api.ts';
import { useDetourGear } from './useDetourGear.ts';

/**
 * The live detour's day cards, out of PlanView when it crossed the 500-line gate (2026-08-31):
 * the arrival card (gear question, asked once on the scheduled start) and the on-detour card
 * (check in / re-photo / come back).
 *
 * The handlers are NOT duplicated here: they are `useDetourGear` — the plan-change suite's
 * extraction of the same machinery, which carries the Phase 0 fix this component's first draft
 * predated (a failed gear rework must say so, never read like a landed one). One hook, two
 * consumers' worth of history, one behavior.
 */

/** Warm label for a detour type — the coach names the disruption plainly (BRAND.md). */
function detourLabel(type: ActiveEpisode['type']): string {
  return {
    travel: 'traveling',
    illness: 'under the weather',
    injury: 'working around an injury',
    recovery: 'recovering',
    custom: 'a full stretch',
  }[type];
}

/** Local calendar day — the detour card's clock is the user's day, not UTC. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One-tap answers for the arrival card; DetourSetup keeps its own copy for the entry sheet. */
const ARRIVAL_GEAR = ['Hotel gym', 'Dumbbells', 'Treadmill', 'Resistance band', 'Pool', 'Just my shoes'];

export function DetourDayCards({
  episode,
  onCheckIn,
  onEnd,
  endBusy = false,
  endError = null,
  onChanged,
}: {
  episode: Pick<ActiveEpisode, 'type' | 'start' | 'paused'> & { gearKnown: boolean };
  /** The on-detour card's "Check in" — keeps the streak alive with nothing completed. */
  onCheckIn: () => void;
  /** "I'm back" — ends the episode; the caller owns the call and its busy/error state (the
   *  plan-change suite's endDetour: real busy flag, honest failure line). */
  onEnd: () => void;
  endBusy?: boolean;
  endError?: string | null;
  /** Data changed server-side (gear confirmed, week re-drafted, start postponed) — revalidate. */
  onChanged: () => void;
}) {
  // The hook wants refresh/bump apart but only ever fires them together; the card's single
  // onChanged carries both, so bump rides as a no-op here.
  const { gymBusy, gymSaw, arrivalGear, setArrivalGear, sendGym, confirmArrivalGear, notArrivedYet } = useDetourGear({
    refresh: onChanged,
    bump: () => {},
  });

  if (todayIso() < episode.start) return null;

  /**
   * A pause has no gear question and no options to do — the person asked for an empty stretch, so
   * both cards below would put something back on their plate: one asks what equipment they have,
   * the other offers to reshape the days around it. It says what is true and leaves the way back.
   */
  if (episode.paused) {
    return (
      <div className="detour">
        <div className="detour-t">
          <b>Paused</b>
          <span>Nothing&rsquo;s scheduled for now. Nothing was deleted — it all comes back when you do.</span>
        </div>
        <div className="detour-actions">
          <button className="detour-end" disabled={endBusy} onClick={onEnd}>
            {endBusy ? 'One moment…' : 'Start again now'}
          </button>
        </div>
        {endError && <div className="detour-saw">{endError}</div>}
      </div>
    );
  }

  if (!episode.gearKnown) {
    return (
      <div className="detour">
        <div className="detour-t">
          <b>Detour day — {detourLabel(episode.type)}</b>
          <span>Have you arrived? Tell me what you&apos;ve got and I&apos;ll shape the days around it.</span>
        </div>
        <div className="detour-chips">
          {ARRIVAL_GEAR.map((g) => (
            <button
              key={g}
              className={`detour-chip ${arrivalGear.includes(g) ? 'on' : ''}`}
              aria-pressed={arrivalGear.includes(g)}
              onClick={() => setArrivalGear((a) => (a.includes(g) ? a.filter((x) => x !== g) : [...a, g]))}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="detour-actions">
          {arrivalGear.length > 0 && (
            <button className="adjust-pill" disabled={gymBusy} onClick={() => void confirmArrivalGear(false)}>
              {gymBusy ? 'Working…' : "That's what I've got"}
            </button>
          )}
          <label className="adjust-pill" title="Snap the gym — I'll work out what's there">
            {gymBusy ? 'Looking…' : '📷 Snap the gym'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              disabled={gymBusy}
              onChange={(e) => {
                void sendGym(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
          <button className="adjust-pill" disabled={gymBusy} onClick={() => void confirmArrivalGear(true)}>
            No gym here
          </button>
          <button className="detour-end" onClick={() => void notArrivedYet()}>
            Not yet
          </button>
        </div>
        {gymSaw && <div className="detour-saw">{gymSaw}</div>}
      </div>
    );
  }

  return (
    <div className="detour">
      <div className="detour-t">
        <b>On a detour — {detourLabel(episode.type)}</b>
        <span>
          Your plan&apos;s on hold so a rough stretch never breaks your rhythm. Do what you can — checking in keeps your
          streak alive.
        </span>
      </div>
      <div className="detour-actions">
        <button className="adjust-pill" onClick={onCheckIn}>
          Check in
        </button>
        {/* The equipment answer as pictures — parsed into names, the week re-drafts. */}
        <label className="adjust-pill" title="Snap the gym — I'll rework the week around what's there">
          {gymBusy ? 'Looking…' : '📷 Snap the gym'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            disabled={gymBusy}
            onChange={(e) => {
              void sendGym(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <button className="detour-end" disabled={endBusy} onClick={onEnd}>
          {endBusy ? 'One moment…' : "I'm back"}
        </button>
      </div>
      {/* One line, one slot: the photo verdict or the resume failure — whichever is live. */}
      {(gymSaw || endError) && <div className="detour-saw">{gymSaw || endError}</div>}
    </div>
  );
}
