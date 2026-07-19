/**
 * AI Matcher comparison summary table + per-slot result cards.
 * Extracted from AiMatcherPage.tsx (FE-03) to keep the page under max-lines.
 */

import { Stack, Group, Paper, Text, Title, Badge, SimpleGrid, Loader, Table, ScrollArea } from '@mantine/core';
import type { AiMatcherSlotResult, ExpectedSchema } from '../../../types/api';
import { SLOT_COLORS, SLOT_LABELS, fastestSuccessDuration, validateSchema } from '../../../lib/ai-matcher';
import { ResultCard } from './ResultCard';

export interface MatcherResultsSectionProps {
  results: (AiMatcherSlotResult | null)[];
  expectedSchema: ExpectedSchema | null;
}

export function MatcherResultsSection({ results, expectedSchema }: MatcherResultsSectionProps) {
  if (!results.some((r) => r !== null)) return null;

  const fastest = fastestSuccessDuration(results);

  return (
    <Stack gap="md">
      <Title order={5}>Results</Title>

      <Paper withBorder p="xs" radius="md">
        <ScrollArea>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Slot</Table.Th>
                <Table.Th>Provider / Model</Table.Th>
                <Table.Th>Duration</Table.Th>
                <Table.Th>Tokens</Table.Th>
                {expectedSchema && <Table.Th>Fields</Table.Th>}
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {results.map((r, i) => {
                if (r === null) {
                  return (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <Badge color={SLOT_COLORS[i]} variant="filled" size="xs">
                          {SLOT_LABELS[i]}
                        </Badge>
                      </Table.Td>
                      <Table.Td colSpan={expectedSchema ? 5 : 4}>
                        <Group gap={6}>
                          <Loader size={12} />
                          <Text size="xs" c="dimmed">
                            Running...
                          </Text>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                }
                const schema =
                  r.status === 'success' && expectedSchema
                    ? validateSchema(r.formatted ?? r.raw ?? '', expectedSchema)
                    : null;
                const isFastest = r.status === 'success' && r.durationMs === fastest;
                return (
                  <Table.Tr key={i} bg={isFastest ? 'var(--mantine-color-green-0)' : undefined}>
                    <Table.Td>
                      <Badge color={SLOT_COLORS[i]} variant="filled" size="xs">
                        {SLOT_LABELS[i]}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" lineClamp={1}>
                        {r.provider || '—'} / {r.model || '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Text size="xs" fw={isFastest ? 700 : 400}>
                          {r.durationMs != null ? `${r.durationMs}ms` : '—'}
                        </Text>
                        {isFastest && (
                          <Badge size="xs" color="green" variant="light">
                            Fastest
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {r.usage ? (r.usage.prompt_tokens || 0) + (r.usage.completion_tokens || 0) : '—'}
                      </Text>
                    </Table.Td>
                    {expectedSchema && (
                      <Table.Td>
                        {schema ? (
                          schema.parseError ? (
                            <Badge size="xs" color="red">
                              Parse error
                            </Badge>
                          ) : (
                            <Text size="xs">
                              {schema.summary.passed}/{schema.summary.total}
                            </Text>
                          )
                        ) : (
                          '—'
                        )}
                      </Table.Td>
                    )}
                    <Table.Td>
                      <Badge size="xs" color={r.status === 'success' ? 'green' : 'red'} variant="light">
                        {r.status}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        {results.map((r, i) => {
          if (r === null) {
            return (
              <Paper
                key={i}
                withBorder
                p="sm"
                radius="md"
                style={{ borderLeft: `4px solid var(--mantine-color-${SLOT_COLORS[i]}-5)` }}
              >
                <Group gap="xs" mb="xs">
                  <Badge color={SLOT_COLORS[i]} variant="filled" size="sm">
                    Slot {SLOT_LABELS[i]}
                  </Badge>
                  <Badge color="gray" variant="outline" size="sm" leftSection={<Loader size={10} />}>
                    Running
                  </Badge>
                </Group>
                <Stack align="center" py="lg">
                  <Loader size="sm" />
                  <Text size="xs" c="dimmed">
                    Waiting for response...
                  </Text>
                </Stack>
              </Paper>
            );
          }
          return <ResultCard key={i} result={r} index={i} expectedSchema={expectedSchema} />;
        })}
      </SimpleGrid>
    </Stack>
  );
}
