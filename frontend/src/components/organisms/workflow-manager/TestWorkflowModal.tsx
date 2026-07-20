import { Modal } from '@mantine/core';
import WorkflowTestSimulator from '../WorkflowTestSimulator';
import type { WorkflowDetail } from './types';

interface Props {
  opened: boolean;
  onClose: () => void;
  testTarget: WorkflowDetail | null;
}

export function TestWorkflowModal({ opened, onClose, testTarget }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={testTarget ? `Test: ${testTarget.name}` : 'Test Workflow'}
      size="xl"
      fullScreen
    >
      {testTarget && <WorkflowTestSimulator workflow={testTarget} onClose={onClose} />}
    </Modal>
  );
}
