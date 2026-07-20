import { Stack, Group, Button, Modal, Select, TextInput, PasswordInput, Switch } from '@mantine/core';
import type { Dispatch, SetStateAction } from 'react';
import type { KeyFormState } from './types';

interface AddProviderKeyModalProps {
  opened: boolean;
  onClose: () => void;
  form: KeyFormState;
  setForm: Dispatch<SetStateAction<KeyFormState>>;
  providerSelectData: { value: string; label: string }[];
  onCreate: () => void;
  submitting: boolean;
}

export function AddProviderKeyModal({
  opened,
  onClose,
  form,
  setForm,
  providerSelectData,
  onCreate,
  submitting,
}: AddProviderKeyModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Add Provider Key" centered>
      <Stack>
        <Select
          label="Provider"
          placeholder="Select a provider"
          data={providerSelectData}
          value={form.provider_id}
          onChange={(val) => setForm((prev) => ({ ...prev, provider_id: val ?? '' }))}
          required
        />
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
          placeholder="Enter API key"
          value={form.api_key}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setForm((prev) => ({ ...prev, api_key: v }));
          }}
          required
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
          <Button onClick={onCreate} loading={submitting}>
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
