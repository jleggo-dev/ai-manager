import { Paper, Group, Text, Badge } from '@mantine/core';
import { useDraggable } from '@dnd-kit/core';
import { IconGripVertical } from '@tabler/icons-react';
import type { AvailableVariable } from './types';

export function DraggableVar({ variable }: { variable: AvailableVariable }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `drag-${variable.name}`,
    data: { varName: variable.name },
  });

  return (
    <Paper
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      p="xs"
      withBorder
      style={{
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        userSelect: 'none',
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <IconGripVertical size={14} opacity={0.4} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={600} truncate="end">
            {variable.name}
          </Text>
          <Badge size="xs" variant="light" color="blue">
            {variable.source}
          </Badge>
        </div>
      </Group>
    </Paper>
  );
}
