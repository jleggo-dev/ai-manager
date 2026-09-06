import { useState } from 'react';
import { PlanView } from '../plan/PlanView.tsx';
import { OnboardingChat } from '../onboarding/OnboardingChat.tsx';
import { ProgressView } from '../progress/ProgressView.tsx';
import { SettingsRoom } from '../settings/SettingsRoom.tsx';
import { AdjustSheet } from '../plan/AdjustSheet.tsx';
import { QuickAddSheet } from '../plan/quick-add/QuickAddSheet.tsx';
import { PlanCardSheet } from '../gate/PlanCardSheet.tsx';
import { CoachFace } from '../../components/CoachFace.tsx';
import { FoodHome } from '../nutrition/FoodHome.tsx';
import { WeekReviewSheet } from '../plan/week-review/WeekReviewSheet.tsx';
import { WeekChangesSheet } from '../plan/week-changes/WeekChangesSheet.tsx';
import { ActivityBuilder } from '../builder/ActivityBuilder.tsx';
import type { BuilderSeed } from '../plan/quick-add/builderSeed.ts';
import { readDraft, type BuilderDraft } from '../builder/draftStore.ts';
import { DraftPill } from '../builder/DraftPill.tsx';

/**
 * Today and Week were separate TABS sharing one PlanView, and the owner's device verdict
 * (2026-08-14) was that Week earned no tab: "it doesn't have more information than the today
 * tab." One PLAN tab now; the day/week toggle lives inside PlanView where it always really was.
 */
type Tab = 'plan' | 'coach' | 'progress';

const TodayIcon = () => (
  <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
    <rect className="stroke" x="2.5" y="3.5" width="14" height="12.5" rx="3" />
    <path className="stroke" d="M2.5 7.5h14M6 1.8v3.4M13 1.8v3.4" strokeLinecap="round" />
  </svg>
);
const CoachIcon = () => (
  <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
    <path
      className="stroke"
      d="M16.5 9a7 7 0 1 0-2.9 5.67L16.5 16l-.62-3.16A6.97 6.97 0 0 0 16.5 9z"
      strokeLinejoin="round"
    />
  </svg>
);
const ProgressIcon = () => (
  <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
    <path className="stroke" d="M2.5 16.5V13M7.2 16.5V8.5M11.9 16.5V11M16.5 16.5V4.5" strokeLinecap="round" />
  </svg>
);
const GearIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden>
    <circle className="stroke" cx="8.5" cy="8.5" r="2.6" />
    <path
      className="stroke"
      d="M8.5 1.6v2M8.5 13.4v2M1.6 8.5h2M13.4 8.5h2M3.6 3.6l1.4 1.4M12 12l1.4 1.4M13.4 3.6L12 5M5 12l-1.4 1.4"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The signed-in shell once a plan is committed: header (wordmark + Settings gear), the active
 * tab's content, and the bottom tab bar — all INSIDE `.app`, so the absolutely-positioned
 * sheets (session/adjust/settings) naturally cover the tab bar with their scrim. The redesign's
 * nav is Plan / Coach / Progress / Settings (Settings opens the full-screen room, not a sheet) — food has no tab of its own; today's
 * nutrition lives on the trail's food strip → the "Today's food" sheet, and the deeper menus /
 * recipes / shop moved into that sheet and the coach. Today and Week share one PlanView instance
 * (kept mounted across the toggle) so switching between them never refetches the plan.
 */
