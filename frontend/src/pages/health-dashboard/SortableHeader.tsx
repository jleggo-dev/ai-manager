/**
 * Sortable table header for the Health Dashboard detail list.
 */

import { Group, Text, Table } from '@mantine/core';
import { IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import type { SortDir, SortField } from './helpers';

export function SortableHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <Table.Th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(field)}>
      <Group gap={4} wrap="nowrap">
        <Text size="xs" fw={active ? 700 : 500}>
          {label}
        </Text>
        {active && (sortDir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}
      </Group>
    </Table.Th>
  );
}
