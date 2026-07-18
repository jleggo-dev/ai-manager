/**
 * ai-profiles/ProfileListView
 * -----------------------------
 * Toolbar (search/filter/sort/group/view-toggle) + table/card profile list.
 * Extracted from AiProfileManager.tsx (FE-02) as a structural, behavior-preserving move.
 */

import {
  Stack,
  Group,
  TextInput,
  Select,
  Alert,
  SimpleGrid,
  Text,
  Badge,
  Paper,
  ScrollArea,
  ActionIcon,
  SegmentedControl,
  Title,
  CloseButton,
  Table,
  Tooltip,
  Checkbox,
  Menu,
  CopyButton,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconSearch,
  IconArrowsShuffle,
  IconLayoutGrid,
  IconList,
  IconEdit,
  IconTrash,
  IconDotsVertical,
  IconMessageCircle,
  IconStar,
  IconStarFilled,
  IconCheck,
} from '@tabler/icons-react';
import AiProfileCard from '../../molecules/AiProfileCard';
import type { AiProfile } from '../../../types/api';

type FilteredAndGrouped =
  | { type: 'flat'; items: AiProfile[] }
  | { type: 'grouped'; groups: Array<{ label: string; items: AiProfile[] }> };

export interface ProfileListViewProps {
  profiles: AiProfile[];
  search: string;
  setSearch: (v: string) => void;
  filterProvider: string;
  setFilterProvider: (v: string) => void;
  filterMode: string;
  setFilterMode: (v: string) => void;
  filterStatus: string;
  setFilterStatus: (v: string) => void;
  sortBy: string;
  setSortBy: (v: string) => void;
  groupBy: string;
  setGroupBy: (v: string) => void;
  providerFilterOptions: Array<{ value: string; label: string }>;
  filteredAndGroupedProfiles: FilteredAndGrouped;
  isFiltered: boolean;
  visibleCount: number;
  viewMode: string;
  setViewMode: (v: string) => void;
  checkedProfileIds: Set<string>;
  toggleProfileChecked: (id: string) => void;
  toggleSelectAll: (ids: string[]) => void;
  onEdit: (profile: AiProfile) => void;
  onDelete: (id: string) => void;
  onTestChat: (profile: AiProfile) => void;
  onToggleDefault: (id: string, setAsDefault: boolean) => void;
  onConfigureFailover: (profile: AiProfile) => void;
}