export function MainTabs({
  email,
  discussPlan = false,
}: {
  email: string | null;
  /**
   * The first plan was just built (or they just signed in at the gate that presented it). Owner
   * ruling 2026-08-12, replacing the land-on-Coach approach that shipped for a day: land on
   * TODAY — the plan itself is the proof that something happened ("landing on the actual plan
   * was more effective") — with a guided overlay pointing at the Coach tab ("head over and we'll
   * fine-tune it"). Only the Coach tab is tappable, which doubles as the app's one navigation
   * lesson; tapping it dismisses the guide and fires the walkthrough.
   */
  discussPlan?: false | 'card' | 'fresh';
}) {
  const [tab, setTab] = useState<Tab>('plan');
  /** The guided hand-off from the built plan to the discussion. Dies on the tap, never returns. */
  const [guide, setGuide] = useState<boolean>(!!discussPlan);
  /** The plan card as a sheet over the chat — the "toggle back to the conversation" surface. */
  const [planCardOpen, setPlanCardOpen] = useState(false);
  /**
   * The Settings Room (SR-3) — a full screen, same idiom as `food` below: it replaces whichever
   * tab's content is showing while the tab bar stays put, and closing it returns to that tab.
   * Replaced the SettingsSheet mount (now unreachable UI, kept mounted-out but intact — the lead
   * deletes it at integration).
   */
  const [settingsRoomOpen, setSettingsRoomOpen] = useState(false);
  /**
   * The coach's build card, tapped in the Coach tab. Same sheet as "review my whole plan", because
   * that is exactly what a rebuild is here — the only difference is that whatever she captured in
   * the conversation that led to the tap gets adopted first (`adoptCaptured`).
   *
   * A plan already exists by the time MainTabs renders, so building from the Coach tab always
   * means rebuilding; onboarding's first build is the other host of the same card (App.tsx).
   */
  const [rebuild, setRebuild] = useState(false);
  /** The WeekReviewCard's Open tap — mounts the real full-screen review (check-in rebuild, step 4). */
  const [weekReviewOpen, setWeekReviewOpen] = useState(false);
  /** ChangeCard's "Show me" tap — mounts the Changes sheet for a check-in-offered swap (check-in
   *  rebuild, step 7 client half). Same idiom as weekReviewOpen just above. */
  const [weekChangesOpen, setWeekChangesOpen] = useState(false);
  /**
   * "Open ›" on the coach's seed receipt (design frame 1e). The list lives on the Progress tab and
   * there is exactly one of it, so this switches tabs and asks ProgressView to open its own
   * drill-down — the same one the Progress repertoire card opens — rather than mounting a second
   * copy over the chat. ProgressView clears it once consumed.
   */
  const [openRepertoire, setOpenRepertoire] = useState(false);
  const [logDidOpen, setLogDidOpen] = useState(false);
  const [planReload, setPlanReload] = useState(0); // bump → PlanView refetches after a ＋ log
  /** App-authored context for the next coach turn (e.g. the session they just finished). */
  const [coachNote, setCoachNote] = useState<string | null>(null);
  /**
   * "Start check-in" (EndOfTrailCard, via PlanView's `onStartCheckIn`) — unlike `coachNote`
   * above, this is not whispered to her as a note: it is sent VISIBLY, the same way a typed
   * message would be (check-in rebuild, step 4 — the approved design shows "Start my check-in"
   * as something the user said). `key` is bumped on every tap so a SECOND end-of-trail later in
   * the same session fires again; OnboardingChat's own effect is what actually consumes it once.
   */
  const [autoSend, setAutoSend] = useState<{ text: string; key: number } | null>(null);
  /**
   * The Food home (Food Journey 02) — a full screen that replaces the Plan tab's content while
   * the tab bar stays. It lives HERE rather
   * than inside PlanView so the ＋ FAB knows to stand down and the coach hand-off is one hop.
   * 'shop' opens straight onto the Kitchen tab's shopping list (a shop trail task lands there);
   * 'log' opens straight into the Log screen (the quick-add sheet's meal row).
   */
  const [food, setFood] = useState<null | 'home' | 'shop' | 'log'>(null);
  /**
   * The Activity Builder (Activity Builder wave 3) — a full screen that replaces the Plan tab's
   * content while the tab bar stays, the exact same escape `food` above uses. `seed` is undefined
   * for a bare "＋ New activity" / "Blank" open, set for a "Build my own" pick from the ＋ sheet's
   * Start-from screen (QuickAddTense → QuickAddSheet → here). `open: false` means "not building";
   * the seed only matters while it's true, so there is nothing to reset when it closes.
   */
  const [building, setBuilding] = useState<{
    open: boolean;
    minimized: boolean;
    seed?: BuilderSeed;
    restore?: BuilderDraft;
    /**
     * Bumped only when a genuinely NEW build starts, and used as the builder's `key`.
     *
     * Minimizing keeps the component mounted, so without this a ＋ → "Build my own" tapped while
     * a draft is parked would reuse that instance: React keeps the old state and the new seed is
     * ignored, handing someone the draft they minimized under the name of the thing they just
     * picked. Restoring from the pill deliberately does NOT bump it — a remount there would throw
     * away the scroll position and open palette that staying mounted exists to keep.
     */
    buildKey: number;
  }>(() => {
    // A draft left on this device opens the builder MINIMIZED — the pill is the offer, not the
    // screen. Somebody who force-quit mid-build gets their work back without being dropped into
    // it, which would be its own kind of hijack on launch.
    const draft = readDraft();
    return draft
      ? { open: true, minimized: true, restore: draft, buildKey: 0 }
      : { open: false, minimized: false, buildKey: 0 };
  });
  /** Mounted AND on the glass. Minimized, it is mounted and hidden — see the render below. */
  const builderShowing = building.open && !building.minimized;

  /**
   * Land on a nav destination, leaving whatever full screen was covering it.
   *
   * Both full screens — the Settings Room and the Activity Builder — REPLACE the tab content
   * (they gate every branch above), but the tab buttons only ever set `tab`. So tapping Plan,
   * Coach or Progress while one was up changed the hidden tab underneath and left the screen on
   * the glass: the nav bar did nothing, four times in a row, with no way to tell it apart from a
   * frozen app (owner, 2026-09-05: "I click the other nav buttons and it stays on settings").
   * Settings was the reported half; the builder had the identical trap, gear included.
   */
  const landOn = (next: Tab | 'settings') => {
    setSettingsRoomOpen(next === 'settings');
    if (next !== 'settings') setTab(next);
  };

  const minimizeBuilder = () => setBuilding((b) => ({ ...b, minimized: true }));
  const closeBuilder = () => setBuilding({ open: false, minimized: false, buildKey: 0 });

  /**
   * Every tab tap, the gear included.
   *
   * A tap while the builder is up MINIMIZES it and asks nothing — because nothing is lost. The
   * draft is held on disk from the first keystroke (draftStore.ts) and the pill brings it back,
   * so the question a dialog would have posed has no stakes left in it (owner ruling 2026-09-06,
   * choosing this over a four-way "leave your draft?" sheet: fewest taps, no dialog in the way).
   * Save and Discard are deliberate acts with their own buttons in the builder's header.
   */
  const goTab = (next: Tab | 'settings') => {
    if (builderShowing) minimizeBuilder();
    landOn(next);
  };
  /**
   * What the bar should light up. The room is a DESTINATION, not a layer over the tab behind it
   * — leaving Plan lit while Settings fills the screen is the same lie the dead taps told.
   */
  const current: Tab | 'settings' = settingsRoomOpen ? 'settings' : tab;

  return (
    <>
      <div className="app">
        {tab === 'plan' && !food && !settingsRoomOpen && !builderShowing && (
          <PlanView
            onCoach={(note) => {
              if (note) setCoachNote(note);
              setTab('coach');
            }}
            onOpenFood={(sub) => setFood(sub ?? 'home')}
            reloadSignal={planReload}
            // "Start check-in" — a visible send, not a note: see the `autoSend` state comment
            // above for why this is its own bridge rather than riding `onCoach`.
            onStartCheckIn={() => {
              setTab('coach');
              setAutoSend({ text: 'Start my check-in', key: Date.now() });
            }}
            // Typed and preformed plan steers (the Adjust sheet's compose box, the daily
            // check-in's picks) ride the same visible bridge, VERBATIM — the words shown as the
            // user's are exactly the user's. The coach triages the size of the ask (Phase 2,
            // PLAN-CHANGES.md); only her explicit build card below (`rebuild`) still opens the
            // direct-pipeline sheet.
            onSteerCoach={(steer) => {
              setTab('coach');
              setAutoSend({ text: steer, key: Date.now() });
            }}
            // The horizon end-cap's ask rides the same visible bridge — she grants (or talks
            // through) the longer week herself via extend_horizon; the app only asks.
            onPlanAhead={() => {
              setTab('coach');
              setAutoSend({ text: 'Can we plan two weeks ahead?', key: Date.now() });
            }}
          />
        )}
        {tab === 'plan' && food && !settingsRoomOpen && !builderShowing && (
          <FoodHome
            initialKitchen={food === 'shop' ? 'shop' : null}
            initialLogMeal={food === 'log'}
            onBack={() => setFood(null)}
            onCoach={(note) => {
              setCoachNote(note);
              setFood(null);
              setTab('coach');
            }}
            onLogged={() => setPlanReload((k) => k + 1)}
          />
        )}
        {settingsRoomOpen && !builderShowing && (
          <SettingsRoom
            email={email}
            onBack={() => setSettingsRoomOpen(false)}
            onCoach={(note) => {
              setCoachNote(note);
              setSettingsRoomOpen(false);
              setTab('coach');
            }}
          />
        )}
        {/**
         * The Activity Builder (Activity Builder wave 3) — reached from the ＋ sheet's "Build my
         * own" (QuickAddTense's Start-from screen, via QuickAddSheet's `onBuild`) or, later, a
         * Settings "＋ New activity" row. Same full-screen escape `FoodHome`/`SettingsRoom` use:
         * it replaces whichever tab's content was showing, the tab bar stays. `onClose` and
         * `onSaved` both return to the plan tab — Save is the only door that ALSO counts as
         * "something happened" (a fresh routine on the plan/library), so only it bumps the reload.
         */}
        {/**
         * Hidden with CSS rather than unmounted, the same trick the coach tab uses two blocks
         * down and for the same reason: minimize has to be free. Disk holds the draft across a
         * force-quit, but only staying mounted keeps the things disk cannot — the scroll
         * position, an open palette, the caret in the name field — so coming back is the screen
         * you left rather than a faithful reconstruction of it.
         *
         * `contents` when showing, not `block`: `.app` is a flex column and a plain wrapper
         * becomes a flex child with no sizing of its own (see the coach's note below).
         */}
        {building.open && (
          <div style={{ display: builderShowing ? 'contents' : 'none' }}>
            <ActivityBuilder
              key={building.buildKey}
              initial={building.seed}
              restore={building.restore}
              onMinimize={minimizeBuilder}
              onClose={() => {
                closeBuilder();
                landOn('plan');
              }}
              onSaved={() => {
                closeBuilder();
                landOn('plan');
                setPlanReload((k) => k + 1);
              }}
              // "Ask the coach" — the same VISIBLE send every other steer uses. From the save
              // moment her context pack already carries the routine's steps; from a draft the
              // builder composes them into the message itself and minimizes rather than closing,
              // so there is still a draft to apply her answer to.
              onAskReview={(text) => {
                landOn('coach');
                setAutoSend({ text, key: Date.now() });
              }}
            />
          </div>
        )}
        {/**
         * The coach stays MOUNTED and is hidden with CSS when another tab is showing. It is the one
         * tab holding work that outlives a glance: an in-flight reply, the poll behind a dropped
         * fetch, the resume listener, and the transcript itself.
         *
         * Unmounting it threw all of that away. Owner, 2026-08-16: *"I can switch applications, the
         * replies keep coming, but if I switch tabs in Cadence all is lost."* Exactly so — every
         * piece of leave-safety built this week protects against iOS suspending the app, and none
         * of it survived React removing the component. Tapping "Plan" was more destructive than
         * closing the phone.
         *
         * `display: none` keeps the fetch alive, keeps the listeners subscribed, and keeps the
         * scroll position, so coming back is instant rather than a re-restore. Plan and Progress
         * stay conditional — they hold no in-flight work — and since PERF-01 a remount paints the
         * cached week/dashboard instantly and revalidates in the background, so the switch itself
         * costs nothing either way.
         */}
        {/* `contents` when showing, not `block`: `.app` is a flex column and a plain wrapper becomes
            a flex child with no sizing of its own, which collapsed the whole chat — composer gone,
            tab bar pushed off, the app apparently frozen (owner, 2026-08-16). `display: contents`
            removes the wrapper from layout entirely, so the chat stays a direct flex child exactly
            as it was before it was wrapped. */}
        <div style={{ display: tab === 'coach' && !settingsRoomOpen && !builderShowing ? 'contents' : 'none' }}>
          <>
            <OnboardingChat
              intent="ongoing"
              chrome="none"
              onBuild={() => setRebuild(true)}
              openWalkthrough={discussPlan}
              sessionNote={coachNote}
              onSessionNoteUsed={() => setCoachNote(null)}
              onPlanChanged={() => setPlanReload((k) => k + 1)}
              onOpenWeekReview={() => setWeekReviewOpen(true)}
              onShowChanges={() => setWeekChangesOpen(true)}
              onShowPlan={() => setPlanCardOpen(true)}
              onOpenRepertoire={() => {
                setOpenRepertoire(true);
                setTab('progress');
              }}
              autoSend={autoSend}
            />
            {/* The deterministic way back to the crafted plan UI from inside the conversation. */}
            <button className="plan-pill" onClick={() => setPlanCardOpen(true)}>
              Your week ↗
            </button>
          </>
        </div>
        {tab === 'progress' && !settingsRoomOpen && !builderShowing && (
          <ProgressView
            onCoach={(note) => {
              setCoachNote(note);
              setTab('coach');
            }}
            openRepertoire={openRepertoire}
            onRepertoireOpened={() => setOpenRepertoire(false)}
          />
        )}
        {tab !== 'coach' && !food && !settingsRoomOpen && !builderShowing && (
          <button className="fab" onClick={() => setLogDidOpen(true)} aria-label="Quick add">
            ＋
          </button>
        )}
        {/**
         * The way back from a minimized draft — the other half of the owner's third door
         * (2026-09-06). Shown on EVERY surface the builder isn't on, the Settings Room included:
         * a draft you cannot get back to from where you happen to be standing is the same trap,
         * one screen along. Bottom-left, so it never fights the ＋ FAB or the coach tab's own
         * top-right "Your week ↗".
         */}
        {building.open && building.minimized && (
          <DraftPill onClick={() => setBuilding((b) => ({ ...b, minimized: false }))} />
        )}
        <nav className="tabbar" aria-label="Main">
          <button
            className={`tab${current === 'plan' ? ' tab-on' : ''}`}
            onClick={() => {
              // Tapping Plan while on Food is the way back to the trail — but only while Food is
              // the thing being LOOKED at. With the room covering it, this tap is the way out of
              // the room, and it lands you back on the screen you left rather than skipping past it.
              if (current === 'plan' && !builderShowing) setFood(null);
              goTab('plan');
            }}
          >
            <TodayIcon />
            <span>Plan</span>
          </button>
          <button
            className={`tab${current === 'coach' ? ' tab-on' : ''}${guide ? ' tab-guided' : ''}`}
            onClick={() => {
              setGuide(false);
              goTab('coach');
            }}
          >
            <CoachIcon />
            <span>Coach</span>
          </button>
          <button className={`tab${current === 'progress' ? ' tab-on' : ''}`} onClick={() => goTab('progress')}>
            <ProgressIcon />
            <span>Progress</span>
          </button>
          <button
            className={`tab${current === 'settings' ? ' tab-on' : ''}`}
            onClick={() => goTab('settings')}
            aria-label="Settings"
          >
            <GearIcon />
            <span>Settings</span>
          </button>
        </nav>
        {/* The guided hand-off: scrim over everything, her line pointing at the one tappable
            thing. The Coach tab rides ABOVE the scrim (`.tab-guided`), so the scrim itself is
            what makes every other control inert — no per-button disabling to keep honest. */}
        {guide && (
          <>
            <div className="guide-scrim" aria-hidden />
            <div className="guide-callout" role="status">
              <CoachFace size={26} ring={false} />
              <span>
                I built your plan — this is your week. Now head to the <b>Coach</b> tab and we&rsquo;ll fine-tune it
                together.
              </span>
              <i className="guide-arrow" aria-hidden>
                ▼
              </i>
            </div>
          </>
        )}
        {planCardOpen && <PlanCardSheet onClose={() => setPlanCardOpen(false)} />}
        {rebuild && (
          <AdjustSheet
            mode="rebalance"
            adoptCaptured
            onClose={() => setRebuild(false)}
            onCommitted={() => {
              setRebuild(false);
              // Stay IN the conversation and show the crafted card over it — the rebuild was
              // agreed in the chat, so the chat is where its result appears, with the toggle
              // back one tap away. Today/Week still refetch underneath for when they leave.
              setPlanCardOpen(true);
              setPlanReload((k) => k + 1);
            }}
          />
        )}
        {weekReviewOpen && (
          <WeekReviewSheet
            onClose={() => setWeekReviewOpen(false)}
            // "Confirm my week" hands the coach the finished receipt VISIBLY — the same autoSend
            // bridge "Start my check-in" already uses (see the state comment above): a real user
            // bubble and a real coach turn, not a whispered note.
            onConfirmed={(receiptText) => {
              setTab('coach');
              setAutoSend({ text: receiptText, key: Date.now() });
            }}
          />
        )}
        {weekChangesOpen && (
          <WeekChangesSheet onClose={() => setWeekChangesOpen(false)} onApplied={() => setPlanReload((k) => k + 1)} />
        )}
        {logDidOpen && (
          <QuickAddSheet
            onClose={() => setLogDidOpen(false)}
            onLogged={() => {
              setTab('plan'); // land back on the plan so the just-logged node shows done
              setPlanReload((k) => k + 1);
            }}
            // The meal row's door — straight into the food module's Log screen (05b).
            onOpenFood={() => {
              setLogDidOpen(false);
              setTab('plan');
              setFood('log');
            }}
            // Screen 2's "Tell me instead" (Activity Builder 2A) — the same visible bridge
            // PlanView's `onSteerCoach` rides: a real user bubble, not a whispered note.
            onSteer={(steer) => {
              setTab('coach');
              setAutoSend({ text: steer, key: Date.now() });
            }}
            // "Build my own", from screen 2's Start-from shelves (Activity Builder wave 3) — the
            // sheet already closed itself before calling this (QuickAddSheet.tsx), so all that's
            // left is opening the builder on the plan tab.
            onBuild={(seed) => {
              setTab('plan');
              setBuilding({ open: true, minimized: false, seed, buildKey: Date.now() });
            }}
          />
        )}
      </div>
    </>
  );
}
