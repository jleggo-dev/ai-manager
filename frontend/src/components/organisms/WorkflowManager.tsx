/**
 * Organism – WorkflowManager
 * ----------------------------
 * Workflow list with delete/test modals.
 * Detail view is a full page (WorkflowDetailPage).
 * Create and edit are handled by the full-page WorkflowEditorPage.
 */

import { Stack } from '@mantine/core';
import { DeleteWorkflowModal } from './workflow-manager/DeleteWorkflowModal';
import { TestWorkflowModal } from './workflow-manager/TestWorkflowModal';
import { WorkflowCardView } from './workflow-manager/WorkflowCardView';
import { WorkflowListView } from './workflow-manager/WorkflowListView';
import {
  WorkflowManagerEmptyState,
  WorkflowManagerLoadingState,
  WorkflowManagerToolbar,
} from './workflow-manager/WorkflowManagerToolbar';
import { useWorkflowManager } from './workflow-manager/useWorkflowManager';
import type { WorkflowManagerProps } from './workflow-manager/types';

export default function WorkflowManager({ onNavigate, autoTestWorkflowId }: WorkflowManagerProps) {
  const manager = useWorkflowManager(autoTestWorkflowId);

  if (manager.loading) {
    return <WorkflowManagerLoadingState />;
  }

  return (
    <Stack gap="md">
      <WorkflowManagerToolbar
        workflowCount={manager.workflows.length}
        viewMode={manager.viewMode}
        onViewModeChange={manager.setViewMode}
        onNavigate={onNavigate}
      />

      {manager.workflows.length === 0 ? (
        <WorkflowManagerEmptyState />
      ) : manager.viewMode === 'list' ? (
        <WorkflowListView
          workflows={manager.workflows}
          onNavigate={onNavigate}
          onViewTest={manager.viewTest}
          onConfirmDelete={manager.confirmDelete}
        />
      ) : (
        <WorkflowCardView
          workflows={manager.workflows}
          onNavigate={onNavigate}
          onViewTest={manager.viewTest}
          onConfirmDelete={manager.confirmDelete}
        />
      )}

      <DeleteWorkflowModal
        opened={manager.deleteModalOpened}
        onClose={manager.closeDeleteModal}
        deleteTarget={manager.deleteTarget}
        onConfirm={manager.handleDelete}
      />

      <TestWorkflowModal opened={manager.testOpened} onClose={manager.closeTest} testTarget={manager.testTarget} />
    </Stack>
  );
}
