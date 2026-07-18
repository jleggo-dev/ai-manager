import { Stack, Group, Button, Text, TextInput, Alert, Modal, Code } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { ProcessingJob } from '../../../types/api';

interface DeleteJobModalProps {
  opened: boolean;
  onClose: () => void;
  job: ProcessingJob | null;
  confirmText: string;
  onConfirmTextChange: (value: string) => void;
  deleting: boolean;
  onConfirm: () => void;
}

/** Typed-confirmation delete modal for a processing job. */
export default function DeleteJobModal({
  opened,
  onClose,
  job,
  confirmText,
  onConfirmTextChange,
  deleting,
  onConfirm,
}: DeleteJobModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Delete Processing Job" size="md">
      <Stack gap="sm">
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          This will permanently delete the processing job
          {job?.name ? ` "${job.name}"` : ''}. Calling applications rely on processing jobs, so this may break active
          workflows.
        </Alert>
        <Text size="sm">
          Type <Code>delete</Code> to confirm.
        </Text>
        <TextInput
          value={confirmText}
          onChange={(e) => onConfirmTextChange(e.currentTarget.value)}
          placeholder="delete"
          autoFocus
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="red"
            loading={deleting}
            disabled={confirmText.trim().toLowerCase() !== 'delete'}
            onClick={onConfirm}
          >
            Delete Job
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
