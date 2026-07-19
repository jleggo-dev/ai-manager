/**
 * Collapsible "Available Variables" reference panel with copy-to-clipboard.
 * Moved verbatim out of ProcessingJobManager.tsx as part of the FE-01 split.
 */

import { useState } from 'react';
import { Paper, Group, UnstyledButton, Text, Badge, Tooltip, ActionIcon, Collapse, Stack, Code } from '@mantine/core';
import { IconChevronDown, IconCopy } from '@tabler/icons-react';
import { copyToClipboard } from './schemaSnippets';
import type { JobVariable } from './types';

export default function VariablesReference({ variables }: { variables: JobVariable[] }) {
  const [collapsed, setCollapsed] = useState(false);

  /* Build a string with all variables for bulk copy */
  const allVarsText = variables.map((v) => `{{${v.name}}}`).join('\n');

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
              Available Variables
            </Text>
            <Badge size="xs" variant="light" color="gray">
              {variables.length} vars
            </Badge>
          </Group>
        </UnstyledButton>
        <Tooltip label="Copy all variable placeholders" withArrow>
          <ActionIcon
            size="sm"
            variant="light"
            color="teal"
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(allVarsText, 'All variable placeholders');
            }}
          >
            <IconCopy size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Collapse in={!collapsed}>
        <Text size="xs" c="dimmed" mt={4} mb={8}>
          Use <Code>{'{{variableName}}'}</Code> anywhere in your prompt. Click{' '}
          <IconCopy size={10} style={{ verticalAlign: 'middle' }} /> to copy a placeholder. Blue = user-supplied, gray =
          auto-populated by the pipeline.
        </Text>
        <Stack gap={4}>
          {variables.map((v) => (
            <Group key={v.name} gap="xs" wrap="nowrap">
              <Tooltip label={`Copy {{${v.name}}}`} withArrow>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="teal"
                  onClick={() => copyToClipboard(`{{${v.name}}}`, `{{${v.name}}}`)}
                >
                  <IconCopy size={12} />
                </ActionIcon>
              </Tooltip>
              <Badge
                variant={v.source === 'user' ? 'filled' : 'outline'}
                color={v.source === 'user' ? 'blue' : 'gray'}
                size="sm"
              >
                {`{{${v.name}}}`}
              </Badge>
              <Text size="xs" c="dimmed">
                {v.description || v.label}
              </Text>
            </Group>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}
