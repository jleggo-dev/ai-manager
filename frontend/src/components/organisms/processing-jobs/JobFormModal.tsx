import React from 'react';
import { Stack, Group, Button, TextInput, Select, Switch, Textarea, Modal } from '@mantine/core';
import type { CallingApplication } from '../../../types/api';
import type { ProcessingJobFormData } from './types';

interface JobFormModalProps {
  opened: boolean;
  onClose: () => void;
  editing: boolean;
  form: ProcessingJobFormData;
  setForm: React.Dispatch<React.SetStateAction<ProcessingJobFormData>>;
  profileOptions: { value: string; label: string }[];
  callingApps: CallingApplication[];
  setCallingApps: React.Dispatch<React.SetStateAction<CallingApplication[]>>;
  saving: boolean;
  onNameChange: (name: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

/** Create / edit processing-job modal. */
export default function JobFormModal({
  opened,
  onClose,
  editing,
  form,
  setForm,
  profileOptions,
  callingApps,
  setCallingApps,
  saving,
  onNameChange,
  onSubmit,
}: JobFormModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={editing ? 'Edit Processing Job' : 'New Processing Job'} size="lg">
      <form onSubmit={onSubmit}>
        <Stack gap="sm">
          <TextInput
            label="Job Name"
            placeholder="e.g. Company Profiling"
            value={form.name}
            onChange={(e) => onNameChange(e.target.value)}
            required
          />
          <TextInput
            label="Slug"
            placeholder="company-profiling"
            value={form.slug}
            onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
            required
            disabled={editing}
          />
          <Textarea
            label="Description"
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            minRows={2}
          />
          <Select
            label="AI Profile"
            placeholder="Select an AI profile"
            data={profileOptions}
            value={form.ai_profile_id}
            onChange={(v) => setForm((prev) => ({ ...prev, ai_profile_id: v }))}
            clearable
            searchable
          />
          {/* eslint-disable @typescript-eslint/no-explicit-any -- Mantine creatable Select workaround */}
          {React.createElement(
            Select as any,
            {
              label: 'Calling Application',
              description:
                'Which product or project owns this job? Pick from the list or type a new platform:project-name.',
              placeholder: 'e.g. lovable:my-marketplace',
              data: [
                ...callingApps.map((a: CallingApplication) => ({
                  value: a.id,
                  label: a.display_name !== a.id ? `${a.display_name} (${a.id})` : a.id,
                })),
              ],
              value: form.calling_application_id,
              onChange: (v: string | null) =>
                setForm((prev: ProcessingJobFormData) => ({ ...prev, calling_application_id: v })),
              clearable: true,
              searchable: true,
              creatable: true,
              getCreateLabel: (query: string) => `+ Register "${query}"`,
              onCreate: (query: string) => {
                const trimmed = query
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9:_-]+/g, '-')
                  .replace(/(^-|-$)/g, '');
                if (!trimmed) return null;
                const newItem = { value: trimmed, label: trimmed };
                setCallingApps((prev) => [
                  ...prev,
                  {
                    id: trimmed,
                    display_name: trimmed,
                    workspace_id: '',
                    created_at: new Date().toISOString(),
                  },
                ]);
                setForm((prev: ProcessingJobFormData) => ({ ...prev, calling_application_id: trimmed }));
                return newItem;
              },
            } as any,
          )}
          {/* eslint-enable @typescript-eslint/no-explicit-any */}
          <Switch
            label="Active"
            checked={form.is_active}
            onChange={(e) => {
              const v = e.currentTarget.checked;
              setForm((prev) => ({ ...prev, is_active: v }));
            }}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Update' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
