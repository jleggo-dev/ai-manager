export interface KeyFormState {
  provider_id: string;
  name: string;
  api_key: string;
  is_active: boolean;
}

export const EMPTY_FORM: KeyFormState = {
  provider_id: '',
  name: '',
  api_key: '',
  is_active: true,
};
