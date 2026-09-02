import { useEffect, useState } from 'react';
import { StartSheet } from './StartSheet.tsx';
import { CaptureSheet } from './CaptureSheet.tsx';
import { CookSheet } from './CookSheet.tsx';
import { AdjustSheet } from './AdjustSheet.tsx';
import { taskOpener } from './taskShape.ts';
import { TodayTrail } from '../today/TodayTrail.tsx';
import { TrailHeader } from '../today/TrailHeader.tsx';
import { DailyCheckIn } from '../today/DailyCheckIn.tsx';
import { PlanAdjustNote, PlanProposalBanner } from './PlanProposalBanner.tsx';
import { PlanSkeleton } from './PlanSkeleton.tsx';
import { DetourBar } from './DetourBar.tsx';
import { DetourStateSheet } from './DetourStateSheet.tsx';
import { DetourSetup, type DetourChoice } from './DetourSetup.tsx';
import { DoorSheet } from './DoorSheet.tsx';
import { DetourDayCards } from './DetourDayCards.tsx';
import { isWeeklyCheckin } from './occurrence/format.ts';
import { EndOfTrail } from './EndOfTrailCard.tsx';
import { HorizonEndCap } from './HorizonEndCap.tsx';
import { endEpisode, checkin, type PlanOccurrence, enterEpisode } from '../../lib/api.ts';
import { useProposalAccept } from './useProposalAccept.ts';
import { useQueryClient } from '@tanstack/react-query';
import { setPlanData, usePlan, useWatchLogInbox, useWatchPortraitSync, useWatchSync } from '../../lib/query/index.ts';
import { useCoachFace } from '../coach/coachFaceContext.ts';

/** Detour failure line — plain, and never silent (PLAN-CHANGES.md Phase 0). The gear one lives
 *  with its handlers in useDetourGear.ts (consumed by DetourDayCards). */
const DETOUR_FAIL = "That didn't take — try again in a moment.";

/**
 * The Today / Week surface — rendered inside MainTabs' .app shell (no header of its own). `view`
 * is controlled by the bottom nav (Today and Week are now sibling tabs, not a top segment):
 *   • Today → the Visual Today sky-trail (nodes, coach note, and the food strip → the Food home).
 *   • Week  → the rolling week list with per-day check-off.
 * Both share the coach proposal banner, the session sheets, and the AdjustSheet. Since Phase 2
 * (PLAN-CHANGES.md) typed and preformed steers go to the COACH as a visible send (`onSteerCoach`)
 * — she triages the size of the ask — while the explicit whole-week rebalance keeps the sheet's
 * direct preview → confirm run. Suggest-never-auto-apply as always.
 * `reloadKey` bumps when a log/meal/adjust lands so the dashboard's aux fetches refresh.
 */
