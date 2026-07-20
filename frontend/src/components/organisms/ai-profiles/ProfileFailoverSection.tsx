/**
 * ai-profiles/ProfileFailoverSection
 * ----------------------------------
 * Optional failover summary + configure entry-point inside the profile form modal.
 * Extracted from ProfileFormModal (FE-14) as a structural, behavior-preserving move.
 */

import { Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconArrowsShuffle } from '@tabler/icons-react';
import type { AiProfile } from '../../../types/api';

interface ProfileFailoverSectionProps {
  editing: AiProfile | null;
  onConfigure: (profile: AiProfile) => void;
}

export default function ProfileFailoverSection({ editing, onConfigure }: ProfileFailoverSectionProps) {
  return (
    <Paper withBorder p="sm" radius="sm" style={{ borderLeft: '3px solid var(--mantine-color-orange-5)' }}>
      <Stack gap="xs">
        <Text size="sm" fw={600} c="orange.7">
          Failover (optional)
        </Text>
        <Text size="xs" c="dimmed">
          Failover activates when the primary model fails or returns empty content.
        </Text>
        {editing?.failover_provider && (
          <Group gap="xs">
            <Badge size="xs" color="orange" variant="light">
              Active
            </Badge>
            <Text size="xs">
              {editing.failover_provider.name} — <code>{editing.failover_external_ai_id}</code>
            </Text>
          </Group>
        )}
        {editing ? (
          <Button
            variant="light"
            color="orange"
            size="xs"
            leftSection={<IconArrowsShuffle size={14} />}
            onClick={() => onConfigure(editing)}
          >
            {editing.failover_provider_id ? 'Edit Failover' : 'Configure Failover'}
          </Button>
        ) : (
          <Text size="xs" c="dimmed" fs="italic">
            Save the profile first, then configure failover.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
