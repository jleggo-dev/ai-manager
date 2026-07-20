/**
 * Health Dashboard detail cards grid (one card per check).
 */

import {
  SimpleGrid,
  Card,
  Stack,
  Group,
  Text,
  Badge,
  Alert,
  Tooltip,
  ActionIcon,
  Button,
  Collapse,
  Table,
  Code,
} from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay, IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import type { HcRun } from '../../types/api';
import { relativeTime, runStatusColor, SEMAPHORE_HEX, type UnifiedDashboardItem } from './helpers';

interface DetailCardsViewProps {
  items: UnifiedDashboardItem[];
  expanded: Record<string, boolean>;
  runningId: string | null;
  onRunNow: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

export function DetailCardsView({ items, expanded, runningId, onRunNow, onToggleExpand }: DetailCardsViewProps) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
      {items.map((item) => (
        <Card key={item.id} withBorder shadow="sm" padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Group gap="sm" wrap="nowrap">
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    backgroundColor: SEMAPHORE_HEX[item.semaphore] ?? SEMAPHORE_HEX.gray,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <Text fw={600} size="sm" lineClamp={1}>
                    {item.name}
                  </Text>
                  {(item.profileName || item.providerName) && (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {[item.profileName, item.providerName].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </div>
              </Group>
              <Badge size="sm" variant="light" color={item.isActive ? 'green' : 'gray'}>
                {item.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </Group>

            <Group gap="lg">
              <div>
                <Text size="xs" c="dimmed">
                  Last run
                </Text>
                <Text size="sm">{relativeTime(item.lastRunAt)}</Text>
              </div>
              {item.lastRun?.response_time_ms != null && (
                <div>
                  <Text size="xs" c="dimmed">
                    Response
                  </Text>
                  <Text size="sm">{item.lastRun.response_time_ms} ms</Text>
                </div>
              )}
              <div>
                <Text size="xs" c="dimmed">
                  Cadence
                </Text>
                {item.activeIncident ? (
                  <Text size="sm" c="orange" fw={600}>
                    Every {item.outageCadenceMinutes} min (accelerated)
                  </Text>
                ) : (
                  <Text size="sm">Every {item.cadenceMinutes} min</Text>
                )}
              </div>
            </Group>

            {item.activeIncident && (
              <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light" p="xs">
                <Text size="xs">
                  Incident active — {item.activeIncident.failed_run_count} consecutive failures since{' '}
                  {relativeTime(item.activeIncident.started_at)}
                </Text>
              </Alert>
            )}

            <Group justify="space-between">
              <Tooltip label="Run now">
                <ActionIcon
                  variant="light"
                  color="blue"
                  size="sm"
                  aria-label="Run now"
                  loading={runningId === item.id}
                  onClick={() => onRunNow(item.id)}
                >
                  <IconPlayerPlay size={14} />
                </ActionIcon>
              </Tooltip>
              <Button
                variant="subtle"
                size="compact-xs"
                rightSection={expanded[item.id] ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                onClick={() => onToggleExpand(item.id)}
              >
                Recent runs
              </Button>
            </Group>

            <Collapse in={!!expanded[item.id]}>
              {item.recentRuns.length === 0 ? (
                <Text size="xs" c="dimmed">
                  No runs yet
                </Text>
              ) : (
                <Table highlightOnHover style={{ fontSize: 12 }}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Time</Table.Th>
                      <Table.Th>Latency</Table.Th>
                      <Table.Th>Error</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {item.recentRuns.map((run: HcRun) => (
                      <Table.Tr key={run.id}>
                        <Table.Td>
                          <Badge size="xs" variant="light" color={runStatusColor(run.status)}>
                            {run.status}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{relativeTime(run.created_at)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">{run.response_time_ms != null ? `${run.response_time_ms} ms` : '—'}</Text>
                        </Table.Td>
                        <Table.Td>
                          {run.error_message ? (
                            <Code color="red" style={{ fontSize: 10 }}>
                              {run.error_message.slice(0, 60)}
                              {run.error_message.length > 60 ? '…' : ''}
                            </Code>
                          ) : (
                            <Text size="xs" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Collapse>
          </Stack>
        </Card>
      ))}
    </SimpleGrid>
  );
}
