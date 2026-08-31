import { useEffect, useState } from 'react';
import { OccurrenceSheet } from './OccurrenceSheet.tsx';
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
import { downscalePhoto, isWeeklyCheckin } from './occurrence/format.ts';
import { EndOfTrail } from './EndOfTrailCard.tsx';
import {
  endEpisode,
  checkin,
  acceptProposal,
  dismissProposal,
  type PlanOccurrence,
  type ActiveEpisode,
  sendGymPhotos,
  sendDetourEquipment,
  enterEpisode,
  postponeDetour,
  getPendingReplan,
} from '../../lib/api.ts';
import { useQueryClient } from '@tanstack/react-query';
import { setPlanData, usePlan, useWatchLogInbox, useWatchPortraitSync, useWatchSync } from '../../lib/query/index.ts';
import { useCoachFace } from '../coach/coachFaceContext.ts';

/** Warm label for a detour type — the coach names the disruption plainly (BRAND.md). */
/** Local calendar day — the detour card's clock is the user's day, not UTC. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** One-tap answers for the arrival card; DetourSetup keeps its own copy for the entry sheet. */
const ARRIVAL_GEAR = ['Hotel gym', 'Dumbbells', 'Treadmill', 'Resistance band', 'Pool', 'Just my shoes'];

function detourLabel(type: ActiveEpisode['type']): string {
  return {
    travel: 'traveling',
    illness: 'under the weather',
    injury: 'working around an injury',
    recovery: 'recovering',
    custom: 'a full stretch',
  }[type];
}

/**
 * The Today / Week surface — rendered inside MainTabs' .app shell (no header of its own). `view`
 * is controlled by the bottom nav (Today and Week are now sibling tabs, not a top segment):
 *   • Today → the Visual Today sky-trail (nodes, coach note, and the food strip → the Food home).
 *   • Week  → the rolling week list with per-day check-off.
 * Both share the coach proposal banner, the session sheets, and "Adjust my plan" (a slim pill
 * that pops the AdjustSheet: steer → preview → confirm) — suggest-never-auto-apply as always.
 * `reloadKey` bumps when a log/meal/adjust lands so the dashboard's aux fetches refresh.
 */
