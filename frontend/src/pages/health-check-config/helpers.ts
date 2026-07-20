export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export const CADENCE_OPTIONS = [
  { value: '1', label: '1 min' },
  { value: '5', label: '5 min' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '60 min' },
];

export interface FormState {
  name: string;
  health_check_profile_id: string;
  test_message: string;
  cadence_minutes: string;
  outage_cadence_minutes: number;
  is_active: boolean;
}

export const EMPTY_FORM: FormState = {
  name: '',
  health_check_profile_id: '',
  test_message: 'Hello, please confirm you are operational.',
  cadence_minutes: '5',
  outage_cadence_minutes: 2,
  is_active: true,
};
