import { Group, Button, Modal } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import { HealthCheckEditFormFields } from './HealthCheckEditFormFields';
import type { FormState } from './helpers';

interface EditCheckModalProps {
  opened: boolean;
  onClose: () => void;
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  onSave: () => void;
  saving: boolean;
}

export function EditCheckModal({ opened, onClose, form, setForm, onSave, saving }: EditCheckModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Edit Health Check" size="md">
      {opened && (
        <>
          <HealthCheckEditFormFields form={form} setForm={setForm} />
          <Group justify="flex-end" mt="lg">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onSave} loading={saving} disabled={!form.name || !form.health_check_profile_id}>
              Save
            </Button>
          </Group>
        </>
      )}
    </Modal>
  );
}
