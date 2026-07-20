import { SimpleGrid, Card, Group, Text, Badge, Code, ActionIcon, Tooltip } from '@mantine/core';
import { IconGitMerge, IconTestPipe, IconEdit, IconTrash } from '@tabler/icons-react';
import type { NavigateFn, WorkflowListItem } from './types';

interface Props {
  workflows: WorkflowListItem[];
  onNavigate?: NavigateFn;
  onViewTest: (workflow: WorkflowListItem) => void;
  onConfirmDelete: (workflow: WorkflowListItem) => void;
}

export function WorkflowCardView({ workflows, onNavigate, onViewTest, onConfirmDelete }: Props) {
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      {workflows.map((wf) => (
        <Card
          key={wf.id}
          shadow="xs"
          padding="md"
          withBorder
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate?.('workflow-detail', { workflowId: wf.id })}
        >
          <Group justify="space-between" mb="xs">
            <Group gap="xs">
              <IconGitMerge size={18} opacity={0.5} />
              <Text fw={600} size="sm">
                {wf.name}
              </Text>
            </Group>
            <Group gap={4}>
              <Badge size="xs" variant="light" color={wf.is_active ? 'green' : 'gray'}>
                {wf.is_active ? 'Active' : 'Inactive'}
              </Badge>
              <Badge size="xs" variant="outline">
                {wf.steps?.length || 0} step{(wf.steps?.length || 0) !== 1 ? 's' : ''}
              </Badge>
            </Group>
          </Group>
          {wf.description && (
            <Text size="xs" c="dimmed" mb="xs" lineClamp={2}>
              {wf.description}
            </Text>
          )}
          <Group gap="xs" mb="xs">
            <Text size="xs" c="dimmed">
              Profile:
            </Text>
            <Text size="xs">{wf.ai_profile?.name || '(none)'}</Text>
          </Group>
          <Code block style={{ fontSize: 11 }}>
            {wf.slug}
          </Code>
          <Group mt="sm" gap="xs">
            <Tooltip label="Test workflow">
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
        </Card>
      ))}
    </SimpleGrid>
  );
}
