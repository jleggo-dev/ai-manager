import { Modal, Stack, Group, Text, Button, Paper, Badge, Alert } from '@mantine/core';
import { IconAlertTriangle, IconArrowsShuffle, IconTrash } from '@tabler/icons-react';
import type { AiProfile, Provider } from '../../types/api';
import { FailoverPrimarySummary } from './failover-config/FailoverPrimarySummary';
import { FailoverTargetFields } from './failover-config/FailoverTargetFields';
import { FailoverRuntimeOptionsPanel } from './failover-config/FailoverRuntimeOptionsPanel';
import { useFailoverConfigForm } from './failover-config/useFailoverConfigForm';

interface FailoverConfigModalProps {
  opened: boolean;
  onClose: () => void;
  profile: AiProfile | null;
  providers: Provider[];
  onSaved?: () => void;
}

export default function FailoverConfigModal({
  opened,
  onClose,
  profile,
  providers,
  onSaved,
}: FailoverConfigModalProps) {
  const form = useFailoverConfigForm({ opened, profile, providers, onSaved, onClose });

  const primaryProviderName = profile?.provider?.name || 'Unknown';
  const primaryModel = profile?.external_ai_id || 'Unknown';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconArrowsShuffle size={18} color="var(--mantine-color-orange-6)" />
          <Text fw={600} c="orange.7">
            Configure Failover
          </Text>
        </Group>
      }
      size="lg"
      styles={{
        content: { borderTop: '3px solid var(--mantine-color-orange-5)' },
      }}
    >
      <Stack gap="sm">
        <FailoverPrimarySummary providerName={primaryProviderName} modelOrAgent={primaryModel} />

        <Alert variant="light" color="orange" icon={<IconAlertTriangle size={14} />}>
          <Text size="xs">
            Failover activates automatically when the primary model fails or returns empty content. Configure a backup
            provider and agent/model below.
          </Text>
        </Alert>

        <FailoverTargetFields
          isModelOnlyProvider={form.isModelOnlyProvider}
          profileType={form.profileType}
          onProfileTypeChange={form.handleProfileTypeChange}
          providerOptions={form.providerOptions}
          failoverProviderId={form.failoverProviderId}
          onProviderChange={form.handleProviderChange}
          aiOptions={form.aiOptions}
          modelOptions={form.modelOptions}
          failoverAiId={form.failoverAiId}
          onAiIdChange={form.setFailoverAiId}
          loadingAis={form.loadingAis}
        />

        {form.failoverProviderId && (
          <FailoverRuntimeOptionsPanel
            providerType={form.selectedProviderType}
            profileType={form.profileType}
            runtimeOptions={form.runtimeOptions}
            onToggleDevsAiTool={form.toggleDevsAiTool}
            onUpdateDevsAiOption={form.updateDevsAiOption}
            onUpdateGeminiOption={form.updateGeminiOption}
          />
        )}

        {profile?.failover_provider_id && (
          <Paper withBorder p="xs" bg="orange.0">
            <Group gap="xs">
              <Badge size="xs" color="orange" variant="light">
                Current Failover
              </Badge>
              <Text size="xs">
                {profile.failover_provider?.name || 'Unknown provider'} — <code>{profile.failover_external_ai_id}</code>
              </Text>
            </Group>
          </Paper>
        )}

        <Group justify="space-between" mt="sm">
          <Button
            variant="subtle"
            color="red"
            size="xs"
            leftSection={<IconTrash size={14} />}
            onClick={form.handleClear}
            loading={form.saving}
            disabled={!profile?.failover_provider_id}
          >
            Clear Failover
          </Button>
          <Group gap="xs">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button
              color="orange"
              onClick={form.handleSave}
              loading={form.saving}
              disabled={!form.failoverProviderId || !form.failoverAiId}
            >
              Save Failover
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
