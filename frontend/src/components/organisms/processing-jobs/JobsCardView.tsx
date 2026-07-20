import { Stack, Group, Button, Text, Badge, ActionIcon, Tooltip, Paper, Collapse, UnstyledButton } from '@mantine/core';
import { IconEdit, IconTrash, IconChevronDown, IconApps } from '@tabler/icons-react';
import type { ProcessingJob, ProcessingJobGroup } from '../../../types/api';
import type { CallingAppEntry } from './types';
import JobCard from './JobCard';

export default function JobsCardView({
  apps,
  isJobFiltered,
  matchingJobIds,
  expandedApps,
  expandedSubgroups,
  draggingJobId,
  checkedIds,
  selectedJob,
  pickerCount,
  onToggleApp,
  onToggleSubgroup,
  onRenameCallingApp,
  onCreateGroup,
  onEditGroup,
  onRemoveGroup,
  onAssignSubgroup,
  onSelect,
  onToggleChecked,
  onSetDraggingJobId,
  onOpenPicker,
  onEdit,
  onDelete,
}: {
  apps: CallingAppEntry[];
  isJobFiltered: boolean;
  matchingJobIds: Set<string>;
  expandedApps: Record<string, boolean>;
  expandedSubgroups: Record<string, boolean>;
  draggingJobId: string | null;
  checkedIds: Set<string>;
  selectedJob: string | null;
  pickerCount: (jobId: string) => number;
  onToggleApp: (appId: string) => void;
  onToggleSubgroup: (key: string) => void;
  onRenameCallingApp: (appId: string) => void;
  onCreateGroup: (appId: string) => void;
  onEditGroup: (group: ProcessingJobGroup) => void;
  onRemoveGroup: (group: ProcessingJobGroup) => void;
  onAssignSubgroup: (jobId: string, subgroupId: string | null) => Promise<void>;
  onSelect: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onSetDraggingJobId: (id: string | null) => void;
  onOpenPicker: (type: 'profile' | 'group', jobId: string) => void;
  onEdit: (job: ProcessingJob) => void;
  onDelete: (job: ProcessingJob) => void;
}) {
  function renderJobCard(job: ProcessingJob) {
    return (
      <JobCard
        key={job.id}
        job={job}
        dimmed={isJobFiltered && !matchingJobIds.has(job.id)}
        isChecked={checkedIds.has(job.id)}
        isSelected={selectedJob === job.id}
        isDragging={draggingJobId === job.id}
        pickerCount={pickerCount(job.id)}
        onSelect={() => onSelect(job.id)}
        onToggleChecked={() => onToggleChecked(job.id)}
        onDragStart={() => onSetDraggingJobId(job.id)}
        onDragEnd={() => onSetDraggingJobId(null)}
        onOpenPicker={(type) => onOpenPicker(type, job.id)}
        onEdit={() => onEdit(job)}
        onDelete={() => onDelete(job)}
      />
    );
  }

  return (
    <>
      {apps.map((app) => (
        <Paper key={app.appId} withBorder radius="md" style={{ overflow: 'hidden' }}>
          <UnstyledButton onClick={() => onToggleApp(app.appId)} style={{ width: '100%' }} p="sm">
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
                        onRenameCallingApp(app.appId);
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
                <Button size="xs" variant="light" onClick={() => onCreateGroup(app.appId)}>
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
                    await onAssignSubgroup(draggingJobId, group.id);
                  }}
                >
                  <Group justify="space-between" mb="xs" wrap="nowrap">
                    <UnstyledButton onClick={() => onToggleSubgroup(`group:${group.id}`)} style={{ flex: 1 }}>
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
                      <ActionIcon variant="subtle" size="sm" onClick={() => onEditGroup(group)}>
                        <IconEdit size={14} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" size="sm" color="red" onClick={() => onRemoveGroup(group)}>
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
                  await onAssignSubgroup(draggingJobId, null);
                }}
              >
                <UnstyledButton onClick={() => onToggleSubgroup(`ungrouped:${app.appId}`)} style={{ width: '100%' }}>
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
      ))}
    </>
  );
}
