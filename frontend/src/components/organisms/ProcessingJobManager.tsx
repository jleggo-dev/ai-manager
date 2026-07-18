/**
 * Organism – ProcessingJobManager
 * ---------------------------------
 * Orchestrates processing-job management tabs and create/edit/delete modals.
 * Tab/panel implementations live under ./processing-jobs/.
 */

import React, { useState, useEffect } from 'react';
import type { ProcessingJob, CallingApplication } from '../../types/api';
import {
  Stack,
  Group,
  Button,
  Text,
  Tooltip,
  Modal,
  TextInput,
  Select,
  Switch,
  Textarea,
  Loader,
  Center,
  Alert,
  Tabs,
  Code,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlayerPlay,
  IconSettings,
  IconFilter,
  IconAlertTriangle,
  IconAdjustments,
  IconActivity,
  IconChartBar,
  IconLock,
  IconLayoutGrid,
} from '@tabler/icons-react';
import * as api from '../../services/api';
import DiagnosticsTab from './DiagnosticsTab';
import { useProcessingJobsData } from './processing-jobs/useProcessingJobsData';
import JobsTab from './processing-jobs/JobsTab';
import RuleSetsTab from './processing-jobs/RuleSetsTab';
import TestRuleSetTab from './processing-jobs/TestRuleSetTab';
import BuildRulesTab from './processing-jobs/BuildRulesTab';
import TestTab from './processing-jobs/TestTab';
import AdvancedTab from './processing-jobs/AdvancedTab';
import AnalyticsTab from './processing-jobs/AnalyticsTab';
import type { ProcessingJobFormData } from './processing-jobs/types';

