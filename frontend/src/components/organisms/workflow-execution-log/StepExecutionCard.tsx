import {
  Stack,
  Paper,
  Text,
  Group,
  Badge,
  Code,
  Collapse,
  UnstyledButton,
  Tabs,
  ScrollArea,
  ThemeIcon,
  Center,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconArrowNarrowDown,
  IconClock,
  IconCheck,
  IconAlertTriangle,
} from '@tabler/icons-react';
import type { StepExecution } from './types';
import { formatMs, statusColor } from './types';
import { VariableDiffView } from './VariableDiffView';
import { DiagnosticDetail } from './DiagnosticDetail';

interface StepExecutionCardProps {
  exec: StepExecution;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export function StepExecutionCard({ exec, index, isExpanded, onToggle }: StepExecutionCardProps) {
  const completed = !!exec.assistantMessage;
  const diagStatus = exec.diagnostic?.status || (completed ? 'success' : 'pending');
  const durationMs = exec.assistantMessage?.duration_ms ?? exec.diagnostic?.total_duration_ms;

  return (
    <Stack gap={0}>
      {index > 0 && (
        <Center>
          <ThemeIcon variant="subtle" size="sm" color="gray">
            <IconArrowNarrowDown size={16} />
          </ThemeIcon>
        </Center>
      )}
      <Paper p="sm" withBorder>
        <UnstyledButton onClick={onToggle} w="100%">
          <Group justify="space-between">
            <Group gap="xs">
              {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              <Badge size="xs" color="gray" variant="filled">
                {index + 1}
              </Badge>
              <Text size="sm" fw={500}>
                {exec.stepName}
              </Text>
              <Code style={{ fontSize: 11 }}>{exec.stepKey}</Code>
            </Group>
            <Group gap="xs">
              <Badge
                size="xs"
                color={statusColor(diagStatus)}
                leftSection={
                  diagStatus === 'success' ? (
                    <IconCheck size={10} />
                  ) : diagStatus === 'error' ? (
                    <IconAlertTriangle size={10} />
                  ) : undefined
                }
              >
                {diagStatus}
              </Badge>
              {durationMs != null && (
                <Badge size="xs" variant="light" color="gray" leftSection={<IconClock size={10} />}>
                  {formatMs(durationMs)}
                </Badge>
              )}
              {Object.keys(exec.addedVars).length > 0 && (
                <Badge size="xs" variant="light" color="teal">
                  +{Object.keys(exec.addedVars).length} vars
                </Badge>
              )}
            </Group>
          </Group>
        </UnstyledButton>

        <Collapse in={isExpanded}>
          <Tabs defaultValue="prompt" mt="sm">
            <Tabs.List>
              <Tabs.Tab value="prompt">Prompt</Tabs.Tab>
              <Tabs.Tab value="response">Response</Tabs.Tab>
              <Tabs.Tab value="variables">Variables</Tabs.Tab>
              <Tabs.Tab value="diagnostics">Diagnostics</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="prompt" pt="xs">
              {exec.userMessage ? (
                <ScrollArea mah={300}>
                  <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {exec.userMessage.content}
                  </Code>
                </ScrollArea>
              ) : (
                <Text size="xs" c="dimmed">
                  Step has not been executed yet.
                </Text>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="response" pt="xs">
              {exec.assistantMessage ? (
                <Stack gap="xs">
                  <ScrollArea mah={300}>
                    <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                      {exec.assistantMessage.content}
                    </Code>
                  </ScrollArea>
                  {(exec.assistantMessage.prompt_tokens || exec.assistantMessage.completion_tokens) && (
                    <Group gap="xs">
                      <Badge size="xs" variant="light">
                        {exec.assistantMessage.prompt_tokens ?? 0} prompt tokens
                      </Badge>
                      <Badge size="xs" variant="light">
                        {exec.assistantMessage.completion_tokens ?? 0} completion tokens
                      </Badge>
                    </Group>
                  )}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed">
                  No response recorded.
                </Text>
              )}
            </Tabs.Panel>

            <Tabs.Panel value="variables" pt="xs">
              <VariableDiffView before={exec.variablesBefore} after={exec.variablesAfter} added={exec.addedVars} />
            </Tabs.Panel>

            <Tabs.Panel value="diagnostics" pt="xs">
              <DiagnosticDetail diagnostic={exec.diagnostic} />
            </Tabs.Panel>
          </Tabs>
        </Collapse>
      </Paper>
    </Stack>
  );
}
