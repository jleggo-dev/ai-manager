import { Group, Button, Text, Breadcrumbs, Anchor, ActionIcon, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconDeviceFloppy, IconTestPipe, IconHistory } from '@tabler/icons-react';
import type { NavigateFn } from './types';
import type { Workflow } from '../../types/api';

interface Props {
  onNavigate: NavigateFn;
  isEditing: boolean;
  formName: string;
  saving: boolean;
  existingWorkflow: Workflow | null;
  onViewExecutions: () => void;
  onSave: () => void;
}

export function WorkflowEditorHeader({
  onNavigate,
  isEditing,
  formName,
  saving,
  existingWorkflow,
  onViewExecutions,
  onSave,
}: Props) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="sm">
        <Tooltip label="Back to Workflows">
          <ActionIcon variant="subtle" size="lg" onClick={() => onNavigate('workflows')}>
            <IconArrowLeft size={20} />
          </ActionIcon>
        </Tooltip>
        <Breadcrumbs>
          <Anchor
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('workflows');
            }}
          >
            Workflows
          </Anchor>
          <Text size="sm" fw={600}>
            {isEditing ? formName || 'Edit Workflow' : 'New Workflow'}
          </Text>
        </Breadcrumbs>
      </Group>
      <Group gap="sm">
        <Button
          variant="default"
          leftSection={<IconHistory size={16} />}
          disabled={!isEditing}
          onClick={onViewExecutions}
        >
          Diagnostics
        </Button>
        <Button
          variant="default"
          leftSection={<IconTestPipe size={16} />}
          disabled={!isEditing}
          onClick={() => {
            if (existingWorkflow) {
              onNavigate('workflows', { autoTest: existingWorkflow.id });
            }
          }}
        >
          Test Run
        </Button>
        <Button leftSection={<IconDeviceFloppy size={16} />} loading={saving} onClick={onSave}>
          {isEditing ? 'Save Changes' : 'Create Workflow'}
        </Button>
      </Group>
    </Group>
  );
}
