/**
 * provider-liveness/ProviderLivenessModal
 * ---------------------------------------
 * "Check models answer": runs POST /api/providers/:id/liveness for one provider and shows the
 * report. Opens on the last stored report (if any) and runs a fresh check at once; "Run again"
 * repeats it. The check costs one short completion per distinct model, only when asked.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Center, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconStethoscope } from '@tabler/icons-react';
import LivenessVerdictList from './LivenessVerdictList';
import { useProviderLivenessQuery } from '../../../hooks/useProviderLivenessQuery';
import { providerKeys } from '../../../lib/query-keys';
import * as api from '../../../services/api';
import type { Provider, ProviderLivenessReport } from '../../../types/api';

interface ProviderLivenessModalProps {
  provider: Provider | null;
  opened: boolean;
  onClose: () => void;
}

export default function ProviderLivenessModal({ provider, opened, onClose }: ProviderLivenessModalProps) {
  const providerId = opened ? provider?.id : null;
  const { data: last } = useProviderLivenessQuery(providerId);
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<ProviderLivenessReport | null>(null);

  const run = useCallback(
    async (id: string) => {
      setRunning(true);
      setError(null);
      try {
        const report = await api.runProviderLiveness(id);
        setFresh(report);
        // Every picker reading the last verdict sees the fresh report at once.
        queryClient.setQueryData(providerKeys.liveness(report.provider_id), report);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    },
    [queryClient],
  );

  useEffect(() => {
    if (!providerId) {
      setFresh(null);
      setError(null);
      return;
    }
    void run(providerId);
  }, [providerId, run]);

  const report = fresh ?? last ?? null;

  return (
    <Modal opened={opened} onClose={onClose} title={`Check models answer — ${provider?.name ?? ''}`} size="lg">
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          The catalog is a listing, not a promise. This sends one short completion to every model this provider&apos;s
          active profiles point at (primary and failover) and reports what came back.
        </Text>

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        {running && (
          <Center py="sm">
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm">Asking each model…</Text>
            </Group>
          </Center>
        )}

        {report && !running && <LivenessVerdictList report={report} />}

        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Close
          </Button>
          <Button
            leftSection={<IconStethoscope size={16} />}
            loading={running}
            disabled={!provider}
            onClick={() => provider && run(provider.id)}
          >
            Run again
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
