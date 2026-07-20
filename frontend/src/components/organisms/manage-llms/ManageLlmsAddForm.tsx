import { Group, Text, TextInput, Select, Button } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

interface ManageLlmsAddFormProps {
  newModelId: string;
  newDisplayName: string;
  newCategory: string;
  categorySelectData: Array<{ value: string; label: string }>;
  onModelIdChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onAdd: () => void;
}

export function ManageLlmsAddForm({
  newModelId,
  newDisplayName,
  newCategory,
  categorySelectData,
  onModelIdChange,
  onDisplayNameChange,
  onCategoryChange,
  onAdd,
}: ManageLlmsAddFormProps) {
  return (
    <>
      <Text size="sm" fw={600} mt="xs">
        Add Model
      </Text>
      <Group gap="xs" align="flex-end">
        <TextInput
          label="Model ID"
          placeholder="e.g. gpt-5.3-codex"
          value={newModelId}
          onChange={(e) => onModelIdChange(e.target.value)}
          style={{ flex: 2 }}
          size="xs"
        />
        <TextInput
          label="Display Name"
          placeholder="Auto-generated if blank"
          value={newDisplayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          style={{ flex: 2 }}
          size="xs"
        />
        <Select
          label="Category"
          placeholder="Auto-detect"
          data={categorySelectData}
          value={newCategory}
          onChange={(v) => onCategoryChange(v || '')}
          clearable
          searchable
          style={{ flex: 1 }}
          size="xs"
        />
        <Button size="xs" leftSection={<IconPlus size={12} />} onClick={onAdd} disabled={!newModelId.trim()}>
          Add
        </Button>
      </Group>
    </>
  );
}
