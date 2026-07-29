import { useState } from 'react';
import { PlanView } from '../plan/PlanView.tsx';
import { OnboardingChat } from '../onboarding/OnboardingChat.tsx';
import { ProgressView } from '../progress/ProgressView.tsx';
import { SettingsSheet } from '../settings/SettingsSheet.tsx';
import { AdjustSheet } from '../plan/AdjustSheet.tsx';
import { LogDidSheet } from '../plan/LogDidSheet.tsx';
import { ReviewScreen } from '../review/ReviewScreen.tsx';

type Tab = 'today' | 'week' | 'coach' | 'progress';

const TodayIcon = () => (
  <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
    <rect className="stroke" x="2.5" y="3.5" width="14" height="12.5" rx="3" />
    <path className="stroke" d="M2.5 7.5h14M6 1.8v3.4M13 1.8v3.4" strokeLinecap="round" />
  </svg>
);
const WeekIcon = () => (
  <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden>
    <rect className="stroke" x="2.5" y="3.5" width="14" height="12.5" rx="3" />
    <path className="stroke" d="M2.5 7.5h14M6.8 7.5v8.5M12.2 7.5v8.5" strokeLinecap="round" />
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
 * nav is Today / Week / Coach / Progress (+ Settings) — food has no tab of its own; today's
 * nutrition lives on the trail's food strip → the "Today's food" sheet, and the deeper menus /
 * recipes / shop moved into that sheet and the coach. Today and Week share one PlanView instance
 * (kept mounted across the toggle) so switching between them never refetches the plan.
 */
export function MainTabs({ email }: { email: string | null }) {
  const [tab, setTab] = useState<Tab>('today');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [offerAdjust, setOfferAdjust] = useState(false);
  const [logDidOpen, setLogDidOpen] = useState(false);
  const [planReload, setPlanReload] = useState(0); // bump → PlanView refetches after a ＋ log

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
      <div className="app">
        {(tab === 'today' || tab === 'week') && (
          <PlanView view={tab} onCoach={() => setTab('coach')} reloadSignal={planReload} />
        )}
        {tab === 'coach' && <OnboardingChat intent="ongoing" chrome="none" onSettings={() => setSettingsOpen(true)} />}
        {tab === 'progress' && <ProgressView />}
        {tab !== 'coach' && (
          <button className="fab" onClick={() => setLogDidOpen(true)} aria-label="Log something you did">
            ＋
          </button>
        )}
        <nav className="tabbar" aria-label="Main">
          <button className={`tab${tab === 'today' ? ' tab-on' : ''}`} onClick={() => setTab('today')}>
            <TodayIcon />
            <span>Today</span>
          </button>
          <button className={`tab${tab === 'week' ? ' tab-on' : ''}`} onClick={() => setTab('week')}>
            <WeekIcon />
            <span>Week</span>
          </button>
          <button className={`tab${tab === 'coach' ? ' tab-on' : ''}`} onClick={() => setTab('coach')}>
            <CoachIcon />
            <span>Coach</span>
          </button>
          <button className={`tab${tab === 'progress' ? ' tab-on' : ''}`} onClick={() => setTab('progress')}>
            <ProgressIcon />
            <span>Progress</span>
          </button>
          <button className="tab" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <GearIcon />
            <span>Settings</span>
          </button>
        </nav>
        {settingsOpen && (
          <SettingsSheet email={email} onClose={() => setSettingsOpen(false)} onManage={() => setManage(true)} />
        )}
        {offerAdjust && <AdjustSheet onClose={() => setOfferAdjust(false)} onCommitted={() => setOfferAdjust(false)} />}
        {logDidOpen && (
          <LogDidSheet
            onClose={() => setLogDidOpen(false)}
            onLogged={() => {
              setTab('today'); // land back on Today so the just-logged node shows done
              setPlanReload((k) => k + 1);
            }}
          />
        )}
      </div>
    </>
  );
}
