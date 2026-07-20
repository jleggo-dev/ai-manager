import {
  Stack,
  Group,
  Text,
  Badge,
  Paper,
  Grid,
  SimpleGrid,
  ScrollArea,
  Divider,
  Box,
  ThemeIcon,
  Center,
  Table,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconChartBar, IconActivity } from '@tabler/icons-react';
import ScoreBadge from '../../atoms/ScoreBadge';
import type { AnalyticsData } from './types';
import { fmtMs } from './analyticsCompute';

export default function AnalyticsScoreCards({
  analytics,
  activeContentFilter,
  contentFieldsSize,
  allSchemaFieldsLength,
}: {
  analytics: AnalyticsData;
  activeContentFilter: Set<string> | null;
  contentFieldsSize: number;
  allSchemaFieldsLength: number;
}) {
  return (
    <>
      {/* ── Score Cards Row ─────────────────────────── */}
      <Grid>
        {/* Content Card */}
        <Grid.Col span={4}>
          <Paper withBorder p="md" h="100%">
            <Stack gap="sm">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="blue">
                  <IconChartBar size={14} />
                </ThemeIcon>
                <Text fw={600} size="sm">
                  Content
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                % of {activeContentFilter ? 'selected' : 'all'} schema fields populated by the AI response.
              </Text>
              <Center>
                <ScoreBadge value={analytics.avgFieldCoverage} label="Field Coverage" />
              </Center>
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Required Fields
                </Text>
                <Text size="xs" fw={500}>
                  {analytics.avgRequiredCoverage != null ? `${analytics.avgRequiredCoverage}%` : '—'}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Fields Scored
                </Text>
                <Text size="xs" fw={500}>
                  {contentFieldsSize} / {allSchemaFieldsLength} selected
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Responses Analyzed
                </Text>
                <Text size="xs" fw={500}>
                  {analytics.validationCount} / {analytics.logCount}
                </Text>
              </Group>
            </Stack>
          </Paper>
        </Grid.Col>

        {/* Speed Card */}
        <Grid.Col span={4}>
          <Paper withBorder p="md" h="100%">
            <Stack gap="sm">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="teal">
                  <IconActivity size={14} />
                </ThemeIcon>
                <Text fw={600} size="sm">
                  Speed
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                LLM response time from the AI provider.
              </Text>
              <Center>
                <Badge
                  size="xl"
                  variant="filled"
                  color={
                    analytics.avgLlm != null
                      ? analytics.avgLlm < 5000
                        ? 'green'
                        : analytics.avgLlm < 15000
                          ? 'yellow'
                          : 'red'
                      : 'gray'
                  }
                >
                  Avg: {fmtMs(analytics.avgLlm)}
                </Badge>
              </Center>
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Fastest
                </Text>
                <Text size="xs" fw={500}>
                  {fmtMs(analytics.minLlm)}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Slowest
                </Text>
                <Text size="xs" fw={500}>
                  {fmtMs(analytics.maxLlm)}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Avg Total (incl. formatting)
                </Text>
                <Text size="xs" fw={500}>
                  {fmtMs(analytics.avgTotal)}
                </Text>
              </Group>
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Avg Prompt Tokens
                </Text>
                <Text size="xs" fw={500}>
                  {analytics.avgPromptTokens?.toLocaleString() ?? '—'}
                </Text>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Avg Completion Tokens
                </Text>
                <Text size="xs" fw={500}>
                  {analytics.avgCompletionTokens?.toLocaleString() ?? '—'}
                </Text>
              </Group>
            </Stack>
          </Paper>
        </Grid.Col>

        {/* Accuracy Card */}
        <Grid.Col span={4}>
          <Paper withBorder p="md" h="100%">
            <Stack gap="sm">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="violet">
                  <IconCheck size={14} />
                </ThemeIcon>
                <Text fw={600} size="sm">
                  Accuracy
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                Structural accuracy: JSON validity, schema conformance, type correctness, and response completion.
              </Text>
              <Center>
                <ScoreBadge value={analytics.accuracyScore} label="Composite" />
              </Center>
              <Divider />
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  JSON Parse Rate
                </Text>
                <Badge
                  size="xs"
                  variant="light"
                  color={
                    (analytics.jsonParseRate ?? 0) >= 90
                      ? 'green'
                      : (analytics.jsonParseRate ?? 0) >= 70
                        ? 'yellow'
                        : 'red'
                  }
                >
                  {analytics.jsonParseRate ?? '—'}%
                </Badge>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Type Conformance
                </Text>
                <Badge
                  size="xs"
                  variant="light"
                  color={
                    (analytics.avgTypeConformance ?? 0) >= 90
                      ? 'green'
                      : (analytics.avgTypeConformance ?? 0) >= 70
                        ? 'yellow'
                        : 'red'
                  }
                >
                  {analytics.avgTypeConformance ?? '—'}%
                </Badge>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Completion Rate (stop)
                </Text>
                <Badge
                  size="xs"
                  variant="light"
                  color={
                    (analytics.completionRate ?? 0) >= 90
                      ? 'green'
                      : (analytics.completionRate ?? 0) >= 70
                        ? 'yellow'
                        : 'red'
                  }
                >
                  {analytics.completionRate ?? '—'}%
                </Badge>
              </Group>
              <Group justify="space-between">
                <Text size="xs" c="dimmed">
                  Error Rate
                </Text>
                <Badge
                  size="xs"
                  variant="light"
                  color={
                    (analytics.errorRate ?? 0) <= 5 ? 'green' : (analytics.errorRate ?? 0) <= 20 ? 'yellow' : 'red'
                  }
                >
                  {analytics.errorRate}%
                </Badge>
              </Group>
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>

      {/* ── Failover Summary Card ────────────────────── */}
      {(analytics.totalFailoverCalls ?? 0) > 0 && (
        <Paper withBorder p="md" style={{ borderLeft: '3px solid var(--mantine-color-orange-5)' }}>
          <Group gap="xs" mb="xs">
            <ThemeIcon size="sm" variant="light" color="orange">
              <IconAlertTriangle size={14} />
            </ThemeIcon>
            <Text fw={600} size="sm" c="orange.7">
              Failover Summary
            </Text>
          </Group>
          <Group gap="xl">
            <Box>
              <Text size="xs" c="dimmed">
                Total Failover Triggers
              </Text>
              <Text size="lg" fw={700} c="orange">
                {analytics.totalFailoverCalls}
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                Failover Rate
              </Text>
              <Badge
                size="md"
                color={
                  (analytics.failoverRate ?? 0) <= 5 ? 'green' : (analytics.failoverRate ?? 0) <= 20 ? 'orange' : 'red'
                }
                variant="light"
              >
                {analytics.failoverRate}%
              </Badge>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                Total Calls
              </Text>
              <Text size="xs" fw={500}>
                {analytics.logCount}
              </Text>
            </Box>
          </Group>
          <Text size="xs" c="dimmed" mt="xs">
            {analytics.totalFailoverCalls} of {analytics.logCount} AI calls required failover to an alternate
            provider/model.
          </Text>
        </Paper>
      )}

      {/* ── Model / Agent Performance Breakdown ───────── */}
      {(analytics.modelBreakdown?.length ?? 0) > 0 && (
        <Paper withBorder p="md">
          <Group justify="space-between" mb="xs">
            <Box>
              <Text fw={600} size="sm">
                Model / Agent Performance (Historical)
              </Text>
              <Text size="xs" c="dimmed">
                Aggregated across {analytics.logCount} diagnostic logs. Use this to compare models/agents used over
                time.
              </Text>
            </Box>
            <Badge variant="light" color="blue" size="sm">
              {analytics.distinctModels} model{analytics.distinctModels === 1 ? '' : 's'}
            </Badge>
          </Group>
          <ScrollArea h={260}>
            <Table striped highlightOnHover withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Provider</Table.Th>
                  <Table.Th>Model / Agent</Table.Th>
                  <Table.Th ta="right">Calls</Table.Th>
                  <Table.Th ta="right">Success</Table.Th>
                  <Table.Th ta="right">Avg LLM</Table.Th>
                  <Table.Th ta="right">Avg Total</Table.Th>
                  <Table.Th ta="right">Failover Calls</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {analytics.modelBreakdown?.map((row) => (
                  <Table.Tr key={`${row.provider}:${row.model}`}>
                    <Table.Td>
                      <Text size="xs">{row.provider}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {row.model}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs">{row.calls}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Badge
                        size="xs"
                        variant="light"
                        color={row.successRate >= 90 ? 'green' : row.successRate >= 70 ? 'yellow' : 'red'}
                      >
                        {row.successRate}%
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs">{fmtMs(row.avgLlmMs)}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs">{fmtMs(row.avgTotalMs)}</Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs">{row.failoverCalls}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      )}

      {/* ── Accuracy Explanation ────────────────────── */}
      <Paper withBorder p="sm">
        <Text size="xs" fw={500} mb={4}>
          How accuracy is measured (AI Manager-only signals)
        </Text>
        <Text size="xs" c="dimmed">
          The composite accuracy score is derived from four levers that require no feedback from calling applications:
        </Text>
        <SimpleGrid cols={2} spacing="xs" mt="xs">
          <Group gap="xs">
            <Badge size="xs" variant="outline" color="blue">
              25%
            </Badge>
            <Text size="xs">
              <strong>JSON Parse Rate</strong> — Can the response be parsed as valid JSON?
            </Text>
          </Group>
          <Group gap="xs">
            <Badge size="xs" variant="outline" color="blue">
              25%
            </Badge>
            <Text size="xs">
              <strong>Required Fields</strong> — Are all required schema fields present and non-null?
            </Text>
          </Group>
          <Group gap="xs">
            <Badge size="xs" variant="outline" color="blue">
              25%
            </Badge>
            <Text size="xs">
              <strong>Type Conformance</strong> — Do fields match expected types (string, array, number)?
            </Text>
          </Group>
          <Group gap="xs">
            <Badge size="xs" variant="outline" color="blue">
              25%
            </Badge>
            <Text size="xs">
              <strong>Completion Rate</strong> — Did the LLM finish normally (not truncated)?
            </Text>
          </Group>
        </SimpleGrid>
      </Paper>
    </>
  );
}
