/**
 * Render a component that reads from the shared query cache.
 *
 * Every screen that paints from cache instead of from its own `useEffect` needs a `QueryClient`
 * around it in tests, and a hand-rolled provider per test file is the kind of copy that drifts —
 * one file forgets `retry: false` and a failure path takes 30s to fail. `client` is handed back so
 * a test can seed the cache with `setQueryData` and assert the FIRST paint, which is the whole
 * point of the caching: the screen must be finished before any fetch resolves.
 */
import type { ReactElement, ReactNode } from 'react';
import { render, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function makeTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export function renderWithQuery(ui: ReactElement, client: QueryClient = makeTestQueryClient()) {
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/** The same wrapper for a hook under test — anything reading the cache needs a client around it. */
export function renderHookWithQuery<T>(hook: () => T, client: QueryClient = makeTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(hook, { wrapper }) };
}
