import { Stack, TextInput, Textarea, Select, NumberInput, Switch } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import { CADENCE_OPTIONS, type FormState } from './helpers';

interface HealthCheckEditFormFieldsProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
}

export function HealthCheckEditFormFields({ form, setForm }: HealthCheckEditFormFieldsProps) {
  return (
    <Stack gap="md">
      <TextInput
        label="Name"
        placeholder="e.g. GPT-4 heartbeat"
        value={form.name ?? ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setForm((f) => ({ ...f, name: v }));
        }}
        required
      />
      <Textarea
        label="Test Message"
        placeholder="Message sent to the AI for health verification"
        value={form.test_message ?? ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setForm((f) => ({ ...f, test_message: v }));
        }}
        minRows={2}
        required
      />
      <Select
        label="Cadence"
        data={CADENCE_OPTIONS}
        value={form.cadence_minutes ?? '5'}
        onChange={(val) => setForm((f) => ({ ...f, cadence_minutes: val || '5' }))}
        required
      />
      <NumberInput
        label="Outage Cadence (minutes)"
        description="Accelerated check frequency while an outage is active"
        min={1}
        max={1440}
        value={form.outage_cadence_minutes ?? 2}
        onChange={(val) => setForm((f) => ({ ...f, outage_cadence_minutes: typeof val === 'number' ? val : 2 }))}
      />
      <Switch
        label="Active"
        checked={form.is_active ?? true}
        onChange={(e) => {
          const v = e.currentTarget.checked;
          setForm((f) => ({ ...f, is_active: v }));
        }}
      />
    </Stack>
  );
}
