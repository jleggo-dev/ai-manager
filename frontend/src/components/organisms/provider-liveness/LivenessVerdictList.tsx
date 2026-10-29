/**
 * provider-liveness/LivenessVerdictList
 * -------------------------------------
 * Renders one liveness report: each model with a plain verdict, then every profile that points
 * at this provider, marked when its primary or failover does not answer. Pure: no fetching.
 */
import { Badge, Group, Stack, Table, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { verdictColor, verdictLabel, verdictShort } from '../../../lib/liveness-verdict';
import type { ProfileLiveness, ProfilePointerLiveness, ProviderLivenessReport } from '../../../types/api';

function Pointer({ label, pointer }: { label: string; pointer: ProfilePointerLiveness | null }) {
  if (!pointer) return null;
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <code>{pointer.model}</code>
      <Badge size="xs" variant="light" color={verdictColor(pointer.verdict)}>
        {verdictShort(pointer.verdict)}
      </Badge>
    </Group>
  );
}

function ProfileRow({ profile }: { profile: ProfileLiveness }) {
  return (
    <Table.Tr data-testid={`liveness-profile-${profile.id}`} data-dead={profile.dead ? 'true' : 'false'}>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          {profile.dead && (
            <IconAlertTriangle size={14} color="var(--mantine-color-red-6)" aria-label="does not answer" />
          )}
          <Text size="sm" fw={profile.dead ? 600 : 400} c={profile.dead ? 'red.7' : undefined}>
            {profile.name}
          </Text>
        </Group>
      </Table.Td>
      <Table.Td>
        <Stack gap={2}>
          <Pointer label="primary" pointer={profile.primary} />
          <Pointer label="failover" pointer={profile.failover} />
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
}

export default function LivenessVerdictList({ report }: { report: ProviderLivenessReport }) {
  const dead = report.profiles.filter((p) => p.dead);
  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed">
        Checked {new Date(report.checked_at).toLocaleString()} — one short completion per model, {report.models.length}{' '}
        {report.models.length === 1 ? 'model' : 'models'} in {Math.round(report.duration_ms / 100) / 10}s.
      </Text>

      {report.models.length === 0 ? (
        <Text size="sm">No active profile points at this provider, so there was nothing to check.</Text>
      ) : (
        <Table withTableBorder data-testid="liveness-models">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Model</Table.Th>
              <Table.Th>Verdict</Table.Th>
              <Table.Th>Time</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {report.models.map((m) => (
              <Table.Tr key={m.model} data-testid={`liveness-model-${m.model}`}>
                <Table.Td>
                  <code>{m.model}</code>
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap" align="flex-start">
                    <Badge size="xs" variant="light" color={verdictColor(m.verdict)} style={{ flexShrink: 0 }}>
                      {verdictShort(m.verdict)}
                    </Badge>
                    {verdictLabel(m) !== verdictShort(m.verdict) && <Text size="sm">{verdictLabel(m)}</Text>}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {m.duration_ms} ms
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {report.profiles.length > 0 && (
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Profiles on this provider
            {dead.length > 0 && (
              <Text span c="red.7" fw={600}>
                {' '}
                — {dead.length} {dead.length === 1 ? 'does' : 'do'} not answer
              </Text>
            )}
          </Text>
          <Table withTableBorder data-testid="liveness-profiles">
            <Table.Tbody>
              {report.profiles.map((p) => (
                <ProfileRow key={p.id} profile={p} />
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Stack>
  );
}