export function PlanView({
  onCoach,
  onOpenFood,
  reloadSignal,
  onStartCheckIn,
}: {
  /** Switch to the coach. `note` is app-authored context she reads and the user never sees. */
  onCoach: (note?: string) => void;
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
  const [note, setNote] = useState('');
  const [proposalBusy, setProposalBusy] = useState(false);
  const [sheetOcc, setSheetOcc] = useState<string | null>(null); // open session sheet (occurrence id)
  const [startOcc, setStartOcc] = useState<{ id: string; title: string } | null>(null); // redesign start sheet (stepped task)
  // The capture sheet, WITH what the trail already knew when it was tapped. Storing only the id
  // meant the sheet had to re-learn the row's own title from the server before it could draw its
  // header — a round trip to render words the phone was already holding (PERF-06).
  const [captureOcc, setCaptureOcc] = useState<{ id: string; title: string; time_of_day?: string } | null>(null);
  const [cookOcc, setCookOcc] = useState<string | null>(null); // cook walkthrough (menu-derived cook task)
  const [detourSheet, setDetourSheet] = useState(false); // the live detour's state sheet
  const [detourEntry, setDetourEntry] = useState(false); // "Life happened?" — the self-declare door
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

  /**
   * A week the coach drew must find its way to the screen. `rebalance_week` (and any server-side
   * path) stores a pending proposal and pushes — but until this ran, the ONLY in-app surface was
   * a live Adjust flow the user had started themselves: a finished 16-activity rebalance sat
   * invisible in pending_plan while its owner asked where it was (2026-08-31). On mount, ask; if
   * one is waiting, open the review sheet on it. Suggest-never-auto-apply is untouched — the
   * sheet still ends in their Apply.
   */
  useEffect(() => {
    let alive = true;
    void getPendingReplan()
      .then(({ proposal }) => {
        if (!alive || !proposal) return;
        setAdjustMode('rebalance');
        setAdjustOpen(true);
      })
      .catch(() => {
        /* best-effort; the push and the coach can both still route them here */
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = () => void refetch();
  const bump = () => setReloadKey((k) => k + 1);

  async function acceptProp() {
    if (proposalBusy) return;
    setProposalBusy(true);
    setNote('');
    try {
      const r = await acceptProposal();
      setPlanData(queryClient, (d) => (d ? { ...d, pendingProposal: null } : d));
      if (r.status === 'committed') {
        setNote(r.note?.trim() || 'Updated your plan to fit how this stretch has been going.');
        await refetch();
        bump();
      } else if (r.status === 'entered_disrupted') {
        await refetch(); // the detour banner + paused overlay appear — that's the feedback
        bump();
      } else {
        setNote("I couldn't adjust it just now — give it another try in a bit.");
      }
    } catch {
      setNote('Something hiccuped on my end — try again in a moment.');
    } finally {
      setProposalBusy(false);
    }
  }

  function dismissProp() {
    setPlanData(queryClient, (d) => (d ? { ...d, pendingProposal: null } : d));
    dismissProposal().catch(() => {});
  }

  // The gym photos → equipment revision (PLAN §424). Several angles are ONE answer: files
  // accumulate here and send as one request; the banner shows what the model saw.
  const [gymBusy, setGymBusy] = useState(false);
  const [gymSaw, setGymSaw] = useState<string | null>(null);
  async function sendGym(files: FileList | null) {
    if (!files?.length || gymBusy) return;
    setGymBusy(true);
    setGymSaw(null);
    try {
      const photos = await Promise.all([...files].slice(0, 4).map((f) => downscalePhoto(f)));
      const r = await sendGymPhotos(photos);
      if (r.ok && r.saw) {
        setGymSaw(
          r.saw.length
            ? `I can see: ${r.saw.join(', ')}.${r.revised ? ' Reworking your week around it.' : ''}`
            : 'Looks like a bare room — keeping things equipment-free.',
        );
        if (r.revised) {
          refresh();
          bump();
        }
      } else {
        setGymSaw("Couldn't read that photo — try another angle?");
      }
    } catch {
      setGymSaw("Couldn't read that photo — try another angle?");
    } finally {
      setGymBusy(false);
    }
  }

  // Arrival-day answers (owner, 2026-08-04): the card asks once, on the scheduled start.
  const [arrivalGear, setArrivalGear] = useState<string[]>([]);
  async function confirmArrivalGear(explicitNone: boolean) {
    if (gymBusy) return;
    setGymBusy(true);
    try {
      const list = explicitNone ? [] : arrivalGear.map((name) => ({ name }));
      const r = await sendDetourEquipment(list);
      if (r.ok) {
        setGymSaw(
          explicitNone ? 'Equipment-free it is — reworking your days.' : 'Got it — reworking your days around that.',
        );
        refresh();
        bump();
      }
    } finally {
      setGymBusy(false);
    }
  }
  async function notArrivedYet() {
    await postponeDetour().catch(() => {});
    refresh(); // today's sessions come back; the card returns tomorrow
    bump();
  }

  /**
   * Starting a detour, restored. This wiring left with the week panel when the 2a redesign deleted
   * it, which took the only door with it (A22); the design's answer is a self-declare line at the
   * end of the day plus the bar for what follows. The window and the gear travel with it — the
   * coach cannot draft a detour without both.
   */
  async function enterDetour(choice: DetourChoice) {
    await enterEpisode(choice.type, {
      days: choice.days,
      available_equipment: choice.available_equipment,
    }).catch(() => {});
    setDetourEntry(false);
    refresh();
    bump();
  }

  async function endDetour() {
    await endEpisode().catch(() => {});
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

  // Trail node tap → routed by task shape: captures (weigh-in, meals) open the minimal CaptureSheet;
  // coach sessions open the StartSheet walkthrough. (The Week view keeps its own OccurrenceSheet.)
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
            onAccept={acceptProp}
            onDismiss={dismissProp}
          />
        )}
        {/* One line of glass, never a card (2a): it announces, the sheet does the work. */}
        {data.activeEpisode && (
          <DetourBar episode={data.activeEpisode} dark={false} onOpen={() => setDetourSheet(true)} />
        )}
        {data.activeEpisode && todayIso() >= data.activeEpisode.start && !data.activeEpisode.gearKnown && (
          <div className="detour">
            <div className="detour-t">
              <b>Detour day — {detourLabel(data.activeEpisode.type)}</b>
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
        )}
        {data.activeEpisode && todayIso() >= data.activeEpisode.start && data.activeEpisode.gearKnown && (
          <div className="detour">
            <div className="detour-t">
              <b>On a detour — {detourLabel(data.activeEpisode.type)}</b>
              <span>
                Your plan&apos;s on hold so a rough stretch never breaks your rhythm. Do what you can — checking in
                keeps your streak alive.
              </span>
            </div>
            <div className="detour-actions">
              <button className="adjust-pill" onClick={checkInNow}>
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
              <button className="detour-end" onClick={endDetour}>
                I&apos;m back
              </button>
            </div>
            {gymSaw && <div className="detour-saw">{gymSaw}</div>}
          </div>
        )}
        {note && <PlanAdjustNote note={note} onDismiss={() => setNote('')} />}

        <TodayTrail plan={data} onOpen={openTask} onOpenFood={() => onOpenFood()} onCoach={onCoach} />

        <EndOfTrail
          show={restEmpty || !!data.weekState?.checkin_due}
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

        {!data.activeEpisode && (
          <button className="detour-trigger" onClick={() => setDetourEntry(true)}>
            Life happened? Take a detour
          </button>
        )}
      </div>
      {sheetOcc && (
        <OccurrenceSheet
          occurrenceId={sheetOcc}
          onClose={() => setSheetOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
          onProposeChange={(steer) => {
            // Baseline → Adjust bridge: the suggested change rides the normal steer→preview→confirm flow.
            setSheetOcc(null);
            setAdjustSteer(steer);
            setAdjustMode('adjust');
            setAdjustOpen(true);
          }}
        />
      )}
      {startOcc && (
        <StartSheet
          occurrenceId={startOcc.id}
          title={startOcc.title}
          onClose={() => setStartOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
          // "Custom — let's talk" rides the SAME steer→preview→confirm flow as every other plan
          // change, pre-seeded with this activity. A session Cadence redesigned in conversation
          // still has to be shown before it lands.
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
      {!checkinSettled && !sheetOcc && !startOcc && !captureOcc && !cookOcc && !adjustOpen && (
        <DailyCheckIn
          onAdjust={(steer) => {
            setCheckinSettled(true);
            setAdjustSteer(steer);
            setAdjustMode('adjust');
            setAdjustOpen(true);
          }}
          onCoach={() => {
            setCheckinSettled(true);
            onCoach();
          }}
          onClose={() => setCheckinSettled(true)}
        />
      )}
      {detourEntry && <DetourSetup onEnter={enterDetour} onCancel={() => setDetourEntry(false)} />}
      {detourSheet && data.activeEpisode && (
        <DetourStateSheet
          episode={data.activeEpisode}
          busy={gymBusy}
          onCheckIn={() => {
            setDetourSheet(false);
            onCoach('<note>They opened their detour and tapped Check in. Ask how it is going where they are.</note>');
          }}
          onResume={() => {
            setDetourSheet(false);
            void endDetour();
          }}
          onClose={() => setDetourSheet(false)}
        />
      )}
      {adjustOpen && (
        <AdjustSheet
          initialSteer={adjustSteer}
          mode={adjustMode}
          onClose={() => setAdjustOpen(false)}
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
