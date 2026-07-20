import {
  Paper,
  Text,
  Group,
  Badge,
  Code,
  TextInput,
  Loader,
  Divider,
  Collapse,
  UnstyledButton,
  ScrollArea,
  Alert,
  Textarea,
  Stack,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconCheck, IconAlertTriangle, IconClock } from '@tabler/icons-react';
import type { StepState } from './types';

interface Props {
  step: StepState;
  stepIndex: number;
  isExpanded: boolean;
  running: boolean;
  onToggle: () => void;
  onUpdateVariable: (varName: string, value: string) => void;
}

export function TestSimulatorStepCard({ step, stepIndex, isExpanded, running, onToggle, onUpdateVariable }: Props) {
  const statusIcon =
    step.status === 'done' ? (
      <IconCheck size={16} color="green" />
    ) : step.status === 'running' ? (
      <Loader size={14} />
    ) : step.status === 'error' ? (
      <IconAlertTriangle size={16} color="red" />
    ) : (
      <IconClock size={14} opacity={0.4} />
    );

  return (
    <Paper key={step.stepKey} p="sm" withBorder>
      <UnstyledButton onClick={onToggle} w="100%">
        <Group justify="space-between">
          <Group gap="xs">
            {statusIcon}
            <Text size="sm" fw={500}>
              {stepIndex + 1}. {step.stepName}
            </Text>
            <Code style={{ fontSize: 11 }}>{step.stepKey}</Code>
          </Group>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              {step.jobName}
            </Text>
            {step.missingKeys.length > 0 && (
              <Badge size="xs" color="orange">
                {step.missingKeys.length} missing
              </Badge>
            )}
            {step.durationMs !== undefined && (
              <Badge size="xs" variant="light">
                {(step.durationMs / 1000).toFixed(1)}s
              </Badge>
            )}
            {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </Group>
        </Group>
      </UnstyledButton>

      <Collapse in={isExpanded}>
        <Stack gap="xs" mt="sm">
          <Text size="xs" fw={600}>
            Input Variables
          </Text>
          {step.placeholders.length === 0 ? (
            <Text size="xs" c="dimmed">
              No variables in this step&apos;s template.
            </Text>
          ) : (
            <Group gap="xs" wrap="wrap">
              {step.placeholders.map((key) => (
                <TextInput
                  key={key}
                  label={key}
                  size="xs"
                  value={step.variables[key] ?? ''}
                  onChange={(e) => onUpdateVariable(key, e.target.value)}
                  placeholder="(no test data)"
                  style={{ flex: '1 1 180px', maxWidth: 300 }}
                  error={!step.variables[key] ? 'No test data' : undefined}
                  disabled={running}
                />
              ))}
            </Group>
          )}

          <Divider />

          <Text size="xs" fw={600}>
            Interpolated Prompt
          </Text>
          <ScrollArea.Autosize mah={200}>
            <Paper
              p="xs"
              withBorder
              style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}
            >
              {step.interpolated || '(empty template)'}
            </Paper>
          </ScrollArea.Autosize>

          {step.response && (
            <>
              <Divider />
              <Text size="xs" fw={600}>
                LLM Response
              </Text>
              <ScrollArea.Autosize mah={300}>
                <Textarea
                  value={step.response}
                  readOnly
                  autosize
                  minRows={3}
                  maxRows={12}
                  styles={{ input: { fontSize: 12, fontFamily: 'monospace' } }}
                />
              </ScrollArea.Autosize>
            </>
          )}

          {step.error && (
            <Alert color="red" variant="light">
              <Text size="xs">{step.error}</Text>
            </Alert>
          )}

          {Object.keys(step.accumulatedAfter).length > 0 && (
            <>
              <Divider />
              <Text size="xs" fw={600}>
                Accumulated Variables After This Step
              </Text>
              <Group gap="xs" wrap="wrap">
                {Object.entries(step.accumulatedAfter).map(([k, v]) => (
                  <Badge key={k} size="xs" variant="light" color="green">
                    {k}: {String(v).slice(0, 40)}
                    {String(v).length > 40 ? '...' : ''}
                  </Badge>
                ))}
              </Group>
            </>
          )}
        </Stack>
      </Collapse>
    </Paper>
  );
}
