import { Text, Paper, Badge, Divider, Table, TextInput } from '@mantine/core';

interface OutputField {
  field: string;
  schema: { type?: string };
}

interface Props {
  outputFields: OutputField[];
  outputMappings: Record<string, string>;
  onUpdateOutput: (outputField: string, rawValue: string) => void;
}

export function OutputMappingSection({ outputFields, outputMappings, onUpdateOutput }: Props) {
  return (
    <>
      <Divider label="Job Outputs" labelPosition="center" />

      <Text size="xs" c="dimmed">
        Output field names are defined by the processing job. Assign workflow variable names so later steps can consume
        them via input mappings.
      </Text>

      <Paper p="sm" withBorder>
        <Text size="xs" fw={600} mb="xs">
          This step produces ({outputFields.length} outputs)
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Output Field (from job)</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th>Workflow Variable Name</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {outputFields.map(({ field, schema }) => (
              <Table.Tr key={field}>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {field}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="outline" color="gray">
                    {schema.type || 'any'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <TextInput
                    placeholder="e.g. project_timeline"
                    value={outputMappings[field] || ''}
                    onChange={(e) => onUpdateOutput(field, e.target.value)}
                    size="xs"
                    style={{ maxWidth: 250 }}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </>
  );
}
