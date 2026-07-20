import { Table, Group, Text, Code, Badge, ActionIcon, Tooltip } from '@mantine/core';
import { IconGitMerge, IconTestPipe, IconEdit, IconTrash } from '@tabler/icons-react';
import type { NavigateFn, WorkflowListItem } from './types';

interface Props {
  workflows: WorkflowListItem[];
  onNavigate?: NavigateFn;
  onViewTest: (workflow: WorkflowListItem) => void;
  onConfirmDelete: (workflow: WorkflowListItem) => void;
}

export function WorkflowListView({ workflows, onNavigate, onViewTest, onConfirmDelete }: Props) {
  return (
    <Table striped highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Name</Table.Th>
          <Table.Th>Slug</Table.Th>
          <Table.Th>Profile</Table.Th>
          <Table.Th>Steps</Table.Th>
          <Table.Th>Status</Table.Th>
          <Table.Th style={{ width: 120 }}>Actions</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {workflows.map((wf) => (
          <Table.Tr
            key={wf.id}
            style={{ cursor: 'pointer' }}
            onClick={() => onNavigate?.('workflow-detail', { workflowId: wf.id })}
          >
            <Table.Td>
              <Group gap="xs">
                <IconGitMerge size={14} opacity={0.5} />
                <Text size="sm" fw={500}>
                  {wf.name}
                </Text>
              </Group>
            </Table.Td>
            <Table.Td>
              <Code style={{ fontSize: 11 }}>{wf.slug}</Code>
            </Table.Td>
            <Table.Td>
              <Text size="xs">{wf.ai_profile?.name || '—'}</Text>
            </Table.Td>
            <Table.Td>
              <Badge size="xs" variant="outline">
                {wf.steps?.length || 0}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Badge size="xs" variant="light" color={wf.is_active ? 'green' : 'gray'}>
                {wf.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Group gap={4}>
                <Tooltip label="Test">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    color="teal"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewTest(wf);
                    }}
                  >
                    <IconTestPipe size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Edit">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigate?.('workflow-editor', { workflowId: wf.id });
                    }}
                  >
                    <IconEdit size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfirmDelete(wf);
                    }}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
