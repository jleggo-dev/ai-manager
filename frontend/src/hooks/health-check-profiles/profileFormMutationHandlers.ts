/**
 * Submit/delete mutations for Health Check Profiles form.
 */

import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';
import type { HcProfile } from '../../types/api';
import type { ProfileFormState } from './profileFormTypes';

export function createProfileFormMutationHandlers(deps: {
  form: ProfileFormState;
  editing: HcProfile | null;
  setEditing: (p: HcProfile | null) => void;
  profileType: 'agent' | 'model';
  isModelOnlyProvider: boolean;
  deleteTarget: HcProfile | null;
  setDeleteTarget: (p: HcProfile | null) => void;
  setSaving: (v: boolean) => void;
  closeForm: () => void;
  closeDelete: () => void;
  loadData: () => Promise<void>;
}) {
  const {
    form,
    editing,
    setEditing,
    profileType,
    isModelOnlyProvider,
    deleteTarget,
    setDeleteTarget,
    setSaving,
    closeForm,
    closeDelete,
    loadData,
  } = deps;

  async function handleSubmit() {
    if (!form.name.trim() || !form.provider_id || !form.hc_provider_key_id || !form.external_ai_id.trim()) {
      notifications.show({ title: 'Validation', message: 'Please fill in all required fields.', color: 'orange' });
      return;
    }

    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        ...form,
        profile_type: isModelOnlyProvider ? 'model' : profileType,
      };
      if (!payload.description) delete payload.description;

      if (editing) {
        await api.updateHcProfile(editing.id, payload);
        notifications.show({ title: 'Updated', message: `${form.name} updated`, color: 'green' });
      } else {
        await api.createHcProfile(payload);
        notifications.show({ title: 'Created', message: `${form.name} created`, color: 'green' });
      }
      closeForm();
      setEditing(null);
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteHcProfile(deleteTarget.id);
      notifications.show({ title: 'Deleted', message: `${deleteTarget.name} removed`, color: 'orange' });
      closeDelete();
      setDeleteTarget(null);
      await loadData();
    } catch (err: unknown) {
      notifications.show({
        title: 'Error',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  return { handleSubmit, handleConfirmDelete };
}
