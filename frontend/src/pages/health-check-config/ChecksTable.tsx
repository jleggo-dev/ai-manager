import { Center, Stack, Text, Table } from '@mantine/core';
import { IconStethoscope } from '@tabler/icons-react';
import type { HcCheck } from '../../types/api';
import { CheckRow } from './CheckRow';

interface ChecksTableProps {
  checks: HcCheck[];
  profileNameMap: Record<string, string>;
  expandedId: string | null;
  onExpand: (checkId: string) => void;
  onEdit: (check: HcCheck) => void;
  onDelete: (check: HcCheck) => void;
  onRunNow: (id: string) => void;
}

export function ChecksTable({
  checks,
  profileNameMap,
  expandedId,
  onExpand,
  onEdit,
  onDelete,
  onRunNow,
}: ChecksTableProps) {
  if (checks.length === 0) {
    return (
      <Center py="xl">
        <Stack align="center" gap="xs">
          <IconStethoscope size={48} color="gray" />
          <Text c="dimmed">No health checks yet. Create a profile to get started.</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th />
          <Table.Th>Name</Table.Th>
          <Table.Th>Profile</Table.Th>
          <Table.Th>Cadence</Table.Th>
          <Table.Th>Last Run</Table.Th>
          <Table.Th>Health</Table.Th>
          <Table.Th>Enabled</Table.Th>
          <Table.Th>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {checks.map((check) => (
          <CheckRow
            key={check.id}
            check={check}
            profileName={profileNameMap[check.health_check_profile_id] || '—'}
            expanded={expandedId === check.id}
            onExpand={() => onExpand(check.id)}
            onEdit={() => onEdit(check)}
            onDelete={() => onDelete(check)}
            onRunNow={() => onRunNow(check.id)}
          />
        ))}
      </Table.Tbody>
    </Table>
  );
}
