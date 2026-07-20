import { useState, useEffect, useCallback } from 'react';
import { Stack, Tabs } from '@mantine/core';
import * as api from '../services/api';
import type { HcRun, HcIncident, FailurePatterns } from '../types/api';
import { InvestigationFilterBar } from './investigation/InvestigationFilterBar';
import { InvestigationRunsTab } from './investigation/InvestigationRunsTab';
import { InvestigationIncidentsTab } from './investigation/InvestigationIncidentsTab';
import { InvestigationPatternsTab } from './investigation/InvestigationPatternsTab';

interface InvestigationPanelProps {
  checkId: string;
}

const PAGE_SIZE = 25;

export default function InvestigationPanel({ checkId }: InvestigationPanelProps) {
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [runs, setRuns] = useState<HcRun[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [page, setPage] = useState(1);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const [incidents, setIncidents] = useState<HcIncident[]>([]);
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
      <InvestigationFilterBar
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
      />

      <Tabs defaultValue="runs">
        <Tabs.List>
          <Tabs.Tab value="runs">Run History ({totalRuns})</Tabs.Tab>
          <Tabs.Tab value="incidents">Incidents ({incidents.length})</Tabs.Tab>
          <Tabs.Tab value="patterns">Failure Patterns</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="runs" pt="sm">
          <InvestigationRunsTab
            runs={runs}
            totalRuns={totalRuns}
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            loading={runsLoading}
            error={runsError}
            expandedRunId={expandedRunId}
            onToggleExpand={(id) => setExpandedRunId(expandedRunId === id ? null : id)}
          />
        </Tabs.Panel>

        <Tabs.Panel value="incidents" pt="sm">
          <InvestigationIncidentsTab incidents={incidents} loading={incidentsLoading} error={incidentsError} />
        </Tabs.Panel>

        <Tabs.Panel value="patterns" pt="sm">
          <InvestigationPatternsTab patterns={patterns} loading={patternsLoading} error={patternsError} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
