/**
 * Per-slot AI Matcher result card (timing, schema validation, raw drill-down).
 * Extracted from AiMatcherPage.tsx (FE-03).
 */

import { useState } from 'react';
import { Stack, Group, Paper, Text, Badge, Button, Code, Alert, Collapse, ScrollArea } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCoin,
  IconCheck,
  IconX,
  IconAlertTriangle,
} from '@tabler/icons-react';
import type { AiMatcherSlotResult, ExpectedSchema, FormattingStep } from '../../../types/api';
import { SLOT_COLORS, SLOT_LABELS, validateSchema } from '../../../lib/ai-matcher';
import { JsonFieldTable } from './JsonFieldTable';

export interface ResultCardProps {
  result: AiMatcherSlotResult;
  index: number;
  expectedSchema: ExpectedSchema | null;
}

export function ResultCard({ result, index, expectedSchema }: ResultCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const color = SLOT_COLORS[index];
  const label = SLOT_LABELS[index];
  const isError = result.status === 'error';
  const responseText = result.formatted || result.raw || '';
  const schemaResult = !isError && expectedSchema ? validateSchema(responseText, expectedSchema) : null;
  const hasJsonTable =
    !isError &&
    (() => {
      try {
        const p = JSON.parse(responseText);
        return typeof p === 'object' && p !== null && !Array.isArray(p);
      } catch (_e) {
        return false;
      }
    })();

  return (
    <Paper withBorder p="sm" radius="md" style={{ borderLeft: `4px solid var(--mantine-color-${color}-5)` }}>
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Badge color={color} variant="filled" size="sm">
            Slot {label}
          </Badge>
          {isError ? (
            <Badge color="red" variant="light" size="sm">
              Error
            </Badge>
          ) : (
            <Badge color="green" variant="light" size="sm">
              Success
            </Badge>
          )}
        </Group>
        {!isError && (
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => setShowRaw(!showRaw)}
            rightSection={showRaw ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
          >
            {showRaw ? 'Hide raw' : 'Show raw'}
          </Button>
        )}
      </Group>

      {isError && (
        <Alert color="red" variant="light" mb="xs">
          {result.error}
        </Alert>
      )}

      {!isError && (
        <>
          <Group gap="md" mb="xs" wrap="wrap">
            <Group gap={4}>
              <IconClock size={14} />
              <Text size="xs" fw={600}>
                {result.durationMs}ms
              </Text>
            </Group>
            {result.usage && (
              <Group gap={4}>
                <IconCoin size={14} />
                <Text size="xs">
                  {(result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0)} tokens
                </Text>
              </Group>
            )}
            <Text size="xs" c="dimmed">
              {result.provider} / {result.model}
            </Text>
            {result.profileName && (
              <Badge size="xs" variant="outline">
                {result.profileName}
              </Badge>
            )}
          </Group>

          {schemaResult && (
            <Group gap="xs" mb="xs">
              {schemaResult.parseError ? (
                <Badge color="red" size="xs" leftSection={<IconX size={10} />}>
                  Parse error
                </Badge>
              ) : (
                <>
                  <Badge
                    color={schemaResult.valid ? 'green' : 'orange'}
                    size="xs"
                    leftSection={schemaResult.valid ? <IconCheck size={10} /> : <IconAlertTriangle size={10} />}
                  >
                    {schemaResult.summary.passed}/{schemaResult.summary.total} fields
                  </Badge>
                  {schemaResult.summary.errors > 0 && (
                    <Badge color="red" size="xs">
                      {schemaResult.summary.errors} missing required
                    </Badge>
                  )}
                </>
              )}
            </Group>
          )}

          {hasJsonTable ? (
            <JsonFieldTable text={responseText} />
          ) : (
            <ScrollArea.Autosize mah={250}>
              <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {responseText || '(empty)'}
              </Code>
            </ScrollArea.Autosize>
          )}

          <Collapse in={showRaw}>
            <Stack gap="xs" mt="xs">
              {result.formatted && (
                <>
                  <Text size="xs" fw={600}>
                    Formatted response
                  </Text>
                  <ScrollArea.Autosize mah={200}>
                    <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                      {result.formatted}
                    </Code>
                  </ScrollArea.Autosize>
                </>
              )}
              <Text size="xs" fw={600}>
                Raw response
              </Text>
              <ScrollArea.Autosize mah={200}>
                <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                  {result.raw}
                </Code>
              </ScrollArea.Autosize>
              {result.formattingSteps && result.formattingSteps.length > 0 && (
                <>
                  <Text size="xs" fw={600}>
                    Formatting steps
                  </Text>
                  <Group gap={4}>
                    {result.formattingSteps.map((s: FormattingStep, i: number) => (
                      <Badge key={i} size="xs" variant="light" color={s.changed ? 'blue' : 'gray'}>
                        {s.label || s.type}
                      </Badge>
                    ))}
                  </Group>
                </>
              )}
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  Finish: {result.finishReason || '—'}
                </Text>
                {result.usage && (
                  <Text size="xs" c="dimmed">
                    In: {result.usage.prompt_tokens || 0} / Out: {result.usage.completion_tokens || 0}
                  </Text>
                )}
              </Group>
            </Stack>
          </Collapse>
        </>
      )}
    </Paper>
  );
}
