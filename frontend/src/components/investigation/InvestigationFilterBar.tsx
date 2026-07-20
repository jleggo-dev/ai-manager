/**
 * Investigation panel filter bar — status chips + date range.
 */

import { Group, Text, Paper, Chip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconFilter } from '@tabler/icons-react';

interface InvestigationFilterBarProps {
  statusFilter: string[];
  onStatusFilterChange: (value: string[]) => void;
  dateRange: [Date | null, Date | null];
  onDateRangeChange: (value: [Date | null, Date | null]) => void;
}

export function InvestigationFilterBar({
  statusFilter,
  onStatusFilterChange,
  dateRange,
  onDateRangeChange,
}: InvestigationFilterBarProps) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Group gap="md" align="flex-end" wrap="wrap">
        <Group gap={4}>
          <IconFilter size={14} />
          <Text size="xs" fw={600}>
            Filters
          </Text>
        </Group>
        <Chip.Group multiple value={statusFilter} onChange={onStatusFilterChange}>
          <Group gap={4}>
            <Chip value="fail" size="xs" color="red" variant="outline">
              Fail
            </Chip>
            <Chip value="timeout" size="xs" color="orange" variant="outline">
              Timeout
            </Chip>
            <Chip value="error" size="xs" color="red" variant="outline">
              Error
            </Chip>
            <Chip value="warning" size="xs" color="yellow" variant="outline">
              Warning
            </Chip>
            <Chip value="pass" size="xs" color="green" variant="outline">
              Pass
            </Chip>
          </Group>
        </Chip.Group>
        <DatePickerInput
          type="range"
          size="xs"
          placeholder="Date range"
          value={dateRange}
          onChange={onDateRangeChange}
          clearable
          maxDate={new Date()}
          style={{ minWidth: 220 }}
        />
      </Group>
    </Paper>
  );
}
