import { useState, useMemo } from 'react';
import {
  Stack,
  Group,
  Button,
  Card,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  Modal,
  TextInput,
  Select,
  Checkbox,
  Alert,
  Paper,
  ScrollArea,
  Table,
  SegmentedControl,
  Collapse,
  UnstyledButton,
  CloseButton,
  Menu,
  CopyButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconEdit,
  IconTrash,
  IconChevronDown,
  IconSearch,
  IconAlertCircle,
  IconApps,
  IconSettings,
  IconCheck,
  IconX,
  IconBrain,
  IconFolder,
  IconLayoutGrid,
  IconList,
  IconDotsVertical,
} from '@tabler/icons-react';
import { slugify } from '../../../lib/slugify';
import useConfirm from '../../../hooks/useConfirm';
import * as api from '../../../services/api';
import type { ProcessingJob, ProcessingJobGroup, AiProfile, CallingApplication } from '../../../types/api';
import type { CallingAppEntry } from './types';
import { getJobConfig } from './types';
import { useJobBulkActions } from './useJobBulkActions';

/* ══════════════════════════════════════════════════════════════
   JOBS TAB
   ══════════════════════════════════════════════════════════════ */

function getCallingAppMeta(job: ProcessingJob, callingAppsLookup: Map<string, CallingApplication>) {
  const colId = job?.calling_application_id || null;
  const appId = colId || 'unknown-calling-application';
  const registered = callingAppsLookup?.get(appId);
  return {
    appId,
    appName: registered?.display_name || appId,
    isUnknown: !colId,
  };
}

function buildJobsByCallingApp(
  jobs: ProcessingJob[],
  subgroups: ProcessingJobGroup[],
  callingAppsLookup: Map<string, CallingApplication>,
) {
  const appMap = new Map<string, CallingAppEntry>();
  const subgroupById = new Map<string, ProcessingJobGroup>((subgroups || []).map((g) => [g.id, g]));

  for (const job of jobs || []) {
    const meta = getCallingAppMeta(job, callingAppsLookup);
    if (!appMap.has(meta.appId)) {
      appMap.set(meta.appId, { ...meta, jobs: [], grouped: [], ungrouped: [], totalJobs: 0 });
    }
    const entry = appMap.get(meta.appId);
    if (entry) entry.jobs.push(job);
  }

  const apps: CallingAppEntry[] = [];
  for (const app of appMap.values()) {
    const appGroups = (subgroups || [])
      .filter((group) => group.app_id === app.appId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));

    const grouped = appGroups.map((group) => ({ group, jobs: [] as ProcessingJob[] }));
    const ungrouped: ProcessingJob[] = [];
    for (const job of app.jobs) {
      const subgroupId = getJobConfig(job).subgroupId || null;
      const subgroup = subgroupId ? subgroupById.get(subgroupId) : null;
      if (!subgroup || subgroup.app_id !== app.appId) {
        ungrouped.push(job);
        continue;
      }
      const target = grouped.find((entry) => entry.group.id === subgroup.id);
      if (target) target.jobs.push(job);
      else ungrouped.push(job);
    }

    apps.push({
      ...app,
      grouped,
      ungrouped,
      totalJobs: app.jobs.length,
    });
  }

  return apps.sort((a, b) => {
    if (a.isUnknown) return 1;
    if (b.isUnknown) return -1;
    return a.appName.localeCompare(b.appName);
  });
}

