import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoachFaceId } from '@cadence/shared';
import { CadenceWorking } from '../../components/CadenceWorking.tsx';
import { CoachFace } from '../../components/CoachFace.tsx';
import { CoachFaceGrid } from '../coach/CoachFaceGrid.tsx';
import { useCoachFace } from '../coach/coachFaceContext.ts';
import { capabilities } from '../../lib/capability/index.ts';
import { enablePushOnThisDevice } from '../settings/notifications/enablePush.ts';
import { useAppResume } from '../../lib/useAppResume.ts';
import { useBuildPlan } from './useBuildPlan.ts';

/**
 * The ready-ping is the DEFAULT, not an opt-in (owner ruling 2026-08-13: "Claude doesn't have a
 * bell — it just assumes you want it"). iOS's own permission dialog is the one ask nothing can
 * skip, so it fires HERE, uninvited, at the moment its value is self-evident: a minutes-long
 * build the copy just said you may leave. Granting registers the token (the server sends at
 * first commit whether or not the app is open); declining Apple's dialog is the answer and is
 * respected in silence — re-asking is Settings' job. The only chrome is the one reassuring line
 * once it's on.
 */
function NotifyWhenReady() {
  const [on, setOn] = useState(false);
  const busy = useRef(false);
  /**
   * Asked on mount AND again whenever they come back, because the first ask can land at the one
   * moment iOS cannot answer it.
   *
   * This screen's own copy says "leave the app if you like", and someone who takes it up on that
   * during the very seconds the permission dialog would appear never sees it — a backgrounded app
   * cannot show one. Observed on device 2026-08-15: the build ran to completion while they were
   * away, and the ledger recorded the ping as `failed / no_devices`, because no token had ever
   * been registered. The feature defeated itself on exactly the behaviour it exists to support.
   *
   * Retrying is safe rather than naggy: iOS shows its permission dialog once per install, and
   * every later request resolves straight from the stored answer without surfacing anything. So
   * a decline stays declined and silent, while a MISSED prompt gets the second chance it needs.
   */
  const attempt = useCallback(() => {
    if (on || busy.current || !capabilities.push.isAvailable()) return;
    busy.current = true;
    void enablePushOnThisDevice()
      .then((r) => setOn(r === 'on'))
      .finally(() => {
        busy.current = false;
      });
  }, [on]);
  useEffect(() => attempt(), [attempt]);
  useAppResume(attempt);
  if (!on) return null;
  return <div className="build-notify is-on">🔔 I&rsquo;ll ping you when it&rsquo;s ready — feel free to leave.</div>;
}

/**
 * The plan is building. Here is something to do while it does.
 *
 * The face pick lives here rather than in the wizard for a reason that is half practical and half
 * about tone: it is the one step that curates nothing, and this is the one wait long enough to
 * need filling. Handing someone a warm, consequence-free choice while the machine works beats a
 * spinner and beats a fake progress bar.
 *
 * The face they met is already ticked — she was drawn at random and kept when they met her, so
 * this grid is "change her if you like", not "choose one". Walking past it is a real answer that
 * keeps her; the mark sits last, as the deliberate opt-out. No names under any tile, as ever.
 *
 * If the build finishes first, the screen stays put until they're done choosing — the plan isn't
 * going anywhere, and yanking a grid out from under a half-made choice is the app deciding for them.
 */
export function BuildingScreen({ onReady, onBackToChat }: { onReady: () => void; onBackToChat: () => void }) {
  const { faceId, setFaceId } = useCoachFace();
  const [built, setBuilt] = useState(false);
  const { phase, note, error, retry, progress } = useBuildPlan({ onDone: () => setBuilt(true) });

  // No toggle-to-clear here: every tile is a positive choice, and the mark tile IS the way to
  // choose no face. Re-tapping the current face should be a no-op, not a quiet un-picking.
  const pick = (id: CoachFaceId | null) => void setFaceId(id);

  if (phase === 'failed') {
    return (
      <div className="building">
        <div className="build-fail">
          <CoachFace size={64} />
          <p>{error}</p>
          <div className="build-fail-acts">
            <button className="cta" onClick={retry}>
              Try again
            </button>
            <button className="build-back" onClick={onBackToChat}>
              Talk it through instead
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="building">
      <CadenceWorking
        label={built ? 'Your week is ready.' : 'Building your week…'}
        note={note}
        progress={built ? 1 : progress}
      />

      <div className="build-say">
        <CoachFace size={40} />
        <p>
          {built
            ? "Done — it's waiting for you. Change my face whenever you like."
            : "This takes me a few minutes, and you don't have to watch me work — leave the app if you like, and your week will be here when you get back. Meanwhile: happy with the face I'm wearing, or would you rather another?"}
        </p>
      </div>

      {!built && <NotifyWhenReady />}

      <CoachFaceGrid selected={faceId} onPick={pick} withMark />

      <div className="build-note">
        {"Whichever you pick, it's still me — and I'll still remember everything you've told me."}
      </div>

      <div className="build-foot">
        {built ? (
          <button className="cta" onClick={onReady}>
            {'See my week →'}
          </button>
        ) : (
          <span>Swap faces later in Settings — your plan and history stay put.</span>
        )}
      </div>
    </div>
  );
}
