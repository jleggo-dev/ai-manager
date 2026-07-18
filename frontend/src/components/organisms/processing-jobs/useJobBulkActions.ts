import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../../../services/api';
import type { ProcessingJob } from '../../../types/api';
import { getJobConfig } from './types';
import type { PickerState } from './types';

/**
 * Owns multi-select ("checked") state for the Jobs tab and the bulk operations that
 * apply to the checked set: changing AI profile, moving to a group, and activating /
 * deactivating. Also owns the profile/group picker modal, which is shared between the
 * bulk flow (multiple checked jobs) and the single-job flow (one job, no selection).
 */
export function useJobBulkActions(jobs: ProcessingJob[], onRefresh: () => Promise<void>) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkApplying, setBulkApplying] = useState(false);

  function toggleChecked(jobId: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  function clearChecked() {
    setCheckedIds(new Set());
  }

  const hasChecked = checkedIds.size > 0;

  async function bulkChangeProfile(profileId: string | null) {
    try {
      setBulkApplying(true);
      const updates = [...checkedIds].map((id) => ({ id, ai_profile_id: profileId || null }));
      await api.batchUpdateProcessingJobs(updates);
      notifications.show({ title: 'Updated', message: `${updates.length} job(s) updated`, color: 'green' });
      clearChecked();
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({
        title: 'Bulk update failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setBulkApplying(false);
    }
  }

  async function bulkMoveToGroup(subgroupId: string | null) {
    try {
      setBulkApplying(true);
      const updates = [...checkedIds].map((id) => ({ id, config: { subgroupId: subgroupId || null } }));
      await api.batchUpdateProcessingJobs(updates);
      notifications.show({ title: 'Moved', message: `${updates.length} job(s) moved`, color: 'green' });
      clearChecked();
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({
        title: 'Bulk move failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setBulkApplying(false);
    }
  }

  async function bulkToggleActive(active: boolean) {
    try {
      setBulkApplying(true);
      const updates = [...checkedIds].map((id) => ({ id, is_active: active }));
      await api.batchUpdateProcessingJobs(updates);
      notifications.show({
        title: active ? 'Activated' : 'Deactivated',
        message: `${updates.length} job(s) updated`,
        color: 'green',
      });
      clearChecked();
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({
        title: 'Bulk update failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setBulkApplying(false);
    }
  }

  /* ── Picker modal (shared for profile & group selection) ── */
  const [picker, setPicker] = useState<PickerState | null>(null);

  function openPicker(type: PickerState['type'], jobId: string) {
    const targetIds = checkedIds.size > 0 && checkedIds.has(jobId) ? [...checkedIds] : [jobId];
    const currentJob = jobs.find((j) => j.id === jobId) ?? null;
    const currentValue =
      type === 'profile' ? currentJob?.ai_profile?.id || null : getJobConfig(currentJob).subgroupId || null;
    setPicker({ type, targetIds, value: currentValue });
  }

  function closePicker() {
    setPicker(null);
  }

  async function applyPicker() {
    if (!picker) return;
    const { type, targetIds, value } = picker;
    closePicker();
    if (targetIds.length > 1) {
      if (type === 'profile') await bulkChangeProfile(value);
      else await bulkMoveToGroup(value);
    } else {
      const id = targetIds[0];
      if (!id) return;
      try {
        if (type === 'profile') {
          await api.updateProcessingJob(id, { ai_profile_id: value || null });
          notifications.show({ title: 'Updated', message: 'AI profile changed', color: 'green' });
        } else {
          await api.updateProcessingJob(id, { config: { subgroupId: value || null } });
          notifications.show({ title: 'Moved', message: 'Job moved', color: 'green' });
        }
        await onRefresh();
      } catch (err: unknown) {
        notifications.show({
          title: 'Update failed',
          message: err instanceof Error ? err.message : String(err),
          color: 'red',
        });
      }
    }
  }

  return {
    checkedIds,
    setCheckedIds,
    toggleChecked,
    clearChecked,
    hasChecked,
    bulkApplying,
    bulkChangeProfile,
    bulkMoveToGroup,
    bulkToggleActive,
    picker,
    setPicker,
    openPicker,
    closePicker,
    applyPicker,
  };
}
