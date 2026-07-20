import { Text, Badge, ActionIcon, Tooltip, Checkbox, Paper, ScrollArea, Table, Menu, CopyButton } from '@mantine/core';
import { IconEdit, IconTrash, IconBrain, IconFolder, IconDotsVertical, IconCheck } from '@tabler/icons-react';
import type { ProcessingJob } from '../../../types/api';
import type { CallingAppEntry } from './types';

export default function JobsListView({
  apps,
  isJobFiltered,
  matchingJobIds,
  checkedIds,
  matchCount,
  selectedJob,
  pickerCount,
  onSelect,
  onToggleChecked,
  onClearChecked,
  onSetCheckedIds,
  onOpenPicker,
  onEdit,
  onDelete,
}: {
  apps: CallingAppEntry[];
  isJobFiltered: boolean;
  matchingJobIds: Set<string>;
  checkedIds: Set<string>;
  matchCount: number;
  selectedJob: string | null;
  pickerCount: (jobId: string) => number;
  onSelect: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onClearChecked: () => void;
  onSetCheckedIds: (ids: Set<string>) => void;
  onOpenPicker: (type: 'profile' | 'group', jobId: string) => void;
  onEdit: (job: ProcessingJob) => void;
  onDelete: (job: ProcessingJob) => void;
}) {
  return (
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
                      onClearChecked();
                    } else {
                      onSetCheckedIds(new Set([...matchingJobIds]));
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
                    <Checkbox size="xs" checked={checkedIds.has(job.id)} onChange={() => onToggleChecked(job.id)} />
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
                          onClick={() => onOpenPicker('profile', job.id)}
                        >
                          Change AI profile {pickerCount(job.id) > 1 ? `(${pickerCount(job.id)})` : ''}
                        </Menu.Item>
                        <Menu.Item leftSection={<IconFolder size={14} />} onClick={() => onOpenPicker('group', job.id)}>
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
  );
}
