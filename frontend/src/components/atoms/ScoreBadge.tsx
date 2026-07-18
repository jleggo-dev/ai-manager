import { Badge } from '@mantine/core';

interface ScoreBadgeProps {
  value: number | null | undefined;
  label: string;
  size?: string;
}

/** Badge that colors itself green/teal/yellow/red based on a 0-100 score, or "N/A" when absent. */
export default function ScoreBadge({ value, label, size = 'xl' }: ScoreBadgeProps) {
  if (value == null)
    return (
      <Badge size={size} variant="light" color="gray">
        {label}: N/A
      </Badge>
    );
  const color = value >= 90 ? 'green' : value >= 70 ? 'teal' : value >= 50 ? 'yellow' : 'red';
  return (
    <Badge size={size} variant="filled" color={color}>
      {label}: {value}%
    </Badge>
  );
}
