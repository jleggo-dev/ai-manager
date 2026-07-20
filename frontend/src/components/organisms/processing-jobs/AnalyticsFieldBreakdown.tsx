import { Group, Button, Text, Badge, Checkbox, Alert, Paper, ScrollArea, Box, Table } from '@mantine/core';
import { IconAlertTriangle, IconDeviceFloppy } from '@tabler/icons-react';
import SortHeader from '../../atoms/SortHeader';
import type { AnalyticsData, FieldFrequency } from './types';

export default function AnalyticsFieldBreakdown({
  analytics,
  contentFields,
  allSelected,
  noneSelected,
  sortCol,
  sortDir,
  savingConfig,
  onToggleField,
  onSelectAll,
  onDeselectAll,
  onSave,
  onSort,
  sortedBreakdown,
}: {
  analytics: AnalyticsData;
  contentFields: Set<string>;
  allSelected: boolean;
  noneSelected: boolean;
  sortCol: string;
  sortDir: string;
  savingConfig: boolean;
  onToggleField: (field: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onSave: () => void;
  onSort: (col: string) => void;
  sortedBreakdown: (breakdown: FieldFrequency[]) => FieldFrequency[];
}) {
  if (!(analytics.fieldBreakdown?.length ?? 0)) return null;

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="xs">
        <Box>
          <Text fw={600} size="sm">
            Field Coverage Breakdown
          </Text>
          <Text size="xs" c="dimmed">
            How often each expected field is populated across {analytics.validationCount} analyzed responses. Check
            fields to include in the Content score. Click column headers to sort.
          </Text>
        </Box>
        <Group gap="xs">
          <Button size="xs" variant="subtle" onClick={allSelected ? onDeselectAll : onSelectAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </Button>
          <Button
            size="xs"
            variant="light"
            color="green"
            leftSection={<IconDeviceFloppy size={14} />}
            onClick={onSave}
            loading={savingConfig}
            disabled={noneSelected}
          >
            Save Selection
          </Button>
        </Group>
      </Group>

      {noneSelected && (
        <Alert variant="light" color="orange" icon={<IconAlertTriangle size={14} />} mb="xs">
          <Text size="xs">
            No fields selected. The Content score requires at least one field. Click &quot;Select All&quot; or check
            individual fields.
          </Text>
        </Alert>
      )}

      <ScrollArea
        h={Math.min(((analytics.fieldBreakdown as FieldFrequency[])?.length ?? 0) * 42 + 40, 500)}
        type="auto"
        offsetScrollbars
      >
        <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing={4} style={{ fontSize: 12 }}>
          <Table.Thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--mantine-color-body)' }}>
            <Table.Tr>
              <Table.Th style={{ width: 40 }}>
                <Checkbox
                  size="xs"
                  checked={allSelected}
                  indeterminate={!allSelected && !noneSelected}
                  onChange={() => (allSelected ? onDeselectAll() : onSelectAll())}
                  aria-label="Select all fields"
                />
              </Table.Th>
              <SortHeader col="field" label="Field" active={sortCol === 'field'} sortDir={sortDir} onSort={onSort} />
              <SortHeader
                col="required"
                label="Required"
                width={90}
                active={sortCol === 'required'}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                col="count"
                label="Populated"
                width={100}
                active={sortCol === 'count'}
                sortDir={sortDir}
                onSort={onSort}
              />
              <SortHeader
                col="rate"
                label="Coverage"
                width={100}
                active={sortCol === 'rate'}
                sortDir={sortDir}
                onSort={onSort}
              />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortedBreakdown(analytics.fieldBreakdown ?? []).map((f) => (
              <Table.Tr
                key={f.field}
                style={{
                  backgroundColor: contentFields.has(f.field) ? undefined : 'var(--mantine-color-gray-0)',
                  opacity: contentFields.has(f.field) ? 1 : 0.6,
                }}
              >
                <Table.Td>
                  <Checkbox
                    size="xs"
                    checked={contentFields.has(f.field)}
                    onChange={() => onToggleField(f.field)}
                    aria-label={`Include ${f.field} in content score`}
                  />
                </Table.Td>
                <Table.Td>
                  <Text size="xs" fw={500}>
                    {f.field}
                  </Text>
                </Table.Td>
                <Table.Td>
                  {f.required ? (
                    <Badge size="xs" color="red" variant="light">
                      req
                    </Badge>
                  ) : (
                    <Text size="xs" c="dimmed">
                      opt
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {f.count} / {f.total}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={f.rate >= 90 ? 'green' : f.rate >= 50 ? 'yellow' : 'red'}>
                    {f.rate}%
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );
}
