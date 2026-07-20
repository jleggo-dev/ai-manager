/**
 * Processing-job Diagnostics tab — log list + detail for the selected job.
 */

import { useState, useEffect, useCallback } from 'react';
import useConfirm from '../../hooks/useConfirm';
import { Stack, Group, Button, Badge, ActionIcon, Tooltip, Alert, Grid, Loader, Center, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import * as api from '../../services/api';
import type { DiagnosticLog, ProcessingJob } from '../../types/api';
import { DiagnosticLogDetail } from './diagnostics/DiagnosticLogDetail';
import { DiagnosticLogList } from './diagnostics/DiagnosticLogList';

interface DiagnosticsConfig {
  enabled?: boolean;
  mode?: string;
}

interface DiagnosticsTabProps {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
}

export default function DiagnosticsTab({ selectedJob, selectedJobFull }: DiagnosticsTabProps) {
  const confirm = useConfirm();
  const [logs, setLogs] = useState<DiagnosticLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<DiagnosticLog | null>(null);

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

  if (!selectedJob) {
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab to view its diagnostic logs.
      </Alert>
    );
  }
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const advanced = selectedJobFull.config?.['advanced'] as { diagnostics?: DiagnosticsConfig } | undefined;
  const diagConfig = advanced?.diagnostics;
  const diagEnabled = diagConfig?.enabled;

  async function handleClearLogs() {
    if (
      !(await confirm({
        title: 'Delete diagnostic logs',
        message: "All diagnostic logs for this job will be permanently removed. This can't be undone.",
      }))
    )
      return;
    try {
      if (!selectedJob) return;
      await api.clearDiagnosticLogs(selectedJob);
      setLogs([]);
      setSelectedLog(null);
      notifications.show({ title: 'Cleared', message: 'Diagnostic logs removed', color: 'orange' });
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>{selectedJobFull.name} — Diagnostic Logs</Title>
        <Group gap="xs">
          <Badge color={diagEnabled ? 'green' : 'gray'} variant="light" size="sm">
            Diagnostics: {diagEnabled ? `${diagConfig.mode}` : 'Off'}
          </Badge>
          <Tooltip label="Refresh logs">
            <ActionIcon variant="subtle" onClick={loadLogs} loading={loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          {logs.length > 0 && (
            <Button size="xs" variant="light" color="red" onClick={handleClearLogs}>
              Clear All Logs
            </Button>
          )}
        </Group>
      </Group>

      {!diagEnabled && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />}>
          Diagnostics are currently disabled for this job. Enable them in the Advanced tab to start logging.
        </Alert>
      )}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : logs.length === 0 ? (
        <Alert variant="light" color="gray">
          No diagnostic logs found.{' '}
          {diagEnabled ? 'Run the processing job to generate logs.' : 'Enable diagnostics in the Advanced tab first.'}
        </Alert>
      ) : (
        <Grid>
          <Grid.Col span={selectedLog ? 4 : 12}>
            <DiagnosticLogList logs={logs} selectedLog={selectedLog} onSelect={setSelectedLog} />
          </Grid.Col>

          {selectedLog && (
            <Grid.Col span={8}>
              <DiagnosticLogDetail log={selectedLog} onClose={() => setSelectedLog(null)} />
            </Grid.Col>
          )}
        </Grid>
      )}
    </Stack>
  );
}
