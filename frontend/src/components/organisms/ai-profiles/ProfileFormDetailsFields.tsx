/**
 * ai-profiles/ProfileFormDetailsFields
 * ------------------------------------
 * Name / description / active toggle and submit actions for the profile form modal.
 * Extracted from ProfileFormModal (FE-14) as a structural, behavior-preserving move.
 */

import { Button, Group, Switch, Textarea, TextInput } from '@mantine/core';

interface ProfileFormDetailsFieldsProps {
  editing: boolean;
  saving: boolean;
  effectiveProfileType: string;
  name: string;
  description: string;
  isActive: boolean;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onActiveChange: (isActive: boolean) => void;
  onCancel: () => void;
}

export default function ProfileFormDetailsFields({
  editing,
  saving,
  effectiveProfileType,
  name,
  description,
  isActive,
  onNameChange,
  onDescriptionChange,
  onActiveChange,
  onCancel,
}: ProfileFormDetailsFieldsProps) {
  return (
    <>
      <TextInput
        data-testid="profile-name-input"
        label="Profile Name"
        placeholder={effectiveProfileType === 'agent' ? 'e.g. GPT-5.2 Generic' : 'e.g. Claude 4 Sonnet'}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        required
      />
      <Textarea
        label="Description (optional)"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        minRows={2}
      />
      <Switch label="Active" checked={isActive} onChange={(e) => onActiveChange(e.currentTarget.checked)} />
      <Group justify="flex-end">
        <Button variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {editing ? 'Update' : 'Create'}
        </Button>
      </Group>
    </>
  );
}
