import { Capacitor } from '@capacitor/core';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
// After styles.css on purpose: the coach-face rules fill in portraits on placements whose
// geometry (the header plate, the trail bay disc) is already defined there.
import './styles/coach.css';
// Last: the v2 sign-in/onboarding rules lean on both of the above (the chat shell from styles.css,
// the portrait chip and picker from coach.css).
import './styles/onboarding.css';
// The plan-card gate reuses onboarding.css's .gate-h heading, so it loads after.
import './styles/gate.css';
// The food CAPTURE surfaces (quick add, the Log screen, the confirm card). Separate from
// styles.css's `.fh-*` reading screens on purpose — a capture and a read are different jobs.
import './styles/food-capture.css';
// The bracket grammar (.mb-*, meal-logging rework P2) — self-contained; drawn the same in the
// meal, the diary, and the cookbook, so it belongs to none of their stylesheets.
import './styles/bracket.css';
// The diary's bracket wrappers and the cookbook shelf (.cs-*, P6) — placement around the mark,
// never the mark itself, so it loads after bracket.css and leans on it.
import './styles/shelf.css';
// The meal screen (.ms-*, meal-logging rework P4) — the draft surface. After bracket.css and
// food-capture.css because it composes around both families without restating either.
import './styles/meal-screen.css';
// The Sunday sweep's surfaces (.sw-*, meal-logging rework P7) — rides the sheet chrome from
// styles.css and the bracket's taxonomy (green/butter), so it loads after both.
import './styles/sweep.css';
// Skeletons (PERF-06). Deliberately self-contained: these rules describe the SHAPE of a screen
// that has not arrived, so they must not depend on — or be overridden by — any one screen's
// stylesheet.
import './styles/skeleton.css';
// The item, opened (.ri-*, P2) — was self-imported by ItemScreen.tsx while the screen was reachable
// only behind a dev preview; now that the list screen (P6) makes it real navigation, its rules load
// centrally like every other screen's, so `.ri-collision`'s butter card is available wherever the
// list screen's own collision card needs it too.
import './styles/repertoire-item.css';
// Seeding a collection (.sr-*, P4) — same move, same reason: SeedReview was self-imported while its
// route belonged to another parcel; P6 wires it into real navigation from the list screen.
import './styles/seed-review.css';
// The list screen itself (.rl-*, P6 "the room") — leans on `.ri-collision` above for the collision
// card and on styles.css's `.sheet-*`/`.ld-row`/`.detour-chip`/`.cta`, so it loads last of the three.
import './styles/repertoire-list.css';
import { App } from './App.tsx';
import { createAppQueryClient, persistBootCache, seedBootCache } from './lib/query/index.ts';
import { warmApi } from './lib/api.ts';
import { initNativeAuth } from './lib/native-auth.ts';

// Deep-link listener for OAuth in the Capacitor iOS shell; no-op on web.
initNativeAuth();

/**
 * Wake the serverless API now, not after auth. Nothing awaits it — by the time the first real
 * request has a token, the ~1.3s cold start has been running alongside everything below instead
 * of in front of it (lib/api/http.ts).
 */
warmApi();

const queryClient = createAppQueryClient();

/**
 * The first frame should be the app, not a wait for one.
 *
 * `seedBootCache` runs BEFORE `createRoot` on purpose: it is a synchronous localStorage read, so
 * last launch's plan, dashboard and food day are in the cache before React renders anything, and
 * the app's opening paint is a real screen rather than a skeleton standing in for a round trip
 * that has not been sent yet. Everything seeded is marked stale on arrival and revalidates
 * immediately — the server is still the truth (lib/query/boot-cache.ts).
 */
seedBootCache(queryClient);
persistBootCache(queryClient);

// Stamp the shell so CSS can key the full-bleed layout off "this is an app" rather than off a
// width breakpoint. A width query put an iPad — and any device whose layout viewport reported wider
// than 480px — into the fake-phone mockup, a fixed 390px frame that cannot fit inside body padding
// on a 393px screen, which is one of the ways every screen ended up panning side to side.
if (Capacitor.isNativePlatform()) document.documentElement.setAttribute('data-native', '');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
