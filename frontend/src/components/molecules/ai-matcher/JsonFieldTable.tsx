/**
 * JSON field tables for AI Matcher result display.
 * Extracted from AiMatcherPage.tsx (FE-03).
 */

import { Stack, Paper, Text, Badge, Code, Table, ScrollArea } from '@mantine/core';

function ObjectMiniTable({ obj }: { obj: Record<string, unknown> }) {
  return (
    <Table withColumnBorders style={{ tableLayout: 'fixed' }}>
      <Table.Tbody>
        {Object.entries(obj).map(([k, v]) => (
          <Table.Tr key={k}>
            <Table.Td style={{ width: 100, verticalAlign: 'top' }}>
              <Text size="xs" fw={600} ff="monospace" c="dimmed">
                {k}
              </Text>
            </Table.Td>
            <Table.Td>{formatCellValue(v, true)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function formatCellValue(val: unknown, nested = false) {
  if (val === null || val === undefined)
    return (
      <Text size="xs" c="dimmed" fs="italic">
        null
      </Text>
    );
  if (typeof val === 'boolean')
    return (
      <Badge size="xs" color={val ? 'green' : 'gray'} variant="light">
        {String(val)}
      </Badge>
    );

  if (Array.isArray(val)) {
    if (val.length === 0)
      return (
        <Text size="xs" c="dimmed" fs="italic">
          []
        </Text>
      );
    const hasObjects = val.some((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (hasObjects) {
      return (
        <Stack gap={6}>
          {val.map((item, idx) => (
            <Paper key={idx} withBorder p={4} radius="sm" bg="var(--mantine-color-gray-0)">
              {item && typeof item === 'object' && !Array.isArray(item) ? (
                <ObjectMiniTable obj={item as Record<string, unknown>} />
              ) : (
                <Text size="xs">{String(item)}</Text>
              )}
            </Paper>
          ))}
        </Stack>
      );
    }
    return <Text size="xs">{val.join('; ')}</Text>;
  }

  if (typeof val === 'object') {
    if (nested) return <Code style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>{JSON.stringify(val, null, 2)}</Code>;
    return <ObjectMiniTable obj={val as Record<string, unknown>} />;
  }

  const str = String(val);
  if (str.length > 300)
    return (
      <Text size="xs" lineClamp={4}>
        {str}
      </Text>
    );
  return <Text size="xs">{str}</Text>;
}

export function JsonFieldTable({ text }: { text: string }) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const entries = Object.entries(parsed);
  if (entries.length === 0) return null;

  return (
    <ScrollArea.Autosize mah={350}>
      <Table striped withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: '30%' }}>Field</Table.Th>
            <Table.Th>Value</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map(([key, val]) => (
            <Table.Tr key={key}>
              <Table.Td>
                <Text size="xs" fw={600} ff="monospace">
                  {key}
                </Text>
              </Table.Td>
              <Table.Td>{formatCellValue(val)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
