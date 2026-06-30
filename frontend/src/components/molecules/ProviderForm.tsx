import { TextInput, Select, Switch, Button, Group, Stack, NumberInput, Text } from '@mantine/core';
import { useState, FormEvent } from 'react';
import type { Provider } from '../../types/api';

const PROVIDER_TYPES = [
  { value: 'devs-ai', label: 'Devs.ai (API v1)' },
  { value: 'devs-ai-v2', label: 'Devs.ai (API v2)' },
  { value: 'google-gemini', label: 'Google Gemini' },
];

const DEFAULT_BASE_URL_BY_TYPE: Record<string, string> = {
  'devs-ai': 'https://devs.ai',
  'devs-ai-v2': 'https://devs.ai',
  'google-gemini': 'https://generativelanguage.googleapis.com',
};

interface ProviderFormData {
  name: string;
  type: string;
  base_url: string;
  api_key: string;
  is_active: boolean;
  request_timeout_ms: number | null;
}

interface ProviderFormProps {
  initial?: Partial<Provider>;
  onSubmit: (data: Record<string, unknown>) => void;
  onCancel?: () => void;
  loading?: boolean;
}

export default function ProviderForm({ initial, onSubmit, onCancel, loading }: ProviderFormProps) {
  const [form, setForm] = useState<ProviderFormData>(() => ({
    name: initial?.name || '',
    type: initial?.type || 'devs-ai',
    base_url: initial?.base_url || DEFAULT_BASE_URL_BY_TYPE[initial?.type || 'devs-ai'] || '',
    api_key: '',
    is_active: initial?.is_active !== false,
    request_timeout_ms: initial?.request_timeout_ms || null,
  }));

  function updateField(key: keyof ProviderFormData, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleTypeChange(type: string | null) {
    if (!type) return;
    setForm((prev) => {
      const currentDefault = DEFAULT_BASE_URL_BY_TYPE[prev.type] || '';
      const nextDefault = DEFAULT_BASE_URL_BY_TYPE[type] || '';
      const shouldReplaceBase = !prev.base_url || prev.base_url === currentDefault;
      return {
        ...prev,
        type,
        base_url: shouldReplaceBase ? nextDefault : prev.base_url,
      };
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { ...form };
    if (!payload.api_key && initial) delete payload.api_key;
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="sm">
        <TextInput
          label="Provider Name"
          placeholder="e.g. Devs.ai Corporate"
          value={form.name}
          onChange={(e) => updateField('name', e.target.value)}
          required
        />
        <Select label="Type" data={PROVIDER_TYPES} value={form.type} onChange={(val) => handleTypeChange(val)} />
        <TextInput
          label="Base URL"
          placeholder="https://devs.ai"
          value={form.base_url}
          onChange={(e) => updateField('base_url', e.target.value)}
          required
        />
        <TextInput
          label={initial ? 'API Key (leave blank to keep current)' : 'API Key'}
          placeholder={form.type === 'google-gemini' ? 'AIza...' : 'sk-...'}
          value={form.api_key}
          onChange={(e) => updateField('api_key', e.target.value)}
          required={!initial}
        />
        <NumberInput
          label="Request Timeout (ms)"
          description={
            form.request_timeout_ms
              ? `${(form.request_timeout_ms / 1000).toFixed(0)}s — overrides the system default for all jobs using this provider`
              : 'Leave empty to use the system default timeout'
          }
          placeholder="e.g. 300000 (5 min)"
          value={form.request_timeout_ms || ''}
          onChange={(val) => updateField('request_timeout_ms', val ? Number(val) : null)}
          min={5000}
          max={600000}
          step={5000}
        />
        {form.request_timeout_ms && form.request_timeout_ms > 0 && (
          <Text size="xs" c="dimmed">
            {(form.request_timeout_ms / 60000).toFixed(1)} minutes
          </Text>
        )}
        <Switch
          label="Active"
          checked={form.is_active}
          onChange={(e) => updateField('is_active', e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          {onCancel && (
            <Button variant="subtle" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" loading={loading}>
            {initial ? 'Update' : 'Create'} Provider
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
