import { useState, useEffect, useCallback } from 'react';
import { Stack, Group, Text, Badge, ActionIcon, Tooltip, Loader, Center, Alert, Paper, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconRefresh, IconChartBar } from '@tabler/icons-react';
import * as api from '../../../services/api';
import type { DiagnosticLog, ProcessingJob } from '../../../types/api';
import type { FieldFrequency } from './types';
import { getJobConfig } from './types';
import { computeAnalytics, fmtMs } from './analyticsCompute';
import AnalyticsScoreCards from './AnalyticsScoreCards';
import AnalyticsFieldBreakdown from './AnalyticsFieldBreakdown';

/* ══════════════════════════════════════════════════════════════
   ANALYTICS TAB — Content, Speed, Accuracy metrics
   ══════════════════════════════════════════════════════════════
   Metrics are derived entirely from AI Manager data (diagnostic
   logs + schema validation). No calling-application feedback needed.

   Content  — % of expected schema fields populated in AI responses
   Speed    — LLM response time from diagnostic logs
   Accuracy — JSON validity, schema conformance, finish reason,
              formatting success (reuses the Test Rules validation pattern)
   ══════════════════════════════════════════════════════════════ */

export default function AnalyticsTab({
  selectedJob,
  selectedJobFull,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
}) {
  const [logs, setLogs] = useState<DiagnosticLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  /* Content scoring: which fields are "important" (checked) for the score */
  const [contentFields, setContentFields] = useState<Set<string>>(new Set());
  /* Sort state for field breakdown table */
  const [sortCol, setSortCol] = useState('rate'); /* field | required | count | rate */
  const [sortDir, setSortDir] = useState('asc'); /* asc | desc */

  const loadLogs = useCallback(async () => {
    if (!selectedJob) return;
    try {
      setLoading(true);
      const result = await api.listDiagnosticLogs({ processingJobId: selectedJob, limit: 50 });
      setLogs(result.data);
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [selectedJob]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  /* Initialise contentFields from saved config or default to all fields */
  useEffect(() => {
    if (!selectedJobFull) return;
    const saved = getJobConfig(selectedJobFull).analytics?.contentFields;
    const allFields = Object.keys(getJobConfig(selectedJobFull).expectedSchema?.fields || {});
    if (Array.isArray(saved) && saved.length > 0) {
      setContentFields(new Set(saved));
    } else {
      /* Default: all fields selected */
      setContentFields(new Set(allFields));
    }
  }, [selectedJobFull]);

  if (!selectedJob || !selectedJobFull) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const expectedSchema = getJobConfig(selectedJobFull).expectedSchema || {};
  const allSchemaFields = Object.keys(expectedSchema?.fields || {});

  /* Compute analytics with the current content field selection */
  const activeContentFilter =
    contentFields.size > 0 && contentFields.size < allSchemaFields.length
      ? contentFields
      : null; /* null = all fields */
  const analytics = computeAnalytics(logs, expectedSchema, activeContentFilter);
  const diagEnabled = getJobConfig(selectedJobFull).advanced?.diagnostics?.enabled;
  const aiProfileName = selectedJobFull.ai_profile?.name || 'Not assigned';
  const providerName = selectedJobFull.ai_profile?.provider?.name || 'Unknown';

  /* ── Field selection helpers ────────────────────────── */
  function toggleField(field: string) {
    setContentFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function selectAll() {
    setContentFields(new Set(allSchemaFields));
  }

  function deselectAll() {
    setContentFields(new Set());
  }

  const allSelected = allSchemaFields.length > 0 && contentFields.size === allSchemaFields.length;
  const noneSelected = contentFields.size === 0;

  /* ── Save content field config ─────────────────────── */
  async function saveContentFieldConfig() {
    try {
      setSavingConfig(true);
      const config = {
        ...getJobConfig(selectedJobFull),
        analytics: {
          ...(getJobConfig(selectedJobFull).analytics || {}),
          contentFields: [...contentFields],
        },
      };
      if (!selectedJob) return;
      await api.updateProcessingJob(selectedJob, { config });
      notifications.show({ title: 'Saved', message: 'Content scoring fields saved to job config.', color: 'green' });
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSavingConfig(false);
    }
  }

  /* ── Sorting helpers ───────────────────────────────── */
  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'field' ? 'asc' : 'asc');
    }
  }

  function sortedBreakdown(breakdown: FieldFrequency[]) {
    const sorted = [...breakdown];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'field') cmp = a.field.localeCompare(b.field);
      else if (sortCol === 'required') cmp = (a.required ? 1 : 0) - (b.required ? 1 : 0);
      else if (sortCol === 'count') cmp = a.count - b.count;
      else if (sortCol === 'rate') cmp = a.rate - b.rate;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={4}>{selectedJobFull.name} — Analytics</Title>
        <Group gap="xs">
          <Badge variant="light" color="blue" size="sm">
            AI Profile: {aiProfileName}
          </Badge>
          <Badge variant="light" color="gray" size="sm">
            Provider: {providerName}
          </Badge>
          <Tooltip label="Refresh data">
            <ActionIcon variant="subtle" onClick={loadLogs} loading={loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Enable diagnostics prompt */}
      {!diagEnabled && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm" fw={500}>
            Diagnostics are disabled for this job
          </Text>
          <Text size="xs" c="dimmed">
            Enable diagnostics in the Advanced tab (set mode to &quot;Always&quot;) and run the job a few times to
            collect analytics data. Content and Accuracy metrics require the raw LLM responses stored in diagnostic
            logs.
          </Text>
        </Alert>
      )}

      {!analytics.hasData ? (
        <Alert variant="light" color="gray" icon={<IconChartBar size={16} />}>
          <Text size="sm">
            No diagnostic logs found for this job.{' '}
            {diagEnabled
              ? 'Run the job to start collecting performance data.'
              : 'Enable diagnostics and run the job to start collecting performance data.'}
          </Text>
        </Alert>
      ) : (
        <Stack gap="md">
          <AnalyticsScoreCards
            analytics={analytics}
            activeContentFilter={activeContentFilter}
            contentFieldsSize={contentFields.size}
            allSchemaFieldsLength={allSchemaFields.length}
          />

          <AnalyticsFieldBreakdown
            analytics={analytics}
            contentFields={contentFields}
            allSelected={allSelected}
            noneSelected={noneSelected}
            sortCol={sortCol}
            sortDir={sortDir}
            savingConfig={savingConfig}
            onToggleField={toggleField}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
            onSave={saveContentFieldConfig}
            onSort={handleSort}
            sortedBreakdown={sortedBreakdown}
          />

          {/* ── Recent Response Times ─────────────────── */}
          {(analytics.llmDurations ?? []).length > 0 && (
            <Paper withBorder p="md">
              <Text fw={600} size="sm" mb="sm">
                Recent LLM Response Times
              </Text>
              <Group gap={4} wrap="wrap">
                {(analytics.llmDurations ?? []).slice(0, 25).map((d: number, i: number) => (
                  <Tooltip key={i} label={`Run #${i + 1}: ${fmtMs(d)}`}>
                    <Badge size="sm" variant="light" color={d < 5000 ? 'green' : d < 15000 ? 'yellow' : 'red'}>
                      {fmtMs(d)}
                    </Badge>
                  </Tooltip>
                ))}
              </Group>
            </Paper>
          )}
        </Stack>
      )}
    </Stack>
  );
}
