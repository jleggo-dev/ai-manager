import { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  Button,
  Text,
  Switch,
  Loader,
  Center,
  Alert,
  Paper,
  Grid,
  Box,
  Title,
  NumberInput,
  SegmentedControl,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import * as api from '../../../services/api';
import type { ProcessingJob } from '../../../types/api';
import type { AdvancedConfig } from './types';
import { getJobConfig } from './types';

/* ══════════════════════════════════════════════════════════════
   ADVANCED TAB — Diagnostics, timeouts, retries, caching toggles
   ══════════════════════════════════════════════════════════════ */

/** Default advanced configuration values */
const DEFAULT_ADVANCED = {
  diagnostics: { enabled: true, mode: 'always' },
  timeout: { llmTimeoutMs: 0, totalTimeoutMs: 0 },
  retries: { enabled: false, maxRetries: 3, retryDelayMs: 1000 },
  caching: { enabled: false, ttlSeconds: 3600 },
};

export default function AdvancedTab({
  selectedJob,
  selectedJobFull,
  onRefresh,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
  onRefresh: () => Promise<void>;
}) {
  const [advanced, setAdvanced] = useState<AdvancedConfig>(DEFAULT_ADVANCED);
  const [requiresUserCreds, setRequiresUserCreds] = useState(false);
  const [saving, setSaving] = useState(false);

  /* Load advanced config + top-level flags from job when it changes */
  useEffect(() => {
    if (!selectedJobFull) return;
    const cfg = getJobConfig(selectedJobFull).advanced || {};
    setAdvanced({
      diagnostics: { ...DEFAULT_ADVANCED.diagnostics, ...cfg.diagnostics },
      timeout: { ...DEFAULT_ADVANCED.timeout, ...cfg.timeout },
      retries: { ...DEFAULT_ADVANCED.retries, ...cfg.retries },
      caching: { ...DEFAULT_ADVANCED.caching, ...cfg.caching },
    });
    setRequiresUserCreds(selectedJobFull.requires_user_credentials === true);
  }, [selectedJobFull]);

  if (!selectedJob) {
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab first to configure advanced settings.
      </Alert>
    );
  }
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  /** Update a nested key in the advanced config state */
  function updateSection(section: keyof AdvancedConfig, key: string, value: unknown) {
    setAdvanced((prev) => ({
      ...prev,
      [section]: { ...(prev[section] as Record<string, unknown>), [key]: value },
    }));
  }

  async function handleSave() {
    try {
      setSaving(true);
      const config = { ...getJobConfig(selectedJobFull), advanced };
      if (!selectedJob) return;
      await api.updateProcessingJob(selectedJob, { config, requires_user_credentials: requiresUserCreds });
      notifications.show({ title: 'Saved', message: 'Advanced settings updated', color: 'green' });
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="lg">
      <Title order={4}>{selectedJobFull.name} — Advanced Settings</Title>

      {/* ── Credentials ─────────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between">
          <Box>
            <Text fw={600} size="sm">
              Requires personal credentials
            </Text>
            <Text size="xs" c="dimmed">
              When enabled, users must store their own provider API key to run this job. Required for tasks that invoke
              MCP tools scoped to a user&apos;s account (Gmail, Drive, etc.).
            </Text>
          </Box>
          <Switch
            checked={requiresUserCreds}
            onChange={(e) => setRequiresUserCreds(e.currentTarget.checked)}
            label={requiresUserCreds ? 'Required' : 'Shared key'}
          />
        </Group>
      </Paper>

      {/* ── Diagnostics ─────────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Box>
            <Text fw={600} size="sm">
              Diagnostics
            </Text>
            <Text size="xs" c="dimmed">
              Log detailed timing and payload data for each AI call. Useful for debugging and performance monitoring.
            </Text>
          </Box>
          <Switch
            checked={advanced.diagnostics.enabled}
            onChange={(e) => updateSection('diagnostics', 'enabled', e.currentTarget.checked)}
            label={advanced.diagnostics.enabled ? 'Enabled' : 'Disabled'}
          />
        </Group>
        {advanced.diagnostics.enabled && (
          <Box mt="sm">
            <Text size="xs" fw={500} mb={4}>
              Diagnostics Mode
            </Text>
            <SegmentedControl
              size="xs"
              value={advanced.diagnostics.mode}
              onChange={(val) => updateSection('diagnostics', 'mode', val)}
              data={[
                { label: 'One-time (returned, not saved)', value: 'one-time' },
                { label: 'Always (saved to database)', value: 'always' },
              ]}
            />
          </Box>
        )}
      </Paper>

      {/* ── Timeouts ────────────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Box>
            <Text fw={600} size="sm">
              Timeouts
            </Text>
            <Text size="xs" c="dimmed">
              Per-job timeout override for LLM completion calls. Set to 0 to inherit from the provider or system
              default.
            </Text>
          </Box>
        </Group>
        <Grid mt="sm">
          <Grid.Col span={6}>
            <NumberInput
              label="LLM Timeout (ms)"
              description={
                advanced.timeout.llmTimeoutMs > 0
                  ? `${(advanced.timeout.llmTimeoutMs / 1000).toFixed(0)}s — overrides provider and system default`
                  : 'Inherits from provider → system default'
              }
              placeholder="0 = inherit"
              value={advanced.timeout.llmTimeoutMs || ''}
              onChange={(val) => updateSection('timeout', 'llmTimeoutMs', Number(val) || 0)}
              min={0}
              max={600000}
              step={5000}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <Text size="xs" c="dimmed" mt={28}>
              Priority: Job timeout → Provider timeout → System default (Settings page)
            </Text>
          </Grid.Col>
        </Grid>
      </Paper>

      {/* ── Retries ─────────────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Box>
            <Text fw={600} size="sm">
              Retries
            </Text>
            <Text size="xs" c="dimmed">
              Automatically retry failed LLM calls before reporting an error.
            </Text>
          </Box>
          <Switch
            checked={advanced.retries.enabled}
            onChange={(e) => updateSection('retries', 'enabled', e.currentTarget.checked)}
            label={advanced.retries.enabled ? 'Enabled' : 'Disabled'}
          />
        </Group>
        {advanced.retries.enabled && (
          <Grid mt="sm">
            <Grid.Col span={6}>
              <NumberInput
                label="Max Retries"
                description="Number of retry attempts"
                value={advanced.retries.maxRetries}
                onChange={(val) => updateSection('retries', 'maxRetries', val || 3)}
                min={1}
                max={10}
              />
            </Grid.Col>
            <Grid.Col span={6}>
              <NumberInput
                label="Retry Delay (ms)"
                description="Wait time between retries"
                value={advanced.retries.retryDelayMs}
                onChange={(val) => updateSection('retries', 'retryDelayMs', val || 1000)}
                min={100}
                max={30000}
                step={500}
              />
            </Grid.Col>
          </Grid>
        )}
      </Paper>

      {/* ── Response Caching ────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Box>
            <Text fw={600} size="sm">
              Response Caching
            </Text>
            <Text size="xs" c="dimmed">
              Cache AI responses to avoid redundant API calls for identical inputs.
            </Text>
          </Box>
          <Switch
            checked={advanced.caching.enabled}
            onChange={(e) => updateSection('caching', 'enabled', e.currentTarget.checked)}
            label={advanced.caching.enabled ? 'Enabled' : 'Disabled'}
          />
        </Group>
        {advanced.caching.enabled && (
          <Box mt="sm">
            <NumberInput
              label="Cache TTL (seconds)"
              description="How long to keep cached responses"
              value={advanced.caching.ttlSeconds}
              onChange={(val) => updateSection('caching', 'ttlSeconds', val || 3600)}
              min={60}
              max={86400}
              step={300}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {advanced.caching.ttlSeconds >= 3600
                ? `≈ ${(advanced.caching.ttlSeconds / 3600).toFixed(1)} hours`
                : `≈ ${(advanced.caching.ttlSeconds / 60).toFixed(0)} minutes`}
            </Text>
          </Box>
        )}
      </Paper>

      <Group justify="flex-end">
        <Button onClick={handleSave} loading={saving}>
          Save Advanced Settings
        </Button>
      </Group>
    </Stack>
  );
}
