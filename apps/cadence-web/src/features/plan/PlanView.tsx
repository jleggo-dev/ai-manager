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
import { DetourBar } from './DetourBar.tsx';
import { DetourStateSheet } from './DetourStateSheet.tsx';
import { DetourSetup, type DetourChoice } from './DetourSetup.tsx';
import { downscalePhoto } from './occurrence/format.ts';
import {
  getPlan,
  endEpisode,
  checkin,
  acceptProposal,
  dismissProposal,
  type PlanViewData,
  type PlanOccurrence,
  type ActiveEpisode,
  sendGymPhotos,
  sendDetourEquipment,
  enterEpisode,
  postponeDetour,
} from '../../lib/api.ts';

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
}: {
  /** Switch to the coach. `note` is app-authored context she reads and the user never sees. */
  onCoach: (note?: string) => void;
  /** Open the Food home (MainTabs swaps this view for it); 'shop' lands on the shopping list. */
  onOpenFood: (sub?: 'shop') => void;
  reloadSignal?: number;
}) {
  const [data, setData] = useState<PlanViewData | null>(null);
  const [note, setNote] = useState('');
  const [proposalBusy, setProposalBusy] = useState(false);
  const [sheetOcc, setSheetOcc] = useState<string | null>(null); // open session sheet (occurrence id)
  const [startOcc, setStartOcc] = useState<{ id: string; title: string } | null>(null); // redesign start sheet (stepped task)
  const [captureOcc, setCaptureOcc] = useState<string | null>(null); // capture sheet (weigh-in / meal)
  const [cookOcc, setCookOcc] = useState<string | null>(null); // cook walkthrough (menu-derived cook task)
  const [detourSheet, setDetourSheet] = useState(false); // the live detour's state sheet
  const [detourEntry, setDetourEntry] = useState(false); // "Life happened?" — the self-declare door
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSteer, setAdjustSteer] = useState(''); // pre-filled request (nutrition baseline → Adjust)
  const [adjustMode, setAdjustMode] = useState<'adjust' | 'rebalance'>('adjust');
  const [, setReloadKey] = useState(0); // bumps → aux refetch after a log/adjust (kept for callbacks)
  const [checkinSettled, setCheckinSettled] = useState(false); // answered/dismissed this mount

  // Refetch on mount AND whenever the parent bumps reloadSignal (a ＋ FAB log just landed).
  useEffect(() => {
    // `null` = could not load. Keep whatever is showing rather than replacing a real week with a
    // fabricated empty one — the old fallback here was the same "failure dressed as new user"
    // shape that restarted onboarding at the App level (2026-08-19).
    getPlan()
      .then((p) => p && setData(p))
      .catch(() => {});
  }, [reloadSignal]);

  const refresh = () =>
    getPlan()
      .then((p) => p && setData(p))
      .catch(() => {});
  const bump = () => setReloadKey((k) => k + 1);

  async function acceptProp() {
    if (proposalBusy) return;
    setProposalBusy(true);
    setNote('');
    try {
      const r = await acceptProposal();
      setData((d) => (d ? { ...d, pendingProposal: null } : d));
      if (r.status === 'committed') {
        setNote(r.note?.trim() || 'Updated your plan to fit how this stretch has been going.');
        setData(await getPlan());
        bump();
      } else if (r.status === 'entered_disrupted') {
        setData(await getPlan()); // the detour banner + paused overlay appear — that's the feedback
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
    setData((d) => (d ? { ...d, pendingProposal: null } : d));
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

  if (!data) {
    return (
      <div className="scrollbody">
        <div className="chat-loading">
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    );
  }

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
        return setCaptureOcc(occ.occurrence_id);
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
          occurrenceId={captureOcc}
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
