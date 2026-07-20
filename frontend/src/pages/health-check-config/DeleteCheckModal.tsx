import { Stack, Text, Switch, Alert, Group, Button, Modal } from '@mantine/core';
import type { HcCheck } from '../../types/api';

interface DeleteCheckModalProps {
  opened: boolean;
  onClose: () => void;
  deletingCheck: HcCheck | null;
  deleteAlsoProfile: boolean;
  onDeleteAlsoProfileChange: (value: boolean) => void;
  onDelete: () => void;
  saving: boolean;
}

export function DeleteCheckModal({
  opened,
  onClose,
  deletingCheck,
  deleteAlsoProfile,
  onDeleteAlsoProfileChange,
  onDelete,
  saving,
}: DeleteCheckModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Delete Health Check" size="sm">
      <Stack gap="md">
        <Text size="sm">
          Are you sure you want to delete <strong>{deletingCheck?.name}</strong>? All run history and incidents will be
          permanently removed.
        </Text>
        <Switch
          label="Also delete the linked profile"
          checked={deleteAlsoProfile}
          onChange={(e) => {
            const v = e.currentTarget.checked;
            onDeleteAlsoProfileChange(v);
          }}
        />
        {deleteAlsoProfile && (
          <Alert color="orange" variant="light" title="Profile will be removed">
            The linked health check profile will also be deleted. This cannot be undone.
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="red" onClick={onDelete} loading={saving}>
            {deleteAlsoProfile ? 'Delete Both' : 'Delete Check Only'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
