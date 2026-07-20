import { Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import type { SessionSortDir, SessionSortField } from './types';

interface Props {
  label: string;
  field: SessionSortField;
  sortField: SessionSortField;
  sortDir: SessionSortDir;
  onSort: (field: SessionSortField) => void;
}

export function SortableHeader({ label, field, sortField, sortDir, onSort }: Props) {
  const active = sortField === field;
  const Icon = active ? (sortDir === 'asc' ? IconChevronUp : IconChevronDown) : IconSelector;

  return (
    <UnstyledButton onClick={() => onSort(field)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Text size="xs" fw={600}>
        {label}
      </Text>
      <Icon size={14} style={{ opacity: active ? 1 : 0.4 }} />
    </UnstyledButton>
  );
}
