import { Group, Card, Text, Badge, ActionIcon, Tooltip, Checkbox, Menu, CopyButton } from '@mantine/core';
import { IconEdit, IconTrash, IconBrain, IconFolder, IconDotsVertical } from '@tabler/icons-react';
import type { ProcessingJob } from '../../../types/api';

export default function JobCard({
  job,
  dimmed,
  isChecked,
  isSelected,
  isDragging,
  pickerCount,
  onSelect,
  onToggleChecked,
  onDragStart,
  onDragEnd,
  onOpenPicker,
  onEdit,
  onDelete,
}: {
  job: ProcessingJob;
  dimmed: boolean;
  isChecked: boolean;
  isSelected: boolean;
  isDragging: boolean;
  pickerCount: number;
  onSelect: () => void;
  onToggleChecked: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpenPicker: (type: 'profile' | 'group') => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      key={job.id}
      padding="sm"
      withBorder
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        cursor: 'pointer',
        backgroundColor: isChecked
          ? 'var(--mantine-color-blue-0)'
          : isSelected
            ? 'var(--mantine-color-gray-0)'
            : undefined,
        borderLeft: isSelected
          ? '3px solid var(--mantine-color-blue-5)'
          : isChecked
            ? '3px solid var(--mantine-color-blue-3)'
            : '3px solid transparent',
        opacity: dimmed ? 0.35 : isDragging ? 0.6 : 1,
        transition: 'opacity 150ms ease, background-color 150ms ease',
      }}
      onClick={onSelect}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Checkbox size="xs" checked={isChecked} onChange={onToggleChecked} onClick={(e) => e.stopPropagation()} />
          <Text fw={600} size="sm" truncate>
            {job.name}
          </Text>
          <Badge size="xs" variant="outline">
            {job.slug}
          </Badge>
          <CopyButton value={job.id}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy job ID'} withArrow>
                <Badge
                  size="xs"
                  variant="dot"
                  color={copied ? 'teal' : 'gray'}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    copy();
                  }}
                >
                  {job.id.slice(0, 8)}…
                </Badge>
              </Tooltip>
            )}
          </CopyButton>
          <Badge size="xs" variant="light" color={job.is_active ? 'green' : 'gray'}>
            {job.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </Group>
        <Group gap={4} wrap="nowrap">
          <Menu shadow="md" width={200} position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" size="sm" onClick={(e) => e.stopPropagation()}>
                <IconDotsVertical size={14} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
              <Menu.Item leftSection={<IconBrain size={14} />} onClick={() => onOpenPicker('profile')}>
                Change AI profile {pickerCount > 1 ? `(${pickerCount})` : ''}
              </Menu.Item>
              <Menu.Item leftSection={<IconFolder size={14} />} onClick={() => onOpenPicker('group')}>
                Move to group {pickerCount > 1 ? `(${pickerCount})` : ''}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
                Edit
              </Menu.Item>
              <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={onDelete}>
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mt={4} ml={28}>
        AI: {job.ai_profile?.name || 'Not assigned'} — {job.description || 'No description'}
      </Text>
    </Card>
  );
}
