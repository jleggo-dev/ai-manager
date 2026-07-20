import { Table, Text, Badge, Center, Loader, Alert } from '@mantine/core';
import type { HcIncident } from '../../types/api';
import { formatTimestampShort } from '../../lib/format';
import { durationStr } from './durationStr';

interface InvestigationIncidentsTabProps {
  incidents: HcIncident[];
  loading: boolean;
  error: string | null;
}

export function InvestigationIncidentsTab({ incidents, loading, error }: InvestigationIncidentsTabProps) {
  if (error) {
    return (
      <Alert color="red" mb="sm">
        {error}
      </Alert>
    );
  }

  if (loading) {
    return (
      <Center py="lg">
        <Loader size="sm" />
      </Center>
    );
  }

  if (incidents.length === 0) {
    return (
      <Text size="sm" c="dimmed" py="md">
        No incidents recorded.
      </Text>
    );
  }

  return (
    <Table highlightOnHover style={{ fontSize: 12 }}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Started</Table.Th>
          <Table.Th>Resolved</Table.Th>
          <Table.Th>Duration</Table.Th>
          <Table.Th>Failures</Table.Th>
          <Table.Th>Last Error</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {incidents.map((inc) => (
          <Table.Tr key={inc.id}>
            <Table.Td>
              <Text size="xs">{formatTimestampShort(inc.started_at)}</Text>
            </Table.Td>
            <Table.Td>
              {inc.resolved_at ? (
                <Text size="xs">{formatTimestampShort(inc.resolved_at)}</Text>
              ) : (
                <Badge size="xs" color="red" variant="filled">
                  Ongoing
                </Badge>
              )}
            </Table.Td>
            <Table.Td>
              <Text size="xs">{durationStr(inc.duration_seconds)}</Text>
            </Table.Td>
            <Table.Td>
              <Badge size="xs" variant="light" color="red">
                {inc.failed_run_count}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Text size="xs" lineClamp={1} style={{ maxWidth: 250 }}>
                {inc.last_error ?? '—'}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
