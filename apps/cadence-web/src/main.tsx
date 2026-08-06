import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { App } from './App.tsx';
import { createAppQueryClient } from './lib/query/index.ts';
import { initNativeAuth } from './lib/native-auth.ts';

// Deep-link listener for OAuth in the Capacitor iOS shell; no-op on web.
initNativeAuth();

const queryClient = createAppQueryClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
