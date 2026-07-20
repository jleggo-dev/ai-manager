import { Stack, Text, ScrollArea, Table, Code, Badge, Divider } from '@mantine/core';

interface VariableDiffViewProps {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  added: Record<string, unknown>;
}

export function VariableDiffView({ before: _before, after, added }: VariableDiffViewProps) {
  const allKeys = Object.keys(after);

  if (allKeys.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No variables available at this point.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {Object.keys(added).length > 0 && (
        <>
          <Text size="xs" fw={600}>
            Added in this step
          </Text>
          <ScrollArea>
            <Table withTableBorder style={{ fontSize: 12 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Variable</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(added).map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td>
                      <Code style={{ fontSize: 11 }}>{k}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" lineClamp={3} style={{ maxWidth: 400 }}>
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}

      <Divider label="Full snapshot after step" labelPosition="center" />
      <ScrollArea>
        <Table withTableBorder style={{ fontSize: 12 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Variable</Table.Th>
              <Table.Th>Value</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allKeys.map((k) => {
              const isNew = k in added;
              return (
                <Table.Tr key={k}>
                  <Table.Td>
                    <Code style={{ fontSize: 11 }}>{k}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={2} style={{ maxWidth: 400 }}>
                      {typeof after[k] === 'string' ? after[k] : JSON.stringify(after[k])}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={isNew ? 'teal' : 'gray'}>
                      {isNew ? 'new' : 'inherited'}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}
