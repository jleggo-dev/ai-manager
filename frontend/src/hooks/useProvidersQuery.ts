/**
 * CROSS-03 pilot: cached providers list shared by ProviderManager and AI Profiles.
 * Navigating Providers ↔ AI Profiles within staleTime reuses cache instead of
 * re-hitting GET /api/providers.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWorkspaceId } from '../lib/auth-session';
import { providerKeys } from '../lib/query-keys';
import * as api from '../services/api';
import type { Provider } from '../types/api';

export function useProvidersQuery() {
  const workspaceId = getWorkspaceId();

  return useQuery({
    queryKey: providerKeys.list(workspaceId),
    queryFn: async (): Promise<Provider[]> => {
      const result = await api.listProviders();
      return result.data;
    },
  });
}

/** Call after create / update / delete so every consumer of providerKeys refreshes. */
export function useInvalidateProviders() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: providerKeys.all });
}
