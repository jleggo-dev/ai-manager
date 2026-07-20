import { Stack, Group, Text, Badge, Alert, Paper, ScrollArea, Table } from '@mantine/core';
import { IconAlertTriangle, IconCircleX } from '@tabler/icons-react';
import StatusIcon from '../../atoms/StatusIcon';
import type { ExpectedSchema } from './types';
import { validateResponseSchema } from './validateResponseSchema';

/* ══════════════════════════════════════════════════════════════
   SCHEMA VALIDATION PANEL
   ══════════════════════════════════════════════════════════════ */

/**
 * Validates the formatted LLM response against the job's expected response
 * schema and renders a field-by-field report with pass/warning/error indicators.
 */
export default function SchemaValidationPanel({
  formattedText,
  expectedSchema,
}: {
  formattedText: string;
  expectedSchema: ExpectedSchema | null | undefined;
}) {
  if (!formattedText) return null;

  const validation = validateResponseSchema(formattedText, expectedSchema);

  /** Format a field value for display (truncate long arrays/strings) */
  function formatValue(val: unknown) {
    if (val === null || val === undefined)
      return (
        <Text size="xs" c="dimmed" fs="italic">
          null
        </Text>
      );
    if (Array.isArray(val)) {
      return (
        <Group gap={4} wrap="wrap">
          {val.map((v, i) => (
            <Badge key={i} size="xs" variant="outline" color="gray">
              {String(v)}
            </Badge>
          ))}
        </Group>
      );
    }
    const str = String(val);
    if (str.length > 80)
      return (
        <Text size="xs" style={{ wordBreak: 'break-word' }}>
          {str.slice(0, 80)}…
        </Text>
      );
    return (
      <Text size="xs" style={{ wordBreak: 'break-word' }}>
        {str}
      </Text>
    );
  }

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600} size="sm">
          Schema Validation
        </Text>
        {validation.parseError ? (
          <Badge color="red" variant="filled" size="sm">
            JSON Parse Error
          </Badge>
        ) : (
          <Group gap="xs">
            <Badge color={validation.valid ? 'green' : 'red'} variant="filled" size="sm">
              {validation.valid ? 'Valid' : 'Issues Found'}
            </Badge>
            <Badge color="green" variant="light" size="xs">
              {validation.summary.passed} passed
            </Badge>
            {validation.summary.warnings > 0 && (
              <Badge color="yellow" variant="light" size="xs">
                {validation.summary.warnings} warnings
              </Badge>
            )}
            {validation.summary.errors > 0 && (
              <Badge color="red" variant="light" size="xs">
                {validation.summary.errors} errors
              </Badge>
            )}
            {validation.summary.missing > 0 && (
              <Badge color="gray" variant="light" size="xs">
                {validation.summary.missing} empty
              </Badge>
            )}
          </Group>
        )}
      </Group>

      {/* Parse error — stop here */}
      {validation.parseError && (
        <Alert color="red" variant="light" icon={<IconCircleX size={16} />}>
          <Text size="sm">{validation.parseError}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            The formatted response could not be parsed as JSON. Check the formatting rules or the AI prompt to ensure
            valid JSON output.
          </Text>
        </Alert>
      )}

      {/* Unexpected extra fields */}
      {validation.unexpectedFields.length > 0 && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />} mb="sm">
          <Text size="sm" fw={500}>
            Unexpected fields in response
          </Text>
          <Text size="xs" c="dimmed">
            The following fields are not part of the expected response schema and may be ignored:{' '}
            {validation.unexpectedFields.map((f: string) => (
              <Badge key={f} size="xs" variant="outline" color="yellow" mx={2}>
                {f}
              </Badge>
            ))}
          </Text>
        </Alert>
      )}

      {/* Field-by-field table */}
      {!validation.parseError && (
        <ScrollArea>
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            verticalSpacing={4}
            style={{ fontSize: 12 }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 30 }}></Table.Th>
                <Table.Th style={{ width: 160 }}>Field</Table.Th>
                <Table.Th style={{ width: 70 }}>Type</Table.Th>
                <Table.Th>Value</Table.Th>
                <Table.Th style={{ width: 250 }}>Issues</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {validation.fields.map((f) => (
                <Table.Tr key={f.field}>
                  <Table.Td>
                    <StatusIcon status={f.status} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Text size="xs" fw={500}>
                        {f.label}
                      </Text>
                      {f.required && (
                        <Badge size="xs" color="red" variant="light">
                          req
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {f.field}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={f.expectedType === 'multi' ? 'violet' : 'blue'}>
                      {f.expectedType}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatValue(f.value)}</Table.Td>
                  <Table.Td>
                    {f.issues.length > 0 ? (
                      <Stack gap={2}>
                        {f.issues.map((issue: string, i: number) => (
                          <Text
                            key={i}
                            size="xs"
                            c={f.status === 'error' ? 'red' : f.status === 'warning' ? 'yellow.8' : 'dimmed'}
                          >
                            {issue}
                          </Text>
                        ))}
                      </Stack>
                    ) : (
                      <Text size="xs" c="green">
                        OK
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Paper>
  );
}
