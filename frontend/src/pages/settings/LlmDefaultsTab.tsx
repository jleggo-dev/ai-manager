/**
 * Settings → General: system-wide LLM defaults — request timeout and tool-result size.
 *
 * Both are the FLOOR of a cascade, not the knob. A provider, a profile, or an individual tool
 * overrides them, and should: one number cannot be right for a tool returning a body weight and a
 * tool returning a week of rows. These exist so nothing is ever unbounded.
 */

import { useState, useEffect } from 'react';
import { Stack, Paper, Text, Group, Button, NumberInput } from '@mantine/core';
import { IconClock, IconRuler2 } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';

export function LlmDefaultsTab() {
  const [timeoutMs, setTimeoutMs] = useState(300000);
  const [toolChars, setToolChars] = useState(32000);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingChars, setSavingChars] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const setting = await api.getSettingByKey('default_llm_timeout_ms');
        if (setting?.value?.value) setTimeoutMs(Number(setting.value.value));
      } catch (_err) {
        /* setting may not exist yet */
      }
      try {
        const setting = await api.getSettingByKey('default_tool_output_chars');
        if (setting?.value?.value) setToolChars(Number(setting.value.value));
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

  async function handleSaveChars() {
    try {
      setSavingChars(true);
      await api.upsertSetting(
        'default_tool_output_chars',
        { value: toolChars },
        'System-wide default cap (characters) on a single tool result. Providers, profiles and individual tools override it.',
      );
      notifications.show({
        title: 'Saved',
        message: `Default tool-output cap set to ${toolChars.toLocaleString()} characters`,
        color: 'green',
      });
    } catch (err) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : 'Save failed', color: 'red' });
    } finally {
      setSavingChars(false);
    }
  }

  return (
    <Stack gap="md">
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

      <Paper p="md" withBorder>
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text fw={600} size="sm">
                Default Tool Output Limit
              </Text>
              <Text size="xs" c="dimmed">
                System-wide cap on a single tool result. Providers, profiles and individual tools override this — it is
                the floor that keeps a result from being unbounded, not the value to tune.
              </Text>
            </div>
            <IconRuler2 size={18} opacity={0.5} />
          </Group>
          <Group align="flex-end" gap="sm">
            <NumberInput
              label="Max characters"
              description={`~${Math.round((toolChars || 0) / 4).toLocaleString()} tokens`}
              value={toolChars}
              onChange={(val) => setToolChars(Number(val) || 0)}
              min={500}
              max={500000}
              step={1000}
              disabled={loading}
              style={{ flex: 1 }}
            />
            <Button onClick={handleSaveChars} loading={savingChars} disabled={loading} size="sm">
              Save
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Over the limit, a JSON result is replaced with a small error object naming the size and limit so the model
            can retry with a narrower query — it is never cut, because half a JSON object is worse than none. Plain text
            is truncated at a line boundary and told that it was.
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
