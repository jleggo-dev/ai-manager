/**
 * The last model liveness report for a provider (GET /api/providers/:id/liveness), shared by the
 * provider page and the profile form's model pickers. `null` means no check has run yet.
 */
import { useQuery } from '@tanstack/react-query';
import { providerKeys } from '../lib/query-keys';
import * as api from '../services/api';

export function useProviderLivenessQuery(providerId: string | null | undefined) {
  return useQuery({
    queryKey: providerKeys.liveness(providerId ?? 'none'),
    queryFn: () => api.getProviderLiveness(providerId as string),
    enabled: Boolean(providerId),
    staleTime: 5 * 60 * 1000,
  });
}
