/**
 * Test helper: wrap components that use TanStack Query.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function QueryWrapper({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [defaultClient] = useState(() => createTestQueryClient());
  const queryClient = client ?? defaultClient;
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
