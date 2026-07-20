import { Group, Text, SegmentedControl, Button } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import type { TestMode } from './types';

interface Props {
  workflowName: string;
  mode: TestMode;
  onModeChange: (mode: TestMode) => void;
  onReset: () => void;
  onClose?: () => void;
}

export function TestSimulatorHeader({ workflowName, mode, onModeChange, onReset, onClose }: Props) {
  return (
    <Group justify="space-between">
      <Group gap="sm">
        <Text fw={600}>Test: {workflowName}</Text>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => onModeChange(v as TestMode)}
          data={[
            { label: 'Dry Run', value: 'dry' },
            { label: 'Live Run', value: 'live' },
          ]}
        />
      </Group>
      <Group gap="xs">
        <Button variant="light" size="xs" leftSection={<IconRefresh size={14} />} onClick={onReset}>
          Reset
        </Button>
        {onClose && (
          <Button variant="default" size="xs" onClick={onClose}>
            Close
          </Button>
        )}
      </Group>
    </Group>
  );
}
