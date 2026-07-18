import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Stack,
  Group,
  Text,
  Badge,
  Button,
  Card,
  SimpleGrid,
  Center,
  Loader,
  Alert,
  Collapse,
  Table,
  ActionIcon,
  Tooltip,
  Code,
  SegmentedControl,
  Paper,
  ThemeIcon,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconHeartRateMonitor,
  IconPlayerPlay,
  IconChevronDown,
  IconChevronUp,
  IconAlertTriangle,
  IconChartPie,
  IconList,
  IconLayoutGrid,
  IconArrowUp,
  IconArrowDown,
} from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import UptimePieChart from '../components/UptimePieChart';
import UptimeHeatmap from '../components/UptimeHeatmap';
import * as api from '../services/api';
import type {
  HcDashboardItem,
  HcRun,
  WidgetHcDashboardItem,
  WidgetHcRun,
  CheckUptimeHistory,
  UptimeTotals,
} from '../types/api';

type UnifiedDashboardItem =
  (HcDashboardItem & { checkType: 'api' }) | (WidgetHcDashboardItem & { checkType: 'widget' });

interface HealthDashboardPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

type ViewMode = 'graph' | 'detail';
type DetailMode = 'cards' | 'list';
type SortField = 'name' | 'type' | 'status' | 'lastRun' | 'latency' | 'cadence';
type SortDir = 'asc' | 'desc';

const SEMAPHORE_HEX: Record<string, string> = {
  green: '#40c057',
  yellow: '#fab005',
  red: '#fa5252',
  gray: '#adb5bd',
};

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function runStatusColor(status: string): string {
  switch (status) {
    case 'pass':
      return 'green';
    case 'warning':
      return 'yellow';
    case 'fail':
      return 'red';
    case 'timeout':
      return 'yellow';
    case 'error':
      return 'red';
    default:
      return 'gray';
  }
}

function truncateUrl(url: string, max = 30): string {
  if (url.length <= max) return url;
  return url.slice(0, max) + '…';
}

function semaphoreOrder(s: string): number {
  switch (s) {
    case 'red':
      return 0;
    case 'yellow':
      return 1;
    case 'green':
      return 2;
    default:
      return 3;
  }
}

/* ── Sortable header helper ──────────────────────────────── */

