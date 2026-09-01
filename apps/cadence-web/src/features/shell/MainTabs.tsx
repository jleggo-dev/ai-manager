import { useState } from 'react';
import { PlanView } from '../plan/PlanView.tsx';
import { OnboardingChat } from '../onboarding/OnboardingChat.tsx';
import { ProgressView } from '../progress/ProgressView.tsx';
import { SettingsRoom } from '../settings/SettingsRoom.tsx';
import { AdjustSheet } from '../plan/AdjustSheet.tsx';
import { LogDidSheet } from '../plan/LogDidSheet.tsx';
import { PlanCardSheet } from '../gate/PlanCardSheet.tsx';
import { CoachFace } from '../../components/CoachFace.tsx';
import { FoodHome } from '../nutrition/FoodHome.tsx';
import { WeekReviewSheet } from '../plan/week-review/WeekReviewSheet.tsx';
import { WeekChangesSheet } from '../plan/week-changes/WeekChangesSheet.tsx';

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
   * the tab bar stays, the same escape ReviewScreen uses minus the bar. It lives HERE rather
   * than inside PlanView so the ＋ FAB knows to stand down and the coach hand-off is one hop.
   * 'shop' opens straight to the shopping list (a shop trail task is a door to that sub-view).
   */
  const [food, setFood] = useState<null | 'home' | 'shop'>(null);

  return (
    <>
      <div className="app">
        {tab === 'plan' && !food && !settingsRoomOpen && (
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
        {tab === 'plan' && food && !settingsRoomOpen && (
          <FoodHome
            initialSub={food === 'shop' ? 'shop' : null}
            onBack={() => setFood(null)}
            onCoach={(note) => {
              setCoachNote(note);
              setFood(null);
              setTab('coach');
            }}
            onLogged={() => setPlanReload((k) => k + 1)}
          />
        )}
        {settingsRoomOpen && (
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
        <div style={{ display: tab === 'coach' && !settingsRoomOpen ? 'contents' : 'none' }}>
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
              autoSend={autoSend}
            />
            {/* The deterministic way back to the crafted plan UI from inside the conversation. */}
            <button className="plan-pill" onClick={() => setPlanCardOpen(true)}>
              Your week ↗
            </button>
          </>
        </div>
        {tab === 'progress' && !settingsRoomOpen && (
          <ProgressView
            onCoach={(note) => {
              setCoachNote(note);
              setTab('coach');
            }}
          />
        )}
        {tab !== 'coach' && !food && !settingsRoomOpen && (
          <button className="fab" onClick={() => setLogDidOpen(true)} aria-label="Log something you did">
            ＋
          </button>
        )}
        <nav className="tabbar" aria-label="Main">
          <button
            className={`tab${tab === 'plan' ? ' tab-on' : ''}`}
            onClick={() => {
              if (tab === 'plan') setFood(null); // tapping Plan while on Food is the way back to the trail
              setTab('plan');
            }}
          >
            <TodayIcon />
            <span>Plan</span>
          </button>
          <button
            className={`tab${tab === 'coach' ? ' tab-on' : ''}${guide ? ' tab-guided' : ''}`}
            onClick={() => {
              setGuide(false);
              setTab('coach');
            }}
          >
            <CoachIcon />
            <span>Coach</span>
          </button>
          <button className={`tab${tab === 'progress' ? ' tab-on' : ''}`} onClick={() => setTab('progress')}>
            <ProgressIcon />
            <span>Progress</span>
          </button>
          <button className="tab" onClick={() => setSettingsRoomOpen(true)} aria-label="Settings">
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
          <LogDidSheet
            onClose={() => setLogDidOpen(false)}
            onLogged={() => {
              setTab('plan'); // land back on the plan so the just-logged node shows done
              setPlanReload((k) => k + 1);
            }}
          />
        )}
      </div>
    </>
  );
}
