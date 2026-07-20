/**
 * Health Dashboard — uptime graph + detail cards/list for configured health checks.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Stack, Group, Center, Loader, Alert, SegmentedControl } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHeartRateMonitor, IconChartPie, IconLayoutGrid } from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import { aggregateUptimeTotals, countActiveIncidents, sortHistoryByUptimeAsc } from '../lib/health-aggregation';
import * as api from '../services/api';
import type { CheckUptimeHistory } from '../types/api';
import { GraphView } from './health-dashboard/GraphView';
import { DetailView } from './health-dashboard/DetailView';
import {
  semaphoreOrder,
  type DetailMode,
  type SortDir,
  type SortField,
  type UnifiedDashboardItem,
  type ViewMode,
} from './health-dashboard/helpers';

interface HealthDashboardPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

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

  const fetchDashboard = useCallback(async () => {
    try {
      const apiRes = await api.getHcDashboard();
      setItems(apiRes.data);
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
      const apiRes = await api.getHcUptimeHistory();
      setUptimeHistory(apiRes.data);
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

  const handleRunNow = async (id: string) => {
    setRunningId(id);
    try {
      await api.runHcCheck(id);
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

  const aggregateTotals = useMemo(() => aggregateUptimeTotals(uptimeHistory), [uptimeHistory]);
  const sortedHistoryItems = useMemo(() => sortHistoryByUptimeAsc(uptimeHistory), [uptimeHistory]);
  const activeIncidentCount = useMemo(() => countActiveIncidents(items), [items]);

  const sortedItems = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
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
        <GraphView
          items={items}
          historyLoading={historyLoading}
          aggregateTotals={aggregateTotals}
          activeIncidentCount={activeIncidentCount}
          sortedHistoryItems={sortedHistoryItems}
        />
      ) : (
        <DetailView
          detailMode={detailMode}
          onDetailModeChange={setDetailMode}
          items={items}
          sortedItems={sortedItems}
          expanded={expanded}
          runningId={runningId}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          onRunNow={handleRunNow}
          onToggleExpand={toggleExpand}
        />
      )}
    </Stack>
  );
}
