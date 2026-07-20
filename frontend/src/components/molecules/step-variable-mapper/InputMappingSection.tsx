import { Group, Text, Paper, Stack, Badge, Divider, Table, Tooltip } from '@mantine/core';
import { IconArrowRight, IconCircleFilled } from '@tabler/icons-react';
import { DraggableVar } from './DraggableVar';
import { DropZone } from './DropZone';
import type { AvailableVariable } from './types';
import type { JobVariable } from '../../../types/api';

interface Props {
  jobInputVars: JobVariable[];
  availableVars: AvailableVariable[];
  inputMappings: Record<string, string>;
  onUpdateMapping: (jobVar: string, workflowVar: string | null) => void;
}

export function InputMappingSection({ jobInputVars, availableVars, inputMappings, onUpdateMapping }: Props) {
  const mappedCount = jobInputVars.filter((v) => inputMappings[v.name]).length;
  const unmappedCount = jobInputVars.length - mappedCount;

  return (
    <>
      <Divider
        label={
          <Group gap="xs">
            <Text size="sm" fw={600}>
              Input Mapping
            </Text>
            {unmappedCount > 0 && (
              <Badge size="xs" color="orange" variant="light">
                {unmappedCount} unmapped
              </Badge>
            )}
            {unmappedCount === 0 && mappedCount > 0 && (
              <Badge size="xs" color="green" variant="light">
                All mapped
              </Badge>
            )}
          </Group>
        }
        labelPosition="center"
      />

      <Group align="flex-start" gap="md" wrap="nowrap" style={{ minHeight: 200 }}>
        <Paper p="sm" withBorder style={{ flex: '0 0 220px', maxHeight: 500, overflow: 'auto' }}>
          <Text size="xs" fw={600} mb="xs">
            Available at this step ({availableVars.length})
          </Text>
          <Stack gap={6}>
            {availableVars.length === 0 && (
              <Text size="xs" c="dimmed">
                No variables available. Define workflow input variables in the Application Call panel, or add output
                mappings to earlier steps.
              </Text>
            )}
            {availableVars.map((v) => (
              <DraggableVar key={v.name} variable={v} />
            ))}
          </Stack>
        </Paper>

        <Stack justify="center" style={{ alignSelf: 'center' }}>
          <IconArrowRight size={20} opacity={0.3} />
        </Stack>

        <Paper p="sm" withBorder style={{ flex: 1 }}>
          <Text size="xs" fw={600} mb="xs">
            Job Expects ({jobInputVars.length} inputs)
          </Text>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 20 }} />
                <Table.Th>Variable</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Mapped From</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {jobInputVars.map((v) => {
                const isMapped = !!inputMappings[v.name];
                return (
                  <Table.Tr key={v.name}>
                    <Table.Td>
                      <Tooltip label={isMapped ? 'Mapped' : 'Unmapped'}>
                        <IconCircleFilled
                          size={10}
                          color={isMapped ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-orange-6)'}
                        />
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {v.label || v.name}
                      </Text>
                      {v.label && (
                        <Text size="xs" c="dimmed">
                          {v.name}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {v.description || '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ minWidth: 180 }}>
                      <DropZone
                        jobVarName={v.name}
                        mappedValue={inputMappings[v.name]}
                        availableVars={availableVars}
                        onClear={() => onUpdateMapping(v.name, null)}
                      />
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Paper>
      </Group>
    </>
  );
}
