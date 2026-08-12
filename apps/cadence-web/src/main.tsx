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
// The plan-card gate reuses onboarding.css's .gate-week strip and .gate-h, so it loads after.
import './styles/gate.css';
import { App } from './App.tsx';
import { createAppQueryClient } from './lib/query/index.ts';
import { initNativeAuth } from './lib/native-auth.ts';

// Deep-link listener for OAuth in the Capacitor iOS shell; no-op on web.
initNativeAuth();

const queryClient = createAppQueryClient();

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