export default function JobsTab({
  jobs,
  jobGroups,
  aiProfiles,
  callingApps,
  selectedJob,
  onSelect,
  onEdit,
  onDelete,
  onCreate,
  onRefresh,
}: {
  jobs: ProcessingJob[];
  jobGroups: ProcessingJobGroup[];
  aiProfiles: AiProfile[];
  callingApps: CallingApplication[];
  selectedJob: string | null;
  onSelect: (id: string) => void;
  onEdit: (job: ProcessingJob) => void;
  onDelete: (job: ProcessingJob) => void;
  onCreate: () => void;
  onRefresh: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({});
  const [expandedSubgroups, setExpandedSubgroups] = useState<Record<string, boolean>>({});
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null);

  const {
    checkedIds,
    setCheckedIds,
    toggleChecked,
    clearChecked,
    hasChecked,
    bulkApplying,
    bulkToggleActive,
    picker,
    setPicker,
    openPicker,
    closePicker,
    applyPicker,
  } = useJobBulkActions(jobs, onRefresh);

  /* Profile / group select options */
  const profileSelectData = useMemo(
    () =>
      (aiProfiles || [])
        .filter((p) => p.is_active)
        .map((p) => ({
          value: p.id,
          label: `${p.name}${p.provider?.name ? ` (${p.provider.name})` : ''}`,
        })),
    [aiProfiles],
  );
  const groupSelectData = useMemo(() => (jobGroups || []).map((g) => ({ value: g.id, label: g.name })), [jobGroups]);

  /* ── View mode ── */
  const [viewMode, setViewMode] = useState('list');

  /* ── Search, filter, sort state ── */
  const [jobSearch, setJobSearch] = useState('');
  const [jobFilterStatus, setJobFilterStatus] = useState('all');
  const [jobFilterMode, setJobFilterMode] = useState('all');
  const [jobSortBy, setJobSortBy] = useState('default');

  const matchingJobIds = useMemo(() => {
    const term = jobSearch.toLowerCase().trim();
    let list = jobs;

    if (term) {
      list = list.filter((j) => {
        const haystack = [j.name, j.slug, j.description, j.ai_profile?.name].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(term);
      });
    }
    if (jobFilterStatus !== 'all') {
      const wantActive = jobFilterStatus === 'active';
      list = list.filter((j) => j.is_active === wantActive);
    }
    if (jobFilterMode !== 'all') {
      list = list.filter((j) => (j.ai_profile?.mode || 'completion') === jobFilterMode);
    }
    return new Set(list.map((j) => j.id));
  }, [jobs, jobSearch, jobFilterStatus, jobFilterMode]);

  const isJobFiltered = !!(jobSearch || jobFilterStatus !== 'all' || jobFilterMode !== 'all');
  const matchCount = matchingJobIds.size;

  function sortJobs(jobList: ProcessingJob[]) {
    if (jobSortBy === 'default') return jobList;
    const sorters: Record<string, (a: ProcessingJob, b: ProcessingJob) => number> = {
      'name-asc': (a, b) => (a.name || '').localeCompare(b.name || ''),
      'name-desc': (a, b) => (b.name || '').localeCompare(a.name || ''),
      newest: (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    };
    return [...jobList].sort(sorters[jobSortBy] || (() => 0));
  }

  const callingAppsLookup = useMemo(
    () => new Map<string, CallingApplication>((callingApps || []).map((a) => [a.id, a])),
    [callingApps],
  );

  const apps = useMemo(() => {
    const raw = buildJobsByCallingApp(jobs, jobGroups, callingAppsLookup);
    if (!isJobFiltered && jobSortBy === 'default') return raw;
    return raw
      .map((app) => ({
        ...app,
        grouped: app.grouped.map((g: { group: ProcessingJobGroup; jobs: ProcessingJob[] }) => ({
          ...g,
          jobs: sortJobs(g.jobs),
        })),
        ungrouped: sortJobs(app.ungrouped),
      }))
      .filter((app) => {
        if (!isJobFiltered) return true;
        const allJobIds = [
          ...app.ungrouped.map((j: ProcessingJob) => j.id),
          ...app.grouped.flatMap((g: { group: ProcessingJobGroup; jobs: ProcessingJob[] }) => g.jobs.map((j) => j.id)),
        ];
        return allJobIds.some((id) => matchingJobIds.has(id));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, jobGroups, callingAppsLookup, matchingJobIds, jobSortBy, isJobFiltered]);

  function toggleApp(appId: string) {
    setExpandedApps((prev) => ({ ...prev, [appId]: !(prev[appId] ?? true) }));
  }

  async function renameCallingApp(appId: string) {
    if (appId === 'unknown-calling-application') return;
    const current = callingAppsLookup.get(appId);
    const next = window.prompt('Rename calling application', current?.display_name || appId);
    if (!next || !next.trim() || next.trim() === (current?.display_name || appId)) return;
    try {
      await api.updateCallingApplication(appId, { display_name: next.trim() });
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({
        title: 'Rename failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  function toggleSubgroup(key: string) {
    setExpandedSubgroups((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  }

  async function assignSubgroup(jobId: string, subgroupId: string | null) {
    try {
      await api.updateProcessingJob(jobId, {
        config: { subgroupId: subgroupId || null },
      });
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({
        title: 'Move failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  async function createGroup(appId: string) {
    const name = window.prompt('New group name');
    if (!name || !name.trim()) return;
    try {
      await api.createProcessingJobGroup({
        app_id: appId,
        name: name.trim(),
        slug: slugify(name),
      });
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({
        title: 'Group create failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  async function editGroup(group: ProcessingJobGroup) {
    const nextName = window.prompt('Update group name', group.name || '');
    if (!nextName || !nextName.trim() || nextName.trim() === group.name) return;
    try {
      await api.updateProcessingJobGroup(group.id, {
        name: nextName.trim(),
        slug: slugify(nextName),
      });
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({
        title: 'Group update failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  async function removeGroup(group: ProcessingJobGroup) {
    if (
      !(await confirm({
        title: `Delete group "${group.name}"`,
        message: "Jobs in this group will move to Ungrouped. This can't be undone.",
      }))
    )
      return;
    try {
      await api.deleteProcessingJobGroup(group.id);
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({
        title: 'Group delete failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  }

  function pickerCount(jobId: string) {
    return checkedIds.size > 0 && checkedIds.has(jobId) ? checkedIds.size : 1;
  }

  function renderJobCard(job: ProcessingJob) {
    const dimmed = isJobFiltered && !matchingJobIds.has(job.id);
    const isChecked = checkedIds.has(job.id);
    return (
      <Card
        key={job.id}
        padding="sm"
        withBorder
        draggable
        onDragStart={() => setDraggingJobId(job.id)}
        onDragEnd={() => setDraggingJobId(null)}
        style={{
          cursor: 'pointer',
          backgroundColor: isChecked
            ? 'var(--mantine-color-blue-0)'
            : selectedJob === job.id
              ? 'var(--mantine-color-gray-0)'
              : undefined,
          borderLeft:
            selectedJob === job.id
              ? '3px solid var(--mantine-color-blue-5)'
              : isChecked
                ? '3px solid var(--mantine-color-blue-3)'
                : '3px solid transparent',
          opacity: dimmed ? 0.35 : draggingJobId === job.id ? 0.6 : 1,
          transition: 'opacity 150ms ease, background-color 150ms ease',
        }}
        onClick={() => onSelect(job.id)}
      >
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            <Checkbox
              size="xs"
              checked={isChecked}
              onChange={() => toggleChecked(job.id)}
              onClick={(e) => e.stopPropagation()}
            />
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
                <Menu.Item leftSection={<IconBrain size={14} />} onClick={() => openPicker('profile', job.id)}>
                  Change AI profile {pickerCount(job.id) > 1 ? `(${pickerCount(job.id)})` : ''}
                </Menu.Item>
                <Menu.Item leftSection={<IconFolder size={14} />} onClick={() => openPicker('group', job.id)}>
                  Move to group {pickerCount(job.id) > 1 ? `(${pickerCount(job.id)})` : ''}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => onEdit(job)}>
                  Edit
                </Menu.Item>
                <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => onDelete(job)}>
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

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={onCreate}>
          Add Processing Job
        </Button>
      </Group>

      {/* Search, filter, sort toolbar */}
      <Group gap="sm" wrap="wrap">
        <TextInput
          placeholder="Search jobs..."
          leftSection={<IconSearch size={14} />}
          rightSection={jobSearch ? <CloseButton size="sm" onClick={() => setJobSearch('')} /> : null}
          value={jobSearch}
          onChange={(e) => setJobSearch(e.target.value)}
          size="sm"
          style={{ flex: 1, minWidth: 180 }}
        />
        <SegmentedControl
          size="xs"
          value={jobFilterStatus}
          onChange={setJobFilterStatus}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Active', value: 'active' },
            { label: 'Inactive', value: 'inactive' },
          ]}
        />
        <SegmentedControl
          size="xs"
          value={jobFilterMode}
          onChange={setJobFilterMode}
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
          onChange={(v) => setJobSortBy(v || 'default')}
          w={150}
          allowDeselect={false}
        />
        <Group gap={4}>
          <Tooltip label="Card view">
            <ActionIcon
              variant={viewMode === 'card' ? 'filled' : 'subtle'}
              onClick={() => setViewMode('card')}
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

      {isJobFiltered && (
        <Text size="sm" c="dimmed">
          {matchCount} job{matchCount !== 1 ? 's' : ''} match{matchCount === 1 ? 'es' : ''}
        </Text>
      )}

      {/* ── Bulk action bar ── */}
      {hasChecked && (
        <Paper withBorder p="xs" radius="md" bg="var(--mantine-color-blue-0)">
          <Group justify="space-between" wrap="wrap">
            <Group gap="sm">
              <Badge size="sm" variant="filled" color="blue">
                {checkedIds.size} selected
              </Badge>
              <Button size="xs" variant="subtle" onClick={clearChecked}>
                Clear
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => {
                  const allIds = jobs.map((j) => j.id);
                  setCheckedIds(new Set(allIds));
                }}
              >
                Select all
              </Button>
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                variant="light"
                leftSection={<IconBrain size={14} />}
                loading={bulkApplying}
                onClick={() => setPicker({ type: 'profile', targetIds: [...checkedIds], value: null })}
              >
                Change AI profile
              </Button>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconFolder size={14} />}
                loading={bulkApplying}
                onClick={() => setPicker({ type: 'group', targetIds: [...checkedIds], value: null })}
              >
                Move to group
              </Button>

              <Menu shadow="md" width={160} position="bottom-end" withinPortal>
                <Menu.Target>
                  <Button
                    size="xs"
                    variant="light"
                    color="gray"
                    leftSection={<IconSettings size={14} />}
                    loading={bulkApplying}
                  >
                    More
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconCheck size={14} />} onClick={() => bulkToggleActive(true)}>
                    Activate all
                  </Menu.Item>
                  <Menu.Item leftSection={<IconX size={14} />} onClick={() => bulkToggleActive(false)}>
                    Deactivate all
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Group>
        </Paper>
      )}

      {jobs.length === 0 ? (
        <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light">
          No processing jobs configured. Create one and assign an AI profile.
        </Alert>
      ) : viewMode === 'list' ? (
        /* ── List / Table View ── */
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <ScrollArea>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 36 }}>
                    <Checkbox
                      size="xs"
                      checked={checkedIds.size > 0 && checkedIds.size === matchCount}
                      indeterminate={checkedIds.size > 0 && checkedIds.size < matchCount}
                      onChange={() => {
                        if (checkedIds.size === matchCount) {
                          clearChecked();
                        } else {
                          setCheckedIds(new Set([...matchingJobIds]));
                        }
                      }}
                    />
                  </Table.Th>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Slug</Table.Th>
                  <Table.Th>ID</Table.Th>
                  <Table.Th>App</Table.Th>
                  <Table.Th>Group</Table.Th>
                  <Table.Th>AI Profile</Table.Th>
                  <Table.Th>Mode</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th style={{ width: 80 }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(() => {
                  const allFlat = apps.flatMap((app) => {
                    const fromGroups = app.grouped.flatMap((g) =>
                      g.jobs.map((j) => ({ ...j, _appName: app.appName, _groupName: g.group.name })),
                    );
                    const fromUngrouped = app.ungrouped.map((j) => ({
                      ...j,
                      _appName: app.appName,
                      _groupName: null,
                    }));
                    return [...fromGroups, ...fromUngrouped];
                  });
                  const visible = isJobFiltered ? allFlat.filter((j) => matchingJobIds.has(j.id)) : allFlat;
                  return visible.map((job) => (
                    <Table.Tr
                      key={job.id}
                      style={{ cursor: 'pointer' }}
                      bg={
                        checkedIds.has(job.id)
                          ? 'var(--mantine-color-blue-0)'
                          : selectedJob === job.id
                            ? 'var(--mantine-color-gray-0)'
                            : undefined
                      }
                      onClick={() => onSelect(job.id)}
                    >
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Checkbox size="xs" checked={checkedIds.has(job.id)} onChange={() => toggleChecked(job.id)} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" fw={600} truncate style={{ maxWidth: 200 }}>
                          {job.name}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="outline">
                          {job.slug}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <CopyButton value={job.id}>
                          {({ copied, copy }) => (
                            <Tooltip label={copied ? 'Copied' : 'Copy job ID'} withArrow>
                              <Text
                                size="xs"
                                c={copied ? 'teal' : 'dimmed'}
                                style={{ cursor: 'pointer', fontFamily: 'monospace' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copy();
                                }}
                              >
                                {job.id.slice(0, 8)}…{' '}
                                {copied && <IconCheck size={10} style={{ verticalAlign: 'middle' }} />}
                              </Text>
                            </Tooltip>
                          )}
                        </CopyButton>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{job._appName}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c={job._groupName ? undefined : 'dimmed'}>
                          {job._groupName || '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{job.ai_profile?.name || '—'}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          size="xs"
                          variant="light"
                          color={(job.ai_profile?.mode || 'completion') === 'chat' ? 'orange' : 'teal'}
                        >
                          {(job.ai_profile?.mode || 'completion') === 'chat' ? 'Chat' : 'Completion'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="light" color={job.is_active ? 'green' : 'gray'}>
                          {job.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </Table.Td>
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Menu shadow="md" width={220} position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" size="sm">
                              <IconDotsVertical size={14} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item
                              leftSection={<IconBrain size={14} />}
                              onClick={() => openPicker('profile', job.id)}
                            >
                              Change AI profile {pickerCount(job.id) > 1 ? `(${pickerCount(job.id)})` : ''}
                            </Menu.Item>
                            <Menu.Item
                              leftSection={<IconFolder size={14} />}
                              onClick={() => openPicker('group', job.id)}
                            >
                              Move to group {pickerCount(job.id) > 1 ? `(${pickerCount(job.id)})` : ''}
                            </Menu.Item>
                            <Menu.Divider />
                            <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => onEdit(job)}>
                              Edit
                            </Menu.Item>
                            <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => onDelete(job)}>
                              Delete
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    </Table.Tr>
                  ));
                })()}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      ) : (
        apps.map((app) => (
          <Paper key={app.appId} withBorder radius="md" style={{ overflow: 'hidden' }}>
            <UnstyledButton onClick={() => toggleApp(app.appId)} style={{ width: '100%' }} p="sm">
              <Group justify="space-between">
                <Group gap="sm">
                  <IconApps size={18} color="var(--mantine-color-blue-5)" />
                  <Text fw={600} size="sm">
                    {app.appName}
                  </Text>
                  <Badge size="xs" variant="light" color="blue">
                    {app.totalJobs} job{app.totalJobs !== 1 ? 's' : ''}
                  </Badge>
                  <Badge size="xs" variant="outline" color="gray">
                    {app.appId}
                  </Badge>
                  {!app.isUnknown && (
                    <Tooltip label="Rename this application" withArrow>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        onClick={(e) => {
                          e.stopPropagation();
                          renameCallingApp(app.appId);
                        }}
                      >
                        <IconEdit size={12} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
                <IconChevronDown
                  size={16}
                  style={{
                    transition: 'transform 200ms',
                    transform: isJobFiltered || (expandedApps[app.appId] ?? true) ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
              </Group>
            </UnstyledButton>
            <Collapse in={isJobFiltered || (expandedApps[app.appId] ?? true)}>
              <Stack gap="sm" p="sm">
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Sub-groups are user-managed buckets under this calling application.
                  </Text>
                  <Button size="xs" variant="light" onClick={() => createGroup(app.appId)}>
                    New Group
                  </Button>
                </Group>

                {app.grouped.map(({ group, jobs: groupJobs }: { group: ProcessingJobGroup; jobs: ProcessingJob[] }) => (
                  <Paper
                    key={group.id}
                    withBorder
                    p="sm"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async () => {
                      if (!draggingJobId) return;
                      await assignSubgroup(draggingJobId, group.id);
                    }}
                  >
                    <Group justify="space-between" mb="xs" wrap="nowrap">
                      <UnstyledButton onClick={() => toggleSubgroup(`group:${group.id}`)} style={{ flex: 1 }}>
                        <Group gap="xs">
                          <IconChevronDown
                            size={14}
                            style={{
                              transition: 'transform 200ms',
                              transform:
                                isJobFiltered || (expandedSubgroups[`group:${group.id}`] ?? true)
                                  ? 'rotate(180deg)'
                                  : 'rotate(0deg)',
                            }}
                          />
                          <Badge size="sm" color="grape" variant="light">
                            {group.name}
                          </Badge>
                          <Badge size="xs" variant="outline">
                            {groupJobs.length}
                          </Badge>
                        </Group>
                      </UnstyledButton>
                      <Group gap={4}>
                        <ActionIcon variant="subtle" size="sm" onClick={() => editGroup(group)}>
                          <IconEdit size={14} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" size="sm" color="red" onClick={() => removeGroup(group)}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>
                    <Collapse in={isJobFiltered || (expandedSubgroups[`group:${group.id}`] ?? true)}>
                      <Stack gap="xs">
                        {groupJobs.length === 0 ? (
                          <Text size="xs" c="dimmed">
                            Drag a job here
                          </Text>
                        ) : (
                          groupJobs.map(renderJobCard)
                        )}
                      </Stack>
                    </Collapse>
                  </Paper>
                ))}

                <Paper
                  withBorder
                  p="sm"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async () => {
                    if (!draggingJobId) return;
                    await assignSubgroup(draggingJobId, null);
                  }}
                >
                  <UnstyledButton onClick={() => toggleSubgroup(`ungrouped:${app.appId}`)} style={{ width: '100%' }}>
                    <Group justify="space-between" mb="xs">
                      <Group gap="xs">
                        <IconChevronDown
                          size={14}
                          style={{
                            transition: 'transform 200ms',
                            transform:
                              isJobFiltered || (expandedSubgroups[`ungrouped:${app.appId}`] ?? true)
                                ? 'rotate(180deg)'
                                : 'rotate(0deg)',
                          }}
                        />
                        <Badge size="sm" color="gray" variant="light">
                          Ungrouped
                        </Badge>
                        <Badge size="xs" variant="outline">
                          {app.ungrouped.length}
                        </Badge>
                      </Group>
                    </Group>
                  </UnstyledButton>
                  <Collapse in={isJobFiltered || (expandedSubgroups[`ungrouped:${app.appId}`] ?? true)}>
                    <Stack gap="xs">
                      {app.ungrouped.length === 0 ? (
                        <Text size="xs" c="dimmed">
                          No ungrouped jobs
                        </Text>
                      ) : (
                        app.ungrouped.map(renderJobCard)
                      )}
                    </Stack>
                  </Collapse>
                </Paper>
              </Stack>
            </Collapse>
          </Paper>
        ))
      )}

      {/* ── Picker modal for AI profile / group selection ── */}
      <Modal
        opened={!!picker}
        onClose={closePicker}
        title={picker?.type === 'profile' ? 'Change AI profile' : 'Move to group'}
        size="sm"
        centered
      >
        {picker && (
          <Stack gap="md">
            {picker.targetIds.length > 1 && (
              <Text size="sm" c="dimmed">
                Applies to {picker.targetIds.length} selected jobs
              </Text>
            )}
            <Select
              label={picker.type === 'profile' ? 'AI profile' : 'Group'}
              placeholder={picker.type === 'profile' ? 'Search profiles...' : 'Search groups...'}
              data={picker.type === 'profile' ? profileSelectData : groupSelectData}
              value={picker.value}
              onChange={(v: string | null) => setPicker((prev) => (prev ? { ...prev, value: v } : null))}
              searchable
              clearable
              nothingFoundMessage="No matches"
              maxDropdownHeight={240}
            />
            {picker.type === 'profile' && !picker.value && (
              <Text size="xs" c="dimmed">
                Leave empty to unassign the AI profile
              </Text>
            )}
            {picker.type === 'group' && !picker.value && (
              <Text size="xs" c="dimmed">
                Leave empty to move to Ungrouped
              </Text>
            )}
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" size="sm" onClick={closePicker}>
                Cancel
              </Button>
              <Button size="sm" onClick={applyPicker} loading={bulkApplying}>
                Apply
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
