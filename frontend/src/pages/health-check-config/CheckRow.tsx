import { Table, Group, Text, Badge, ActionIcon, Tooltip, Collapse, Box } from '@mantine/core';
import { IconEdit, IconTrash, IconPlayerPlay, IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import InvestigationPanel from '../../components/InvestigationPanel';
import type { HcCheck } from '../../types/api';
import { HEALTH_STATUS_CONFIG } from '../../constants/healthStatus';
import { relativeTime } from './helpers';

interface CheckRowProps {
  check: HcCheck;
  profileName: string;
  expanded: boolean;
  onExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRunNow: () => void;
}

export function CheckRow({ check, profileName, expanded, onExpand, onEdit, onDelete, onRunNow }: CheckRowProps) {
  return (
    <>
      <Table.Tr style={{ cursor: 'pointer' }} onClick={onExpand}>
        <Table.Td>{expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}</Table.Td>
        <Table.Td>{check.name}</Table.Td>
        <Table.Td>{profileName}</Table.Td>
        <Table.Td>{check.cadence_minutes} min</Table.Td>
        <Table.Td>{relativeTime(check.last_run_at)}</Table.Td>
        <Table.Td>
          {(() => {
            const hs = HEALTH_STATUS_CONFIG[check.healthStatus ?? 'unknown'];
            return (
              <Group gap={6} wrap="nowrap">
                <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: hs.hex, flexShrink: 0 }} />
                <Text size="xs" fw={500} c={hs.color}>
                  {hs.label}
                </Text>
              </Group>
            );
          })()}
        </Table.Td>
        <Table.Td>
          <Badge size="xs" color={check.is_active ? 'teal' : 'gray'} variant="light">
            {check.is_active ? 'Enabled' : 'Disabled'}
          </Badge>
        </Table.Td>
        <Table.Td onClick={(e) => e.stopPropagation()}>
          <Group gap="xs">
            <Tooltip label="Run Now">
              <ActionIcon variant="subtle" color="blue" onClick={onRunNow} aria-label="Run Now">
                <IconPlayerPlay size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Edit">
              <ActionIcon variant="subtle" onClick={onEdit} aria-label="Edit">
                <IconEdit size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete">
              <ActionIcon variant="subtle" color="red" onClick={onDelete}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Table.Td>
      </Table.Tr>
      <Table.Tr>
        <Table.Td colSpan={8} p={0} style={{ border: expanded ? undefined : 'none' }}>
          <Collapse in={expanded}>
            <Box p="md">
              <InvestigationPanel checkId={check.id} />
            </Box>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </>
  );
}
