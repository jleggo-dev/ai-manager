import { Modal, Stack, Text, Group, Button } from '@mantine/core';
import type { Workflow } from '../../../types/api';

interface Props {
  opened: boolean;
  onClose: () => void;
  deleteTarget: Workflow | null;
  onConfirm: () => void;
}

export function DeleteWorkflowModal({ opened, onClose, deleteTarget, onConfirm }: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title="Delete Workflow" size="sm">
      <Stack gap="sm">
        <Text size="sm">
          Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This will remove the workflow and all
          its step configurations. The underlying processing jobs will not be affected.
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="red" onClick={onConfirm}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
