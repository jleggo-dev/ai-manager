import { Group, Text, Button, ActionIcon, Tooltip, Alert, Center, Loader } from '@mantine/core';
import { IconPlus, IconLayoutGrid, IconList, IconAlertCircle } from '@tabler/icons-react';
import type { NavigateFn, ViewMode } from './types';

interface Props {
  workflowCount: number;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onNavigate?: NavigateFn;
}

export function WorkflowManagerToolbar({ workflowCount, viewMode, onViewModeChange, onNavigate }: Props) {
  return (
    <Group justify="space-between">
      <Text size="sm" c="dimmed">
        {workflowCount} workflow{workflowCount !== 1 ? 's' : ''}
      </Text>
      <Group gap="xs">
        <Tooltip label="Card view">
          <ActionIcon variant={viewMode === 'card' ? 'filled' : 'subtle'} onClick={() => onViewModeChange('card')}>
            <IconLayoutGrid size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="List view">
          <ActionIcon variant={viewMode === 'list' ? 'filled' : 'subtle'} onClick={() => onViewModeChange('list')}>
            <IconList size={16} />
          </ActionIcon>
        </Tooltip>
        <Button leftSection={<IconPlus size={16} />} onClick={() => onNavigate?.('workflow-editor', {})}>
          New Workflow
        </Button>
      </Group>
    </Group>
  );
}

export function WorkflowManagerEmptyState() {
  return (
    <Alert icon={<IconAlertCircle size={18} />} color="blue" variant="light">
      No workflows yet. Create one to group processing jobs into multi-step chat flows.
    </Alert>
  );
}

export function WorkflowManagerLoadingState() {
  return (
    <Center p="xl">
      <Loader />
    </Center>
  );
}
