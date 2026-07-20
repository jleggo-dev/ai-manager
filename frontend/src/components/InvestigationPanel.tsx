import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  Stack,
  Group,
  Text,
  Badge,
  Table,
  Tabs,
  Center,
  Loader,
  Chip,
  Code,
  Paper,
  Alert,
  ActionIcon,
  Tooltip,
  Pagination,
  Progress,
  Box,
  CopyButton,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconFilter, IconCopy, IconCheck } from '@tabler/icons-react';
import * as api from '../services/api';
import type { HcRun, HcIncident, FailurePatterns } from '../types/api';
import { CHECK_RUN_STATUS_COLORS } from '../constants/checkRunStatus';
import { formatTimestampShort } from '../lib/format';

interface InvestigationPanelProps {
  checkId: string;
}

type AnyRun = HcRun;
type AnyIncident = HcIncident;

const PAGE_SIZE = 25;

function durationStr(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/* ══════════════════════════════════════════════════════════ */

export default function InvestigationPanel({ checkId }: InvestigationPanelProps) {
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [runs, setRuns] = useState<AnyRun[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [page, setPage] = useState(1);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const [incidents, setIncidents] = useState<AnyIncident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const [patterns, setPatterns] = useState<FailurePatterns | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(true);
  const [patternsError, setPatternsError] = useState<string | null>(null);

  const buildFilterParams = useCallback(() => {
    const params: api.RunFilterParams = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    if (statusFilter.length > 0) params.status = statusFilter.join(',');
    if (dateRange[0]) params.from = dateRange[0].toISOString();
    if (dateRange[1]) params.to = dateRange[1].toISOString();
    return params;
  }, [statusFilter, dateRange, page]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      setRunsLoading(true);
      setRunsError(null);
      try {
        const params = buildFilterParams();
        const res = await api.listHcRunsFiltered(checkId, params);
        if (!cancelled) {
          setRuns(res.data);
          setTotalRuns(res.total);
        }
      } catch (err) {
        if (!cancelled) setRunsError(err instanceof Error ? err.message : 'Failed to load runs');
      } finally {
        if (!cancelled) setRunsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [checkId, buildFilterParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIncidentsLoading(true);
      setIncidentsError(null);
      try {
        const res = await api.listHcIncidents(checkId);
        if (!cancelled) setIncidents(res.data);
      } catch (err) {
        if (!cancelled) setIncidentsError(err instanceof Error ? err.message : 'Failed to load incidents');
      } finally {
        if (!cancelled) setIncidentsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPatternsLoading(true);
      setPatternsError(null);
      try {
        const from = dateRange[0]?.toISOString().slice(0, 10);
        const to = dateRange[1]?.toISOString().slice(0, 10);
        const res = await api.getHcFailurePatterns(checkId, from, to);
        if (!cancelled) setPatterns(res);
      } catch (err) {
        if (!cancelled) setPatternsError(err instanceof Error ? err.message : 'Failed to load patterns');
      } finally {
        if (!cancelled) setPatternsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkId, dateRange]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, dateRange]);

  const totalPages = Math.max(1, Math.ceil(totalRuns / PAGE_SIZE));

  return (
    <Stack gap="md" mt="md">
      {/* ── Filter Bar ──────────────────────────────────── */}
      <Paper withBorder p="sm" radius="md">
        <Group gap="md" align="flex-end" wrap="wrap">
          <Group gap={4}>
            <IconFilter size={14} />
            <Text size="xs" fw={600}>
              Filters
            </Text>
          </Group>
          <Chip.Group multiple value={statusFilter} onChange={setStatusFilter}>
            <Group gap={4}>
              <Chip value="fail" size="xs" color="red" variant="outline">
                Fail
              </Chip>
              <Chip value="timeout" size="xs" color="orange" variant="outline">
                Timeout
              </Chip>
              <Chip value="error" size="xs" color="red" variant="outline">
                Error
              </Chip>
              <Chip value="warning" size="xs" color="yellow" variant="outline">
                Warning
              </Chip>
              <Chip value="pass" size="xs" color="green" variant="outline">
                Pass
              </Chip>
            </Group>
          </Chip.Group>
          <DatePickerInput
            type="range"
            size="xs"
            placeholder="Date range"
            value={dateRange}
            onChange={setDateRange}
            clearable
            maxDate={new Date()}
            style={{ minWidth: 220 }}
          />
        </Group>
      </Paper>

      {/* ── Tabs ────────────────────────────────────────── */}
      <Tabs defaultValue="runs">
        <Tabs.List>
          <Tabs.Tab value="runs">Run History ({totalRuns})</Tabs.Tab>
          <Tabs.Tab value="incidents">Incidents ({incidents.length})</Tabs.Tab>
          <Tabs.Tab value="patterns">Failure Patterns</Tabs.Tab>
        </Tabs.List>

        {/* ── Tab: Run History ──────────────────────────── */}
        <Tabs.Panel value="runs" pt="sm">
          {runsError && (
            <Alert color="red" mb="sm">
              {runsError}
            </Alert>
          )}
          {runsLoading ? (
            <Center py="lg">
              <Loader size="sm" />
            </Center>
          ) : runs.length === 0 && !runsError ? (
            <Text size="sm" c="dimmed" py="md">
              No runs match the current filters.
            </Text>
          ) : (
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
                      <Table.Tr
                        style={{ cursor: 'pointer' }}
                        onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                      >
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
                  <Pagination value={page} onChange={setPage} total={totalPages} size="sm" />
                </Center>
              )}
            </Stack>
          )}
        </Tabs.Panel>

        {/* ── Tab: Incidents ────────────────────────────── */}
        <Tabs.Panel value="incidents" pt="sm">
          {incidentsError && (
            <Alert color="red" mb="sm">
              {incidentsError}
            </Alert>
          )}
          {incidentsLoading ? (
            <Center py="lg">
              <Loader size="sm" />
            </Center>
          ) : incidents.length === 0 && !incidentsError ? (
            <Text size="sm" c="dimmed" py="md">
              No incidents recorded.
            </Text>
          ) : (
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
          )}
        </Tabs.Panel>

        {/* ── Tab: Failure Patterns ─────────────────────── */}
        <Tabs.Panel value="patterns" pt="sm">
          {patternsError && (
            <Alert color="red" mb="sm">
              {patternsError}
            </Alert>
          )}
          {patternsLoading ? (
            <Center py="lg">
              <Loader size="sm" />
            </Center>
          ) : !patterns ||
            (patterns.error_groups.length === 0 && patterns.hourly_distribution.length === 0 && !patternsError) ? (
            <Text size="sm" c="dimmed" py="md">
              No failure patterns detected in the selected range.
            </Text>
          ) : (
            <Stack gap="lg">
              {/* Top Errors */}
              {patterns.error_groups.length > 0 && (
                <Box>
                  <Text fw={600} size="sm" mb="xs">
                    Top Error Messages
                  </Text>
                  <Stack gap={4}>
                    {patterns.error_groups.map((eg, i) => {
                      const maxCount = patterns.error_groups[0]?.count ?? 1;
                      return (
                        <Paper key={i} withBorder p="xs" radius="sm">
                          <Group justify="space-between" mb={4}>
                            <Text size="xs" style={{ flex: 1, wordBreak: 'break-all' }} lineClamp={2}>
                              {eg.error_message}
                            </Text>
                            <Badge size="xs" variant="light" color="red" style={{ flexShrink: 0 }}>
                              {eg.count}x
                            </Badge>
                          </Group>
                          <Progress value={(eg.count / maxCount) * 100} color="red" size="xs" />
                        </Paper>
                      );
                    })}
                  </Stack>
                </Box>
              )}

              {/* Hourly Distribution */}
              {patterns.hourly_distribution.length > 0 && (
                <Box>
                  <Text fw={600} size="sm" mb="xs">
                    Failures by Hour of Day (UTC)
                  </Text>
                  <Group gap={2} align="flex-end" style={{ height: 80 }}>
                    {Array.from({ length: 24 }, (_, h) => {
                      const entry = patterns.hourly_distribution.find((e) => e.hour === h);
                      const count = entry?.count ?? 0;
                      const maxH = Math.max(...patterns.hourly_distribution.map((e) => e.count), 1);
                      const barHeight = count > 0 ? Math.max((count / maxH) * 60, 4) : 2;
                      return (
                        <Tooltip
                          key={h}
                          label={`${String(h).padStart(2, '0')}:00 — ${count} failure${count !== 1 ? 's' : ''}`}
                          fz="xs"
                        >
                          <Box
                            style={{
                              width: 12,
                              height: barHeight,
                              backgroundColor: count > 0 ? '#fa5252' : '#dee2e6',
                              borderRadius: 2,
                            }}
                          />
                        </Tooltip>
                      );
                    })}
                  </Group>
                  <Group gap={2} mt={2}>
                    {[0, 6, 12, 18, 23].map((h) => (
                      <Text key={h} fz={9} c="dimmed" style={{ width: h === 23 ? undefined : `${(6 / 24) * 100}%` }}>
                        {String(h).padStart(2, '0')}
                      </Text>
                    ))}
                  </Group>
                </Box>
              )}
            </Stack>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
