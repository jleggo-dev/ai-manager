import { Stack, Text, Table, Code, Divider } from '@mantine/core';
import WorkflowVariablePanel from '../../components/organisms/WorkflowVariablePanel';
import type { WorkflowDetail } from './types';
import { getInputVariables } from './types';
import type { WorkflowInputVariable } from '../../types/api';

interface Props {
  detail: WorkflowDetail;
}

export function StepsTabPanel({ detail }: Props) {
  const inputVariables = getInputVariables(detail.config) as WorkflowInputVariable[] | undefined;

  return (
    <Stack gap="sm">
      {(!detail.steps || detail.steps.length === 0) && (
        <Text size="sm" c="dimmed" ta="center">
          No steps configured.
        </Text>
      )}

      {detail.steps && detail.steps.length > 0 && (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Step Key</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Processing Job</Table.Th>
              <Table.Th>Required</Table.Th>
              <Table.Th>Depends On</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {detail.steps.map((s, i) => (
              <Table.Tr key={s.id || i}>
                <Table.Td>{i + 1}</Table.Td>
                <Table.Td>
                  <Code>{s.step_key}</Code>
                </Table.Td>
                <Table.Td>{s.name}</Table.Td>
                <Table.Td>{s.processing_job?.name || s.processing_job_id}</Table.Td>
                <Table.Td>{s.is_required ? 'Yes' : 'No'}</Table.Td>
                <Table.Td>{s.depends_on?.length ? s.depends_on.join(', ') : '—'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {detail.steps && detail.steps.length > 0 && (
        <>
          <Divider label="Variable Flow" labelPosition="center" />
          <WorkflowVariablePanel steps={detail.steps} inputVariables={inputVariables} />
        </>
      )}
    </Stack>
  );
}