export function PlanView({
  onCoach,
  onSteerCoach,
  onOpenFood,
  reloadSignal,
  onStartCheckIn,
  onPlanAhead,
}: {
  /** Switch to the coach. `note` is app-authored context she reads and the user never sees. */
  onCoach: (note?: string) => void;
  /**
   * Hand a plan steer to the coach as a VISIBLE send — the same autoSend bridge as
   * `onStartCheckIn`, but carrying the steer's words verbatim as the user's own message. This is
   * Phase 2 routing (PLAN-CHANGES.md): typed and preformed steers go to the coach, who triages
   * the size of the ask; only the explicit whole-week rebalance stays on the direct pipeline.
   */
  onSteerCoach: (steer: string) => void;
  /** Open the Food home (MainTabs swaps this view for it); 'shop' lands on the shopping list. */
  onOpenFood: (sub?: 'shop') => void;
  reloadSignal?: number;
  /**
   * The end-of-trail card's "Start check-in" (check-in rebuild, step 4). Deliberately its OWN
   * prop, not routed through `onCoach`: that bridge whispers a note to her, and the approved
   * design shows "Start my check-in" as something the user visibly said — MainTabs wires this one
   * to its `autoSend` bridge instead. `onCoach` keeps its other callers unchanged.
   */
  onStartCheckIn: () => void;
  /**
   * The horizon end-cap's "Can we plan two weeks ahead?" — the same visible-send bridge as
   * `onStartCheckIn`, its own prop for the same reason: the approved shape is words the user
   * said, and the coach grants (or talks through) the extension herself via `extend_horizon`.
   */
  onPlanAhead: () => void;
}) {
  /**
   * The plan comes from the shared query cache (PERF-01), not per-mount state. Tab switches
   * unmount this view, and the old `useState` + mount-fetch meant every return started from
   * nothing — the typing dots over a deterministic DB read, every single time (owner, 2026-08-20:
   * "I press a button, I immediately see a screen" — everywhere but here). Now a return paints
   * the cached week instantly; the query revalidates in the background once stale.
   */
  const queryClient = useQueryClient();
  const { data, error, refetch } = usePlan();
  // The wrist's copy of the week, kept current from the same cached plan this view paints.
  // A no-op everywhere but a native shell with our watch app actually installed.
  useWatchSync(data);
  // The other direction: sessions finished on the watch, delivered to the API. Also a no-op
  // everywhere but a native shell.
  useWatchLogInbox();
  // And the coach's chosen portrait, so the wrist shows the face they picked rather than the
  // bundled stand-in. Sent on change only — a portrait changes approximately never.
  const { faceId: coachFaceId } = useCoachFace();
  useWatchPortraitSync(coachFaceId);
  const [startOcc, setStartOcc] = useState<{ id: string; title: string } | null>(null); // redesign start sheet (stepped task)
  // The capture sheet, WITH what the trail already knew when it was tapped. Storing only the id
  // meant the sheet had to re-learn the row's own title from the server before it could draw its
  // header — a round trip to render words the phone was already holding (PERF-06).
  const [captureOcc, setCaptureOcc] = useState<{ id: string; title: string; time_of_day?: string } | null>(null);
  const [cookOcc, setCookOcc] = useState<string | null>(null); // cook walkthrough (menu-derived cook task)
  const [detourSheet, setDetourSheet] = useState(false); // the live detour's state sheet
  const [doorOpen, setDoorOpen] = useState(false); // the door's fork: temporary plan vs. a tweak
  const [detourEntry, setDetourEntry] = useState(false); // the detour setup (type, window, gear)
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSteer, setAdjustSteer] = useState(''); // pre-filled request (nutrition baseline → Adjust)
  const [adjustMode, setAdjustMode] = useState<'adjust' | 'rebalance'>('adjust');
  const [, setReloadKey] = useState(0); // bumps → aux refetch after a log/adjust (kept for callbacks)
  const [checkinSettled, setCheckinSettled] = useState(false); // answered/dismissed this mount

  // A change landed elsewhere (＋ FAB log, coach commit, manage wizard) and the parent bumped
  // reloadSignal → revalidate now. Plain mounts are the query's own affair: fresh cache paints
  // with no network, stale cache paints then revalidates. A failed refetch keeps the last good
  // week on screen — never a fabricated empty one (the 2026-08-19 rule, now enforced by the
  // cache: the queryFn throws on "could not load" instead of storing it).
  useEffect(() => {
    if (reloadSignal) void refetch();
  }, [reloadSignal, refetch]);

  const refresh = () => void refetch();
  const bump = () => setReloadKey((k) => k + 1);

  // The proposal banner's accept lifecycle + this screen's pending-replan recovery (mount AND
  // foreground resume) — the whole story lives in useProposalAccept.ts, including the Phase 0
  // background-run watch (accept answers 202 and the commit happens server-side).
  const { note, setNote, proposalBusy, working, acceptProp, dismissProp } = useProposalAccept({
    refetch,
    bump,
    clearProposal: () => setPlanData(queryClient, (d) => (d ? { ...d, pendingProposal: null } : d)),
    onRecoveredProposal: () => {
      setAdjustMode('rebalance');
      setAdjustOpen(true);
    },
    recoveryPaused: adjustOpen,
  });

  /**
   * Starting a detour, restored. This wiring left with the week panel when the 2a redesign deleted
   * it, which took the only door with it (A22); the design's answer is a self-declare line at the
   * end of the day plus the bar for what follows. The window and the gear travel with it — the
   * coach cannot draft a detour without both.
   *
   * A failure keeps the sheet OPEN with a line: the old `.catch(() => {})` closed it either way,
   * so a failed entry was indistinguishable from a started detour (PLAN-CHANGES.md Phase 0).
   */
  const [detourError, setDetourError] = useState<string | null>(null);
  async function enterDetour(choice: DetourChoice) {
    setDetourError(null);
    const r = await enterEpisode(choice.type, {
      days: choice.days,
      available_equipment: choice.available_equipment,
    }).catch(() => ({ ok: false }));
    if (!r.ok) {
      setDetourError(DETOUR_FAIL);
      return;
    }
    setDetourEntry(false);
    refresh();
    bump();
  }

  // Ending one gets a real busy flag (the sheet's 'One moment…' used to hang off gymBusy, which
  // this never set) and an honest failure line; the state sheet stays open until the end lands.
  const [detourEndBusy, setDetourEndBusy] = useState(false);
  const [detourEndError, setDetourEndError] = useState<string | null>(null);
  async function endDetour() {
    if (detourEndBusy) return;
    setDetourEndBusy(true);
    setDetourEndError(null);
    const r = await endEpisode().catch(() => ({ ok: false }));
    setDetourEndBusy(false);
    if (!r.ok) {
      setDetourEndError(DETOUR_FAIL);
      return;
    }
    setDetourSheet(false);
    refresh(); // base plan resumes; the banner clears
    bump();
  }

  async function checkInNow() {
    await checkin().catch(() => {});
    refresh(); // keeps the streak alive even with nothing completed
  }

  // A failed load with nothing cached says so and offers the retry. This branch used to not exist:
  // `!data` rendered the typing dots whether the fetch was in flight or had already given up, so a
  // dead load span forever — the skeleton-that-never-resolves this fix must not reintroduce.
  if (error && !data) {
    return (
      <div className="scrollbody">
        <div className="wiz-empty" style={{ marginTop: 24 }}>
          {"Couldn't reach your week just now — it's safe on the server."}
        </div>
        <button className="cta" style={{ margin: '16px 20px' }} onClick={() => void refetch()}>
          Try again
        </button>
      </div>
    );
  }

  // Structure first, numbers after (PERF-06). GET /plan is a Postgres read — never the coach
  // thinking — so it gets the trail's own bones, not the chat's typing dots.
  if (!data) return <PlanSkeleton />;

  if (!data.hasPlan) {
    return (
      <div className="scrollbody">
        <div className="wiz-empty" style={{ marginTop: 24 }}>
          No plan yet — talk to your coach to set your rhythm.
        </div>
      </div>
    );
  }

  const doneCount = data.week.reduce((n, d) => n + d.occurrences.filter((o) => o.status === 'done').length, 0);
  const xp = doneCount * 10; // stopgap XP until the REQ8 points finalize is wired to the plan response

  // Layer 1's own trigger (check-in rebuild, step 6): nothing left past today, counted the same
  // way the trail itself will actually render it (the retired check-in row doesn't count as
  // content). OR'd with the server's `checkin_due` in the render below — either can fire this on
  // its own, and this half needs nothing but the week already on screen to work.
  const restEmpty = data.week.slice(1).every((d) => d.occurrences.filter((o) => !isWeeklyCheckin(o)).length === 0);
  // One name for "the horizon has been reached" — the end-of-trail card and the mid-week end-cap
  // key off the same fact so exactly one of them can ever be on screen.
  const horizonReached = restEmpty || !!data.weekState?.checkin_due;

  // Trail node tap → routed by task shape: captures (weigh-in, meals) open the minimal CaptureSheet;
  // coach sessions open the StartSheet walkthrough.
  const openTask = (occ: PlanOccurrence) => {
    switch (taskOpener(occ)) {
      case 'task':
        return setStartOcc({ id: occ.occurrence_id, title: occ.title });
      case 'cook':
        return setCookOcc(occ.occurrence_id);
      case 'shop':
        return onOpenFood('shop');
      default: // weigh + meal
        return setCaptureOcc({ id: occ.occurrence_id, title: occ.title, time_of_day: occ.time_of_day });
    }
  };

  return (
    <>
      <TrailHeader streak={data.streak?.current ?? 0} xp={xp} />
      <div className="scrollbody">
        {data.pendingProposal && (
          <PlanProposalBanner
            proposal={data.pendingProposal}
            busy={proposalBusy}
            working={working}
            onAccept={acceptProp}
            onDismiss={dismissProp}
          />
        )}
        {/* The run line (Phase 3, PLAN-CHANGES.md): a background rebuild used to be invisible
            from this screen — only the Adjust sheet or the banner knew. `working` IS the Phase 0
            recovery watch already following the run (useProposalAccept: pending checked on mount
            and on foreground resume, polled until it resolves); this line just says so. It stops
            itself the way the watch does — proposal recovered (the sheet opens), failure (the
            note speaks), or the commit landing — and yields to the banner, which owns the louder
            copy while a proposal is up. */}
        {working && !data.pendingProposal && (
          <div className="plan-runline" role="status">
            Your week is being redrawn — I&rsquo;ll let you know when it&rsquo;s ready.
          </div>
        )}
        {/* One line of glass, never a card (2a): it announces, the sheet does the work. */}
        {data.activeEpisode && (
          <DetourBar
            episode={data.activeEpisode}
            dark={false}
            onOpen={() => {
              setDetourEndError(null); // a stale failure line must not greet the reopened sheet
              setDetourSheet(true);
            }}
          />
        )}
        {/* The detour DOOR, in the bar's own slot (owner ruling 2026-08-31, settled on device):
            door and live-state share one home at the top of the page, mutually exclusive by
            condition. The felt statement is the user's own words; the tap opens the FORK
            (DoorSheet) — "plan isn't working" can mean a time-bound temporary plan (detour) OR
            a regular tweak (Adjust), and the door must not assume which (owner, same day). */}
        {!data.activeEpisode && (
          <button className="detour-bar detour-door" onClick={() => setDoorOpen(true)}>
            <span className="detour-bar-dot" aria-hidden />
            <span className="detour-bar-line">&ldquo;My plan isn&rsquo;t working — I&rsquo;m too busy&rdquo;</span>
            <span className="detour-bar-chev" aria-hidden>
              ›
            </span>
          </button>
        )}
        {data.activeEpisode && (
          <DetourDayCards
            episode={data.activeEpisode}
            onCheckIn={checkInNow}
            onEnd={() => void endDetour()}
            endBusy={detourEndBusy}
            endError={detourEndError}
            onChanged={() => {
              refresh();
              bump();
            }}
          />
        )}
        {note && <PlanAdjustNote note={note} onDismiss={() => setNote('')} />}

        <TodayTrail plan={data} onOpen={openTask} onOpenFood={() => onOpenFood()} onCoach={onCoach} />

        <EndOfTrail
          show={horizonReached}
          version={data.version}
          endsOn={data.weekState?.ends_on}
          // "Start check-in" — the sentence, not a mode (DESIGN-check-in.md), but a VISIBLE one:
          // MainTabs' `onStartCheckIn` switches to the Coach tab and sends it through the same
          // path the composer's own Send uses, not a whispered note (check-in rebuild, step 4).
          onStartCheckIn={onStartCheckIn}
          onBuilt={() => {
            refresh();
            bump();
          }}
        />

        {/* Mid-week the horizon is a marker, not a card: the check-in is named where it will
            land, and seeing further is an ask to the coach. Quiet during a detour — the paused
            week's end is not the moment to plan two ahead. */}
        {!horizonReached && !data.activeEpisode && (
          <HorizonEndCap
            endsOn={data.weekState?.ends_on}
            canAskAhead={data.week.length <= 7}
            onPlanAhead={onPlanAhead}
          />
        )}
      </div>
      {startOcc && (
        <StartSheet
          occurrenceId={startOcc.id}
          title={startOcc.title}
          onClose={() => setStartOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
          // "Custom — let's talk" opens the SAME compose sheet as every other typed plan change,
          // pre-seeded with this activity ("About today's X: "). The finished sentence goes to
          // the coach, who triages the size of the ask (Phase 2).
          onCustom={(steer) => {
            setStartOcc(null);
            setAdjustSteer(steer);
            setAdjustMode('adjust');
            setAdjustOpen(true);
          }}
          onTalk={() => {
            const title = startOcc.title;
            setStartOcc(null);
            // Carry the session across. "Talk to me" used to switch tabs and pass NOTHING, so the
            // coach opened blank about the thing they had just done and were standing there
            // wanting to discuss (owner, 2026-08-15). She can read the log herself, but she has
            // to be told WHICH moment this is.
            onCoach(
              `They just finished "${title}" and tapped Talk to me from the end of it. Open on THAT: ` +
                'ask how it went in your own words. Their own report is on file — read it with ' +
                'get_recent_logs (and get_workout_history if a device recorded it) rather than ' +
                'asking them to repeat what they already logged.',
            );
          }}
        />
      )}
      {captureOcc && (
        <CaptureSheet
          occurrenceId={captureOcc.id}
          known={{ title: captureOcc.title, time_of_day: captureOcc.time_of_day }}
          onClose={() => setCaptureOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
          onOpenFood={() => {
            setCaptureOcc(null);
            onOpenFood();
          }}
        />
      )}
      {cookOcc && (
        <CookSheet
          occurrenceId={cookOcc}
          onClose={() => setCookOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
        />
      )}
      {/* Popup discipline (design note): at most ONE Cadence moment on screen, never stacked.
          Pre- and post-activity are user-initiated and mutually exclusive by construction; the
          check-in is the only one that arrives uninvited, so it is the one that yields — it
          mounts (and only then asks the server whether it's due) once nothing else is open. */}
      {!checkinSettled && !startOcc && !captureOcc && !cookOcc && !adjustOpen && !doorOpen && !detourEntry && (
        <DailyCheckIn
          // A pick's preformed steer is a small ask — exactly what the coach's triage exists for
          // (Phase 2). It goes to her as a visible send, in the pick's own user-voice words; she
          // makes the change or puts up a card. No sheet, no direct synthesis.
          onAdjust={(steer) => {
            setCheckinSettled(true);
            onSteerCoach(steer);
          }}
          onCoach={() => {
            setCheckinSettled(true);
            onCoach();
          }}
          onClose={() => setCheckinSettled(true)}
        />
      )}
      {doorOpen && (
        <DoorSheet
          onTempPlan={() => {
            setDoorOpen(false);
            setDetourError(null);
            setDetourEntry(true);
          }}
          // Phase-2-compliant as designed: the Adjust sheet's compose branch itself hands typed
          // words to the coach as a visible send now, so the fork's "regular tweak" door opens a
          // compose surface, never a direct pipeline.
          onAdjust={() => {
            setDoorOpen(false);
            setAdjustSteer('');
            setAdjustMode('adjust');
            setAdjustOpen(true);
          }}
          onClose={() => setDoorOpen(false)}
        />
      )}
      {detourEntry && (
        <DetourSetup error={detourError ?? undefined} onEnter={enterDetour} onCancel={() => setDetourEntry(false)} />
      )}
      {detourSheet && data.activeEpisode && (
        <DetourStateSheet
          episode={data.activeEpisode}
          busy={detourEndBusy}
          error={detourEndError ?? undefined}
          onCheckIn={() => {
            setDetourSheet(false);
            onCoach('<note>They opened their detour and tapped Check in. Ask how it is going where they are.</note>');
          }}
          // The sheet stays up while the end runs — 'One moment…' has somewhere to render, and a
          // failure keeps the sheet (with its line) instead of vanishing into apparent success.
          // endDetour closes it itself when the resume lands.
          onResume={() => void endDetour()}
          onClose={() => setDetourSheet(false)}
        />
      )}
      {adjustOpen && (
        <AdjustSheet
          initialSteer={adjustSteer}
          mode={adjustMode}
          onClose={() => setAdjustOpen(false)}
          // The compose branch's submit (adjust mode only): close the sheet and hand the words to
          // the coach as a visible send. Rebalance mode never calls this — its explicit
          // whole-week run stays on the direct pipeline (Phase 2 routing).
          onSteerToCoach={(steer) => {
            setAdjustOpen(false);
            onSteerCoach(steer);
          }}
          onCommitted={(n) => {
            setNote(n);
            refresh();
            bump();
          }}
        />
      )}
    </>
  );
}
