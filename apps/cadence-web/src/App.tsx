import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { MeetCadence } from './features/onboarding/MeetCadence.tsx';
import { OnboardingChat } from './features/onboarding/OnboardingChat.tsx';
import { BuildingScreen } from './features/onboarding/BuildingScreen.tsx';
import { ReviewScreen } from './features/review/ReviewScreen.tsx';
import type { Step } from './features/review/reviewConstants.ts';
import { MainTabs } from './features/shell/MainTabs.tsx';
import { DevPanel } from './features/dev/DevPanel.tsx';
import { AccountSwitcher } from './features/dev/AccountSwitcher.tsx';
import { previewScreen } from './features/dev/previewRoutes.tsx';
import { AuthScreen } from './features/auth/AuthScreen.tsx';
import { AccountPicker } from './features/auth/AccountPicker.tsx';
import { SignInFork } from './features/auth/SignInFork.tsx';
import { SignUpGate } from './features/auth/SignUpGate.tsx';
import { isAnonymousSession } from './features/auth/anonymous.ts';
import { listDeviceAccounts, rememberDeviceAccount } from './features/auth/deviceAccounts.ts';
import { syncLocalStateToUser } from './features/auth/localUserState.ts';
import { PhoneFrame } from './components/PhoneFrame.tsx';
import { CoachFaceProvider } from './features/coach/CoachFaceProvider.tsx';
import { getPlan, setAuthToken, isDevMode, getHealthDigest, postHealthDigest } from './lib/api.ts';
import { syncPlanLocalNotifications } from './lib/local-notifications-sync.ts';
import { capabilities } from './lib/capability/index.ts';
import { maybeRefreshHealthDigest } from './features/onboarding/health-digest.ts';
import { supabase } from './lib/supabase.ts';
import { screenFromPlanStage } from './screenFromPlanStage.ts';

type Screen = 'loading' | 'meet' | 'onboarding' | 'review' | 'building' | 'gate' | 'plan';

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
 * The signed-in app: the phone shell + the onboarding→build→plan screen machine. Mounts only once
 * an identity is resolved (a dev account, a real session, or the anonymous session onboarding
 * opens), so its getPlan() fires with auth in place.
 *
 * Since the v2 redesign the flow is: meet the coach → one running chat (the coach drives it, the
 * old wizard is gone) → build the week → save it. `review` is still here but is no longer a step
 * anyone walks through: it is what "edit" on the confirmation opens, and what Settings opens later.
 *
 * The sign-up gate sits between `building` and `plan` and ONLY for an anonymous session. Everyone
 * who signed in first goes straight to their plan — being asked to sign up twice is worse than
 * being asked once at the wrong time.
 */
