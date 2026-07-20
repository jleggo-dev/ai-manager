/**
 * Open/close + field helpers for Health Check Profiles form.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { HcProfile } from '../../types/api';
import { EMPTY_PROFILE_FORM, type ProfileFormState } from './profileFormTypes';

export function createProfileFormOpenHandlers(deps: {
  setEditing: (p: HcProfile | null) => void;
  setForm: Dispatch<SetStateAction<ProfileFormState>>;
  setProfileType: Dispatch<SetStateAction<'agent' | 'model'>>;
  resetCatalog: () => void;
  setAdvancedOpen: (v: boolean) => void;
  setManualIdEntry: Dispatch<SetStateAction<boolean>>;
  openForm: () => void;
  closeForm: () => void;
  openDelete: () => void;
  closeDelete: () => void;
  setDeleteTarget: (p: HcProfile | null) => void;
}) {
  const {
    setEditing,
    setForm,
    setProfileType,
    resetCatalog,
    setAdvancedOpen,
    setManualIdEntry,
    openForm,
    closeForm,
    openDelete,
    closeDelete,
    setDeleteTarget,
  } = deps;

  function handleOpenCreate() {
    setEditing(null);
    setForm(EMPTY_PROFILE_FORM);
    setProfileType('agent');
    resetCatalog();
    setAdvancedOpen(false);
    setManualIdEntry(false);
    openForm();
  }

  function handleOpenEdit(profile: HcProfile) {
    setEditing(profile);
    const type = profile.profile_type === 'model' ? 'model' : 'agent';
    setProfileType(type);
    setForm({
      name: profile.name,
      provider_id: profile.provider_id,
      hc_provider_key_id: profile.hc_provider_key_id,
      external_ai_id: profile.external_ai_id,
      mode: profile.mode,
      profile_type: profile.profile_type,
      description: profile.description ?? '',
      is_active: profile.is_active,
    });
    setAdvancedOpen(false);
    setManualIdEntry(false);
    openForm();
  }

  function handleOpenDelete(profile: HcProfile) {
    setDeleteTarget(profile);
    openDelete();
  }

  function handleCloseForm() {
    closeForm();
    setEditing(null);
  }

  function handleCloseDelete() {
    closeDelete();
    setDeleteTarget(null);
  }

  function setField<K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleManualIdEntry() {
    setManualIdEntry((v) => !v);
    setForm((prev) => ({ ...prev, external_ai_id: '' }));
  }

  return {
    handleOpenCreate,
    handleOpenEdit,
    handleOpenDelete,
    handleCloseForm,
    handleCloseDelete,
    setField,
    toggleManualIdEntry,
  };
}
