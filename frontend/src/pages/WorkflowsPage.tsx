import { Stack, ActionIcon, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconHelp } from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import WorkflowManager from '../components/organisms/WorkflowManager';
import WorkflowHelpDrawer from '../components/molecules/WorkflowHelpDrawer';

type NavigateFn = (key: string, params?: Record<string, unknown>) => void;

interface Props {
  onNavigate: NavigateFn;
  pageParams: Record<string, unknown>;
}

export default function WorkflowsPage({ onNavigate, pageParams }: Props) {
  const [helpOpened, { open: openHelp, close: closeHelp }] = useDisclosure(false);
  const autoTestWorkflowId = pageParams.autoTest as string | undefined;

  return (
    <Stack gap="md">
      <PageHeader
        title="Workflows"
        description="Group processing jobs into multi-step flows for structured chat sessions"
      >
        <Tooltip label="Workflow Guide">
          <ActionIcon variant="subtle" size="lg" onClick={openHelp} aria-label="Workflow Guide">
            <IconHelp size={20} />
          </ActionIcon>
        </Tooltip>
      </PageHeader>
      <WorkflowManager onNavigate={onNavigate} autoTestWorkflowId={autoTestWorkflowId} />
      <WorkflowHelpDrawer opened={helpOpened} onClose={closeHelp} />
    </Stack>
  );
}
