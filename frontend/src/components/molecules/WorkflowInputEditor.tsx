/**
 * Molecule – WorkflowInputEditor
 * Edits workflow-level metadata and input variables (the "Application Call" panel).
 */
import {
  Stack,
  Group,
  TextInput,
  Textarea,
  Select,
  Switch,
  Button,
  ActionIcon,
  Text,
  Code,
  Divider,
  Paper,
  Title,
} from '@mantine/core';
import { IconPlus, IconTrash, IconPhoneCall } from '@tabler/icons-react';
import { slugify } from '../../lib/slugify';
import type { WorkflowInputVariable } from '../../types/api';

export interface InputVariableFormItem extends WorkflowInputVariable {
  _uid: string;
}

interface WorkflowFormFields {
  name: string;
  slug: string;
  description: string;
  ai_profile_id: string | null;
  is_active: boolean;
  inputVariables: InputVariableFormItem[];
}

interface Props {
  form: WorkflowFormFields;
  onChange: (updates: Partial<WorkflowFormFields>) => void;
  profileOptions: { value: string; label: string }[];
}

export default function WorkflowInputEditor({ form, onChange, profileOptions }: Props) {
  function uid(): string {
    return crypto.randomUUID();
  }

  function updateVariable(index: number, updates: Partial<InputVariableFormItem>) {
    const updated = [...form.inputVariables];
    const current = updated[index];
    if (!current) return;
    updated[index] = { ...current, ...updates };
    onChange({ inputVariables: updated });
  }

  function removeVariable(index: number) {
    onChange({ inputVariables: form.inputVariables.filter((_, i) => i !== index) });
  }

  function addVariable() {
    onChange({
      inputVariables: [...form.inputVariables, { _uid: uid(), name: '', required: false }],
    });
  }

  return (
    <Stack gap="md">
      <Group gap="sm">
        <IconPhoneCall size={20} opacity={0.6} />
        <Title order={4}>Application Call</Title>
      </Group>
      <Text size="sm" c="dimmed">
        Configure the workflow identity and the variables that calling applications provide when invoking this workflow.
      </Text>

      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Group grow>
            <TextInput
              label="Workflow Name"
              placeholder="Product Launch Planner"
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              required
            />
            <TextInput
              label="Slug"
              placeholder={slugify(form.name) || 'auto-generated'}
              value={form.slug}
              onChange={(e) => onChange({ slug: e.target.value })}
              description="URL-safe identifier"
            />
          </Group>
          <Textarea
            label="Description"
            placeholder="What this workflow does…"
            value={form.description}
            onChange={(e) => onChange({ description: e.target.value })}
            autosize
            minRows={2}
          />
          <Group grow>
            <Select
              label="AI Profile"
              placeholder="Select a profile"
              data={profileOptions}
              value={form.ai_profile_id}
              onChange={(v) => onChange({ ai_profile_id: v })}
              searchable
              clearable
            />
            <Switch
              label="Active"
              checked={form.is_active}
              onChange={(e) => onChange({ is_active: e.currentTarget.checked })}
              mt={24}
            />
          </Group>
        </Stack>
      </Paper>

      <Divider label="Input Variables" labelPosition="center" />

      <Text size="xs" c="dimmed">
        Variables the calling application provides when invoking the workflow. These are available to all steps via
        input mappings. Use <Code style={{ fontSize: 10 }}>{'{{variableName}}'}</Code> syntax in job prompts to
        reference them.
      </Text>

      {form.inputVariables.length === 0 && (
        <Text size="sm" c="dimmed" ta="center" py="sm">
          No input variables defined. Add one to pass data from the calling application into the workflow.
        </Text>
      )}

      {form.inputVariables.map((v, vi) => (
        <Paper key={v._uid} p="xs" withBorder>
          <Group gap="xs" wrap="wrap" align="flex-end">
            <TextInput
              label="Variable name"
              placeholder="product_name"
              value={v.name}
              onChange={(e) => updateVariable(vi, { name: slugify(e.target.value) || e.target.value })}
              size="xs"
              style={{ flex: '1 1 130px' }}
              required
            />
            <TextInput
              label="Label"
              placeholder="Product Name"
              value={v.label || ''}
              onChange={(e) => updateVariable(vi, { label: e.target.value })}
              size="xs"
              style={{ flex: '1 1 130px' }}
            />
            <TextInput
              label="Description"
              placeholder="The name of the product being launched"
              value={v.description || ''}
              onChange={(e) => updateVariable(vi, { description: e.target.value })}
              size="xs"
              style={{ flex: '2 1 200px' }}
            />
            <Switch
              label="Required"
              checked={v.required || false}
              onChange={(e) => updateVariable(vi, { required: e.currentTarget.checked })}
              size="xs"
            />
            <ActionIcon color="red" variant="subtle" size="sm" onClick={() => removeVariable(vi)}>
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        </Paper>
      ))}

      <Button variant="light" size="xs" leftSection={<IconPlus size={12} />} onClick={addVariable}>
        Add Input Variable
      </Button>
    </Stack>
  );
}
