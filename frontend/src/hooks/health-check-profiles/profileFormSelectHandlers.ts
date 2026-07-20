/**
 * Provider/AI/model selection handlers for Health Check Profiles form.
 */

import type { Dispatch, SetStateAction } from 'react';
import { notifications } from '@mantine/notifications';
import type { LlmModel, Provider } from '../../types/api';
import { isModelOnlyProviderType, type ProviderAi } from '../../lib/health-check-profiles';
import type { ProfileFormState } from './profileFormTypes';

export function createProfileFormSelectHandlers(deps: {
  setForm: Dispatch<SetStateAction<ProfileFormState>>;
  profileType: 'agent' | 'model';
  setProfileType: Dispatch<SetStateAction<'agent' | 'model'>>;
  providers: Provider[];
  availableAis: ProviderAi[];
  availableModels: LlmModel[];
}) {
  const { setForm, profileType, setProfileType, providers, availableAis, availableModels } = deps;

  function handleProviderChange(providerId: string | null) {
    const provType = providers.find((p) => p.id === providerId)?.type ?? '';
    if (isModelOnlyProviderType(provType) && profileType !== 'model') {
      setProfileType('model');
      notifications.show({
        title: 'Model-only Provider',
        message: 'Google Gemini profiles use model mode only.',
        color: 'blue',
      });
    }
    setForm((prev) => ({
      ...prev,
      provider_id: providerId ?? '',
      hc_provider_key_id: '',
      external_ai_id: '',
      name: prev.name,
    }));
  }

  function handleProfileTypeChange(value: string) {
    const next = value === 'model' ? 'model' : 'agent';
    setProfileType(next);
    setForm((prev) => ({
      ...prev,
      external_ai_id: '',
      profile_type: next,
      mode: next === 'model' ? 'completion' : prev.mode,
    }));
  }

  function handleAiSelect(value: string | null) {
    const ai = availableAis.find((a) => (a.id || a.aiId) === value);
    setForm((prev) => ({
      ...prev,
      external_ai_id: value ?? '',
      name: prev.name || ai?.name || '',
    }));
  }

  function handleModelSelect(value: string | null) {
    const model = availableModels.find((m) => m.model_id === value);
    setForm((prev) => ({
      ...prev,
      external_ai_id: value ?? '',
      name: prev.name || model?.display_name || '',
    }));
  }

  return {
    handleProviderChange,
    handleProfileTypeChange,
    handleAiSelect,
    handleModelSelect,
  };
}
