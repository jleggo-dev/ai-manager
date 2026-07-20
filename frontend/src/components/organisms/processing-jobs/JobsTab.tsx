import { useState, useMemo } from 'react';
import { Stack, Group, Button, Text, Badge, Modal, Select, Alert, Paper, Menu } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconAlertCircle, IconSettings, IconCheck, IconX, IconBrain, IconFolder } from '@tabler/icons-react';
import { slugify } from '../../../lib/slugify';
import useConfirm from '../../../hooks/useConfirm';
import * as api from '../../../services/api';
import type { ProcessingJob, ProcessingJobGroup, AiProfile, CallingApplication } from '../../../types/api';
import { useJobBulkActions } from './useJobBulkActions';
import { buildJobsByCallingApp } from './jobsGrouping';
import JobsListView from './JobsListView';
import JobsCardView from './JobsCardView';
import JobsToolbar from './JobsToolbar';

/* ══════════════════════════════════════════════════════════════
   JOBS TAB
   ══════════════════════════════════════════════════════════════ */

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

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Button leftSection={<IconPlus size={16} />} onClick={onCreate}>
          Add Processing Job
        </Button>
      </Group>

      <JobsToolbar
        jobSearch={jobSearch}
        jobFilterStatus={jobFilterStatus}
        jobFilterMode={jobFilterMode}
        jobSortBy={jobSortBy}
        viewMode={viewMode}
        onSearchChange={setJobSearch}
        onFilterStatusChange={setJobFilterStatus}
        onFilterModeChange={setJobFilterMode}
        onSortByChange={setJobSortBy}
        onViewModeChange={setViewMode}
      />

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
        <JobsListView
          apps={apps}
          isJobFiltered={isJobFiltered}
          matchingJobIds={matchingJobIds}
          checkedIds={checkedIds}
          matchCount={matchCount}
          selectedJob={selectedJob}
          pickerCount={pickerCount}
          onSelect={onSelect}
          onToggleChecked={toggleChecked}
          onClearChecked={clearChecked}
          onSetCheckedIds={setCheckedIds}
          onOpenPicker={openPicker}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ) : (
        <JobsCardView
          apps={apps}
          isJobFiltered={isJobFiltered}
          matchingJobIds={matchingJobIds}
          expandedApps={expandedApps}
          expandedSubgroups={expandedSubgroups}
          draggingJobId={draggingJobId}
          checkedIds={checkedIds}
          selectedJob={selectedJob}
          pickerCount={pickerCount}
          onToggleApp={toggleApp}
          onToggleSubgroup={toggleSubgroup}
          onRenameCallingApp={renameCallingApp}
          onCreateGroup={createGroup}
          onEditGroup={editGroup}
          onRemoveGroup={removeGroup}
          onAssignSubgroup={assignSubgroup}
          onSelect={onSelect}
          onToggleChecked={toggleChecked}
          onSetDraggingJobId={setDraggingJobId}
          onOpenPicker={openPicker}
          onEdit={onEdit}
          onDelete={onDelete}
        />
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
