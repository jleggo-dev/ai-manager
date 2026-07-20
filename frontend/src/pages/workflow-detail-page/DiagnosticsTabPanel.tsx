import {
  Stack,
  Group,
  Text,
  Code,
  Badge,
  Button,
  Table,
  Center,
  Loader,
  ScrollArea,
  TextInput,
  Select,
} from '@mantine/core';
import { IconHistory, IconSearch } from '@tabler/icons-react';
import WorkflowExecutionLog from '../../components/organisms/WorkflowExecutionLog';
import { SortableHeader } from './SortableHeader';
import type { ChatSession, WorkflowStep } from '../../types/api';
import type { SessionSortDir, SessionSortField } from './types';

interface Props {
  execLoading: boolean;
  execSessions: ChatSession[];
  selectedExecSession: string | null;
  onSelectSession: (sessionId: string | null) => void;
  workflowSteps?: WorkflowStep[];
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  statusFilter: string | null;
  onStatusFilterChange: (value: string | null) => void;
  filteredSorted: ChatSession[];
  sortField: SessionSortField;
  sortDir: SessionSortDir;
  onToggleSort: (field: SessionSortField) => void;
}

export function DiagnosticsTabPanel({
  execLoading,
  execSessions,
  selectedExecSession,
  onSelectSession,
  workflowSteps,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  filteredSorted,
  sortField,
  sortDir,
  onToggleSort,
}: Props) {
  if (execLoading) {
    return (
      <Center p="md">
        <Loader size="sm" />
      </Center>
    );
  }

  if (execSessions.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="md">
        No workflow executions found. Run the workflow to see execution logs here.
      </Text>
    );
  }

  if (selectedExecSession && workflowSteps) {
    return (
      <Stack gap="sm">
        <Button
          variant="subtle"
          size="xs"
          onClick={() => onSelectSession(null)}
          leftSection={<IconHistory size={14} />}
        >
          Back to session list
        </Button>
        <WorkflowExecutionLog sessionId={selectedExecSession} steps={workflowSteps} />
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      <Group gap="sm">
        <TextInput
          placeholder="Search by session ID…"
          size="xs"
          leftSection={<IconSearch size={14} />}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.currentTarget.value)}
          style={{ flex: 1, maxWidth: 260 }}
        />
        <Select
          placeholder="All statuses"
          size="xs"
          clearable
          data={[
            { value: 'active', label: 'Active' },
            { value: 'closed', label: 'Closed' },
          ]}
          value={statusFilter}
          onChange={onStatusFilterChange}
          style={{ width: 140 }}
        />
        <Text size="xs" c="dimmed">
          {filteredSorted.length} of {execSessions.length} sessions
        </Text>
      </Group>

      <ScrollArea>
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                <SortableHeader
                  label="Session"
                  field="id"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onToggleSort}
                />
              </Table.Th>
              <Table.Th>
                <SortableHeader
                  label="Status"
                  field="status"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onToggleSort}
                />
              </Table.Th>
              <Table.Th>
                <SortableHeader
                  label="Messages"
                  field="message_count"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onToggleSort}
                />
              </Table.Th>
              <Table.Th>
                <SortableHeader
                  label="Started"
                  field="created_at"
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={onToggleSort}
                />
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {filteredSorted.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text size="sm" c="dimmed" ta="center" py="sm">
                    No sessions match the current filters.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              filteredSorted.map((s) => (
                <Table.Tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => onSelectSession(s.id)}>
                  <Table.Td>
                    <Code style={{ fontSize: 11 }}>{s.id.slice(0, 8)}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={s.status === 'active' ? 'green' : s.status === 'closed' ? 'gray' : 'blue'}>
                      {s.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{s.message_count ?? 0}</Table.Td>
                  <Table.Td>
                    <Text size="xs">{new Date(s.created_at).toLocaleString()}</Text>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}
