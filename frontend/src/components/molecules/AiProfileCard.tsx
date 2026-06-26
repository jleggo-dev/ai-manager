import { Card, Group, Text, Badge, ActionIcon, Stack, Tooltip, CopyButton } from '@mantine/core';
import {
  IconTrash,
  IconEdit,
  IconMessageCircle,
  IconStarFilled,
  IconStar,
  IconRobot,
  IconCpu,
  IconArrowsShuffle,
  IconCopy,
  IconCheck,
} from '@tabler/icons-react';
import type { AiProfile } from '../../types/api';

interface AiProfileCardProps {
  profile: AiProfile;
  onEdit: (profile: AiProfile) => void;
  onDelete: (id: string) => void;
  onTestChat?: (profile: AiProfile) => void;
  onToggleDefault?: (id: string, setAsDefault: boolean) => void;
  onConfigureFailover?: (profile: AiProfile) => void;
}

export default function AiProfileCard({
  profile,
  onEdit,
  onDelete,
  onTestChat,
  onToggleDefault,
  onConfigureFailover,
}: AiProfileCardProps) {
  const providerLabel = profile.provider?.name || 'Unknown';
  const providerType = profile.provider?.type || '';
  const isDefault = !!profile.is_default;
  const isModelType = profile.profile_type === 'model';
  const runtimeOptions: Record<string, unknown> =
    profile.runtime_options && typeof profile.runtime_options === 'object' ? profile.runtime_options : {};
  const devsAi = runtimeOptions.devs_ai as Record<string, unknown> | undefined;
  const gemini = runtimeOptions.google_gemini as Record<string, unknown> | undefined;
  const devsAiTools: string[] = Array.isArray(devsAi?.built_in_tools) ? (devsAi.built_in_tools as string[]) : [];
  const citationsEnabled = devsAi?.generate_citations === true;
  const parallelToolsEnabled = devsAi?.parallel_tool_calls === true;
  const geminiGroundingEnabled = gemini?.grounding_with_google_search === true;

  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      style={isDefault ? { borderColor: 'var(--mantine-color-yellow-5)', borderWidth: 2 } : undefined}
    >
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Text fw={600} size="sm">
            {profile.name}
          </Text>
          <Tooltip label={isModelType ? 'Pure LLM model (completions API)' : 'Devs.ai agent'}>
            <Badge
              size="xs"
              variant="light"
              color={isModelType ? 'violet' : 'teal'}
              leftSection={isModelType ? <IconCpu size={10} /> : <IconRobot size={10} />}
            >
              {isModelType ? 'Model' : 'Agent'}
            </Badge>
          </Tooltip>
          <Badge size="xs" variant="light" color={profile.mode === 'chat' ? 'orange' : 'teal'}>
            {profile.mode === 'chat' ? 'Chat' : 'Completion'}
          </Badge>
          <Badge size="xs" variant="light" color={profile.is_active ? 'green' : 'gray'}>
            {profile.is_active ? 'Active' : 'Inactive'}
          </Badge>
          {isDefault && (
            <Badge size="xs" variant="filled" color="yellow" c="dark">
              Default
            </Badge>
          )}
        </Group>
        <Group gap={4}>
          {onToggleDefault && (
            <Tooltip label={isDefault ? 'Remove Default' : 'Set as Default'}>
              <ActionIcon
                variant="subtle"
                color="yellow"
                size="sm"
                onClick={() => onToggleDefault(profile.id, !isDefault)}
              >
                {isDefault ? <IconStarFilled size={14} /> : <IconStar size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
          {onConfigureFailover && (
            <Tooltip label="Configure Failover">
              <ActionIcon variant="subtle" color="orange" size="sm" onClick={() => onConfigureFailover(profile)}>
                <IconArrowsShuffle size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          {onTestChat && (
            <Tooltip label="Test Chat">
              <ActionIcon variant="subtle" color="blue" size="sm" onClick={() => onTestChat(profile)}>
                <IconMessageCircle size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Edit">
            <ActionIcon variant="subtle" size="sm" onClick={() => onEdit(profile)}>
              <IconEdit size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Delete">
            <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDelete(profile.id)}>
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Stack gap={2}>
        <Group gap={4} align="center">
          <Text size="xs" c="dimmed">
            ID:
          </Text>
          <CopyButton value={profile.id}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied!' : 'Copy profile ID'} withArrow>
                <Badge
                  size="xs"
                  variant="dot"
                  color={copied ? 'teal' : 'gray'}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={copy}
                  rightSection={copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
                >
                  {profile.id.slice(0, 8)}…
                </Badge>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
        <Text size="xs" c="dimmed">
          Provider: {providerLabel} ({providerType})
        </Text>
        <Text size="xs" c="dimmed">
          {isModelType ? 'Model ID' : 'External AI ID'}: <code>{profile.external_ai_id}</code>
        </Text>
        {profile.failover_provider && (
          <Text size="xs" c="orange.7" fw={500}>
            Failover: {profile.failover_provider.name} — <code>{profile.failover_external_ai_id}</code>
          </Text>
        )}
        {providerType === 'devs-ai' && (devsAiTools.length > 0 || citationsEnabled || parallelToolsEnabled) && (
          <Text size="xs" c="dimmed">
            Runtime:{' '}
            {[
              devsAiTools.length > 0 ? `tools=${devsAiTools.join(',')}` : null,
              citationsEnabled ? 'citations' : null,
              parallelToolsEnabled ? 'parallel-tools' : null,
            ]
              .filter(Boolean)
              .join(' | ')}
          </Text>
        )}
        {providerType === 'google-gemini' && geminiGroundingEnabled && (
          <Text size="xs" c="dimmed">
            Runtime: grounding-with-google-search
          </Text>
        )}
        {profile.description && (
          <Text size="xs" mt={4}>
            {profile.description}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
