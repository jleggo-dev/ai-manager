import { Group, TextInput, Select, SegmentedControl, ActionIcon, Tooltip, CloseButton } from '@mantine/core';
import { IconSearch, IconLayoutGrid, IconList } from '@tabler/icons-react';

export default function JobsToolbar({
  jobSearch,
  jobFilterStatus,
  jobFilterMode,
  jobSortBy,
  viewMode,
  onSearchChange,
  onFilterStatusChange,
  onFilterModeChange,
  onSortByChange,
  onViewModeChange,
}: {
  jobSearch: string;
  jobFilterStatus: string;
  jobFilterMode: string;
  jobSortBy: string;
  viewMode: string;
  onSearchChange: (value: string) => void;
  onFilterStatusChange: (value: string) => void;
  onFilterModeChange: (value: string) => void;
  onSortByChange: (value: string) => void;
  onViewModeChange: (value: string) => void;
}) {
  return (
    <Group gap="sm" wrap="wrap">
      <TextInput
        placeholder="Search jobs..."
        leftSection={<IconSearch size={14} />}
        rightSection={jobSearch ? <CloseButton size="sm" onClick={() => onSearchChange('')} /> : null}
        value={jobSearch}
        onChange={(e) => onSearchChange(e.target.value)}
        size="sm"
        style={{ flex: 1, minWidth: 180 }}
      />
      <SegmentedControl
        size="xs"
        value={jobFilterStatus}
        onChange={onFilterStatusChange}
        data={[
          { label: 'All', value: 'all' },
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' },
        ]}
      />
      <SegmentedControl
        size="xs"
        value={jobFilterMode}
        onChange={onFilterModeChange}
        data={[
          { label: 'All', value: 'all' },
          { label: 'Completion', value: 'completion' },
          { label: 'Chat', value: 'chat' },
        ]}
      />
      <Select
        size="sm"
        data={[
          { value: 'default', label: 'Default order' },
          { value: 'name-asc', label: 'Name A–Z' },
          { value: 'name-desc', label: 'Name Z–A' },
          { value: 'newest', label: 'Newest first' },
        ]}
        value={jobSortBy}
        onChange={(v) => onSortByChange(v || 'default')}
        w={150}
        allowDeselect={false}
      />
      <Group gap={4}>
        <Tooltip label="Card view">
          <ActionIcon
            variant={viewMode === 'card' ? 'filled' : 'subtle'}
            onClick={() => onViewModeChange('card')}
            size="sm"
          >
            <IconLayoutGrid size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="List view">
          <ActionIcon
            variant={viewMode === 'list' ? 'filled' : 'subtle'}
            onClick={() => onViewModeChange('list')}
            size="sm"
          >
            <IconList size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
