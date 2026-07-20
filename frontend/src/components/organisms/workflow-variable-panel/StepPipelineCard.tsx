import {
  Stack,
  Paper,
  Table,
  Badge,
  Text,
  Group,
  Code,
  Collapse,
  UnstyledButton,
  ScrollArea,
  ThemeIcon,
  Center,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconArrowRight, IconArrowNarrowDown } from '@tabler/icons-react';
import type { StepJobData, StepVarMappings, VarState } from './types';

interface Props {
  sd: StepJobData;
  stepIndex: number;
  isExpanded: boolean;
  stepMappings?: StepVarMappings;
  allVars: VarState[];
  onToggle: () => void;
}

export function StepPipelineCard({ sd, stepIndex, isExpanded, stepMappings, allVars, onToggle }: Props) {
  const inputs = stepMappings?.inputs ?? new Map();
  const outputs = stepMappings?.outputs ?? new Map();

  return (
    <Stack gap={0}>
      {stepIndex > 0 && (
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
                {stepIndex + 1}
              </Badge>
              <Text size="sm" fw={500}>
                {sd.stepName}
              </Text>
              <Code style={{ fontSize: 11 }}>{sd.stepKey}</Code>
            </Group>
            <Group gap="xs">
              {inputs.size > 0 && (
                <Badge size="xs" variant="light" color="blue">
                  {inputs.size} in
                </Badge>
              )}
              {outputs.size > 0 && (
                <Badge size="xs" variant="light" color="green">
                  {outputs.size} out
                </Badge>
              )}
              <Badge size="xs" variant="light" color="gray">
                +2 auto
              </Badge>
            </Group>
          </Group>
        </UnstyledButton>

        <Collapse in={isExpanded}>
          <Stack gap="xs" mt="sm">
            {inputs.size > 0 && (
              <>
                <Text size="xs" fw={600}>
                  Inputs (workflow var → job var)
                </Text>
                <ScrollArea>
                  <Table withTableBorder style={{ fontSize: 12 }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Workflow Variable</Table.Th>
                        <Table.Th>→</Table.Th>
                        <Table.Th>Job Variable</Table.Th>
                        <Table.Th>Available</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {[...inputs.entries()].map(([jobVar, wfVar]) => {
                        const source = allVars.find((v) => v.name === wfVar);
                        const available = source ? source.availableAt < stepIndex : false;
                        return (
                          <Table.Tr key={jobVar}>
                            <Table.Td>
                              <Code style={{ fontSize: 11 }}>{wfVar}</Code>
                            </Table.Td>
                            <Table.Td>
                              <IconArrowRight size={12} opacity={0.4} />
                            </Table.Td>
                            <Table.Td>
                              <Code style={{ fontSize: 11 }}>{jobVar}</Code>
                            </Table.Td>
                            <Table.Td>
                              <Badge size="xs" color={available ? 'green' : 'orange'}>
                                {available ? 'Yes' : 'Not yet'}
                              </Badge>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </>
            )}

            {outputs.size > 0 && (
              <>
                <Text size="xs" fw={600}>
                  Outputs (job output → workflow var)
                </Text>
                <ScrollArea>
                  <Table withTableBorder style={{ fontSize: 12 }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Output Field</Table.Th>
                        <Table.Th>→</Table.Th>
                        <Table.Th>Workflow Variable</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {[...outputs.entries()].map(([field, wfVar]) => (
                        <Table.Tr key={field}>
                          <Table.Td>
                            <Code style={{ fontSize: 11 }}>{field}</Code>
                          </Table.Td>
                          <Table.Td>
                            <IconArrowRight size={12} opacity={0.4} />
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" variant="light" color="green">
                              {wfVar}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </>
            )}

            <Text size="xs" c="dimmed" fs="italic">
              Auto-captured: <Code style={{ fontSize: 10 }}>{sd.stepKey}.prompt</Code> and{' '}
              <Code style={{ fontSize: 10 }}>{sd.stepKey}.response</Code> (the raw LLM input/output for this step)
            </Text>

            {inputs.size === 0 && outputs.size === 0 && (
              <Text size="xs" c="dimmed">
                No variable mappings configured for this step.
              </Text>
            )}
          </Stack>
        </Collapse>
      </Paper>
    </Stack>
  );
}
