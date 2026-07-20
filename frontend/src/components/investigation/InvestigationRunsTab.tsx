import { Fragment } from 'react';
import {
  Stack,
  Group,
  Text,
  Badge,
  Table,
  Center,
  Loader,
  Code,
  Alert,
  ActionIcon,
  Tooltip,
  Pagination,
  Box,
  CopyButton,
} from '@mantine/core';
import { IconCopy, IconCheck } from '@tabler/icons-react';
import type { HcRun } from '../../types/api';
import { CHECK_RUN_STATUS_COLORS } from '../../constants/checkRunStatus';
import { formatTimestampShort } from '../../lib/format';

interface InvestigationRunsTabProps {
  runs: HcRun[];
  totalRuns: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  loading: boolean;
  error: string | null;
  expandedRunId: string | null;
  onToggleExpand: (runId: string) => void;
}

export function InvestigationRunsTab({
  runs,
  totalRuns: _totalRuns,
  page,
  totalPages,
  onPageChange,
  loading,
  error,
  expandedRunId,
  onToggleExpand,
}: InvestigationRunsTabProps) {
  return (
    <>
      {error && (
        <Alert color="red" mb="sm">
          {error}
        </Alert>
      )}
      {loading ? (
        <Center py="lg">
          <Loader size="sm" />
        </Center>
      ) : runs.length === 0 && !error ? (
        <Text size="sm" c="dimmed" py="md">
          No runs match the current filters.
        </Text>
      ) : runs.length === 0 ? null : (
        <Stack gap="xs">
          <Table highlightOnHover style={{ fontSize: 12 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Status</Table.Th>
                <Table.Th>Timestamp</Table.Th>
                <Table.Th>Latency</Table.Th>
                <Table.Th>Error</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.map((run) => (
                <Fragment key={run.id}>
                  <Table.Tr style={{ cursor: 'pointer' }} onClick={() => onToggleExpand(run.id)}>
                    <Table.Td>
                      <Badge size="xs" variant="filled" color={CHECK_RUN_STATUS_COLORS[run.status] ?? 'gray'}>
                        {run.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={new Date(run.created_at).toISOString()} fz="xs">
                        <Text size="xs">{formatTimestampShort(run.created_at)}</Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{run.response_time_ms != null ? `${run.response_time_ms} ms` : '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" lineClamp={1} style={{ maxWidth: 300 }}>
                        {run.error_message ?? '—'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                  {expandedRunId === run.id && (
                    <Table.Tr key={`${run.id}-detail`}>
                      <Table.Td colSpan={4}>
                        <Stack gap="xs" p="xs">
                          {run.error_message && (
                            <Group gap="xs" align="flex-start">
                              <Text size="xs" fw={600} style={{ flexShrink: 0 }}>
                                Error:
                              </Text>
                              <Code block style={{ fontSize: 11, flex: 1 }}>
                                {run.error_message}
                              </Code>
                              <CopyButton value={run.error_message}>
                                {({ copied, copy }) => (
                                  <ActionIcon size="xs" variant="subtle" onClick={copy}>
                                    {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                                  </ActionIcon>
                                )}
                              </CopyButton>
                            </Group>
                          )}
                          {run.raw_response && (
                            <Box>
                              <Text size="xs" fw={600} mb={2}>
                                Raw Response:
                              </Text>
                              <Code block style={{ fontSize: 11, maxHeight: 150, overflow: 'auto' }}>
                                {run.raw_response}
                              </Code>
                            </Box>
                          )}
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
          {totalPages > 1 && (
            <Center>
              <Pagination value={page} onChange={onPageChange} total={totalPages} size="sm" />
            </Center>
          )}
        </Stack>
      )}
    </>
  );
}
