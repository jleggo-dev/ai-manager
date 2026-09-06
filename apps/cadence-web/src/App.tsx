import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { MeetCadence } from './features/onboarding/MeetCadence.tsx';
import { OnboardingChat } from './features/onboarding/OnboardingChat.tsx';
import { BuildingScreen } from './features/onboarding/BuildingScreen.tsx';
import { MainTabs } from './features/shell/MainTabs.tsx';
import { DevPanel } from './features/dev/DevPanel.tsx';
import { AccountSwitcher } from './features/dev/AccountSwitcher.tsx';
import { previewScreen } from './features/dev/previewRoutes.tsx';
import { AuthScreen } from './features/auth/AuthScreen.tsx';
import { AccountPicker, type ResumeTarget } from './features/auth/AccountPicker.tsx';
import { SignInFork } from './features/auth/SignInFork.tsx';
import { SignUpGate } from './features/auth/SignUpGate.tsx';
import { isAnonymousSession } from './features/auth/anonymous.ts';
import { listDeviceAccounts, rememberDeviceAccount } from './features/auth/deviceAccounts.ts';
import { syncLocalStateToUser } from './features/auth/localUserState.ts';
import { PhoneFrame } from './components/PhoneFrame.tsx';
import { PlanSkeleton } from './features/plan/PlanSkeleton.tsx';
import { CoachFaceProvider } from './features/coach/CoachFaceProvider.tsx';
import { setAuthToken, isDevMode, getHealthDigest, postHealthDigest, postWorkoutHistory } from './lib/api.ts';
import { useQueryClient } from '@tanstack/react-query';
import { bootPlanStage, clearBootCache, fetchPlanIntoCache, hasCachedPlan, queryKeys } from './lib/query/index.ts';
import { syncPlanLocalNotifications } from './lib/local-notifications-sync.ts';
import { usePushRegistered } from './lib/usePushRegistered.ts';
import { capabilities } from './lib/capability/index.ts';
import { maybeRefreshHealthDigest } from './features/onboarding/health-digest.ts';
import { useForegroundResume } from './lib/useForegroundResume.ts';
import { readPersistedSession, supabase } from './lib/supabase.ts';
import { screenFromPlanStage } from './screenFromPlanStage.ts';

/**
 * `review` is gone from the onboarding machine on purpose. Corrections during the first
 * conversation happen IN the conversation now — the capture pills and the confirmation's "fix"
 * both draft a message rather than opening the pre-v2 curate wizard. That wizard still exists and
 * is still reachable from Settings (MainTabs), where editing a committed plan really is the task.
 */
type Screen = 'loading' | 'meet' | 'onboarding' | 'building' | 'gate' | 'plan' | 'error';

// Resolved once at load (the URL doesn't change without a reload). Dev mode uses the header-based
// test accounts and skips real auth; everything else requires a Supabase session.
const DEV_MODE = isDevMode();
// Resolved once at load, like DEV_MODE — the URL doesn't change without a reload.
const PREVIEW = new URLSearchParams(window.location.search).get('preview');

/**
 * App open, while the session resolves and `/plan` decides which screen this is (PERF-06).
 *
 * This is the screen behind the owner's first complaint — "the first time logging in, it still
 * takes 10s to load the plan screen" (2026-08-20) — and it was the coach's typing dots, which
 * told him the app was talking to a model when it was in fact reading Postgres and waking a
 * serverless function.
 *
 * It shows the PLAN's skeleton rather than a neutral one because that is what this fetch is
 * literally for: `fetchPlanIntoCache`. For the rare brand-new account it flashes and gives way to
 * "meet Cadence" — which costs nothing, because a skeleton asserts a shape, never a fact.
 */
const Loading = () => (
  <div className="app">
    <PlanSkeleton />
  </div>
);

/**
 * The signed-in app: the phone shell + the onboarding→build→plan screen machine. Mounts only once
 * an identity is resolved (a dev account, a real session, or the anonymous session onboarding
 * opens), so its getPlan() fires with auth in place.
 *
 * Since the v2 redesign the flow is: meet the coach → one running chat (the coach drives it, the
 * old wizard is gone) → build the week → save it. Nothing here opens the curate wizard any more:
 * corrections during the first conversation are made by talking to her.
 *
 * The sign-up gate sits between `building` and `plan` and ONLY for an anonymous session. Everyone
 * who signed in first goes straight to their plan — being asked to sign up twice is worse than
 * being asked once at the wrong time.
 */
