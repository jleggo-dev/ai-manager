/**
 * Form state shape for Health Check Profiles create/edit modal.
 */

export interface ProfileFormState {
  name: string;
  provider_id: string;
  hc_provider_key_id: string;
  external_ai_id: string;
  mode: string;
  profile_type: string;
  description: string;
  is_active: boolean;
}

export const EMPTY_PROFILE_FORM: ProfileFormState = {
  name: '',
  provider_id: '',
  hc_provider_key_id: '',
  external_ai_id: '',
  mode: 'completion',
  profile_type: 'agent',
  description: '',
  is_active: true,
};
