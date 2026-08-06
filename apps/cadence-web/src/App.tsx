import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Welcome } from './features/welcome/Welcome.tsx';
import { OnboardingChat } from './features/onboarding/OnboardingChat.tsx';
import { ReviewScreen } from './features/review/ReviewScreen.tsx';
import { MainTabs } from './features/shell/MainTabs.tsx';
import { DevPanel } from './features/dev/DevPanel.tsx';
import { AccountSwitcher } from './features/dev/AccountSwitcher.tsx';
import { AuthScreen } from './features/auth/AuthScreen.tsx';
import { PhoneFrame } from './components/PhoneFrame.tsx';
import {
  BreathingPreview,
  GroundingPreview,
  MeditatePreview,
  NowMenuPreview,
  FeelingLogPreview,
  JournalPreview,
} from './features/dev/BreathingPreview.tsx';
import { FreeWritePreview } from './features/dev/FreeWritePreview.tsx';
import { getPlan, setAuthToken, isDevMode, getHealthDigest, postHealthDigest } from './lib/api.ts';
import { capabilities } from './lib/capability/index.ts';
import { maybeRefreshHealthDigest } from './features/onboarding/health-digest.ts';
import { supabase } from './lib/supabase.ts';
import { screenFromPlanStage } from './screenFromPlanStage.ts';

type Screen = 'loading' | 'welcome' | 'onboarding' | 'review' | 'plan';

// Resolved once at load (the URL doesn't change without a reload). Dev mode uses the header-based
// test accounts and skips real auth; everything else requires a Supabase session.
const DEV_MODE = isDevMode();
// Resolved once at load, like DEV_MODE — the URL doesn't change without a reload.
const PREVIEW = new URLSearchParams(window.location.search).get('preview');

const Loading = () => (
  <div className="app">
    <div className="scrollbody">
      <div className="chat-loading">
        <span className="typing">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  </div>
);

/**
 * The signed-in app: the phone shell + the onboarding→review→plan screen machine. Mounts only once
 * an identity is resolved (a dev account, or a real session), so its getPlan() fires with auth in
 * place. Dev affordances (account switcher, X-ray toggle) render only in dev mode; real-auth mode
 * gets a small sign-out control in the same corner instead.
 */
function CoachApp({ session }: { session: Session | null }) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [coachIntent, setCoachIntent] = useState<'onboarding' | 'ongoing'>('onboarding');
  const [dev, setDev] = useState(DEV_MODE);

  useEffect(() => {
    getPlan()
      .then((p) => {
        setScreen(screenFromPlanStage(p.stage));
      })
      .catch(() => setScreen('welcome'));
    // Silent Apple Health refresh (iOS shell, permission already granted): keeps the coach's
    // view of recent activity current without re-asking. Throttled + content-diffed inside.
    void maybeRefreshHealthDigest({
      isAvailable: () => capabilities.health.isAvailable(),
      getWorkouts: (since) => capabilities.health.getWorkouts(since),
      getLatest: getHealthDigest,
      post: (d) => postHealthDigest(d),
    }).catch(() => {});
  }, []);

  const phone = (
    <PhoneFrame>
      {screen === 'loading' ? (
        <Loading />
      ) : screen === 'welcome' ? (
        <Welcome
          onStart={() => {
            setCoachIntent('onboarding');
            setScreen('onboarding');
          }}
        />
      ) : screen === 'onboarding' ? (
        <OnboardingChat intent={coachIntent} onReview={() => setScreen('review')} />
      ) : screen === 'review' ? (
        <ReviewScreen onBack={() => setScreen('onboarding')} onLocked={() => setScreen('plan')} />
      ) : (
        <MainTabs email={session?.user.email ?? null} />
      )}
    </PhoneFrame>
  );

  return (
    <>
      {dev ? (
        <div className="devroot">
          {phone}
          <DevPanel />
        </div>
      ) : (
        phone
      )}
      {DEV_MODE && (
        <>
          <AccountSwitcher />
          <button
            className="dev-toggle"
            onClick={() => setDev((d) => !d)}
            title={dev ? 'Hide developer X-ray' : 'Show developer X-ray'}
          >
            {dev ? '✕' : '🛠'}
          </button>
        </>
      )}
      {/* Real-auth sign-out / password / start-over live in the in-app Settings sheet now. */}
    </>
  );
}

/**
 * Auth gate. Dev mode renders the app straight away (dev-account header). Otherwise we resolve the
 * Supabase session first: no session → the sign-in screen; a session → the app. `onAuthStateChange`
 * keeps the API's bearer token in sync and swaps the sign-in screen for the app on login (and back
 * on sign-out) without a reload.
 */
export function App() {
  const [ready, setReady] = useState(DEV_MODE);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (DEV_MODE) return;
    supabase.auth.getSession().then(({ data }) => {
      setAuthToken(data.session?.access_token ?? null);
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setAuthToken(s?.access_token ?? null);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Tool previews (`?preview=breathing`) short-circuit auth and the plan entirely — they render one
  // component against fixture data so a temporal tool can be watched without a coach-composed
  // session. Dev affordance only; nothing links here. Sits below the hooks so the hook order is
  // identical on every render.
  if (PREVIEW === 'breathing')
    return (
      <PhoneFrame>
        <BreathingPreview />
      </PhoneFrame>
    );
  if (PREVIEW === 'meditate')
    return (
      <PhoneFrame>
        <MeditatePreview />
      </PhoneFrame>
    );
  if (PREVIEW === 'grounding')
    return (
      <PhoneFrame>
        <GroundingPreview />
      </PhoneFrame>
    );
  if (PREVIEW === 'feeling')
    return (
      <PhoneFrame>
        <FeelingLogPreview />
      </PhoneFrame>
    );
  if (PREVIEW === 'journal')
    return (
      <PhoneFrame>
        <JournalPreview />
      </PhoneFrame>
    );
  if (PREVIEW === 'freewrite')
    return (
      <PhoneFrame>
        <FreeWritePreview />
      </PhoneFrame>
    );
  if (PREVIEW === 'nowmenu')
    return (
      <PhoneFrame>
        <NowMenuPreview />
      </PhoneFrame>
    );

  if (!ready)
    return (
      <PhoneFrame>
        <Loading />
      </PhoneFrame>
    );
  if (!DEV_MODE && !session)
    return (
      <PhoneFrame>
        <AuthScreen />
      </PhoneFrame>
    );
  return <CoachApp session={session} />;
}