function CoachApp({ session, authReady = true }: { session: Session | null; authReady?: boolean }) {
  const queryClient = useQueryClient();
  const anonymous = isAnonymousSession(session);

  /**
   * The screen this device was on last time — read from disk, synchronously, ahead of the first
   * render (lib/query/boot-cache.ts).
   *
   * Only INTO the plan, never out of it. A cached `new`/`in_progress` routing someone to "meet
   * Cadence" is the 2026-08-19 failure — onboarding restarted at a signed-in owner with a plan on
   * the server — and a snapshot is a weaker source than the 401 that caused it. So a remembered
   * `committed` opens the shell (the plan is already in the cache to paint it with), and every
   * other answer waits for the server exactly as before.
   */
  const [screen, setScreen] = useState<Screen>(() => {
    if (bootPlanStage() !== 'committed') return 'loading';
    return anonymous ? 'gate' : 'plan';
  });
  const [dev, setDev] = useState(DEV_MODE);
  /**
   * True only on the session where the first plan was just built — it routes the landing into the
   * COACH tab so the walkthrough conversation actually happens (PLAN.md, present-then-discuss:
   * the persona has scripted this walkthrough since v2 and it never once fired, because every
   * route out of building/gate landed on Today). Deliberately NOT persisted: if the app is killed
   * before the coach tab opens, the next launch lands on Today as ever and the canned greeting
   * still invites adjustment — a nudge that fires days later would be worse than none.
   */
  const [justBuilt, setJustBuilt] = useState<false | 'card' | 'fresh'>(false);
  // Notifications are core functionality, so registration is core setup: from launch, on every
  // screen, retried on resume. The one place that used to ask was the onboarding build screen,
  // which is why device_tokens was empty and no push Cadence ever sent could be delivered.
  usePushRegistered(authReady && screen !== 'loading');

  /**
   * A push landing means finished work is waiting server-side (Gap 6, PLAN-CHANGES.md): the
   * plan-ready pushes (`replan_ready` / `replan_committed` / `checkin_replan_ready`) used to
   * arrive as pure text with no listeners — received in the foreground they changed nothing, and
   * a tap just foregrounded the app. Both arrival doors funnel here (capability seam — the web
   * build's push capability never fires, the same guard the registration path uses): drop the
   * plan cache so the week repaints wherever it's on screen, then ring the resume doorbell —
   * useAppResume/useForegroundResume both listen on `document`, so everything built to heal on a
   * real return heals now, the pending-replan re-check that surfaces a waiting proposal included
   * (useProposalAccept's own resume door; its in-flight guards already absorb the double-fire a
   * tapped push produces alongside the real foreground event). Deliberately payload-blind: a
   * push with no `kind`/`target` (older server) triggers the exact same refresh.
   */
  useEffect(() => {
    if (!capabilities.push.isAvailable()) return;
    return capabilities.push.onNotification(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plan.all });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // capabilities is module-static; queryClient is provider-stable for the app's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPlan = () => {
    /**
     * Blank to the skeleton ONLY when there is genuinely nothing to show. With last launch's plan
     * seeded into the cache, this fetch is a background revalidate of a screen the user is already
     * reading — replacing it with a loader would be the app throwing away its own answer to go ask
     * for the same one, which is the behaviour being fixed, not a smaller version of it.
     */
    const painted = hasCachedPlan(queryClient);
    if (!painted) setScreen('loading');
    /**
     * Through the shared query cache (PERF-02), not a bare getPlan(): routing and PlanView's
     * first paint used to be two sequential /plan round trips — the gate resolved, MainTabs
     * mounted, and PlanView refetched the exact plan the gate had just thrown away, holding the
     * typing dots for a second full trip (2026-08-20 latency report). Now the gate's fetch IS
     * the cache PlanView paints from, and the dots end with round trip one.
     *
     * "Could not load" must never route anywhere a plan-stage routes: the API once dressed any
     * failure as `stage: 'new'`, so a cold start or a 401 blip right after sign-in landed a
     * fully signed-in owner on "meet Cadence" — onboarding, restarted, on top of a plan sitting
     * on the server (2026-08-19). The cache fetch THROWS on that answer (one silent retry built
     * into the client), so failure lands on the error screen below, never on a plan stage.
     */
    fetchPlanIntoCache(queryClient)
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
      /**
       * A failed revalidate must not take a working screen away. With nothing painted this is the
       * error state as it has always been (never a plan stage — see above); with a plan on screen
       * the honest response is to leave it there, keep its own "couldn't refresh" affordance in
       * PlanView, and let the resume hook try again.
       */
      .catch(() => {
        if (!painted) setScreen('error');
      });
  };

  /**
   * The rescuer for a boot interrupted by backgrounding (2026-08-29 device round): a fetch
   * suspended mid-flight comes back to a dead socket, and with no timeout and no resume signal
   * the skeleton sat for minutes. The plan fetch now times out (api/plan.ts) so a hang becomes a
   * failure — and this is the other half: coming back to the foreground retries a gate stuck on
   * loading/error, and nudges every stale active query so what IS on screen is current.
   *
   * `screenRef` rather than a dependency: re-subscribing the native listener per screen change
   * would race Capacitor's remove/add across a fast background-foreground flip.
   */
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useForegroundResume(() => {
    if (!authReady) return; // nothing can be fetched yet; the auth effect below will fire it
    if (screenRef.current === 'loading' || screenRef.current === 'error') loadPlan();
    else void queryClient.refetchQueries({ type: 'active', stale: true });
  });

  /**
   * Keyed on `authReady`, not on mount, because the paint now starts BEFORE auth resolves: a
   * returning user's screen is on the glass while Supabase is still refreshing their access token
   * (App, below). Every request in here needs that token, so they wait for it — the split is the
   * whole idea. Paint from what the device knows; fetch when there is something to fetch with.
   */
  useEffect(() => {
    if (!authReady) return;
    loadPlan();
    // Silent Apple Health refresh (iOS shell, permission already granted): keeps the coach's
    // view of recent activity current without re-asking. Throttled + content-diffed inside.
    void maybeRefreshHealthDigest({
      isAvailable: () => capabilities.health.isAvailable(),
      getWorkouts: (since) => capabilities.health.getWorkouts(since),
      getDailySteps: (since) => capabilities.health.getDailySteps(since),
      ensureAccess: () => capabilities.health.requestPermissions(['workouts']),
      getLatest: getHealthDigest,
      post: (d) => postHealthDigest(d),
      postWorkouts: postWorkoutHistory,
    }).catch(() => {});
    // anonymous is fixed for the life of a session object; re-running on it would refetch the plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  /**
   * The way OUT of the sign-up gate, and the reason it needs its own effect.
   *
   * The gate is chosen once, in the mount effect above, from `stage === plan && anonymous`. Signing
   * up doesn't re-run that — it updates the session — so nothing ever moved the screen off `gate`.
   * Continue with Apple (or Google) therefore looked like a freeze: the sheet closed, the identity
   * linked, the session came back non-anonymous, and the gate just sat there. Force-quitting and
   * relaunching "fixed" it because that re-ran the mount effect with `anonymous` false. Which is
   * exactly what was reported, and exactly the moment someone is deciding to trust this app with
   * an account.
   *
   * Keyed on `anonymous` going false, not on any one provider's success path, so every route
   * through the gate — Apple, Google, a confirmed email — lands the same way.
   */
  useEffect(() => {
    if (!anonymous)
      setScreen((s) => {
        // Leaving the gate BY signing in lands in the coach conversation, not on Today — the gate
        // footer literally promises "Sign in and we'll talk it through", so arriving anywhere else
        // is the app breaking its own sentence. This covers the resume path too (app killed at
        // the gate, reopened, signed in): the promise is the same however they got here.
        if (s === 'gate') setJustBuilt('card');
        return s === 'gate' ? 'plan' : s;
      });
  }, [anonymous]);

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
        <OnboardingChat onBuild={() => setScreen('building')} onBack={() => setScreen('meet')} />
      ) : screen === 'building' ? (
        <BuildingScreen
          onReady={() => {
            // 'fresh': a signed-in user goes straight to the discussion and has NOT seen the
            // card (the card is a conversion device; no gate, no card). The anonymous path is
            // overwritten to 'card' by the gate-exit effect below, which is the only way out.
            setJustBuilt('fresh');
            setScreen(anonymous ? 'gate' : 'plan');
          }}
          onBackToChat={() => setScreen('onboarding')}
        />
      ) : screen === 'gate' ? (
        <SignUpGate />
      ) : screen === 'error' ? (
        <div className="app">
          <div className="scrollbody">
            <div className="wiz-empty" style={{ marginTop: 48 }}>
              {"Couldn't reach your plan just now — it's safe on the server."}
            </div>
            <button className="cta" style={{ marginTop: 16 }} onClick={loadPlan}>
              Try again
            </button>
          </div>
        </div>
      ) : (
        <MainTabs email={session?.user.email ?? null} discussPlan={justBuilt} />
      )}
    </PhoneFrame>
  );

  return (
    // Gated like every other fetch on the paint-before-auth path: a face read fired before the
    // token exists is a guaranteed 401, and a 401 read as "hasn't picked" is how portraits
    // reverted to the mark (see CoachFaceProvider).
    <CoachFaceProvider authReady={authReady}>
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
      {/* Real-auth sign-out / password / start-over live in the in-app Settings room now. */}
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
  /**
   * Who the sign-in screen is FOR, when it is for someone in particular. An expired picker row
   * sets it, so the screen can lead with their name and the way they signed in before — the fix
   * for the 2026-08-19 report: the generic sheet let the owner tap Apple on a Google+email
   * account, which minted a fresh user and "restarted onboarding".
   */
  const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(null);
  if (view === 'picker')
    return (
      <AccountPicker
        // A NEW person: the fork (get started → onboarding, account at the end — or sign in).
        // This used to open the sign-in sheet, which demanded an account before onboarding.
        onAddAccount={() => {
          setResumeTarget(null);
          setView('fork');
        }}
        // A KNOWN person whose session expired: aim the sign-in screen at them.
        onSignInAs={(t) => {
          setResumeTarget(t);
          setView('signin');
        }}
        // The session change is what actually swaps the screen (App's auth listener); this only
        // matters if a resume lands without one.
        onResumed={() => setView('fork')}
      />
    );
  if (view === 'signin') return <AuthScreen resume={resumeTarget} />;
  return (
    <SignInFork
      onSignIn={() => {
        setResumeTarget(null);
        setView('signin');
      }}
      onStarted={() => setView('fork')}
    />
  );
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
  const queryClient = useQueryClient();

  useEffect(() => {
    // A different person signed in → their predecessor's cached server answers (plan, nutrition
    // day, progress) are not theirs to inherit either — same rule as the localStorage sweep, now
    // that the plan cache also routes the app (PERF-02). Same-person resumes keep their cache.
    const syncUser = (userId: string | null) => {
      if (!syncLocalStateToUser(userId)) return;
      queryClient.clear();
      // The sweep already removed the snapshot's key; this drops the copy boot-cache memoized at
      // module load, so the next mount cannot route from a stage that belonged to someone else.
      clearBootCache();
    };
    if (DEV_MODE) return;
    supabase.auth.getSession().then(({ data }) => {
      setAuthToken(data.session?.access_token ?? null);
      setSession(data.session);
      // Before anything reads a local answer: a different person means the last person's answers
      // are not theirs to inherit (features/auth/localUserState.ts).
      syncUser(data.session?.user.id ?? null);
      if (data.session) rememberDeviceAccount(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setAuthToken(s?.access_token ?? null);
      setSession(s);
      syncUser(s?.user.id ?? null);
      if (s) rememberDeviceAccount(s);
    });
    return () => sub.subscription.unsubscribe();
    // queryClient is provider-stable for the app's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tool previews short-circuit auth and the plan entirely. Sits below the hooks so the hook
  // order is identical on every render.
  const preview = previewScreen(PREVIEW);
  if (preview) return <PhoneFrame>{preview}</PhoneFrame>;

  /**
   * Auth is still resolving — and for a returning user that is a NETWORK wait, not a disk one:
   * `getSession()` awaits a token refresh whenever the access token has aged out, which after the
   * default hour means most launches. Sitting on a skeleton through it is the app waiting for
   * permission to draw something it already has.
   *
   * So: if the device's own copy of the session says somebody is signed in here, mount the app now
   * and let it paint from the boot cache; `authReady` holds every request until the real token
   * lands (CoachApp). Same element type in the same position as the ready branch below, so this is
   * the app starting early, not a screen that gets replaced.
   *
   * Three conditions, and each removes a way to be wrong. A persisted session, because without one
   * the next screen is PreAuth and painting a plan first would be a flash of the wrong thing. NOT
   * anonymous, because an anonymous account with a committed plan belongs at the sign-up gate and
   * `session` is null here — the one routing question this path cannot answer for itself. And a
   * remembered `committed` stage, because there is nothing cached to paint for any other one.
   */
  if (!ready) {
    const persisted = readPersistedSession();
    const paintable = persisted && !isAnonymousSession(persisted) && bootPlanStage() === 'committed';
    if (paintable) return <CoachApp session={null} authReady={false} />;
    return (
      <PhoneFrame>
        <Loading />
      </PhoneFrame>
    );
  }
  if (!DEV_MODE && !session)
    return (
      <PhoneFrame>
        <PreAuth />
      </PhoneFrame>
    );
  return <CoachApp session={session} />;
}
