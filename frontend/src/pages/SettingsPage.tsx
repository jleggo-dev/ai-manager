/**
 * Page – AI Admin Settings
 * -------------------------
 * Tab shell for system config, integration keys, personal credentials, and data management.
 * Tab bodies live in `pages/settings/*`.
 */

import { Stack, Tabs } from '@mantine/core';
import { IconAdjustments, IconKey, IconUserCog, IconDatabase } from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import { SystemTab } from './settings/SystemTab';
import { LlmDefaultsTab } from './settings/LlmDefaultsTab';
import { RateLimitsTab } from './settings/RateLimitsTab';
import { BackendUrlCard } from './settings/BackendUrlCard';
import { ApiKeysTab } from './settings/ApiKeysTab';
import { UserCredentialsTab } from './settings/UserCredentialsTab';
import { DataManagementTab } from './settings/DataManagementTab';

interface SettingsPageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

export default function SettingsPage({ workspaceRole, pageParams }: SettingsPageProps) {
  const validTabs = ['general', 'api-keys', 'my-credentials', 'data-management'];
  const tabParam = typeof pageParams?.tab === 'string' ? pageParams.tab : null;
  const initialTab = tabParam && validTabs.includes(tabParam) ? tabParam : 'general';

  return (
    <Stack gap="md">
      <PageHeader title="Settings" description="System configuration, integration keys, and personal credentials" />
      <Tabs key={initialTab} defaultValue={initialTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="general" leftSection={<IconAdjustments size={16} />}>
            General
          </Tabs.Tab>
          <Tabs.Tab value="api-keys" leftSection={<IconKey size={16} />}>
            API keys
          </Tabs.Tab>
          <Tabs.Tab value="my-credentials" leftSection={<IconUserCog size={16} />}>
            My Credentials
          </Tabs.Tab>
          <Tabs.Tab value="data-management" leftSection={<IconDatabase size={16} />}>
            Data Management
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general" pt="md">
          <Stack gap="md">
            <SystemTab />
            <LlmDefaultsTab />
            <RateLimitsTab />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="api-keys" pt="md">
          <Stack gap="md">
            <BackendUrlCard />
            <ApiKeysTab workspaceRole={workspaceRole} />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="my-credentials" pt="md">
          <UserCredentialsTab />
        </Tabs.Panel>

        <Tabs.Panel value="data-management" pt="md">
          <DataManagementTab />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
