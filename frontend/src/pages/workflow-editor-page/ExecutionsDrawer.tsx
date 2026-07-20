import { Drawer, Group, Text, Badge, Center, Loader, Stack, Button, ScrollArea, Table, Code } from '@mantine/core';
import { IconHistory, IconArrowLeft } from '@tabler/icons-react';
import WorkflowExecutionLog from '../../components/organisms/WorkflowExecutionLog';
import type { ChatSession, WorkflowStep } from '../../types/api';

interface Props {
  opened: boolean;
  onClose: () => void;
  execLoading: boolean;
  execSessions: ChatSession[];
  selectedExecSession: string | null;
  onSelectSession: (sessionId: string | null) => void;
  workflowSteps?: WorkflowStep[];
}

export function ExecutionsDrawer({
  opened,
  onClose,
  execLoading,
  execSessions,
  selectedExecSession,
  onSelectSession,
  workflowSteps,
}: Props) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconHistory size={18} />
          <Text fw={600}>Diagnostics</Text>
          {execSessions.length > 0 && (
            <Badge size="sm" variant="light">
              {execSessions.length}
            </Badge>
          )}
        </Group>
      }
      position="right"
      size="xl"
      padding="md"
    >
      {execLoading ? (
        <Center p="xl">
          <Loader size="sm" />
        </Center>
      ) : execSessions.length === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="xl">
          No execution data yet. Run the workflow to see diagnostics here.
        </Text>
      ) : selectedExecSession && workflowSteps ? (
        <Stack gap="sm">
          <Button
            variant="subtle"
            size="xs"
            onClick={() => onSelectSession(null)}
            leftSection={<IconArrowLeft size={14} />}
          >
            Back to sessions
          </Button>
          <WorkflowExecutionLog sessionId={selectedExecSession} steps={workflowSteps} />
        </Stack>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Session</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Messages</Table.Th>
                <Table.Th>Started</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {execSessions.map((s) => (
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
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Drawer>
  );
}