function CoachApp({ session }: { session: Session | null }) {
  const [screen, setScreen] = useState<Screen>('loading');
  const [reviewStep, setReviewStep] = useState<Step>('goals');
  const [dev, setDev] = useState(DEV_MODE);
  const anonymous = isAnonymousSession(session);

  useEffect(() => {
    getPlan()
      .then((p) => {
        const next = screenFromPlanStage(p.stage);
        // A finished plan on an account that never signed up: the gate is what stands between
        // them and it, so land there rather than on a plan that could evaporate with the browser.
        setScreen(next === 'plan' && anonymous ? 'gate' : next);
        // Reconcile on-device local notifications with the plan we just loaded. Full replace, native-only,
        // and a no-op without permission — so it is safe to run on every load, and running it
        // often is the point: a reminder for a session that was replanned away reads as the app
        // not having listened.
        void syncPlanLocalNotifications();
      })
      .catch(() => setScreen('meet'));
    // Silent Apple Health refresh (iOS shell, permission already granted): keeps the coach's
    // view of recent activity current without re-asking. Throttled + content-diffed inside.
    void maybeRefreshHealthDigest({
      isAvailable: () => capabilities.health.isAvailable(),
      getWorkouts: (since) => capabilities.health.getWorkouts(since),
      getLatest: getHealthDigest,
      post: (d) => postHealthDigest(d),
    }).catch(() => {});
    // anonymous is fixed for the life of a session object; re-running on it would refetch the plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openReview = (step: Step = 'goals') => {
    setReviewStep(step);
    setScreen('review');
  };

  /**
   * The way out of onboarding, and the reason it has to be a sign-out rather than a screen change.
   *
   * A Supabase session — anonymous ones included — is persisted, so it survives a hard close. That
   * made onboarding a one-way street: the fork and the sign-in screen only render when there is NO
   * session, so once an anonymous one existed every launch dropped straight back into the chat with
   * no route to sign in, switch accounts, or start fresh. Dropping the session is what puts the
   * fork back on screen.
   *
   * Nothing is deleted server-side. For an anonymous draft that is academic — there is no way to
   * sign back in to reach it, which is exactly why the caller confirms first.
   */
  const leaveOnboarding = () => {
    void supabase.auth.signOut().catch(() => {
      // Already gone, or offline. The listener drives the screen either way; a failure here must
      // not strand someone on the screen they asked to leave.
    });
  };

  // The picked portrait is loaded once here, above the screen machine: the face has to be the
  // same on the review wizard, the trail and every sheet, and a per-surface fetch would let them
  // disagree for a frame after a swap.
  const phone = (
    <PhoneFrame>
      {screen === 'loading' ? (
        <Loading />
      ) : screen === 'meet' ? (
        <MeetCadence onSayHi={() => setScreen('onboarding')} onLeave={leaveOnboarding} warnUnsaved={anonymous} />
      ) : screen === 'onboarding' ? (
        <OnboardingChat onReview={openReview} onBuild={() => setScreen('building')} onBack={() => setScreen('meet')} />
      ) : screen === 'review' ? (
        <ReviewScreen
          initialStep={reviewStep}
          onBack={() => setScreen('onboarding')}
          onLocked={() => setScreen('plan')}
        />
      ) : screen === 'building' ? (
        <BuildingScreen
          onReady={() => setScreen(anonymous ? 'gate' : 'plan')}
          onBackToChat={() => setScreen('onboarding')}
        />
      ) : screen === 'gate' ? (
        <SignUpGate />
      ) : (
        <MainTabs email={session?.user.email ?? null} />
      )}
    </PhoneFrame>
  );

  return (
    <CoachFaceProvider>
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
    </CoachFaceProvider>
  );
}

/**
 * Pre-auth. Three doors, and which one opens first is the whole point of the redesign:
 * accounts already on this phone get "welcome back" (one tap, no typing); everyone else gets the
 * fork, where "get started" opens an anonymous session and the account comes after the plan exists.
 * The provider sheet is unchanged — it is what "sign in" and "add another account" open.
 */
function PreAuth() {
  const [view, setView] = useState<'picker' | 'fork' | 'signin'>(() =>
    listDeviceAccounts().length ? 'picker' : 'fork',
  );
  if (view === 'picker')
    return (
      <AccountPicker
        onAddAccount={() => setView('fork')}
        // The session change is what actually swaps the screen (App's auth listener); this only
        // matters if a resume lands without one.
        onResumed={() => setView('fork')}
      />
    );
  if (view === 'signin') return <AuthScreen />;
  return <SignInFork onSignIn={() => setView('signin')} onStarted={() => setView('fork')} />;
}

/**
 * Auth gate. Dev mode renders the app straight away (dev-account header). Otherwise we resolve the
 * Supabase session first: no session → the pre-auth doors; a session (including an anonymous one)
 * → the app. `onAuthStateChange` keeps the API's bearer token in sync, swaps the screens on login
 * (and back on sign-out) without a reload, and keeps this device's account roster current — the
 * stored refresh token has to follow rotation or "welcome back" stops working after a day.
 */
export function App() {
  const [ready, setReady] = useState(DEV_MODE);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (DEV_MODE) return;
    supabase.auth.getSession().then(({ data }) => {
      setAuthToken(data.session?.access_token ?? null);
      setSession(data.session);
      // Before anything reads a local answer: a different person means the last person's answers
      // are not theirs to inherit (features/auth/localUserState.ts).
      syncLocalStateToUser(data.session?.user.id ?? null);
      if (data.session) rememberDeviceAccount(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setAuthToken(s?.access_token ?? null);
      setSession(s);
      syncLocalStateToUser(s?.user.id ?? null);
      if (s) rememberDeviceAccount(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Tool previews short-circuit auth and the plan entirely. Sits below the hooks so the hook
  // order is identical on every render.
  const preview = previewScreen(PREVIEW);
  if (preview) return <PhoneFrame>{preview}</PhoneFrame>;

  if (!ready)
    return (
      <PhoneFrame>
        <Loading />
      </PhoneFrame>
    );
  if (!DEV_MODE && !session)
    return (
      <PhoneFrame>
        <PreAuth />
      </PhoneFrame>
    );
  return <CoachApp session={session} />;
}