export default function ProfileListView({
  profiles,
  search,
  setSearch,
  filterProvider,
  setFilterProvider,
  filterMode,
  setFilterMode,
  filterStatus,
  setFilterStatus,
  sortBy,
  setSortBy,
  groupBy,
  setGroupBy,
  providerFilterOptions,
  filteredAndGroupedProfiles,
  isFiltered,
  visibleCount,
  viewMode,
  setViewMode,
  checkedProfileIds,
  toggleProfileChecked,
  toggleSelectAll,
  onEdit,
  onDelete,
  onTestChat,
  onToggleDefault,
  onConfigureFailover,
}: ProfileListViewProps) {
  const profileCardProps = (p: AiProfile) => ({
    profile: p,
    onEdit,
    onDelete,
    onTestChat,
    onToggleDefault,
    onConfigureFailover,
  });

  return (
    <>
      {/* Toolbar: search, filter, sort, group-by */}
      <Group gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search profiles..."
          leftSection={<IconSearch size={14} />}
          rightSection={search ? <CloseButton size="sm" onClick={() => setSearch('')} /> : null}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          style={{ flex: 1, minWidth: 180 }}
        />
        <Select
          size="sm"
          data={providerFilterOptions}
          value={filterProvider}
          onChange={(v) => setFilterProvider(v || 'all')}
          w={160}
          allowDeselect={false}
        />
        <SegmentedControl
          size="xs"
          value={filterMode}
          onChange={setFilterMode}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Completion', value: 'completion' },
            { label: 'Chat', value: 'chat' },
          ]}
        />
        <SegmentedControl
          size="xs"
          value={filterStatus}
          onChange={setFilterStatus}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ]}
        />
        <Select
          size="sm"
          placeholder="Sort"
          data={[
            { value: 'name-asc', label: 'Name A–Z' },
            { value: 'name-desc', label: 'Name Z–A' },
            { value: 'newest', label: 'Newest first' },
            { value: 'oldest', label: 'Oldest first' },
            { value: 'provider', label: 'Provider' },
          ]}
          value={sortBy}
          onChange={(v) => setSortBy(v || 'name-asc')}
          w={140}
          allowDeselect={false}
        />
        <Select
          size="sm"
          placeholder="Group by"
          data={[
            { value: 'none', label: 'No grouping' },
            { value: 'provider', label: 'Group by provider' },
            { value: 'mode', label: 'Group by mode' },
          ]}
          value={groupBy}
          onChange={(v) => setGroupBy(v || 'none')}
          w={160}
          allowDeselect={false}
        />
        <Group gap={4}>
          <Tooltip label="Card view">
            <ActionIcon
              variant={viewMode === 'grid' ? 'filled' : 'subtle'}
              onClick={() => setViewMode('grid')}
              size="sm"
            >
              <IconLayoutGrid size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="List view">
            <ActionIcon
              variant={viewMode === 'list' ? 'filled' : 'subtle'}
              onClick={() => setViewMode('list')}
              size="sm"
            >
              <IconList size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Result count */}
      <Text size="sm" c="dimmed">
        {isFiltered
          ? `Showing ${visibleCount} of ${profiles.length} profiles`
          : `${profiles.length} profile${profiles.length !== 1 ? 's' : ''}`}
      </Text>

      {/* Profile display */}
      {profiles.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
          No AI profiles configured. Add one to assign to processing jobs.
        </Alert>
      ) : visibleCount === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="gray" variant="light">
          No profiles match your filters.
        </Alert>
      ) : viewMode === 'list' ? (
        /* List / Table View */
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <ScrollArea>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 36 }}>
                    <Checkbox
                      size="xs"
                      checked={checkedProfileIds.size > 0 && checkedProfileIds.size === visibleCount}
                      indeterminate={checkedProfileIds.size > 0 && checkedProfileIds.size < visibleCount}
                      onChange={() => {
                        const allVisible =
                          filteredAndGroupedProfiles.type === 'flat'
                            ? filteredAndGroupedProfiles.items.map((p) => p.id)
                            : filteredAndGroupedProfiles.groups.flatMap((g) => g.items.map((p) => p.id));
                        toggleSelectAll(allVisible);
                      }}
                    />
                  </Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Profile ID</Table.Th>
                  <Table.Th>Provider</Table.Th>
                  <Table.Th>Model / Agent</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Mode</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Failover</Table.Th>
                  <Table.Th style={{ width: 80 }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(filteredAndGroupedProfiles.type === 'flat'
                  ? filteredAndGroupedProfiles.items
                  : filteredAndGroupedProfiles.groups.flatMap((g) => g.items)
                ).map((p) => (
                  <Table.Tr
                    key={p.id}
                    bg={
                      checkedProfileIds.has(p.id)
                        ? 'var(--mantine-color-blue-0)'
                        : p.is_default
                          ? 'var(--mantine-color-yellow-0)'
                          : undefined
                    }
                  >
                    <Table.Td>
                      <Checkbox
                        size="xs"
                        checked={checkedProfileIds.has(p.id)}
                        onChange={() => toggleProfileChecked(p.id)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        <Text size="xs" fw={600}>
                          {p.name}
                        </Text>
                        {p.is_default && (
                          <Badge size="xs" variant="filled" color="yellow" c="dark">
                            Default
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <CopyButton value={p.id}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? 'Copied!' : 'Copy profile ID'} withArrow>
                            <Text
                              size="xs"
                              c={copied ? 'teal' : 'dimmed'}
                              style={{
                                cursor: 'pointer',
                                fontFamily: 'monospace',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                copy();
                              }}
                            >
                              {p.id.slice(0, 8)}…{' '}
                              {copied && <IconCheck size={10} style={{ verticalAlign: 'middle' }} />}
                            </Text>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{p.provider?.name || '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" truncate style={{ maxWidth: 160 }}>
                        {p.external_ai_id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={p.profile_type === 'model' ? 'violet' : 'teal'}>
                        {p.profile_type === 'model' ? 'Model' : 'Agent'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={p.mode === 'chat' ? 'orange' : 'teal'}>
                        {p.mode === 'chat' ? 'Chat' : 'Completion'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" variant="light" color={p.is_active ? 'green' : 'gray'}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {p.failover_provider ? (
                        <Text size="xs" c="orange.7">
                          {p.failover_provider.name}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Menu shadow="md" width={160} position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" size="sm">
                            <IconDotsVertical size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => onEdit(p)}>
                            Edit
                          </Menu.Item>
                          <Menu.Item leftSection={<IconMessageCircle size={14} />} onClick={() => onTestChat(p)}>
                            Test chat
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<IconArrowsShuffle size={14} />}
                            onClick={() => onConfigureFailover(p)}
                          >
                            Failover
                          </Menu.Item>
                          <Menu.Item
                            leftSection={p.is_default ? <IconStarFilled size={14} /> : <IconStar size={14} />}
                            onClick={() => onToggleDefault(p.id, !p.is_default)}
                          >
                            {p.is_default ? 'Remove default' : 'Set default'}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => onDelete(p.id)}>
                            Delete
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      ) : filteredAndGroupedProfiles.type === 'flat' ? (
        /* Card view (flat) */
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {filteredAndGroupedProfiles.items.map((p) => (
            <AiProfileCard key={p.id} {...profileCardProps(p)} />
          ))}
        </SimpleGrid>
      ) : (
        /* Card view (grouped) */
        <Stack gap="lg">
          {filteredAndGroupedProfiles.groups.map((g) => (
            <Stack key={g.label} gap="xs">
              <Title order={5} c="dimmed">
                {g.label}
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                {g.items.map((p) => (
                  <AiProfileCard key={p.id} {...profileCardProps(p)} />
                ))}
              </SimpleGrid>
            </Stack>
          ))}
        </Stack>
      )}
    </>
  );
}