export default function ProcessingJobManager() {
  const {
    jobs,
    jobGroups,
    aiProfiles,
    availableRules,
    callingApps,
    setCallingApps,
    loading,
    selectedJob,
    setSelectedJob,
    selectedJobFull,
    setSelectedJobFull,
    loadData,
  } = useProcessingJobsData();

  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ProcessingJob | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  const [activeTab, setActiveTab] = useState('jobs');
  const [deleteTargetJob, setDeleteTargetJob] = useState<ProcessingJob | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [form, setForm] = useState<ProcessingJobFormData>({
    name: '',
    slug: '',
    description: '',
    ai_profile_id: null,
    is_active: true,
    calling_application_id: null,
  });

  function openCreate() {
    setEditing(null);
    const defaultProfile = aiProfiles.find((p) => p.is_default && p.is_active);
    setForm({
      name: '',
      slug: '',
      description: '',
      ai_profile_id: defaultProfile?.id || null,
      is_active: true,
      calling_application_id: null,
    });
    openModal();
  }

  function openEdit(job: ProcessingJob) {
    setEditing(job);
    setForm({
      name: job.name || '',
      slug: job.slug || '',
      description: job.description || '',
      ai_profile_id: job.ai_profile_id || null,
      is_active: job.is_active !== false,
      calling_application_id: job.calling_application_id || null,
    });
    openModal();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setSaving(true);
      if (form.calling_application_id) {
        try {
          await api.createCallingApplication({
            id: form.calling_application_id,
            display_name: form.calling_application_id,
          });
        } catch {
          /* upsert — ok if exists */
        }
      }
      if (editing) {
        await api.updateProcessingJob(editing.id, form as unknown as Record<string, unknown>);
        notifications.show({ title: 'Updated', message: 'Processing job updated', color: 'green' });
      } else {
        await api.createProcessingJob(form as unknown as Record<string, unknown>);
        notifications.show({ title: 'Created', message: 'Processing job created', color: 'green' });
      }
      closeModal();
      await loadData();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  function openDeleteConfirm(job: ProcessingJob) {
    setDeleteTargetJob(job);
    setDeleteConfirmText('');
    openDeleteModal();
  }

  async function handleDeleteConfirmed() {
    const id = deleteTargetJob?.id;
    if (!id) return;
    if (deleteConfirmText.trim().toLowerCase() !== 'delete') return;
    try {
      setDeleting(true);
      await api.deleteProcessingJob(id);
      if (selectedJob === id) setSelectedJob(null);
      notifications.show({ title: 'Deleted', message: 'Processing job removed', color: 'orange' });
      closeDeleteModal();
      setDeleteTargetJob(null);
      setDeleteConfirmText('');
      await loadData();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setDeleting(false);
    }
  }

  function handleNameChange(name: string) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    setForm((prev) => ({ ...prev, name, slug: editing ? prev.slug : slug }));
  }

  const profileOptions = aiProfiles.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.provider?.name || 'unknown'})`,
  }));

  const isChatMode = selectedJobFull?.ai_profile?.mode === 'chat';

  /* Reset to Jobs tab when switching between chat-mode and non-chat-mode jobs */
  useEffect(() => {
    if (isChatMode && (activeTab === 'rules' || activeTab === 'test')) {
      setActiveTab('jobs');
    }
    if (!isChatMode && (activeTab === 'rulesets' || activeTab === 'test-ruleset')) {
      setActiveTab('jobs');
    }
  }, [isChatMode, activeTab]);

  if (loading)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  /* Tabs that require a job to be selected — greyed out when no job is active */
  const jobRequired = !selectedJob;

  /** Handle tab change — prevent switching to job-dependent tabs when no job selected */
  function handleTabChange(tab: string | null) {
    if (!tab) return;
    if (tab !== 'jobs' && jobRequired) return;
    if ((tab === 'rules' || tab === 'test') && isChatMode) return;
    if ((tab === 'rulesets' || tab === 'test-ruleset') && !isChatMode) return;
    setActiveTab(tab);
  }

  async function refreshSelectedJob() {
    if (!selectedJob) return;
    const fresh = await api.getProcessingJob(selectedJob);
    setSelectedJobFull(fresh);
  }

  return (
    <Stack gap="md">
      <Tabs value={activeTab} onChange={handleTabChange}>
        <Tabs.List>
          <Tabs.Tab value="jobs" leftSection={<IconSettings size={14} />}>
            Jobs
          </Tabs.Tab>
          {!isChatMode && (
            <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
              <Tabs.Tab
                value="rules"
                leftSection={<IconFilter size={14} />}
                disabled={jobRequired}
                style={jobRequired ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              >
                Build Rules
              </Tabs.Tab>
            </Tooltip>
          )}
          {!isChatMode && (
            <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
              <Tabs.Tab
                value="test"
                leftSection={<IconPlayerPlay size={14} />}
                disabled={jobRequired}
                style={jobRequired ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              >
                Test Rules (API call)
              </Tabs.Tab>
            </Tooltip>
          )}
          {isChatMode && (
            <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
              <Tabs.Tab
                value="rulesets"
                leftSection={<IconLayoutGrid size={14} />}
                disabled={jobRequired}
                style={jobRequired ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              >
                Rule Sets
              </Tabs.Tab>
            </Tooltip>
          )}
          {isChatMode && (
            <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
              <Tabs.Tab
                value="test-ruleset"
                leftSection={<IconPlayerPlay size={14} />}
                disabled={jobRequired}
                style={jobRequired ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              >
                Test Rule Set
              </Tabs.Tab>
            </Tooltip>
          )}
          <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
            <Tabs.Tab
              value="analytics"
              leftSection={<IconChartBar size={14} />}
              disabled={jobRequired}
              style={jobRequired ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
              Analytics
            </Tabs.Tab>
          </Tooltip>
          <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
            <Tabs.Tab
              value="advanced"
              leftSection={<IconAdjustments size={14} />}
              disabled={jobRequired}
              style={jobRequired ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
              Advanced
            </Tabs.Tab>
          </Tooltip>
          <Tooltip label="Select a job first" disabled={!jobRequired} position="bottom" withArrow>
            <Tabs.Tab
              value="diagnostics"
              leftSection={<IconActivity size={14} />}
              disabled={jobRequired}
              style={jobRequired ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
            >
              Diagnostics
            </Tabs.Tab>
          </Tooltip>
        </Tabs.List>

        {jobRequired && activeTab === 'jobs' && (
          <Alert variant="light" color="blue" icon={<IconLock size={16} />} mt="sm">
            Select a processing job below to unlock the Build Rules, Test, Analytics, Advanced, and Diagnostics tabs.
          </Alert>
        )}

        <Tabs.Panel value="jobs" pt="md">
          <JobsTab
            jobs={jobs}
            jobGroups={jobGroups}
            aiProfiles={aiProfiles}
            callingApps={callingApps}
            selectedJob={selectedJob}
            onSelect={setSelectedJob}
            onEdit={openEdit}
            onDelete={openDeleteConfirm}
            onCreate={openCreate}
            onRefresh={loadData}
          />
        </Tabs.Panel>

        {!isChatMode && (
          <Tabs.Panel value="rules" pt="md">
            <BuildRulesTab
              selectedJob={selectedJob}
              selectedJobFull={selectedJobFull}
              availableRules={availableRules}
              onSelect={setSelectedJob}
              onRefresh={refreshSelectedJob}
            />
          </Tabs.Panel>
        )}

        {isChatMode && (
          <Tabs.Panel value="rulesets" pt="md">
            <RuleSetsTab
              selectedJob={selectedJob}
              selectedJobFull={selectedJobFull}
              availableRules={availableRules}
              onRefresh={refreshSelectedJob}
            />
          </Tabs.Panel>
        )}

        {isChatMode && (
          <Tabs.Panel value="test-ruleset" pt="md">
            <TestRuleSetTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} />
          </Tabs.Panel>
        )}

        {!isChatMode && (
          <Tabs.Panel value="test" pt="md">
            <TestTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} onSelect={setSelectedJob} />
          </Tabs.Panel>
        )}

        <Tabs.Panel value="analytics" pt="md">
          <AnalyticsTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} />
        </Tabs.Panel>

        <Tabs.Panel value="advanced" pt="md">
          <AdvancedTab
            selectedJob={selectedJob}
            selectedJobFull={selectedJobFull}
            onRefresh={refreshSelectedJob}
          />
        </Tabs.Panel>

        <Tabs.Panel value="diagnostics" pt="md">
          <DiagnosticsTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} />
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={modalOpened}
        onClose={closeModal}
        title={editing ? 'Edit Processing Job' : 'New Processing Job'}
        size="lg"
      >
        <form onSubmit={handleSubmit}>
          <Stack gap="sm">
            <TextInput
              label="Job Name"
              placeholder="e.g. Company Profiling"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
            />
            <TextInput
              label="Slug"
              placeholder="company-profiling"
              value={form.slug}
              onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
              required
              disabled={!!editing}
            />
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              minRows={2}
            />
            <Select
              label="AI Profile"
              placeholder="Select an AI profile"
              data={profileOptions}
              value={form.ai_profile_id}
              onChange={(v) => setForm((prev) => ({ ...prev, ai_profile_id: v }))}
              clearable
              searchable
            />
            {/* eslint-disable @typescript-eslint/no-explicit-any -- Mantine creatable Select workaround */}
            {React.createElement(
              Select as any,
              {
                label: 'Calling Application',
                description:
                  'Which product or project owns this job? Pick from the list or type a new platform:project-name.',
                placeholder: 'e.g. lovable:my-marketplace',
                data: [
                  ...callingApps.map((a: CallingApplication) => ({
                    value: a.id,
                    label: a.display_name !== a.id ? `${a.display_name} (${a.id})` : a.id,
                  })),
                ],
                value: form.calling_application_id,
                onChange: (v: string | null) =>
                  setForm((prev: ProcessingJobFormData) => ({ ...prev, calling_application_id: v })),
                clearable: true,
                searchable: true,
                creatable: true,
                getCreateLabel: (query: string) => `+ Register "${query}"`,
                onCreate: (query: string) => {
                  const trimmed = query
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9:_-]+/g, '-')
                    .replace(/(^-|-$)/g, '');
                  if (!trimmed) return null;
                  const newItem = { value: trimmed, label: trimmed };
                  setCallingApps((prev) => [...prev, { id: trimmed, display_name: trimmed } as CallingApplication]);
                  setForm((prev: ProcessingJobFormData) => ({ ...prev, calling_application_id: trimmed }));
                  return newItem;
                },
              } as any,
            )}
            {/* eslint-enable @typescript-eslint/no-explicit-any */}
            <Switch
              label="Active"
              checked={form.is_active}
              onChange={(e) => {
                const v = e.currentTarget.checked;
                setForm((prev) => ({ ...prev, is_active: v }));
              }}
            />
            <Group justify="flex-end">
              <Button variant="subtle" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {editing ? 'Update' : 'Create'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal opened={deleteModalOpened} onClose={closeDeleteModal} title="Delete Processing Job" size="md">
        <Stack gap="sm">
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            This will permanently delete the processing job
            {deleteTargetJob?.name ? ` "${deleteTargetJob.name}"` : ''}. Calling applications rely on processing jobs,
            so this may break active workflows.
          </Alert>
          <Text size="sm">
            Type <Code>delete</Code> to confirm.
          </Text>
          <TextInput
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.currentTarget.value)}
            placeholder="delete"
            autoFocus
          />
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => {
                closeDeleteModal();
                setDeleteTargetJob(null);
                setDeleteConfirmText('');
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={deleting}
              disabled={deleteConfirmText.trim().toLowerCase() !== 'delete'}
              onClick={handleDeleteConfirmed}
            >
              Delete Job
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
