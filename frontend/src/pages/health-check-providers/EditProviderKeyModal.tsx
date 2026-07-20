import { Stack, Group, Button, Modal, Select, TextInput, PasswordInput, Switch } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import type { KeyFormState } from './types';

interface EditProviderKeyModalProps {
  opened: boolean;
  onClose: () => void;
  form: KeyFormState;
  setForm: Dispatch<SetStateAction<KeyFormState>>;
  providerSelectData: { value: string; label: string }[];
  onUpdate: () => void;
  submitting: boolean;
}

export function EditProviderKeyModal({
  opened,
  onClose,
  form,
  setForm,
  providerSelectData,
  onUpdate,
  submitting,
}: EditProviderKeyModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Edit Provider Key" centered>
      <Stack>
        <Select label="Provider" data={providerSelectData} value={form.provider_id} disabled />
        <TextInput
          label="Name"
          placeholder="Key name"
          value={form.name}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setForm((prev) => ({ ...prev, name: v }));
          }}
          required
        />
        <PasswordInput
          label="API Key"
          placeholder="Leave blank to keep current"
          value={form.api_key}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setForm((prev) => ({ ...prev, api_key: v }));
          }}
        />
        <Switch
          label="Active"
          checked={form.is_active}
          onChange={(e) => {
            const v = e.currentTarget.checked;
            setForm((prev) => ({ ...prev, is_active: v }));
          }}
        />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onUpdate} loading={submitting}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
