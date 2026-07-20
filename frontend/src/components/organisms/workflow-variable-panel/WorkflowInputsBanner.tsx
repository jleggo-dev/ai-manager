import { Paper, Group, Text, Badge } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import type { WorkflowInputVariable } from '../../../types/api';

interface Props {
  inputVariables: WorkflowInputVariable[];
}

export function WorkflowInputsBanner({ inputVariables }: Props) {
  if (inputVariables.length === 0) return null;

  return (
    <Paper p="xs" withBorder>
      <Text size="xs" fw={600} mb={4}>
        Workflow Inputs (from calling app)
      </Text>
      <Group gap="xs" wrap="wrap">
        {inputVariables
          .filter((v) => (v.name ?? '').trim())
          .map((v) => (
            <Badge key={v.name} size="sm" variant="light" color="blue" leftSection={<IconArrowRight size={10} />}>
              {v.name}
              {v.required ? ' *' : ''}
            </Badge>
          ))}
      </Group>
    </Paper>
  );
}
