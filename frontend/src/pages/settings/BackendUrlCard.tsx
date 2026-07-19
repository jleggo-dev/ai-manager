/**
 * Settings → API keys: backend base URL for Edge Function / integration secrets.
 */

import { Stack, Paper, Text, Group, Button, Code, CopyButton } from '@mantine/core';
import { IconCopy, IconCheck } from '@tabler/icons-react';

export function BackendUrlCard() {
  const backendUrl = `${window.location.origin}/_/backend`;

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <div>
            <Text fw={600} size="sm">
              Backend API URL
            </Text>
            <Text size="xs" c="dimmed" maw={640}>
              Use this as <Code>AI_ADMIN_BASE_URL</Code> in your Supabase Edge Function secrets. All API routes are
              relative to this base.
            </Text>
          </div>
        </Group>
        <Group gap="sm">
          <Code block style={{ flex: 1, fontSize: 13, padding: '8px 12px' }}>
            {backendUrl}
          </Code>
          <CopyButton value={backendUrl}>
            {({ copied, copy }) => (
              <Button
                variant="light"
                size="sm"
                leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                color={copied ? 'teal' : undefined}
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Paper>
  );
}
