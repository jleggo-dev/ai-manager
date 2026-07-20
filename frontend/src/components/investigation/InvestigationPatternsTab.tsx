import { Stack, Group, Text, Badge, Paper, Center, Loader, Alert, Progress, Box, Tooltip } from '@mantine/core';
import type { FailurePatterns } from '../../types/api';

interface InvestigationPatternsTabProps {
  patterns: FailurePatterns | null;
  loading: boolean;
  error: string | null;
}

export function InvestigationPatternsTab({ patterns, loading, error }: InvestigationPatternsTabProps) {
  if (error) {
    return (
      <Alert color="red" mb="sm">
        {error}
      </Alert>
    );
  }

  if (loading) {
    return (
      <Center py="lg">
        <Loader size="sm" />
      </Center>
    );
  }

  if (!patterns || (patterns.error_groups.length === 0 && patterns.hourly_distribution.length === 0)) {
    return (
      <Text size="sm" c="dimmed" py="md">
        No failure patterns detected in the selected range.
      </Text>
    );
  }

  return (
    <Stack gap="lg">
      {patterns.error_groups.length > 0 && (
        <Box>
          <Text fw={600} size="sm" mb="xs">
            Top Error Messages
          </Text>
          <Stack gap={4}>
            {patterns.error_groups.map((eg, i) => {
              const maxCount = patterns.error_groups[0]?.count ?? 1;
              return (
                <Paper key={i} withBorder p="xs" radius="sm">
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" style={{ flex: 1, wordBreak: 'break-all' }} lineClamp={2}>
                      {eg.error_message}
                    </Text>
                    <Badge size="xs" variant="light" color="red" style={{ flexShrink: 0 }}>
                      {eg.count}x
                    </Badge>
                  </Group>
                  <Progress value={(eg.count / maxCount) * 100} color="red" size="xs" />
                </Paper>
              );
            })}
          </Stack>
        </Box>
      )}

      {patterns.hourly_distribution.length > 0 && (
        <Box>
          <Text fw={600} size="sm" mb="xs">
            Failures by Hour of Day (UTC)
          </Text>
          <Group gap={2} align="flex-end" style={{ height: 80 }}>
            {Array.from({ length: 24 }, (_, h) => {
              const entry = patterns.hourly_distribution.find((e) => e.hour === h);
              const count = entry?.count ?? 0;
              const maxH = Math.max(...patterns.hourly_distribution.map((e) => e.count), 1);
              const barHeight = count > 0 ? Math.max((count / maxH) * 60, 4) : 2;
              return (
                <Tooltip
                  key={h}
                  label={`${String(h).padStart(2, '0')}:00 — ${count} failure${count !== 1 ? 's' : ''}`}
                  fz="xs"
                >
                  <Box
                    style={{
                      width: 12,
                      height: barHeight,
                      backgroundColor: count > 0 ? '#fa5252' : '#dee2e6',
                      borderRadius: 2,
                    }}
                  />
                </Tooltip>
              );
            })}
          </Group>
          <Group gap={2} mt={2}>
            {[0, 6, 12, 18, 23].map((h) => (
              <Text key={h} fz={9} c="dimmed" style={{ width: h === 23 ? undefined : `${(6 / 24) * 100}%` }}>
                {String(h).padStart(2, '0')}
              </Text>
            ))}
          </Group>
        </Box>
      )}
    </Stack>
  );
}
