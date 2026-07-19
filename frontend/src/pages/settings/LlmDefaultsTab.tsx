/**
 * Settings → General: system-wide default LLM timeout.
 */

import { useState, useEffect } from 'react';
import { Stack, Paper, Text, Group, Button, NumberInput } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';

export function LlmDefaultsTab() {
  const [timeoutMs, setTimeoutMs] = useState(300000);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const setting = await api.getSettingByKey('default_llm_timeout_ms');
        if (setting?.value?.value) setTimeoutMs(Number(setting.value.value));
      } catch (_err) {
        /* setting may not exist yet */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      await api.upsertSetting(
        'default_llm_timeout_ms',
        { value: timeoutMs },
        'System-wide default timeout (ms) for LLM completion API calls.',
      );
      notifications.show({
        title: 'Saved',
        message: `Default LLM timeout set to ${(timeoutMs / 1000).toFixed(0)}s`,
        color: 'green',
      });
    } catch (err) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Save failed', color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <div>
            <Text fw={600} size="sm">
              Default LLM Timeout
            </Text>
            <Text size="xs" c="dimmed">
              System-wide timeout for LLM completion calls. Individual providers and processing jobs can override this
              value.
            </Text>
          </div>
          <IconClock size={18} opacity={0.5} />
        </Group>
        <Group align="flex-end" gap="sm">
          <NumberInput
            label="Timeout (ms)"
            description={`${((timeoutMs || 0) / 1000).toFixed(0)} seconds = ${((timeoutMs || 0) / 60000).toFixed(1)} minutes`}
            value={timeoutMs}
            onChange={(val) => setTimeoutMs(Number(val) || 0)}
            min={5000}
            max={600000}
            step={5000}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <Button onClick={handleSave} loading={saving} disabled={loading} size="sm">
            Save
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
