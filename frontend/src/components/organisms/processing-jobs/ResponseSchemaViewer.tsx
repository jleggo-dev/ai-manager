/**
 * Read-only viewer for a job's expected response schema, with per-field and
 * full-schema copy-to-clipboard snippets. Moved verbatim out of
 * ProcessingJobManager.tsx as part of the FE-01 split.
 */

import React, { useState } from 'react';
import {
  Paper,
  Group,
  UnstyledButton,
  Text,
  Badge,
  Tooltip,
  ActionIcon,
  Collapse,
  Code,
  ScrollArea,
  Table,
} from '@mantine/core';
import { IconChevronDown, IconCopy } from '@tabler/icons-react';
import { buildFieldSnippet, buildFullSchemaSnippet, copyToClipboard } from './schemaSnippets';
import type { ExpectedSchema, SchemaFieldDefExtended } from './types';

export default function ResponseSchemaViewer({
  expectedSchema,
}: {
  expectedSchema: ExpectedSchema | null | undefined;
}) {
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const schema = expectedSchema && typeof expectedSchema === 'object' ? expectedSchema : {};
  const fields = schema.fields || {};
  const fieldEntries = Object.entries(fields);

  if (fieldEntries.length === 0) return null;

  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" style={{ width: '100%' }}>
        <UnstyledButton onClick={() => setCollapsed(!collapsed)} style={{ flex: 1 }}>
          <Group gap="xs">
            <IconChevronDown
              size={14}
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 150ms' }}
            />
            <Text fw={600} size="sm">
              Expected Response Schema
            </Text>
            <Badge size="xs" variant="light" color="gray">
              {fieldEntries.length} fields
            </Badge>
          </Group>
        </UnstyledButton>
        <Tooltip label="Copy entire schema as prompt-ready JSON" withArrow>
          <ActionIcon
            size="sm"
            variant="light"
            color="teal"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(buildFullSchemaSnippet(fields), 'Full response schema');
            }}
          >
            <IconCopy size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Collapse in={!collapsed}>
        <Text size="xs" c="dimmed" mt={4} mb={8}>
          Describes the JSON object you expect from the model (Test tab + validation). Edit JSON in Build Rules or sync
          via <Code>PUT /api/processing-jobs/:id</Code>. Click{' '}
          <IconCopy size={10} style={{ verticalAlign: 'middle' }} /> to copy snippets.
        </Text>

        <ScrollArea.Autosize mah={420}>
          <Table striped highlightOnHover withTableBorder withColumnBorders verticalSpacing={4} fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 30 }} />
                <Table.Th>Field</Table.Th>
                <Table.Th style={{ width: 90 }}>Type</Table.Th>
                <Table.Th style={{ width: 80 }}>Required</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th style={{ width: 40 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {fieldEntries.map(([name, def]: [string, SchemaFieldDefExtended]) => {
                const isArrayObj = def.type === 'array' && def.items?.type === 'object';
                const isExpanded = expandedField === name;
                const subFields = isArrayObj ? Object.entries(def.items?.fields || {}) : [];
                return (
                  <React.Fragment key={name}>
                    <Table.Tr>
                      <Table.Td>
                        {isArrayObj && (
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            onClick={() => setExpandedField(isExpanded ? null : name)}
                          >
                            <IconChevronDown
                              size={12}
                              style={{
                                transform: isExpanded ? 'rotate(180deg)' : 'none',
                                transition: 'transform 150ms',
                              }}
                            />
                          </ActionIcon>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text fw={600} size="xs">
                          {name}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="xs"
                          variant="light"
                          color={def.type === 'array' ? 'grape' : def.type === 'object' ? 'orange' : 'blue'}
                        >
                          {def.type}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="xs"
                          variant={def.required ? 'filled' : 'light'}
                          color={def.required ? 'red' : 'gray'}
                        >
                          {def.required ? 'Yes' : 'No'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {def.description || '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label="Copy field snippet for prompt" withArrow>
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            color="teal"
                            onClick={() => copyToClipboard(buildFieldSnippet(name, def), `"${name}" snippet`)}
                          >
                            <IconCopy size={12} />
                          </ActionIcon>
                        </Tooltip>
                      </Table.Td>
                    </Table.Tr>

                    {/* Sub-fields for array-of-objects */}
                    {isArrayObj &&
                      isExpanded &&
                      subFields.map(([subName, subDef]: [string, SchemaFieldDefExtended]) => (
                        <Table.Tr key={`${name}.${subName}`} bg="gray.0">
                          <Table.Td />
                          <Table.Td pl={28}>
                            <Text size="xs" c="dimmed">
                              {'\u21B3'} {subName}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" variant="dot" color="blue">
                              {subDef.type}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Badge
                              size="xs"
                              variant={subDef.required ? 'filled' : 'light'}
                              color={subDef.required ? 'red' : 'gray'}
                            >
                              {subDef.required ? 'Yes' : 'No'}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {subDef.description || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td />
                        </Table.Tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      </Collapse>
    </Paper>
  );
}
