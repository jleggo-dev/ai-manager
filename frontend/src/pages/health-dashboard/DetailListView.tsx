/**
 * Health Dashboard detail list table (sortable columns).
 */

import { Paper, Table, Group, Text, Badge, Tooltip, ThemeIcon, ActionIcon } from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay } from '@tabler/icons-react';
import { SortableHeader } from './SortableHeader';
import { relativeTime, SEMAPHORE_HEX, type SortDir, type SortField, type UnifiedDashboardItem } from './helpers';

interface DetailListViewProps {
  sortedItems: UnifiedDashboardItem[];
  sortField: SortField;
  sortDir: SortDir;
  runningId: string | null;
  onSort: (field: SortField) => void;
  onRunNow: (id: string) => void;
}

export function DetailListView({ sortedItems, sortField, sortDir, runningId, onSort, onRunNow }: DetailListViewProps) {
  return (
    <Paper withBorder radius="md" style={{ overflow: 'auto' }}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableHeader field="name" label="Name" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <SortableHeader field="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <SortableHeader field="lastRun" label="Last Run" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <SortableHeader field="latency" label="Latency" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <SortableHeader field="cadence" label="Cadence" sortField={sortField} sortDir={sortDir} onSort={onSort} />
            <Table.Th>Incident</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sortedItems.map((item) => (
            <Table.Tr key={item.id}>
              <Table.Td>
                <Group gap="sm" wrap="nowrap">
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: SEMAPHORE_HEX[item.semaphore] ?? SEMAPHORE_HEX.gray,
                      flexShrink: 0,
                    }}
                  />
                  <Text size="sm" lineClamp={1}>
                    {item.name}
                  </Text>
                </Group>
              </Table.Td>
              <Table.Td>
                <Badge size="xs" variant="light" color={item.isActive ? 'green' : 'gray'}>
                  {item.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{relativeTime(item.lastRunAt)}</Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs">
                  {item.lastRun?.response_time_ms != null ? `${item.lastRun.response_time_ms} ms` : '—'}
                </Text>
              </Table.Td>
              <Table.Td>
                {item.activeIncident ? (
                  <Text size="xs" c="orange" fw={600}>
                    Every {item.outageCadenceMinutes}m
                  </Text>
                ) : (
                  <Text size="xs">Every {item.cadenceMinutes}m</Text>
                )}
              </Table.Td>
              <Table.Td>
                {item.activeIncident ? (
                  <Tooltip
                    label={`${item.activeIncident.failed_run_count} failures since ${relativeTime(item.activeIncident.started_at)}`}
                  >
                    <ThemeIcon size="sm" variant="light" color="red">
                      <IconAlertTriangle size={12} />
                    </ThemeIcon>
                  </Tooltip>
                ) : (
                  <Text size="xs" c="dimmed">
                    —
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Tooltip label="Run now">
                  <ActionIcon
                    variant="light"
                    color="blue"
                    size="sm"
                    loading={runningId === item.id}
                    onClick={() => onRunNow(item.id)}
                  >
                    <IconPlayerPlay size={14} />
                  </ActionIcon>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
