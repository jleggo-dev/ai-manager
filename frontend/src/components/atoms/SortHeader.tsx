import { Table, Group, Text } from '@mantine/core';
import { IconArrowUp, IconArrowDown, IconSelector } from '@tabler/icons-react';

interface SortHeaderProps {
  col: string;
  label: string;
  width?: number;
  active: boolean;
  sortDir: string;
  onSort: (col: string) => void;
}

/** Clickable, sortable table header cell with an asc/desc/inactive indicator icon. */
export default function SortHeader({ col, label, width, active, sortDir, onSort }: SortHeaderProps) {
  return (
    <Table.Th style={{ width, cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(col)}>
      <Group gap={4} wrap="nowrap">
        <Text size="xs" fw={600}>
          {label}
        </Text>
        {active ? (
          sortDir === 'asc' ? (
            <IconArrowUp size={12} />
          ) : (
            <IconArrowDown size={12} />
          )
        ) : (
          <IconSelector size={12} color="var(--mantine-color-gray-4)" />
        )}
      </Group>
    </Table.Th>
  );
}
