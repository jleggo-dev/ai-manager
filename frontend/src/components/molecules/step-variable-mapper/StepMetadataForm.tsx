import { Paper, Group, TextInput, Select, Switch } from '@mantine/core';
import { slugify } from '../../../lib/slugify';
import type { ProcessingJob } from '../../../types/api';
import type { StepFormData } from './types';

interface Props {
  step: StepFormData;
  jobs: ProcessingJob[];
  allStepKeys: string[];
  onUpdate: (updates: Partial<StepFormData>) => void;
}

export function StepMetadataForm({ step, jobs, allStepKeys, onUpdate }: Props) {
  const jobOptions = jobs.map((j) => ({ value: j.id, label: `${j.name} (${j.slug})` }));
  const depOptions = allStepKeys.filter((k) => k !== step.step_key).map((k) => ({ value: k, label: k }));

  return (
    <Paper p="md" withBorder>
      <Group gap="sm" wrap="wrap" align="flex-end">
        <TextInput
          label="Step Key"
          placeholder="generate-timeline"
          value={step.step_key}
          onChange={(e) => onUpdate({ step_key: slugify(e.target.value) || e.target.value })}
          style={{ flex: '1 1 160px' }}
          required
        />
        <TextInput
          label="Name"
          placeholder="Generate Timeline"
          value={step.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          style={{ flex: '1 1 200px' }}
          required
        />
        <Select
          label="Processing Job"
          placeholder="Select a job"
          data={jobOptions}
          value={step.processing_job_id}
          onChange={(v) => onUpdate({ processing_job_id: v })}
          searchable
          style={{ flex: '2 1 260px' }}
          required
        />
        <Select
          label="Depends on"
          placeholder="None"
          data={depOptions}
          value={step.depends_on?.[0] || null}
          onChange={(v) => onUpdate({ depends_on: v ? [v] : [] })}
          clearable
          style={{ flex: '1 1 150px' }}
        />
        <Switch
          label="Required"
          checked={step.is_required || false}
          onChange={(e) => onUpdate({ is_required: e.currentTarget.checked })}
          mt={24}
        />
      </Group>
    </Paper>
  );
}
