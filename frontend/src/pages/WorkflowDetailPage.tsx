/**
 * Full-page workflow detail view with executions tab.
 * Navigated to by clicking a workflow card on the Workflows list page.
 */

import { Stack, Button, Tabs, Badge, Center, Loader, Alert } from '@mantine/core';
import { IconHistory } from '@tabler/icons-react';
import { DiagnosticsTabPanel } from './workflow-detail-page/DiagnosticsTabPanel';
import { StepsTabPanel } from './workflow-detail-page/StepsTabPanel';
import { WorkflowDetailHeader } from './workflow-detail-page/WorkflowDetailHeader';
import { useWorkflowDetailPage } from './workflow-detail-page/useWorkflowDetailPage';
import type { WorkflowDetailPageProps } from './workflow-detail-page/types';

export default function WorkflowDetailPage({ onNavigate, pageParams }: WorkflowDetailPageProps) {
  const workflowId = pageParams.workflowId as string | undefined;
  const page = useWorkflowDetailPage(workflowId);

  if (!workflowId) {
    return (
      <Stack gap="md">
        <Alert color="yellow">No workflow selected.</Alert>
        <Button variant="light" onClick={() => onNavigate('workflows', {})}>
          Back to Workflows
        </Button>
      </Stack>
    );
  }

  if (page.loading) {
    return (
      <Center p="xl">
        <Loader />
      </Center>
    );
  }

  if (!page.detail) {
    return (
      <Stack gap="md">
        <Alert color="red">Workflow not found.</Alert>
        <Button variant="light" onClick={() => onNavigate('workflows', {})}>
          Back to Workflows
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <WorkflowDetailHeader detail={page.detail} onNavigate={onNavigate} />

      <Tabs defaultValue="steps">
        <Tabs.List>
          <Tabs.Tab value="steps">Steps</Tabs.Tab>
          <Tabs.Tab value="diagnostics" leftSection={<IconHistory size={14} />}>
            Diagnostics
            {page.execSessions.length > 0 && (
              <Badge size="xs" variant="light" ml={4}>
                {page.execSessions.length}
              </Badge>
            )}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="steps" pt="sm">
          <StepsTabPanel detail={page.detail} />
        </Tabs.Panel>

        <Tabs.Panel value="diagnostics" pt="sm">
          <DiagnosticsTabPanel
            execLoading={page.execLoading}
            execSessions={page.execSessions}
            selectedExecSession={page.selectedExecSession}
            onSelectSession={page.setSelectedExecSession}
            workflowSteps={page.detail.steps}
            searchQuery={page.searchQuery}
            onSearchQueryChange={page.setSearchQuery}
            statusFilter={page.statusFilter}
            onStatusFilterChange={page.setStatusFilter}
            filteredSorted={page.filteredSorted}
            sortField={page.sortField}
            sortDir={page.sortDir}
            onToggleSort={page.toggleSort}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
