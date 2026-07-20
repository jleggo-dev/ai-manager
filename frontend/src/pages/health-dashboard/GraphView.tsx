/**
 * Health Dashboard graph view — summary cards, aggregate pie, per-check heatmaps.
 */

import { Stack, SimpleGrid, Paper, Text, Badge, Group, Center, Loader } from '@mantine/core';
import UptimePieChart from '../../components/UptimePieChart';
import UptimeHeatmap from '../../components/UptimeHeatmap';
import { formatOverallUptimePercent, overallUptimePercent } from '../../lib/health-aggregation';
import type { CheckUptimeHistory, UptimeTotals } from '../../types/api';
import type { UnifiedDashboardItem } from './helpers';

interface GraphViewProps {
  items: UnifiedDashboardItem[];
  historyLoading: boolean;
  aggregateTotals: UptimeTotals;
  activeIncidentCount: number;
  sortedHistoryItems: CheckUptimeHistory[];
}

export function GraphView({
  items,
  historyLoading,
  aggregateTotals,
  activeIncidentCount,
  sortedHistoryItems,
}: GraphViewProps) {
  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Total Checks
          </Text>
          <Text size="xl" fw={700}>
            {items.length}
          </Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Overall Uptime
          </Text>
          <Text size="xl" fw={700} c={overallUptimePercent(aggregateTotals) == null ? 'dimmed' : undefined}>
            {formatOverallUptimePercent(aggregateTotals)}
          </Text>
        </Paper>
        <Paper withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            Active Incidents
          </Text>
          <Text size="xl" fw={700} c={activeIncidentCount > 0 ? 'red' : undefined}>
            {activeIncidentCount}
          </Text>
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="lg" radius="md">
        <Text fw={600} mb="md">
          Yearly Run Distribution
        </Text>
        {historyLoading ? (
          <Center py="lg">
            <Loader size="sm" />
          </Center>
        ) : (
          <Center>
            <UptimePieChart totals={aggregateTotals} size={200} />
          </Center>
        )}
      </Paper>

      <Text fw={600}>Per-Check Availability (365 days)</Text>
      {historyLoading ? (
        <Center py="lg">
          <Loader size="sm" />
        </Center>
      ) : sortedHistoryItems.length === 0 ? (
        <Text size="sm" c="dimmed">
          No historical data yet.
        </Text>
      ) : (
        <Stack gap="md">
          {sortedHistoryItems.map((h) => (
            <Paper key={h.checkId} withBorder p="md" radius="md">
              <Group justify="space-between" mb="sm">
                <Group gap="sm">
                  <Text fw={600} size="sm">
                    {h.checkName}
                  </Text>
                </Group>
                <Badge
                  size="sm"
                  variant="light"
                  color={
                    h.uptimePercent == null
                      ? 'gray'
                      : h.uptimePercent >= 99
                        ? 'green'
                        : h.uptimePercent >= 90
                          ? 'yellow'
                          : 'red'
                  }
                >
                  {h.uptimePercent != null ? `${h.uptimePercent}%` : 'N/A'}
                </Badge>
              </Group>
              <UptimeHeatmap dailyStats={h.dailyStats} />
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
