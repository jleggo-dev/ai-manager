import { useMemo } from 'react';
import { Tooltip, Text, Group, Box } from '@mantine/core';
import type { UptimeDay } from '../types/api';

interface UptimeHeatmapProps {
  dailyStats: UptimeDay[];
  days?: number;
}

const CELL_SIZE = 12;
const CELL_GAP = 2;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function uptimeColor(day: UptimeDay | undefined): string {
  if (!day || day.totalRuns === 0) return '#dee2e6';
  const pct = (day.passCount + (day.warningCount ?? 0)) / day.totalRuns;
  if (pct >= 1) return '#40c057';
  if (pct >= 0.9) return '#82c91e';
  if (pct >= 0.5) return '#fab005';
  return '#fa5252';
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function tooltipContent(date: string, day: UptimeDay | undefined): string {
  if (!day || day.totalRuns === 0) return `${date}: No runs`;
  const operational = day.passCount + (day.warningCount ?? 0);
  const pct = Math.round((operational / day.totalRuns) * 100);
  const warningNote = (day.warningCount ?? 0) > 0 ? ` (${day.warningCount} slow)` : '';
  return `${date}: ${pct}% uptime (${operational}/${day.totalRuns} passed${warningNote})`;
}

export default function UptimeHeatmap({ dailyStats, days = 365 }: UptimeHeatmapProps) {
  const { grid, weeks, monthLabels } = useMemo(() => {
    const lookup = new Map<string, UptimeDay>();
    for (const d of dailyStats) {
      lookup.set(d.date, d);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(today);
    start.setDate(start.getDate() - days + 1);
    const _startDow = start.getDay();

    const cells: { date: string; dow: number; weekIdx: number; day: UptimeDay | undefined }[] = [];
    let weekIdx = 0;

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const dow = d.getDay();
      const dateStr = formatDate(d);

      if (i > 0 && dow === 0) weekIdx++;

      cells.push({ date: dateStr, dow, weekIdx, day: lookup.get(dateStr) });
    }

    const totalWeeks = weekIdx + 1;

    const labels: { label: string; weekIdx: number }[] = [];
    let lastMonth = -1;
    for (const cell of cells) {
      const month = new Date(cell.date).getMonth();
      if (month !== lastMonth && cell.dow === 0) {
        labels.push({ label: MONTH_NAMES[month] ?? '', weekIdx: cell.weekIdx });
        lastMonth = month;
      }
    }

    return { grid: cells, weeks: totalWeeks, monthLabels: labels };
  }, [dailyStats, days]);

  const labelWidth = 28;
  const headerHeight = 16;
  const svgWidth = labelWidth + weeks * (CELL_SIZE + CELL_GAP);
  const svgHeight = headerHeight + 7 * (CELL_SIZE + CELL_GAP);

  return (
    <Box style={{ overflowX: 'auto' }}>
      <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
        {monthLabels.map((ml, i) => (
          <text key={i} x={labelWidth + ml.weekIdx * (CELL_SIZE + CELL_GAP)} y={10} fontSize={9} fill="#868e96">
            {ml.label}
          </text>
        ))}

        {DAY_LABELS.map((label, i) =>
          label ? (
            <text
              key={i}
              x={0}
              y={headerHeight + i * (CELL_SIZE + CELL_GAP) + CELL_SIZE * 0.8}
              fontSize={9}
              fill="#868e96"
            >
              {label}
            </text>
          ) : null,
        )}

        {grid.map((cell, i) => (
          <Tooltip key={i} label={tooltipContent(cell.date, cell.day)} withArrow position="top" fz="xs">
            <rect
              x={labelWidth + cell.weekIdx * (CELL_SIZE + CELL_GAP)}
              y={headerHeight + cell.dow * (CELL_SIZE + CELL_GAP)}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2}
              fill={uptimeColor(cell.day)}
              style={{ cursor: 'default' }}
            />
          </Tooltip>
        ))}
      </svg>

      <Group gap="sm" mt={4}>
        <Text size="xs" c="dimmed">
          Less
        </Text>
        {['#dee2e6', '#fa5252', '#fab005', '#82c91e', '#40c057'].map((c) => (
          <Box key={c} w={CELL_SIZE} h={CELL_SIZE} style={{ borderRadius: 2, backgroundColor: c }} />
        ))}
        <Text size="xs" c="dimmed">
          More
        </Text>
      </Group>
    </Box>
  );
}
