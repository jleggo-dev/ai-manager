import { useState } from 'react';
import { PlanView } from '../plan/PlanView.tsx';
import { OnboardingChat } from '../onboarding/OnboardingChat.tsx';
import { ProgressView } from '../progress/ProgressView.tsx';
import { FoodView } from '../food/FoodView.tsx';
import { SettingsSheet } from '../settings/SettingsSheet.tsx';
import { AdjustSheet } from '../plan/AdjustSheet.tsx';
import { ReviewScreen } from '../review/ReviewScreen.tsx';
import { LocationOffer } from './LocationOffer.tsx';

type Tab = 'today' | 'coach' | 'food' | 'progress';

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
const FoodIcon = () => (
  <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
    <path
      className="stroke"
      d="M5 3.5v6.5a2 2 0 0 0 2 2h0V16M12.5 3.5c0 2.5 1.5 3.5 1.5 6v6.5M12.5 3.5c0 2.2-1.2 3.2-1.2 5.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
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
 * sheets (session/adjust/settings) naturally cover the tab bar with their scrim. Stable chrome,
 * variable content: the tabs never change; what the Progress tab shows derives from the user's
 * own data. "Edit goals & equipment" pushes ReviewScreen in manage mode as a full sub-screen;
 * on exit we OFFER a plan refit (AdjustSheet) — never auto-replan.
 */
export function MainTabs({ email }: { email: string | null }) {
  const [tab, setTab] = useState<Tab>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [offerAdjust, setOfferAdjust] = useState(false);

  if (manage) {
    return (
      <ReviewScreen
        mode="manage"
        onBack={() => {
          setManage(false);
          setOfferAdjust(true); // changed or not, offer the refit; "Not now" is one tap
        }}
        onLocked={() => setManage(false)}
      />
    );
  }

  return (
    <>
      {/* The Coach tab is an immersive full-screen chat (its own floating settings gear), so it
          drops this header; Today/Food/Progress keep a slim header that now carries only the gear. */}
      {tab !== 'coach' && (
        <div className="app-head app-head-min">
          <button className="gear" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
            <GearIcon />
          </button>
        </div>
      )}
      <div className="app">
        {tab === 'today' && (
          <>
            <LocationOffer />
            <PlanView />
          </>
        )}
        {tab === 'coach' && <OnboardingChat intent="ongoing" chrome="none" onSettings={() => setSettingsOpen(true)} />}
        {tab === 'food' && <FoodView />}
        {tab === 'progress' && <ProgressView />}
        <nav className="tabbar" aria-label="Main">
          <button className={`tab${tab === 'today' ? ' tab-on' : ''}`} onClick={() => setTab('today')}>
            <TodayIcon />
            <span>Today</span>
          </button>
          <button className={`tab${tab === 'coach' ? ' tab-on' : ''}`} onClick={() => setTab('coach')}>
            <CoachIcon />
            <span>Coach</span>
          </button>
          <button className={`tab${tab === 'food' ? ' tab-on' : ''}`} onClick={() => setTab('food')}>
            <FoodIcon />
            <span>Food</span>
          </button>
          <button className={`tab${tab === 'progress' ? ' tab-on' : ''}`} onClick={() => setTab('progress')}>
            <ProgressIcon />
            <span>Progress</span>
          </button>
        </nav>
        {settingsOpen && (
          <SettingsSheet email={email} onClose={() => setSettingsOpen(false)} onManage={() => setManage(true)} />
        )}
        {offerAdjust && <AdjustSheet onClose={() => setOfferAdjust(false)} onCommitted={() => setOfferAdjust(false)} />}
      </div>
    </>
  );
}
