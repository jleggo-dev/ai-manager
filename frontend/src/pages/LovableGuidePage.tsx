/**
 * Vibe-Coding Tools — integration guide for Lovable, Cursor, Claude Code, and other AI agents.
 * All heavy-lifting lives in downloadable .md / .ts / skill files; this page directs the user.
 */

import { Stack, Tabs, Badge, Group } from '@mantine/core';
import { IconHeartHandshake, IconBrandVscode, IconRobot } from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import { LovableTab } from './lovable-guide/LovableTab';
import { CursorTab } from './lovable-guide/CursorTab';
import { ClaudeTab } from './lovable-guide/ClaudeTab';

interface LovableGuidePageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

export default function LovableGuidePage({ onNavigate }: LovableGuidePageProps) {
  return (
    <Stack gap="xl" maw={820}>
      <PageHeader
        title="Vibe-Coding Tools"
        description="Download integration files and skills for your AI coding tool of choice, then start building AI-powered features against AI Admin."
      />

      <Tabs defaultValue="lovable" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="lovable" leftSection={<IconHeartHandshake size={16} />}>
            Lovable
          </Tabs.Tab>
          <Tabs.Tab value="cursor" leftSection={<IconBrandVscode size={16} />}>
            <Group gap={6}>
              Cursor
              <Badge size="xs" variant="light" color="indigo">
                + Windsurf, Codex…
              </Badge>
            </Group>
          </Tabs.Tab>
          <Tabs.Tab value="claude" leftSection={<IconRobot size={16} />}>
            Claude Code
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="lovable" pt="lg">
          <LovableTab onNavigate={onNavigate} />
        </Tabs.Panel>

        <Tabs.Panel value="cursor" pt="lg">
          <CursorTab onNavigate={onNavigate} />
        </Tabs.Panel>

        <Tabs.Panel value="claude" pt="lg">
          <ClaudeTab onNavigate={onNavigate} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
