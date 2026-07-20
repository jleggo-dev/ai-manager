import { Group, Button, Badge, Code, Text } from '@mantine/core';
import { IconArrowLeft, IconEdit, IconTestPipe } from '@tabler/icons-react';
import PageHeader from '../../components/atoms/PageHeader';
import type { NavigateFn, WorkflowDetail } from './types';

interface Props {
  detail: WorkflowDetail;
  onNavigate: NavigateFn;
}

export function WorkflowDetailHeader({ detail, onNavigate }: Props) {
  return (
    <>
      <PageHeader title={detail.name} description={detail.description || undefined}>
        <Group gap="xs">
          <Button
            variant="subtle"
            size="sm"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => onNavigate('workflows', {})}
          >
            Back
          </Button>
          <Button
            variant="light"
            size="sm"
            leftSection={<IconEdit size={16} />}
            onClick={() => onNavigate('workflow-editor', { workflowId: detail.id })}
          >
            Edit
          </Button>
          <Button
            variant="light"
            size="sm"
            color="teal"
            leftSection={<IconTestPipe size={16} />}
            onClick={() => onNavigate('workflows', { autoTest: detail.id })}
          >
            Test
          </Button>
        </Group>
      </PageHeader>

      <Group gap="xs">
        <Badge size="sm" variant="light" color={detail.is_active ? 'green' : 'gray'}>
          {detail.is_active ? 'Active' : 'Inactive'}
        </Badge>
        <Code>{detail.slug}</Code>
        <Text size="sm">
          <strong>Profile:</strong> {detail.ai_profile?.name || '(none)'}
        </Text>
      </Group>
    </>
  );
}
