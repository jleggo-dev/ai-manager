/**
 * Settings → General: API health check and configuration notes.
 */

import { useState, useEffect } from 'react';
import { Stack, Paper, Text, Badge, Group, Button, Code } from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import * as api from '../../services/api';
import type { HealthCheckResult } from '../../types/api';

export function SystemTab() {
  const [health, setHealth] = useState<(HealthCheckResult & { error?: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  async function checkHealth() {
    try {
      setLoading(true);
      const data = await api.healthCheck();
      setHealth(data);
    } catch (err) {
      setHealth({ status: 'error', tables: {}, error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <Stack gap="md">
      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600} size="sm">
              API Health
            </Text>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconRefresh size={14} />}
              onClick={checkHealth}
              loading={loading}
            >
              Refresh
            </Button>
          </Group>
          <Group gap="sm">
            <Text size="sm">Backend Status:</Text>
            <Badge color={health?.status === 'ok' ? 'green' : 'red'} variant="light">
              {health?.status || 'checking...'}
            </Badge>
          </Group>
          {health?.error && <Code color="red">{health.error}</Code>}
        </Stack>
      </Paper>

      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Configuration Notes
          </Text>
          <Text size="sm" c="dimmed">
            LLM model selection is managed through the Admin section:
          </Text>
          <Text size="sm">
            1. Add a <strong>Provider</strong> (e.g. Devs.ai) with your API credentials.
          </Text>
          <Text size="sm">
            2. Create an <strong>AI Profile</strong> that references a specific AI from the provider.
          </Text>
          <Text size="sm">
            3. Create a <strong>Processing Job</strong> (e.g. &quot;Company Profiling&quot;) and assign the AI profile
            to it.
          </Text>
          <Text size="sm" c="dimmed" mt="xs">
            The profiling pipeline will automatically use the AI assigned to the &quot;company-profiling&quot; job. If
            no job is configured, it falls back to the environment variable defaults.
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
