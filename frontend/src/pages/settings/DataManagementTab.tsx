/**
 * Settings → Data Management: GDPR / CCPA compliance deletion.
 */

import { useState } from 'react';
import { Stack, Paper, Text, Group, Button, Code, TextInput, Select, Modal, Alert } from '@mantine/core';
import { IconDatabase, IconAlertTriangle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import * as api from '../../services/api';

type DeletionScope = 'all' | 'sessions' | 'diagnostic-logs' | 'credentials';

const SCOPE_OPTIONS: { value: DeletionScope; label: string }[] = [
  { value: 'all', label: 'All data (sessions, logs, credentials)' },
  { value: 'sessions', label: 'Chat sessions only' },
  { value: 'diagnostic-logs', label: 'Diagnostic logs only' },
  { value: 'credentials', label: 'Provider credentials only' },
];

export function DataManagementTab() {
  const [userId, setUserId] = useState('');
  const [scope, setScope] = useState<DeletionScope>('all');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  function handleInitiateDelete() {
    const trimmed = userId.trim();
    if (!trimmed) {
      notifications.show({ title: 'Required', message: 'Enter a user ID to proceed.', color: 'yellow' });
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      notifications.show({ title: 'Invalid ID', message: 'User ID must be a valid UUID.', color: 'yellow' });
      return;
    }
    setConfirmText('');
    setConfirmOpen(true);
  }

  async function handleConfirmedDelete() {
    try {
      setDeleting(true);
      const result = await api.deleteUserData(userId.trim(), scope);
      const counts = result.deleted;
      const parts: string[] = [];
      if (counts.sessions != null) parts.push(`${counts.sessions} session(s)`);
      if (counts.diagnosticLogs != null) parts.push(`${counts.diagnosticLogs} log(s)`);
      if (counts.credentials != null) parts.push(`${counts.credentials} credential(s)`);
      notifications.show({
        title: 'Data deleted',
        message: `Removed: ${parts.join(', ') || 'no matching records'}.`,
        color: 'green',
      });
      setConfirmOpen(false);
      setUserId('');
      setConfirmText('');
    } catch (err) {
      notifications.show({
        title: 'Deletion failed',
        message: err instanceof Error ? err.message : 'Request failed',
        color: 'red',
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Stack gap="md">
        <Alert icon={<IconAlertTriangle size={18} />} color="orange" variant="light" title="Compliance Data Deletion">
          <Text size="sm">
            Use this tool to permanently delete a user&apos;s data from this workspace in compliance with GDPR, CCPA, or
            internal data retention policies. This action is <strong>irreversible</strong>.
          </Text>
        </Alert>

        <Paper p="md" withBorder>
          <Stack gap="sm">
            <Group gap="sm">
              <IconDatabase size={20} opacity={0.6} />
              <div>
                <Text fw={600} size="sm">
                  Delete User Data
                </Text>
                <Text size="xs" c="dimmed" maw={640}>
                  Enter the target user&apos;s UUID and select which data to remove. You will be asked to type a
                  confirmation string before deletion proceeds.
                </Text>
              </div>
            </Group>

            <Group align="flex-end" gap="sm" wrap="wrap">
              <TextInput
                label="User ID"
                description="UUID of the user whose data should be deleted"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                style={{ flex: '2 1 300px' }}
              />
              <Select
                label="Scope"
                description="Which data to delete"
                data={SCOPE_OPTIONS}
                value={scope}
                onChange={(v) => setScope((v as DeletionScope) || 'all')}
                style={{ flex: '1 1 220px' }}
              />
              <Button color="red" variant="outline" onClick={handleInitiateDelete} size="sm">
                Delete data…
              </Button>
            </Group>
          </Stack>
        </Paper>
      </Stack>

      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm irreversible deletion" size="md">
        <Stack gap="sm">
          <Text size="sm">
            You are about to permanently delete <strong>{scope === 'all' ? 'all data' : scope}</strong> for user{' '}
            <Code>{userId.trim()}</Code> in this workspace.
          </Text>
          <Text size="sm" c="red" fw={500}>
            This cannot be undone. Type DELETE below to confirm.
          </Text>
          <TextInput
            placeholder="Type DELETE to confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            error={confirmText.length > 0 && confirmText !== 'DELETE' ? 'Must type exactly DELETE' : undefined}
          />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button color="red" onClick={handleConfirmedDelete} loading={deleting} disabled={confirmText !== 'DELETE'}>
              Permanently delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
