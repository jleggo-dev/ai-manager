/**
 * ai-profiles/hooks/useAiProfilesData
 * -----------------------------
 * Owns the AI Profiles list CRUD concern: fetching profiles/providers and the
 * delete / toggle-default operations. Extracted from AiProfileManager.tsx (FE-02)
 * as a structural, behavior-preserving move.
 *
 * CROSS-03: providers list shares TanStack Query cache with ProviderManager
 * (`useProvidersQuery`); profiles remain a local fetch until a later pilot.
 */

import { useState, useEffect, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import useConfirm from '../../../../hooks/useConfirm';
import { useProvidersQuery } from '../../../../hooks/useProvidersQuery';
import * as api from '../../../../services/api';
import type { AiProfile } from '../../../../types/api';

export function useAiProfilesData() {
  const confirm = useConfirm();
  const { data: providers = [], isLoading: providersLoading } = useProvidersQuery();
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const loadProfiles = useCallback(async () => {
    try {
      setProfilesLoading(true);
      const profilesResult = await api.listAiProfiles();
      setProfiles(profilesResult.data);
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const loadData = useCallback(async () => {
    await loadProfiles();
  }, [loadProfiles]);

  async function handleDelete(id: string) {
    if (
      !(await confirm({
        title: 'Delete AI profile',
        message: "This can't be undone.",
      }))
    )
      return;
    try {
      await api.deleteAiProfile(id);
      notifications.show({
        title: 'Deleted',
        message: 'AI profile removed',
        color: 'orange',
      });
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  /** Toggle the is_default flag on a profile (only-one-default pattern) */
  async function handleToggleDefault(id: string, setAsDefault: boolean) {
    try {
      if (setAsDefault) {
        await api.setAiProfileDefault(id);
        notifications.show({
          title: 'Default Set',
          message: 'This profile is now the default',
          color: 'yellow',
        });
      } else {
        await api.clearAiProfileDefault(id);
        notifications.show({
          title: 'Default Cleared',
          message: 'Default profile removed',
          color: 'gray',
        });
      }
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  return {
    profiles,
    providers,
    loading: profilesLoading || providersLoading,
    loadData,
    handleDelete,
    handleToggleDefault,
  };
}
