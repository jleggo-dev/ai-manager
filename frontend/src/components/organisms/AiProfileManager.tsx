/**
 * Organism – AiProfileManager
 * -----------------------------
 * Orchestrates AI Profiles list CRUD, filters, bulk selection, create/edit modal,
 * test chat drawer, Manage LLMs, and failover config. Extracted concerns live under
 * ai-profiles/ (FE-02 structural split).
 */

import { useRef, useState } from 'react';
import { Stack, Group, Button, Loader, Center, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconSettings } from '@tabler/icons-react';
import FailoverConfigModal from '../molecules/FailoverConfigModal';
import ManageLlmsModal from './ManageLlmsModal';
import TestChatPanel from './ai-profiles/TestChatPanel';
import ProfileFormModal, { type ProfileFormModalHandle } from './ai-profiles/ProfileFormModal';
import ProfileListView from './ai-profiles/ProfileListView';
import { useAiProfilesData } from './ai-profiles/hooks/useAiProfilesData';
import { useProfileListFilters } from './ai-profiles/hooks/useProfileListFilters';
import { useProfileBulkActions } from './ai-profiles/hooks/useProfileBulkActions';
import type { AiProfile } from '../../types/api';

export default function AiProfileManager() {
  const { profiles, providers, loading, loadData, handleDelete, handleToggleDefault } = useAiProfilesData();
  const formModalRef = useRef<ProfileFormModalHandle>(null);

  /* Test chat state */
  const [chatProfile, setChatProfile] = useState<AiProfile | null>(null);
  const [chatOpened, { open: openChat, close: closeChat }] = useDisclosure(false);

  /* Manage LLMs modal state */
  const [llmsOpened, { open: openLlms, close: closeLlms }] = useDisclosure(false);

  /* Failover config modal state */
  const [failoverProfile, setFailoverProfile] = useState<AiProfile | null>(null);
  const [failoverOpened, { open: openFailover, close: closeFailover }] = useDisclosure(false);

  const listFilters = useProfileListFilters(profiles);
  const bulkActions = useProfileBulkActions();

  function openTestChat(profile: AiProfile) {
    setChatProfile(profile);
    openChat();
  }

  function openFailoverConfig(profile: AiProfile) {
    setFailoverProfile(profile);
    openFailover();
  }

  if (loading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  return (
    <Stack gap="md">
      {/* Action bar */}
      <Group justify="flex-end">
        <Button variant="light" leftSection={<IconSettings size={16} />} onClick={openLlms}>
          Manage LLMs
        </Button>
        <Button leftSection={<IconPlus size={16} />} onClick={() => formModalRef.current?.openCreate()}>
          Add AI Profile
        </Button>
      </Group>

      <ProfileListView
        profiles={profiles}
        {...listFilters}
        {...bulkActions}
        onEdit={(profile) => formModalRef.current?.openEdit(profile)}
        onDelete={handleDelete}
        onTestChat={openTestChat}
        onToggleDefault={handleToggleDefault}
        onConfigureFailover={openFailoverConfig}
      />

      {/* Create / Edit Modal */}
      <ProfileFormModal
        ref={formModalRef}
        providers={providers}
        onSaved={loadData}
        onConfigureFailover={openFailoverConfig}
      />

      {/* Test Chat Drawer */}
      <Drawer
        opened={chatOpened}
        onClose={closeChat}
        title={`Test Chat — ${chatProfile?.name || ''}`}
        position="right"
        size="lg"
      >
        {chatProfile && (
          <TestChatPanel profileId={chatProfile.id} profileName={chatProfile.name} profile={chatProfile} />
        )}
      </Drawer>

      {/* Manage LLMs Modal */}
      <ManageLlmsModal opened={llmsOpened} onClose={closeLlms} providers={providers} />

      {/* Failover Config Modal */}
      <FailoverConfigModal
        opened={failoverOpened}
        onClose={closeFailover}
        profile={failoverProfile}
        providers={providers}
        onSaved={() => {
          loadData();
          setFailoverProfile(null);
        }}
      />
    </Stack>
  );
}
