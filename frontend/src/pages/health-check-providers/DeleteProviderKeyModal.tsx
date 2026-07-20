import { Stack, Group, Button, Modal, Text } from '@mantine/core';
import type { HcProviderKey } from '../../types/api';

interface DeleteProviderKeyModalProps {
  opened: boolean;
  onClose: () => void;
  deletingKey: HcProviderKey | null;
  onDelete: () => void;
  submitting: boolean;
}

export function DeleteProviderKeyModal({
  opened,
  onClose,
  deletingKey,
  onDelete,
  submitting,
}: DeleteProviderKeyModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Delete Provider Key" centered>
      <Stack>
        <Text>
          Are you sure you want to delete the key{' '}
          <Text span fw={600}>
            {deletingKey?.name}
          </Text>
          ? This action cannot be undone.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color="red" onClick={onDelete} loading={submitting}>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
