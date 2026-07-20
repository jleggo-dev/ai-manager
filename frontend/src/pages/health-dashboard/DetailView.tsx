/**
 * Health Dashboard detail view shell — cards/list mode toggle.
 */

import { Stack, Group, SegmentedControl } from '@mantine/core';
import { IconLayoutGrid, IconList } from '@tabler/icons-react';
import { DetailCardsView } from './DetailCardsView';
import { DetailListView } from './DetailListView';
import type { DetailMode, SortDir, SortField, UnifiedDashboardItem } from './helpers';

interface DetailViewProps {
  detailMode: DetailMode;
  onDetailModeChange: (mode: DetailMode) => void;
  items: UnifiedDashboardItem[];
  sortedItems: UnifiedDashboardItem[];
  expanded: Record<string, boolean>;
  runningId: string | null;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  onRunNow: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

export function DetailView({
  detailMode,
  onDetailModeChange,
  items,
  sortedItems,
  expanded,
  runningId,
  sortField,
  sortDir,
  onSort,
  onRunNow,
  onToggleExpand,
}: DetailViewProps) {
  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <SegmentedControl
          size="xs"
          value={detailMode}
          onChange={(v) => onDetailModeChange(v as DetailMode)}
          data={[
            {
              value: 'cards',
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconLayoutGrid size={12} />
                  <span>Cards</span>
                </Group>
              ),
            },
            {
              value: 'list',
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconList size={12} />
                  <span>List</span>
                </Group>
              ),
            },
          ]}
        />
      </Group>

      {detailMode === 'cards' ? (
        <DetailCardsView
          items={items}
          expanded={expanded}
          runningId={runningId}
          onRunNow={onRunNow}
          onToggleExpand={onToggleExpand}
        />
      ) : (
        <DetailListView
          sortedItems={sortedItems}
          sortField={sortField}
          sortDir={sortDir}
          runningId={runningId}
          onSort={onSort}
          onRunNow={onRunNow}
        />
      )}
    </Stack>
  );
}
