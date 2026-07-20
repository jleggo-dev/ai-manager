/**
 * useHealthCheckProfilesData
 * -----------------------------
 * Owns Health Check Profiles list CRUD, form state, provider-key auto-resolve,
 * and agent/model option fetching. Extracted from HealthCheckProfilesPage.tsx
 * (FE-08); form/catalog logic further split under health-check-profiles/ (FE-P2).
 */

import { useState, useEffect, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../services/api';
import type { HcProfile, Provider, HcProviderKey } from '../types/api';
import { useHealthCheckProfileForm } from './health-check-profiles/useHealthCheckProfileForm';

export type { ProfileFormState } from './health-check-profiles/profileFormTypes';
export { EMPTY_PROFILE_FORM } from './health-check-profiles/profileFormTypes';

export function useHealthCheckProfilesData() {
  const [profiles, setProfiles] = useState<HcProfile[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerKeys, setProviderKeys] = useState<HcProviderKey[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [profileRes, providerRes, keyRes] = await Promise.all([
        api.listHcProfiles(),
        api.listProviders(),
        api.listHcProviderKeys(),
      ]);
      setProfiles(profileRes.data);
      setProviders(providerRes.data);
      setProviderKeys(keyRes.data);
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formApi = useHealthCheckProfileForm({ providers, providerKeys, loadData });

  return {
    profiles,
    providers,
    loading,
    ...formApi,
  };
}
