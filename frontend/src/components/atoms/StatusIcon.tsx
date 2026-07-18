import { ThemeIcon } from '@mantine/core';
import { IconCheck, IconAlertTriangle, IconCircleX } from '@tabler/icons-react';

interface StatusIconProps {
  status: string;
}

/** Small filled circular icon for pass/warning/error style status indicators. */
export default function StatusIcon({ status }: StatusIconProps) {
  if (status === 'pass')
    return (
      <ThemeIcon size="xs" radius="xl" color="green" variant="filled">
        <IconCheck size={10} />
      </ThemeIcon>
    );
  if (status === 'warning')
    return (
      <ThemeIcon size="xs" radius="xl" color="yellow" variant="filled">
        <IconAlertTriangle size={10} />
      </ThemeIcon>
    );
  return (
    <ThemeIcon size="xs" radius="xl" color="red" variant="filled">
      <IconCircleX size={10} />
    </ThemeIcon>
  );
}
