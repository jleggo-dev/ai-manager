/**
 * Page – WorkflowEditorPage
 * Full-page editor for creating/editing workflows with drag-and-drop
 * variable mapping. Replaces the modal-based editor from WorkflowManager.
 */
import { Stack, Group, Center, Loader } from '@mantine/core';
import WorkflowStepSidebar from '../components/molecules/WorkflowStepSidebar';
import WorkflowInputEditor from '../components/molecules/WorkflowInputEditor';
import StepVariableMapper from '../components/molecules/StepVariableMapper';
import { ExecutionsDrawer } from './workflow-editor-page/ExecutionsDrawer';
import { WorkflowEditorHeader } from './workflow-editor-page/WorkflowEditorHeader';
import { useWorkflowEditorPage } from './workflow-editor-page/useWorkflowEditorPage';
import type { WorkflowEditorPageProps } from './workflow-editor-page/types';

export default function WorkflowEditorPage({ onNavigate, pageParams }: WorkflowEditorPageProps) {
  const workflowId = pageParams.workflowId as string | undefined;
  const editor = useWorkflowEditorPage(onNavigate, workflowId);

  if (editor.loading) {
    return (
      <Center p="xl" h={400}>
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md" h="100%">
      <WorkflowEditorHeader
        onNavigate={onNavigate}
        isEditing={editor.isEditing}
        formName={editor.form.name}
        saving={editor.saving}
        existingWorkflow={editor.existingWorkflow}
        onViewExecutions={editor.viewExecutions}
        onSave={editor.handleSave}
      />

      <Group align="flex-start" gap="md" wrap="nowrap" style={{ flex: 1 }}>
        <WorkflowStepSidebar
          steps={editor.steps}
          selectedId={editor.selectedStepId}
          onSelect={editor.setSelectedStepId}
          onAddStep={editor.addStep}
          onMoveStep={editor.moveStep}
          onRemoveStep={editor.removeStep}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          {editor.selectedStepId === null && (
            <WorkflowInputEditor
              form={editor.form}
              onChange={(updates) => editor.setForm((prev) => ({ ...prev, ...updates }))}
              profileOptions={editor.profileOptions}
            />
          )}

          {editor.selectedStep && editor.selectedStepIndex >= 0 && (
            <StepVariableMapper
              step={editor.selectedStep}
              stepIndex={editor.selectedStepIndex}
              jobs={editor.jobs}
              allStepKeys={editor.allStepKeys}
              availableVars={editor.getAvailableVarsForStep(editor.selectedStepIndex)}
              onUpdate={(updates) => editor.updateStep(editor.selectedStepIndex, updates)}
            />
          )}
        </div>
      </Group>

      <ExecutionsDrawer
        opened={editor.execDrawerOpened}
        onClose={editor.closeExecDrawer}
        execLoading={editor.execLoading}
        execSessions={editor.execSessions}
        selectedExecSession={editor.selectedExecSession}
        onSelectSession={editor.setSelectedExecSession}
        workflowSteps={editor.existingWorkflow?.steps}
      />
    </Stack>
  );
}
