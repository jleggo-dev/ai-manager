/**
 * Settings → General: configurable per-minute request limits.
 */

import { useState, useEffect } from 'react';
import { Stack, Paper, Text, Group, Button, NumberInput } from '@mantine/core';
import { IconShield } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';

const RATE_LIMIT_FIELDS = [
  {
    key: 'rate_limit_global_rpm',
    label: 'Global',
    description: 'All API endpoints combined',
    min: 10,
    max: 10000,
    step: 10,
    defaultVal: 200,
  },
  {
    key: 'rate_limit_llm_rpm',
    label: 'AI endpoints (per IP)',
    description: 'Chat sessions and AI matcher — per IP address',
    min: 5,
    max: 1000,
    step: 5,
    defaultVal: 30,
  },
  {
    key: 'rate_limit_llm_user_rpm',
    label: 'Per-user AI',
    description: 'AI endpoints per forwarded user (multi-tenant). 0 = off.',
    min: 0,
    max: 200,
    step: 5,
    defaultVal: 15,
  },
  {
    key: 'rate_limit_auth_rpm',
    label: 'Auth endpoints',
    description: 'Login and bootstrap calls',
    min: 5,
    max: 100,
    step: 5,
    defaultVal: 15,
  },
];

export function RateLimitsTab() {
  const [values, setValues] = useState(() => Object.fromEntries(RATE_LIMIT_FIELDS.map((f) => [f.key, f.defaultVal])));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const results = await Promise.all(RATE_LIMIT_FIELDS.map((f) => api.getSettingByKey(f.key).catch(() => null)));
        const loaded: Record<string, number> = {};
        RATE_LIMIT_FIELDS.forEach((f, i) => {
          loaded[f.key] = Number(results[i]?.value?.value) || f.defaultVal;
        });
        setValues(loaded);
      } catch (_err) {
        /* use defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      await Promise.all(
        RATE_LIMIT_FIELDS.map((f) => api.upsertSetting(f.key, { value: values[f.key] }, f.description)),
      );
      notifications.show({
        title: 'Saved',
        message: 'Rate limits updated. Changes take effect within 60 seconds.',
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
              Rate Limits
            </Text>
            <Text size="xs" c="dimmed">
              Maximum requests per minute per IP address. Changes take effect within 60 seconds.
            </Text>
          </div>
          <IconShield size={18} opacity={0.5} />
        </Group>
        <Group align="flex-end" gap="sm" wrap="wrap">
          {RATE_LIMIT_FIELDS.map((f) => (
            <NumberInput
              key={f.key}
              label={`${f.label} (rpm)`}
              description={f.description}
              value={values[f.key]}
              onChange={(val) => setValues((prev) => ({ ...prev, [f.key]: Number(val) || 0 }))}
              min={f.min}
              max={f.max}
              step={f.step}
              disabled={loading}
              style={{ flex: '1 1 160px' }}
            />
          ))}
          <Button onClick={handleSave} loading={saving} disabled={loading} size="sm">
            Save
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
