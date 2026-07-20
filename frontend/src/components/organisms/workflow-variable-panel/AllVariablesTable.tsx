import { ScrollArea, Table, Code, Badge, Text } from '@mantine/core';
import type { VarState } from './types';

interface Props {
  allVars: VarState[];
}

export function AllVariablesTable({ allVars }: Props) {
  return (
    <ScrollArea>
      <Table striped withTableBorder style={{ minWidth: 400, fontSize: 12 }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Variable</Table.Th>
            <Table.Th>Source</Table.Th>
            <Table.Th>Available From</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {allVars.map((v) => (
            <Table.Tr key={v.name}>
              <Table.Td>
                <Code style={{ fontSize: 11 }}>{v.name}</Code>
              </Table.Td>
              <Table.Td>
                <Badge
                  size="xs"
                  variant="light"
                  color={v.availableAt < 0 ? 'blue' : v.source.startsWith('auto:') ? 'teal' : 'green'}
                >
                  {v.source}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="xs">{v.availableAt < 0 ? 'Start' : `After step ${v.availableAt + 1}`}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  );
}
