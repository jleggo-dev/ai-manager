/**
 * Molecule – ModelVerdict
 * -----------------------
 * The last liveness verdict for one model on one provider, shown beside the picker that chooses
 * it, so a dead pointer is visible where it gets chosen. Renders nothing until a check has run.
 */
import { Badge, Group, Text } from '@mantine/core';
import { useProviderLivenessQuery } from '../../hooks/useProviderLivenessQuery';
import { isDeadVerdict, verdictColor, verdictLabel, verdictShort } from '../../lib/liveness-verdict';

interface ModelVerdictProps {
  providerId: string | null | undefined;
  model: string | null | undefined;
}

export default function ModelVerdict({ providerId, model }: ModelVerdictProps) {
  const { data: report } = useProviderLivenessQuery(providerId);
  const key = String(model || '').trim();
  if (!report || !key) return null;
  const result = report.models.find((m) => m.model === key);
  const when = new Date(report.checked_at).toLocaleString();

  if (!result) {
    return (
      <Text size="xs" c="dimmed" data-testid="model-verdict" data-verdict="unchecked">
        Not in the last check ({when}) — run &quot;Check models answer&quot; on the provider.
      </Text>
    );
  }

  return (
    <Group gap={6} wrap="nowrap" align="flex-start" data-testid="model-verdict" data-verdict={result.verdict}>
      <Badge size="xs" variant="light" color={verdictColor(result.verdict)} style={{ flexShrink: 0 }}>
        {verdictShort(result.verdict)}
      </Badge>
      <Text size="xs" c={isDeadVerdict(result.verdict) ? 'red.7' : 'dimmed'}>
        {isDeadVerdict(result.verdict) ? `Last check (${when}): ${verdictLabel(result)}` : `Last check ${when}`}
      </Text>
    </Group>
  );
}