function SortableHeader({
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

/* ══════════════════════════════════════════════════════════ */

export default function HealthDashboardPage({
  onNavigate: _onNavigate,
  pageParams: _pageParams,
  workspaceRole: _workspaceRole,
}: HealthDashboardPageProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [detailMode, setDetailMode] = useState<DetailMode>('cards');

  const [items, setItems] = useState<UnifiedDashboardItem[]>([]);
  const [uptimeHistory, setUptimeHistory] = useState<CheckUptimeHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [sortField, setSortField] = useState<SortField>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  /* ── Data fetching ──────────────────────────────────────── */

  const fetchDashboard = useCallback(async () => {
    try {
      const [apiRes, widgetRes] = await Promise.allSettled([api.getHcDashboard(), api.getWidgetHcDashboard()]);
      const apiItems: UnifiedDashboardItem[] =
        apiRes.status === 'fulfilled' ? apiRes.value.data.map((i) => ({ ...i, checkType: 'api' as const })) : [];
      const widgetItems: UnifiedDashboardItem[] =
        widgetRes.status === 'fulfilled'
          ? widgetRes.value.data.map((i) => ({ ...i, checkType: 'widget' as const }))
          : [];
      setItems([...apiItems, ...widgetItems]);
    } catch (err) {
      notifications.show({
        title: 'Failed to load dashboard',
        message: err instanceof Error ? err.message : 'Unknown error',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const [apiRes, widgetRes] = await Promise.allSettled([api.getHcUptimeHistory(), api.getWidgetHcUptimeHistory()]);
      const apiData = apiRes.status === 'fulfilled' ? apiRes.value.data : [];
      const widgetData = widgetRes.status === 'fulfilled' ? widgetRes.value.data : [];
      setUptimeHistory([...apiData, ...widgetData]);
    } catch {
      /* silently fail; graph view will show empty state */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    fetchHistory();
    const interval = setInterval(fetchDashboard, 30_000);
    return () => clearInterval(interval);
  }, [fetchDashboard, fetchHistory]);

  /* ── Handlers ───────────────────────────────────────────── */

  const handleRunNow = async (id: string, checkType: 'api' | 'widget') => {
    setRunningId(id);
    try {
      if (checkType === 'widget') await api.runWidgetHcCheck(id);
      else await api.runHcCheck(id);
      notifications.show({ title: 'Health check triggered', message: 'Run started successfully', color: 'green' });
      await fetchDashboard();
    } catch (err) {
      notifications.show({
        title: 'Run failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        color: 'red',
      });
    } finally {
      setRunningId(null);
    }
  };

  const toggleExpand = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  /* ── Derived data ───────────────────────────────────────── */

  const aggregateTotals = useMemo<UptimeTotals>(() => {
    return uptimeHistory.reduce(
      (acc, h) => ({
        pass: acc.pass + h.totals.pass,
        fail: acc.fail + h.totals.fail,
        timeout: acc.timeout + h.totals.timeout,
        error: acc.error + h.totals.error,
        warning: acc.warning + (h.totals.warning ?? 0),
      }),
      { pass: 0, fail: 0, timeout: 0, error: 0, warning: 0 },
    );
  }, [uptimeHistory]);

  const sortedHistoryItems = useMemo(() => {
    return [...uptimeHistory].sort((a, b) => (a.uptimePercent ?? 101) - (b.uptimePercent ?? 101));
  }, [uptimeHistory]);

  const activeIncidentCount = useMemo(() => items.filter((i) => i.activeIncident).length, [items]);

  const sortedItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'type':
          cmp = a.checkType.localeCompare(b.checkType);
          break;
        case 'status':
          cmp = semaphoreOrder(a.semaphore) - semaphoreOrder(b.semaphore);
          break;
        case 'lastRun':
          cmp = (a.lastRunAt ?? '').localeCompare(b.lastRunAt ?? '');
          break;
        case 'latency':
          cmp = (a.lastRun?.response_time_ms ?? 0) - (b.lastRun?.response_time_ms ?? 0);
          break;
        case 'cadence':
          cmp = a.cadenceMinutes - b.cadenceMinutes;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [items, sortField, sortDir]);

  /* ── Loading / empty states ─────────────────────────────── */

  if (loading) {
    return (
      <Stack gap="md">
        <PageHeader title="Health Dashboard" />
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  if (items.length === 0) {
    return (
      <Stack gap="md">
        <PageHeader title="Health Dashboard" />
        <Alert icon={<IconHeartRateMonitor size={18} />} title="No health checks configured" color="blue">
          Configure health checks in Settings to start monitoring your AI profiles and providers.
        </Alert>
      </Stack>
    );
  }

  /* ── Render ─────────────────────────────────────────────── */

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <PageHeader title="Health Dashboard" />
        <SegmentedControl
          value={viewMode}
          onChange={(v) => setViewMode(v as ViewMode)}
          data={[
            {
              value: 'graph',
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconChartPie size={14} />
                  <span>Graph</span>
                </Group>
              ),
            },
            {
              value: 'detail',
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconLayoutGrid size={14} />
                  <span>Detail</span>
                </Group>
              ),
            },
          ]}
        />
      </Group>

      {viewMode === 'graph' ? (
        /* ────── GRAPH VIEW ────────────────────────────────── */
        <Stack gap="lg">
          {/* Summary banner */}
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Total Checks
              </Text>
              <Text size="xl" fw={700}>
                {items.length}
              </Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Overall Uptime
              </Text>
              <Text
                size="xl"
                fw={700}
                c={
                  aggregateTotals.pass + aggregateTotals.fail + aggregateTotals.timeout + aggregateTotals.error === 0
                    ? 'dimmed'
                    : undefined
                }
              >
                {(() => {
                  const total =
                    aggregateTotals.pass + aggregateTotals.fail + aggregateTotals.timeout + aggregateTotals.error;
                  return total > 0
                    ? `${(Math.round((aggregateTotals.pass / total) * 10_000) / 100).toFixed(2)}%`
                    : 'N/A';
                })()}
              </Text>
            </Paper>
            <Paper withBorder p="md" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Active Incidents
              </Text>
              <Text size="xl" fw={700} c={activeIncidentCount > 0 ? 'red' : undefined}>
                {activeIncidentCount}
              </Text>
            </Paper>
          </SimpleGrid>

          {/* Aggregate pie chart */}
          <Paper withBorder p="lg" radius="md">
            <Text fw={600} mb="md">
              Yearly Run Distribution
            </Text>
            {historyLoading ? (
              <Center py="lg">
                <Loader size="sm" />
              </Center>
            ) : (
              <Center>
                <UptimePieChart totals={aggregateTotals} size={200} />
              </Center>
            )}
          </Paper>

          {/* Per-check heatmaps */}
          <Text fw={600}>Per-Check Availability (365 days)</Text>
          {historyLoading ? (
            <Center py="lg">
              <Loader size="sm" />
            </Center>
          ) : sortedHistoryItems.length === 0 ? (
            <Text size="sm" c="dimmed">
              No historical data yet.
            </Text>
          ) : (
            <Stack gap="md">
              {sortedHistoryItems.map((h) => (
                <Paper key={`${h.checkType}-${h.checkId}`} withBorder p="md" radius="md">
                  <Group justify="space-between" mb="sm">
                    <Group gap="sm">
                      <Badge size="xs" variant="outline" color={h.checkType === 'widget' ? 'violet' : 'blue'}>
                        {h.checkType === 'widget' ? 'Widget' : 'API'}
                      </Badge>
                      <Text fw={600} size="sm">
                        {h.checkName}
                      </Text>
                    </Group>
                    <Badge
                      size="sm"
                      variant="light"
                      color={
                        h.uptimePercent == null
                          ? 'gray'
                          : h.uptimePercent >= 99
                            ? 'green'
                            : h.uptimePercent >= 90
                              ? 'yellow'
                              : 'red'
                      }
                    >
                      {h.uptimePercent != null ? `${h.uptimePercent}%` : 'N/A'}
                    </Badge>
                  </Group>
                  <UptimeHeatmap dailyStats={h.dailyStats} />
                </Paper>
              ))}
            </Stack>
          )}
        </Stack>
      ) : (
        /* ────── DETAIL VIEW ───────────────────────────────── */
        <Stack gap="md">
          <Group justify="flex-end">
            <SegmentedControl
              size="xs"
              value={detailMode}
              onChange={(v) => setDetailMode(v as DetailMode)}
              data={[
                {
                  value: 'cards',
                  label: (
                    <Group gap={4} wrap="nowrap">
                      <IconLayoutGrid size={12} />
                      <span>Cards</span>
                    </Group>
                  ),
                },
                {
                  value: 'list',
                  label: (
                    <Group gap={4} wrap="nowrap">
                      <IconList size={12} />
                      <span>List</span>
                    </Group>
                  ),
                },
              ]}
            />
          </Group>

          {detailMode === 'cards' ? (
            /* ── Card grid (original layout) ───────────────── */
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {items.map((item) => (
                <Card key={`${item.checkType}-${item.id}`} withBorder shadow="sm" padding="md" radius="md">
                  <Stack gap="sm">
                    <Badge
                      size="xs"
                      variant="outline"
                      color={item.checkType === 'widget' ? 'violet' : 'blue'}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      {item.checkType === 'widget' ? 'Widget' : 'API'}
                    </Badge>

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
                          {item.checkType === 'api' && (item.profileName || item.providerName) && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {[item.profileName, item.providerName].filter(Boolean).join(' · ')}
                            </Text>
                          )}
                          {item.checkType === 'widget' && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              {truncateUrl(item.url)}
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
                          {item.checkType === 'widget' &&
                            item.lastRun &&
                            'page_load_time_ms' in item.lastRun &&
                            item.lastRun.page_load_time_ms != null && (
                              <Text size="xs" c="dimmed">
                                Page {item.lastRun.page_load_time_ms}ms
                                {' / '}Widget {item.lastRun.widget_load_time_ms ?? '—'}ms
                                {' / '}AI {item.lastRun.ai_response_time_ms ?? '—'}ms
                              </Text>
                            )}
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
                          onClick={() => handleRunNow(item.id, item.checkType)}
                        >
                          <IconPlayerPlay size={14} />
                        </ActionIcon>
                      </Tooltip>
                      <Button
                        variant="subtle"
                        size="compact-xs"
                        rightSection={
                          expanded[`${item.checkType}-${item.id}`] ? (
                            <IconChevronUp size={14} />
                          ) : (
                            <IconChevronDown size={14} />
                          )
                        }
                        onClick={() => toggleExpand(`${item.checkType}-${item.id}`)}
                      >
                        Recent runs
                      </Button>
                    </Group>

                    <Collapse in={!!expanded[`${item.checkType}-${item.id}`]}>
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
                            {item.recentRuns.map((run: HcRun | WidgetHcRun) => (
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
                                  <Text size="xs">
                                    {run.response_time_ms != null ? `${run.response_time_ms} ms` : '—'}
                                  </Text>
                                  {'page_load_time_ms' in run && run.page_load_time_ms != null && (
                                    <Text size="xs" c="dimmed">
                                      P:{run.page_load_time_ms}
                                      {' W:'}
                                      {run.widget_load_time_ms ?? '—'}
                                      {' A:'}
                                      {run.ai_response_time_ms ?? '—'}
                                    </Text>
                                  )}
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
          ) : (
            /* ── List table ────────────────────────────────── */
            <Paper withBorder radius="md" style={{ overflow: 'auto' }}>
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <SortableHeader
                      field="name"
                      label="Name"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      field="type"
                      label="Type"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      field="status"
                      label="Status"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      field="lastRun"
                      label="Last Run"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      field="latency"
                      label="Latency"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      field="cadence"
                      label="Cadence"
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <Table.Th>Incident</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sortedItems.map((item) => (
                    <Table.Tr key={`${item.checkType}-${item.id}`}>
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
                        <Badge size="xs" variant="outline" color={item.checkType === 'widget' ? 'violet' : 'blue'}>
                          {item.checkType === 'widget' ? 'Widget' : 'API'}
                        </Badge>
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
                            onClick={() => handleRunNow(item.id, item.checkType)}
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
          )}
        </Stack>
      )}
    </Stack>
  );
}
