import { Group, Badge, Text, ActionIcon, Box } from '@mantine/core';
import { useDroppable } from '@dnd-kit/core';
import { IconX } from '@tabler/icons-react';
import type { AvailableVariable } from './types';

interface Props {
  jobVarName: string;
  mappedValue: string | undefined;
  availableVars: AvailableVariable[];
  onClear: () => void;
}

export function DropZone({ jobVarName, mappedValue, availableVars, onClear }: Props) {
  const { isOver, setNodeRef } = useDroppable({ id: `drop-${jobVarName}` });
  const sourceVar = mappedValue ? availableVars.find((v) => v.name === mappedValue) : null;

  if (mappedValue) {
    return (
      <Group ref={setNodeRef} gap={4} wrap="nowrap">
        <Badge
          size="lg"
          variant="filled"
          color="green"
          rightSection={
            <ActionIcon
              variant="transparent"
              size="xs"
              c="white"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
            >
              <IconX size={12} />
            </ActionIcon>
          }
          style={{ maxWidth: 180 }}
        >
          <Text size="xs" truncate="end">
            {mappedValue}
          </Text>
        </Badge>
        {sourceVar && (
          <Text size="xs" c="dimmed" truncate="end">
            {sourceVar.source}
          </Text>
        )}
      </Group>
    );
  }

  return (
    <Box
      ref={setNodeRef}
      p="xs"
      style={(theme) => ({
        border: `2px dashed ${isOver ? theme.colors.blue[5] : theme.colors.dark[4]}`,
        borderRadius: theme.radius.sm,
        background: isOver ? theme.colors.dark[5] : 'transparent',
        minHeight: 36,
        display: 'flex',
        alignItems: 'center',
        transition: 'all 150ms ease',
      })}
    >
      <Text size="xs" c="dimmed">
        {isOver ? 'Drop here' : 'Drag variable here'}
      </Text>
    </Box>
  );
}
