/**
 * Shared presentational helpers for Vibe-Coding Tools guide tabs.
 */

import type { ReactNode } from 'react';
import { Paper, Stack, Text, Title, ThemeIcon, Button, CopyButton } from '@mantine/core';
import {
  IconCheck,
  IconCopy,
  IconCircleNumber1,
  IconCircleNumber2,
  IconCircleNumber3,
  IconCircleNumber4,
} from '@tabler/icons-react';

interface StepCardProps {
  n: number;
  title: string;
  children: ReactNode;
}

export function StepCard({ n, title, children }: StepCardProps) {
  const icons = [IconCircleNumber1, IconCircleNumber2, IconCircleNumber3, IconCircleNumber4];
  const Num = icons[n - 1] || IconCircleNumber1;
  return (
    <Paper p="lg" radius="md" withBorder shadow="xs">
      <Stack gap="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ThemeIcon size={40} radius="md" variant="light" color="indigo">
            <Num size={22} stroke={1.5} />
          </ThemeIcon>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Step {n}
            </Text>
            <Title order={4} mt={2}>
              {title}
            </Title>
          </div>
        </div>
        {children}
      </Stack>
    </Paper>
  );
}

export function CopyBlock({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton value={value} timeout={2000}>
      {({ copied, copy }) => (
        <Button leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />} onClick={copy} variant="light">
          {copied ? 'Copied' : label}
        </Button>
      )}
    </CopyButton>
  );
}
