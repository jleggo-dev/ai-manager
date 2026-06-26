import { Stack, Group, Text, Box } from '@mantine/core';
import type { UptimeTotals } from '../types/api';

interface UptimePieChartProps {
  totals: UptimeTotals;
  size?: number;
}

const SEGMENT_COLORS: Record<keyof UptimeTotals, string> = {
  pass: '#40c057',
  fail: '#fa5252',
  timeout: '#fab005',
  error: '#fd7e14',
  warning: '#fcc419',
};

const SEGMENT_LABELS: Record<keyof UptimeTotals, string> = {
  pass: 'Pass',
  fail: 'Fail',
  timeout: 'Timeout',
  error: 'Error',
  warning: 'Warning',
};

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

export default function UptimePieChart({ totals, size = 160 }: UptimePieChartProps) {
  const total = totals.pass + totals.fail + totals.timeout + totals.error + totals.warning;
  const uptimePercent = total > 0 ? Math.round(((totals.pass + totals.warning) / total) * 10_000) / 100 : 0;

  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = outerR * 0.62;
  const strokeWidth = outerR - innerR;
  const midR = (outerR + innerR) / 2;

  const segments: { key: keyof UptimeTotals; value: number; color: string }[] = (
    ['pass', 'warning', 'fail', 'timeout', 'error'] as const
  )
    .filter((k) => totals[k] > 0)
    .map((k) => ({ key: k, value: totals[k], color: SEGMENT_COLORS[k] }));

  if (total === 0) {
    return (
      <Stack align="center" gap="xs">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={cx} cy={cy} r={midR} fill="none" stroke="#dee2e6" strokeWidth={strokeWidth} />
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={size * 0.16}
            fontWeight={700}
            fill="#adb5bd"
          >
            N/A
          </text>
        </svg>
        <Text size="xs" c="dimmed">
          No runs recorded
        </Text>
      </Stack>
    );
  }

  let currentAngle = 0;
  const arcs = segments.map((seg) => {
    const sweep = (seg.value / total) * 360;
    const clampedSweep = Math.max(sweep, 0.5);
    const startAngle = currentAngle;
    const endAngle = currentAngle + clampedSweep;
    currentAngle += sweep;
    return { ...seg, startAngle, endAngle };
  });

  return (
    <Stack align="center" gap="xs">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.length === 1 && arcs[0] ? (
          <circle cx={cx} cy={cy} r={midR} fill="none" stroke={arcs[0].color} strokeWidth={strokeWidth} />
        ) : (
          arcs.map((arc) => (
            <path
              key={arc.key}
              d={describeArc(cx, cy, midR, arc.startAngle, arc.endAngle)}
              fill="none"
              stroke={arc.color}
              strokeWidth={strokeWidth}
              strokeLinecap="butt"
            />
          ))
        )}
        <text
          x={cx}
          y={cy - size * 0.06}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.2}
          fontWeight={700}
          fill="currentColor"
        >
          {uptimePercent}%
        </text>
        <text
          x={cx}
          y={cy + size * 0.12}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.09}
          fill="#868e96"
        >
          uptime
        </text>
      </svg>

      <Group gap="md" justify="center" wrap="wrap">
        {segments.map((seg) => (
          <Group key={seg.key} gap={4} wrap="nowrap">
            <Box w={10} h={10} style={{ borderRadius: 2, backgroundColor: seg.color, flexShrink: 0 }} />
            <Text size="xs" c="dimmed">
              {SEGMENT_LABELS[seg.key]}: {seg.value.toLocaleString()}
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  );
}
