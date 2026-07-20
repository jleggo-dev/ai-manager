import { Paper, Text, Group } from '@mantine/core';

interface FailoverPrimarySummaryProps {
  providerName: string;
  modelOrAgent: string;
}

export function FailoverPrimarySummary({ providerName, modelOrAgent }: FailoverPrimarySummaryProps) {
  return (
    <Paper withBorder p="xs" bg="gray.0">
      <Text size="xs" fw={600} mb={4}>
        Primary Configuration
      </Text>
      <Group gap="lg">
        <div>
          <Text size="10" c="dimmed">
            Provider
          </Text>
          <Text size="xs" fw={500}>
            {providerName}
          </Text>
        </div>
        <div>
          <Text size="10" c="dimmed">
            Agent / Model
          </Text>
          <Text size="xs" fw={500}>
            <code>{modelOrAgent}</code>
          </Text>
        </div>
      </Group>
    </Paper>
  );
}
