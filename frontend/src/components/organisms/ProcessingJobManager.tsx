/**
 * Organism – ProcessingJobManager
 * ---------------------------------
 * Full-featured management for processing jobs:
 *   - Jobs tab: CRUD list
 *   - Build Rules tab: unified prompt editor + formatting rules + full test
 *   - Validation tab: validate response structure (future)
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { ProcessingJob, CallingApplication } from '../../types/api';
import {
  Stack,
  Group,
  Button,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  Modal,
  TextInput,
  Select,
  Switch,
  Textarea,
  Checkbox,
  Loader,
  Center,
  Alert,
  Tabs,
  Code,
  Paper,
  Grid,
  SimpleGrid,
  ScrollArea,
  Divider,
  Box,
  Title,
  ThemeIcon,
  Table,
  NumberInput,
  SegmentedControl,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlayerPlay,
  IconSettings,
  IconFilter,
  IconChevronRight,
  IconWand,
  IconArrowUp,
  IconArrowDown,
  IconX,
  IconEye,
  IconCheck,
  IconAlertTriangle,
  IconCircleX,
  IconAdjustments,
  IconActivity,
  IconRefresh,
  IconChartBar,
  IconLock,
  IconDeviceFloppy,
  IconLayoutGrid,
} from '@tabler/icons-react';
import * as api from '../../services/api';
import DiagnosticsTab from './DiagnosticsTab';
import VariablesReference from './processing-jobs/VariablesReference';
import ResponseSchemaViewer from './processing-jobs/ResponseSchemaViewer';
import StatusIcon from '../atoms/StatusIcon';
import ScoreBadge from '../atoms/ScoreBadge';
import SortHeader from '../atoms/SortHeader';
import { useProcessingJobsData } from './processing-jobs/useProcessingJobsData';
import JobsTab from './processing-jobs/JobsTab';
import RuleSetsTab from './processing-jobs/RuleSetsTab';

import type {
  ExpectedSchema,
  FormattingRule,
  AppliedRule,
  RuleSet,
  SchemaFieldDefExtended,
  TestResult,
  FormattingStepResult,
  ValidationFieldResult,
  ValidationResult,
  SchemaFieldDetail,
  SchemaValidationResult,
  FieldFrequency,
  AnalyticsData,
  LegacySchemaFieldDef,
  DiagnosticLog,
  AdvancedConfig,
  ProcessingJobFormData,
} from './processing-jobs/types';
import { getJobConfig } from './processing-jobs/types';

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

        {/* Prompt to select a job — shown inline under the tab bar when no job is selected */}
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
              onRefresh={async () => {
                if (!selectedJob) return;
                const fresh = await api.getProcessingJob(selectedJob);
                setSelectedJobFull(fresh);
              }}
            />
          </Tabs.Panel>
        )}

        {isChatMode && (
          <Tabs.Panel value="rulesets" pt="md">
            <RuleSetsTab
              selectedJob={selectedJob}
              selectedJobFull={selectedJobFull}
              availableRules={availableRules}
              onRefresh={async () => {
                if (!selectedJob) return;
                const fresh = await api.getProcessingJob(selectedJob);
                setSelectedJobFull(fresh);
              }}
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
            onRefresh={async () => {
              if (!selectedJob) return;
              const fresh = await api.getProcessingJob(selectedJob);
              setSelectedJobFull(fresh);
            }}
          />
        </Tabs.Panel>

        <Tabs.Panel value="diagnostics" pt="md">
          <DiagnosticsTab selectedJob={selectedJob} selectedJobFull={selectedJobFull} />
        </Tabs.Panel>
      </Tabs>

      {/* Create / Edit Modal */}
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

/* ══════════════════════════════════════════════════════════════
   TEST RULE SET TAB  (chat-mode jobs only)
   Opens a real chat session, invokes the selected rule set with
   test data, streams the response, and displays it alongside
   metadata (duration, model, tokens).
   ══════════════════════════════════════════════════════════════ */

function TestRuleSetTab({
  selectedJob,
  selectedJobFull,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
}) {
  const [selectedRuleSetKey, setSelectedRuleSetKey] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [composedPrompt, setComposedPrompt] = useState('');
  const [testing, setTesting] = useState(false);
  const [streamedContent, setStreamedContent] = useState('');
  const [metadata, setMetadata] = useState<{
    durationMs?: number;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    finishReason?: string;
    formattingSteps?: FormattingStepResult[];
  } | null>(null);

  /* When job or selected rule set changes, initialise variable state */
  const ruleSets = getJobConfig(selectedJobFull).ruleSets || [];
  const activeRuleSet = ruleSets.find((rs) => rs.key === selectedRuleSetKey) || null;

  useEffect(() => {
    if (!activeRuleSet) {
      setVariables({});
      setComposedPrompt('');
      return;
    }
    const vars: Record<string, string> = {};
    for (const v of activeRuleSet.variables || []) {
      vars[v.name] = activeRuleSet.testData?.[v.name] || '';
    }
    setVariables(vars);
    let composed = activeRuleSet.promptTemplate || '';
    for (const [key, val] of Object.entries(vars)) {
      composed = composed.split(`{{${key}}}`).join(val || `{{${key}}}`);
    }
    setComposedPrompt(composed);
  }, [selectedRuleSetKey, activeRuleSet]);

  function composePrompt(vars: Record<string, string>, rs: RuleSet | null) {
    let composed = rs?.promptTemplate || '';
    for (const [key, val] of Object.entries(vars || {})) {
      composed = composed.split(`{{${key}}}`).join(val || `{{${key}}}`);
    }
    setComposedPrompt(composed);
  }

  function handleVarChange(name: string, value: string) {
    const updated = { ...variables, [name]: value };
    setVariables(updated);
    composePrompt(updated, activeRuleSet);
  }

  function loadTestData() {
    if (!activeRuleSet) return;
    const filled: Record<string, string> = {};
    for (const v of activeRuleSet.variables || []) {
      filled[v.name] = activeRuleSet.testData?.[v.name] || `[No test data for ${v.label || v.name}]`;
    }
    setVariables(filled);
    composePrompt(filled, activeRuleSet);
  }

  async function runTest() {
    if (!activeRuleSet || !composedPrompt.trim()) return;
    try {
      setTesting(true);
      setStreamedContent('');
      setMetadata(null);

      /* Use the existing processing-job test endpoint with a promptOverride.
         This calls the same AI profile (completion path) so we can preview
         the formatted response without needing a live chat session from the test UI. */
      if (!selectedJob) return;
      const data = (await api.testProcessingJob(selectedJob, variables, composedPrompt)) as TestResult;
      setStreamedContent(data.formatted || data.raw || '');
      setMetadata({
        durationMs: data.durationMs,
        model: data.model,
        usage: data.usage,
        finishReason: data.finishReason,
        formattingSteps: data.formattingSteps,
      });
    } catch (err: unknown) {
      notifications.show({
        title: 'Test Failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setTesting(false);
    }
  }

  if (!selectedJob)
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab first.
      </Alert>
    );
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  if (ruleSets.length === 0) {
    return (
      <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={14} />}>
        No rule sets configured. Go to the <strong>Rule Sets</strong> tab to add some.
      </Alert>
    );
  }

  const ruleSetOptions = ruleSets.map((rs) => ({ value: rs.key, label: `${rs.name || rs.key} (${rs.key})` }));

  return (
    <Stack gap="md">
      <Title order={4}>Test Rule Set — {selectedJobFull.name}</Title>

      <Select
        label="Rule Set"
        placeholder="Select a rule set to test"
        data={ruleSetOptions}
        value={selectedRuleSetKey}
        onChange={setSelectedRuleSetKey}
      />

      {activeRuleSet && (
        <>
          {/* ── Variables ── */}
          <Paper withBorder p="md">
            <Group justify="space-between" mb={8}>
              <Text fw={600} size="sm">
                Variable Values
              </Text>
              <Group gap="xs">
                <Button size="xs" variant="light" leftSection={<IconWand size={14} />} onClick={loadTestData}>
                  Load Test Data
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  leftSection={<IconEye size={14} />}
                  onClick={() => composePrompt(variables, activeRuleSet)}
                >
                  Compose Prompt
                </Button>
              </Group>
            </Group>
            {(activeRuleSet.variables || []).length === 0 ? (
              <Text size="xs" c="dimmed">
                This rule set has no variables.
              </Text>
            ) : (
              <Grid>
                {(activeRuleSet.variables || []).map((v) => (
                  <Grid.Col span={v.source === 'user' ? 6 : 12} key={v.name}>
                    {v.source === 'user' ? (
                      <TextInput
                        label={
                          <Group gap={4}>
                            <Text size="xs" fw={500}>
                              {v.label || v.name}
                            </Text>
                            <Badge size="xs" color="blue">
                              user
                            </Badge>
                          </Group>
                        }
                        value={variables[v.name] || ''}
                        onChange={(e) => handleVarChange(v.name, e.target.value)}
                      />
                    ) : (
                      <Textarea
                        label={
                          <Group gap={4}>
                            <Text size="xs" fw={500}>
                              {v.label || v.name}
                            </Text>
                            <Badge size="xs" variant="outline" color="gray">
                              pipeline
                            </Badge>
                          </Group>
                        }
                        value={variables[v.name] || ''}
                        onChange={(e) => handleVarChange(v.name, e.target.value)}
                        autosize
                        minRows={2}
                        maxRows={6}
                        styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                      />
                    )}
                  </Grid.Col>
                ))}
              </Grid>
            )}
          </Paper>

          {/* ── Composed Prompt ── */}
          <Paper withBorder p="md">
            <Group justify="space-between" mb={8}>
              <Text fw={600} size="sm">
                Message Sent to LLM
              </Text>
              <Group gap="xs">
                <Badge variant="light" size="sm">
                  {composedPrompt.length} chars
                </Badge>
                <Button
                  size="xs"
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={runTest}
                  loading={testing}
                  disabled={!composedPrompt.trim()}
                >
                  Run Test
                </Button>
              </Group>
            </Group>
            <Textarea
              value={composedPrompt}
              onChange={(e) => setComposedPrompt(e.target.value)}
              autosize
              minRows={6}
              maxRows={25}
              styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
            />
          </Paper>

          {/* ── Result ── */}
          {(streamedContent || metadata) && (
            <Stack gap="md">
              {metadata && (
                <Paper withBorder p="sm">
                  <Group gap="lg" wrap="wrap">
                    {metadata.durationMs && (
                      <Badge color="blue" variant="light">
                        Duration: {metadata.durationMs}ms
                      </Badge>
                    )}
                    {metadata.model && (
                      <Badge color="gray" variant="light">
                        Model: {metadata.model}
                      </Badge>
                    )}
                    {metadata.usage && (
                      <>
                        <Badge color="gray" variant="light">
                          Prompt tokens: {metadata.usage.prompt_tokens}
                        </Badge>
                        <Badge color="gray" variant="light">
                          Completion tokens: {metadata.usage.completion_tokens}
                        </Badge>
                      </>
                    )}
                    {metadata.finishReason && (
                      <Badge color="gray" variant="light">
                        Finish: {metadata.finishReason}
                      </Badge>
                    )}
                    {activeRuleSet.key && (
                      <Badge color="violet" variant="light">
                        Rule set: {activeRuleSet.key}
                      </Badge>
                    )}
                  </Group>
                </Paper>
              )}
              <Paper withBorder p="md">
                <Text fw={600} size="sm" mb={8}>
                  AI Response
                </Text>
                <Textarea
                  value={streamedContent}
                  readOnly
                  autosize
                  minRows={6}
                  maxRows={40}
                  styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                />
              </Paper>
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}

function BuildRulesTab({
  selectedJob,
  selectedJobFull,
  availableRules,
  onSelect: _onSelect,
  onRefresh,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
  availableRules: FormattingRule[];
  onSelect?: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('');
  const [appliedRules, setAppliedRules] = useState<AppliedRule[]>([]);
  const [applyFormattingRules, setApplyFormattingRules] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedJobFull) return;
    const c = getJobConfig(selectedJobFull);
    setSystemPrompt(c.systemPrompt || '');
    setPromptTemplate(c.promptTemplate || '');
    setAppliedRules(c.formattingRules || []);
    setApplyFormattingRules(c.applyFormattingRules === true);
  }, [selectedJobFull]);

  if (!selectedJob) {
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab first, then come back here to edit its prompt and formatting rules.
      </Alert>
    );
  }
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const cfg = getJobConfig(selectedJobFull);
  const jobVariables = Array.isArray(cfg.variables) ? cfg.variables : [];
  const expectedSchema =
    cfg.expectedSchema && typeof cfg.expectedSchema === 'object' && Object.keys(cfg.expectedSchema).length > 0
      ? cfg.expectedSchema
      : null;
  const schemaFieldCount = expectedSchema?.fields ? Object.keys(expectedSchema.fields).length : 0;
  const isV2Profile = selectedJobFull.ai_profile?.provider?.type === 'devs-ai-v2';
  const hasNativeV2Schema = isV2Profile && schemaFieldCount > 0;

  function addRule(ruleType: string) {
    setAppliedRules((prev) => [...prev, { type: ruleType, order: prev.length, options: {} }]);
  }
  function removeRule(index: number) {
    setAppliedRules((prev) => prev.filter((_, i) => i !== index));
  }
  function moveRule(index: number, direction: number) {
    setAppliedRules((prev) => {
      const list = [...prev];
      const swap = index + direction;
      if (swap < 0 || swap >= list.length) return list;
      const a = list[index];
      const b = list[swap];
      if (a === undefined || b === undefined) return list;
      list[index] = b;
      list[swap] = a;
      return list.map((r, i) => ({ ...r, order: i }));
    });
  }
  function updateRuleOptions(index: number, options: Record<string, unknown>) {
    setAppliedRules((prev) => prev.map((r, i) => (i === index ? { ...r, options: { ...r.options, ...options } } : r)));
  }

  async function handleSave() {
    try {
      setSaving(true);
      // Preserve all other config keys (advanced, variables, testData, ruleSets, …) — only
      // overwrite the three this tab owns.
      const config = {
        ...getJobConfig(selectedJobFull),
        systemPrompt,
        promptTemplate,
        formattingRules: appliedRules.map((r, i) => ({ ...r, order: i })),
        applyFormattingRules: applyFormattingRules || undefined,
      };
      if (!selectedJob) return;
      await api.updateProcessingJob(selectedJob, { config });
      notifications.show({
        title: 'Saved',
        message: 'System prompt, prompt template, and rules updated',
        color: 'green',
      });
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="lg">
      <Title order={4}>{selectedJobFull.name} — Prompt & Rules Configuration</Title>

      {hasNativeV2Schema && (
        <Alert variant="light" color="blue" title="Native structured output (v2)">
          Structured output is enforced by the Devs.ai v2 provider when Expected Schema is set. JSON build rules such as
          trim-to-json are optional — use them only if you need a post-processing validation layer.
        </Alert>
      )}

      {hasNativeV2Schema && (
        <Switch
          label="Apply formatting rules after native v2 schema"
          description="When off (default), formatting rules are skipped when the provider enforces expectedSchema."
          checked={applyFormattingRules}
          onChange={(e) => setApplyFormattingRules(e.currentTarget.checked)}
        />
      )}

      {jobVariables.length > 0 && <VariablesReference variables={jobVariables} />}

      {expectedSchema && schemaFieldCount > 0 && <ResponseSchemaViewer expectedSchema={expectedSchema} />}

      <Textarea
        label="System Prompt"
        description="The model's standing instructions / persona for this job. For chat sessions this becomes the system role applied to every turn (the cacheable prefix), with per-call data supplied separately. Leave blank for one-shot templated jobs that put everything in the Prompt Template below."
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        autosize
        minRows={6}
        maxRows={30}
        styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
      />

      <Textarea
        label="Prompt Template"
        description="The complete prompt sent to the AI. Use {{variableName}} placeholders for dynamic data. This is the full message — include instructions, schema definitions, and data sections all in one place."
        value={promptTemplate}
        onChange={(e) => setPromptTemplate(e.target.value)}
        autosize
        minRows={12}
        maxRows={40}
        styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
      />

      <Divider label="Formatting Rules" />

      <Grid>
        <Grid.Col span={6}>
          <Paper withBorder p="sm" h="100%">
            <Text fw={600} size="sm" mb={8}>
              Select a Rule
            </Text>
            <Text size="xs" c="dimmed" mb={12}>
              Click to add formatting rules for <strong>{selectedJobFull.name}</strong>
            </Text>
            <ScrollArea h={400}>
              <Stack gap={4}>
                {availableRules.map((rule) => (
                  <Paper
                    key={rule.type}
                    withBorder
                    p="xs"
                    style={{ cursor: 'pointer' }}
                    onClick={() => addRule(rule.type)}
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Box>
                        <Text size="sm" fw={500}>
                          {rule.label}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {rule.description}
                        </Text>
                        {!rule.streamingSafe && rule.streamingNote && (
                          <Group gap={4} mt={2}>
                            <IconAlertTriangle size={11} color="var(--mantine-color-orange-5)" />
                            <Text size="xs" c="orange.6" fs="italic">
                              {rule.streamingNote}
                            </Text>
                          </Group>
                        )}
                      </Box>
                      <IconChevronRight size={14} />
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea>
          </Paper>
        </Grid.Col>

        <Grid.Col span={6}>
          <Paper withBorder p="sm" h="100%">
            <Group justify="space-between" mb={8}>
              <Text fw={600} size="sm">
                Applied Rules
              </Text>
              <Button size="xs" color="green" onClick={handleSave} loading={saving}>
                Save Configuration ({appliedRules.length} rules)
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mb={12}>
              Rules will be applied to AI responses in this order:
            </Text>
            <ScrollArea h={400}>
              {appliedRules.length === 0 ? (
                <Center py="xl">
                  <Stack align="center" gap={4}>
                    <Text size="sm" c="dimmed">
                      No formatting rules configured.
                    </Text>
                    <Text size="xs" c="dimmed">
                      Click on rules in the left panel to add them, or save to confirm no formatting.
                    </Text>
                  </Stack>
                </Center>
              ) : (
                <Stack gap={4}>
                  {appliedRules.map((rule: AppliedRule, idx: number) => {
                    const meta = availableRules.find((r) => r.type === rule.type);
                    return (
                      <Paper key={`${rule.type}-${idx}`} withBorder p="xs">
                        <Group justify="space-between" wrap="nowrap">
                          <Group gap="xs" wrap="nowrap">
                            <Text size="xs" c="dimmed" fw={600}>
                              {idx + 1}.
                            </Text>
                            <Box>
                              <Group gap={4} wrap="nowrap">
                                <Text size="sm" fw={500}>
                                  {meta?.label || rule.type}
                                </Text>
                                {meta && !meta.streamingSafe && (
                                  <Tooltip label={meta.streamingNote} multiline w={280} withArrow>
                                    <IconAlertTriangle size={13} color="var(--mantine-color-orange-5)" />
                                  </Tooltip>
                                )}
                              </Group>
                              {meta && !meta.streamingSafe && (
                                <Text size="xs" c="orange.6" fs="italic" mt={2}>
                                  Post-stream only
                                </Text>
                              )}
                              {(rule.type === 'remove-custom-tags' || rule.type === 'extract-between-tags') && (
                                <TextInput
                                  size="xs"
                                  placeholder="Tag name (e.g. data, result)"
                                  value={(rule.options?.tagName as string) || ''}
                                  onChange={(e) => updateRuleOptions(idx, { tagName: e.target.value })}
                                  mt={4}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              )}
                            </Box>
                          </Group>
                          <Group gap={2}>
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              onClick={() => moveRule(idx, -1)}
                              disabled={idx === 0}
                            >
                              <IconArrowUp size={12} />
                            </ActionIcon>
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              onClick={() => moveRule(idx, 1)}
                              disabled={idx === appliedRules.length - 1}
                            >
                              <IconArrowDown size={12} />
                            </ActionIcon>
                            <ActionIcon size="xs" variant="subtle" color="red" onClick={() => removeRule(idx)}>
                              <IconX size={12} />
                            </ActionIcon>
                          </Group>
                        </Group>
                      </Paper>
                    );
                  })}
                </Stack>
              )}
            </ScrollArea>
          </Paper>
        </Grid.Col>
      </Grid>

      <Group justify="flex-end">
        <Button onClick={handleSave} loading={saving}>
          Save All Changes
        </Button>
      </Group>
    </Stack>
  );
}

/* ══════════════════════════════════════════════════════════════
   DYNAMIC RESPONSE SCHEMA VALIDATION
   Uses the job's config.expectedSchema instead of a hardcoded schema.
   ══════════════════════════════════════════════════════════════ */

/**
 * LEGACY: Kept for backward compatibility with jobs that don't yet have
 * an expectedSchema. Will be removed once all jobs are migrated.
 */
const ICP_SCHEMA_LEGACY = {
  name: {
    label: 'Company Name',
    type: 'single',
    required: true,
    allowedValues: null /* free-text */,
  },
  /* icp_type removed — shelved for re-evaluation */
  size: {
    label: 'Size',
    type: 'single',
    required: false,
    allowedValues: ['SOHO (Micro)', 'Small', 'Medium', 'MSE (Mid-Size Enterprise)', 'Enterprise', 'Large Enterprise'],
  },
  employee_range: {
    label: 'Employee Range',
    type: 'single',
    required: false,
    allowedValues: [
      '1–10 employees',
      '11–50 employees',
      '51–250 employees',
      '251–1,000 employees',
      '1,001–5,000 employees',
      '5,001+ employees',
    ],
  },
  revenue_range: {
    label: 'Revenue Range',
    type: 'single',
    required: false,
    allowedValues: ['$0 — <$1M', '$1M — <$10M', '$10M — <$50M', '$50M — <$500M', '$500M — <$1B', '$1B — <$5B', '$5B+'],
  },
  vertical: {
    label: 'Vertical',
    type: 'multi',
    required: false,
    allowedValues: [
      'Healthcare',
      'Financial Services',
      'Retail',
      'Manufacturing',
      'Technology',
      'Education',
      'Real Estate',
      'Hospitality',
      'Transportation & Logistics',
      'Energy & Utilities',
      'Media & Entertainment',
      'Professional Services',
      'Construction',
      'Agriculture',
      'Telecommunications',
      'Government',
    ],
  },
  sub_vertical: {
    label: 'Sub-Vertical',
    type: 'multi',
    required: false,
    allowedValues: [
      /* Healthcare */ 'Hospitals & Health Systems',
      'Clinics & Ambulatory',
      'Pharma',
      'Medical Devices',
      'Health IT',
      'Payer / Insurance',
      /* Financial Services */ 'Banking',
      'Insurance',
      'Capital Markets',
      'Fintech',
      'Wealth Management',
      /* Retail */ 'E-commerce',
      'Brick & Mortar',
      'Grocery',
      'Specialty Retail',
      'Luxury',
      /* Manufacturing */ 'Discrete',
      'Process',
      'Automotive',
      'Aerospace & Defense',
      'Consumer Goods',
      /* Technology */ 'SaaS',
      'Hardware',
      'IT Services',
      'Cybersecurity',
      'AI / ML',
      'MSP',
      'Distributor',
      /* Education */ 'K-12',
      'Higher Education',
      'EdTech',
      'Corporate Training',
      /* Real Estate */ 'Commercial',
      'Residential',
      'Property Management',
      'REITs',
      /* Hospitality */ 'Hotels & Resorts',
      'Restaurants & Food Service',
      'Travel & Tourism',
      'Events',
      /* Transportation */ 'Freight & Shipping',
      'Last Mile',
      'Fleet Management',
      'Warehousing',
      /* Energy */ 'Oil & Gas',
      'Renewables',
      'Electric Utilities',
      'Water',
      'Energy Broker',
      /* Media */ 'Streaming',
      'Gaming',
      'Publishing',
      'Advertising',
      /* Professional Services */ 'Consulting',
      'Legal',
      'Accounting',
      'Staffing',
      /* Construction */ 'General Contracting',
      'Engineering',
      'Architecture',
      /* Agriculture */ 'Farming',
      'AgTech',
      'Food Processing',
      /* Telecommunications */ 'Wireless',
      'ISP',
      'Infrastructure',
      'Major Telco',
      /* Government */ 'Federal',
      'State & Local',
      'Defense',
      'Civilian Agencies',
    ],
  },
  business_model: {
    label: 'Business Model',
    type: 'multi',
    required: false,
    allowedValues: ['B2B', 'B2C', 'Hybrid'],
  },
  num_locations: {
    label: 'Number of Locations',
    type: 'single',
    required: false,
    allowedValues: null /* free-text number */,
  },
  ownership_type: {
    label: 'Ownership Type',
    type: 'multi',
    required: false,
    allowedValues: ['Private', 'Public', 'PE Backed', 'Non-profit', 'Government'],
  },
  operating_region: {
    label: 'Operating Region',
    type: 'multi',
    required: false,
    allowedValues: ['Any', 'US', 'Canada', 'EMEA', 'Africa', 'APAC'],
  },
  software_type: {
    label: 'Software Type',
    type: 'multi',
    required: false,
    allowedValues: [
      'HCM',
      'ERP',
      'CRM',
      'SCM',
      'BI / Analytics',
      'Collaboration',
      'Security',
      'DevOps',
      'iPaaS / Integration',
      'Vertical SaaS',
      'Infrastructure',
      'Fintech',
      'Martech',
      'Healthtech',
      'Edtech',
    ],
  },
  cbis: {
    label: 'Critical Business Issues',
    type: 'multi',
    required: false,
    allowedValues: null /* suggested values but custom accepted */,
    suggestedValues: [
      'Revenue Growth',
      'Cost Reduction',
      'Digital Transformation',
      'Customer Experience',
      'Operational Efficiency',
      'Risk & Compliance',
      'Market Expansion',
      'Innovation',
      'Talent Acquisition & Retention',
      'Sustainability',
    ],
  },
  pain_points: {
    label: 'Pain Points',
    type: 'multi',
    required: false,
    allowedValues: null /* suggested values but custom accepted */,
    suggestedValues: [
      'Manual Processes',
      'Data Silos',
      'Poor Visibility / Reporting',
      'Scaling Challenges',
      'Integration Issues',
      'Compliance Burden',
      'Talent Shortage',
      'Legacy Systems',
      'Customer Churn',
      'Security Concerns',
    ],
  },
  tech_stack: {
    label: 'Tech Stack',
    type: 'multi',
    required: false,
    allowedValues: null /* suggested values but custom accepted */,
    suggestedValues: [
      'Salesforce',
      'SAP',
      'Oracle',
      'Microsoft 365',
      'AWS',
      'Azure',
      'GCP',
      'HubSpot',
      'Workday',
      'ServiceNow',
      'Snowflake',
      'Tableau',
      'Slack',
      'Jira',
      'NetSuite',
    ],
  },
  tech_products_sold: {
    label: 'Tech Products Sold',
    type: 'multi',
    required: false,
    allowedValues: [
      'Connectivity',
      'Mobile',
      'CX',
      'SaaS',
      'AI',
      'Infrastructure',
      'Security',
      'Services',
      'Hardware',
      'Energy',
    ],
  },
  other_criteria: {
    label: 'Other Criteria',
    type: 'multi',
    required: false,
    allowedValues: null /* free-text tags */,
  },
  fortune_rank: {
    label: 'Fortune Rank',
    type: 'single',
    required: false,
    allowedValues: null,
  },
  ticker_symbol: {
    label: 'Ticker Symbol',
    type: 'single',
    required: false,
    allowedValues: null,
  },
  stock_exchange: {
    label: 'Stock Exchange',
    type: 'single',
    required: false,
    allowedValues: null,
  },
  locations: {
    label: 'Locations',
    type: 'multi',
    required: false,
    allowedValues: null,
  },
  general_contact: {
    label: 'General Contact',
    type: 'single',
    required: false,
    allowedValues: null,
  },
};

/**
 * Convert a job's expectedSchema fields into the legacy ICP_SCHEMA format
 * so the validator can handle both old and new field definitions uniformly.
 * Maps schema types: 'array' → 'multi', everything else → 'single'.
 */
function normaliseSchemaFields(expectedSchema: ExpectedSchema | null | undefined) {
  const fields = expectedSchema?.fields || {};
  const normalised: Record<string, LegacySchemaFieldDef> = {};
  for (const [name, def] of Object.entries(fields) as [string, SchemaFieldDefExtended][]) {
    normalised[name] = {
      label: def.description || name,
      type: def.type === 'array' ? 'multi' : 'single',
      required: !!def.required,
      allowedValues: def.allowedValues || null,
      suggestedValues: def.suggestedValues || null,
    };
  }
  return normalised;
}

/**
 * Validate a parsed JSON object against the response schema.
 * Uses the job's dynamic expectedSchema if provided, otherwise
 * falls back to the legacy ICP_SCHEMA_LEGACY for backward compat.
 *
 * @param {string} formattedText — raw AI response text
 * @param {object|null} expectedSchema — job's config.expectedSchema
 * @returns {{ valid, parseError, fields, summary, unexpectedFields }}
 */
function validateResponseSchema(
  formattedText: string,
  expectedSchema: ExpectedSchema | null | undefined,
): ValidationResult {
  /* Determine which schema fields to use */
  const hasExpectedSchema = expectedSchema && Object.keys(expectedSchema.fields || {}).length > 0;
  const schemaToUse = hasExpectedSchema ? normaliseSchemaFields(expectedSchema) : ICP_SCHEMA_LEGACY;

  const result: ValidationResult = {
    valid: false,
    parseError: null as string | null,
    fields: [] as ValidationFieldResult[],
    summary: { total: 0, passed: 0, warnings: 0, errors: 0, missing: 0 },
    unexpectedFields: [] as string[],
  };

  /* Try to parse the formatted text as JSON */
  let parsed;
  try {
    parsed = JSON.parse(formattedText);
  } catch (err: unknown) {
    result.parseError = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  /* Check if it's an object (not an array or primitive) */
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    result.parseError = `Expected a JSON object but got ${Array.isArray(parsed) ? 'array' : typeof parsed}`;
    return result;
  }

  const schemaKeys = Object.keys(schemaToUse);
  const parsedKeys = Object.keys(parsed);

  /* Detect unexpected (extra) fields not in the schema */
  result.unexpectedFields = parsedKeys.filter((k) => !schemaKeys.includes(k));

  /* Validate each expected field */
  for (const [fieldName, fieldDef] of Object.entries(schemaToUse) as [string, LegacySchemaFieldDef][]) {
    const fieldResult: ValidationFieldResult & { present: boolean; value: unknown } = {
      field: fieldName,
      label: fieldDef.label,
      required: fieldDef.required,
      expectedType: fieldDef.type,
      present: fieldName in parsed,
      value: parsed[fieldName] ?? null,
      status: 'pass',
      issues: [] as string[],
    };

    result.summary.total++;

    /* Check presence */
    if (!fieldResult.present || fieldResult.value === null || fieldResult.value === undefined) {
      if (fieldDef.required) {
        fieldResult.status = 'error';
        fieldResult.issues.push('Required field is missing or null');
        result.summary.errors++;
      } else {
        fieldResult.status = 'warning';
        fieldResult.issues.push('Field is missing or null (optional)');
        result.summary.missing++;
      }
      result.fields.push(fieldResult);
      continue;
    }

    /* Type check: multi fields should be arrays, single fields should be strings */
    const val = fieldResult.value;

    if (fieldDef.type === 'multi') {
      if (!Array.isArray(val)) {
        /* Accept semicolon-separated strings as well */
        if (typeof val === 'string') {
          fieldResult.issues.push('Expected array but got string (semicolon-separated may be acceptable)');
          fieldResult.status = 'warning';
          result.summary.warnings++;
          /* Still validate allowed values by splitting */
          if (fieldDef.allowedValues) {
            const allowed = fieldDef.allowedValues;
            const parts = val.split(';').map((s) => s.trim());
            const invalid = parts.filter((p) => p && !allowed.includes(p));
            if (invalid.length > 0) {
              fieldResult.issues.push(`Non-allowed values: ${invalid.join(', ')}`);
              fieldResult.status = 'error';
              result.summary.errors++;
              result.summary.warnings--; /* upgrade from warning to error */
            }
          }
          result.fields.push(fieldResult);
          continue;
        } else {
          fieldResult.status = 'error';
          fieldResult.issues.push(`Expected array but got ${typeof val}`);
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Validate allowed values for array items */
      if (fieldDef.allowedValues) {
        const allowed = fieldDef.allowedValues;
        const invalid = val.filter((v) => typeof v === 'string' && !allowed.includes(v));
        if (invalid.length > 0) {
          fieldResult.issues.push(`Non-allowed values: ${invalid.join(', ')}`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Check if suggested values — flag non-standard but don't mark as error */
      if (fieldDef.suggestedValues && Array.isArray(val)) {
        const suggested = fieldDef.suggestedValues;
        const nonStandard = val.filter((v) => typeof v === 'string' && !suggested.includes(v));
        if (nonStandard.length > 0) {
          fieldResult.issues.push(`Custom values (not in suggested list): ${nonStandard.join(', ')}`);
          /* Custom values are acceptable for these fields, so keep as pass */
        }
      }
    } else if (fieldDef.type === 'single') {
      if (typeof val !== 'string' && typeof val !== 'number') {
        /* Arrays are not acceptable for single-value fields */
        if (Array.isArray(val)) {
          fieldResult.issues.push('Expected single value but got array');
          fieldResult.status = 'warning';
          result.summary.warnings++;
        } else {
          fieldResult.issues.push(`Expected string but got ${typeof val}`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Validate against allowed values */
      if (fieldDef.allowedValues && typeof val === 'string') {
        if (!fieldDef.allowedValues.includes(val)) {
          fieldResult.issues.push(`Value "${val}" not in allowed list`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }
    }

    if (fieldResult.status === 'pass') {
      result.summary.passed++;
    }
    result.fields.push(fieldResult);
  }

  result.valid = result.summary.errors === 0 && !result.parseError;
  return result;
}

/* ══════════════════════════════════════════════════════════════
   TEST TAB — Full end-to-end test with 3 panels
   ══════════════════════════════════════════════════════════════ */

/**
 * Default sample values for the Test tab live in config.testData.
 * Configure them under Jobs → Build Rules (Default test values) or via
 * PUT /api/processing-jobs/:id (config.testData).
 *
 * config.testData example:
 * {
 *   companyName: 'HubSpot',
 *   domain: 'hubspot.com',
 *   websiteHomepage: '...',
 *   ...
 * }
 */

function TestTab({
  selectedJob,
  selectedJobFull,
  onSelect: _onSelect,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
  onSelect?: (id: string) => void;
}) {
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [composedPrompt, setComposedPrompt] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  /* Initialise all variables (user + pipeline) when job changes */
  useEffect(() => {
    if (!selectedJobFull) {
      setVariables({});
      setComposedPrompt('');
      setResult(null);
      return;
    }
    const vars: Record<string, string> = {};
    for (const v of getJobConfig(selectedJobFull).variables || []) {
      vars[v.name] = '';
    }
    setVariables(vars);
    setComposedPrompt('');
    setResult(null);
  }, [selectedJobFull]);

  if (!selectedJob) {
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab first, then test it here.
      </Alert>
    );
  }
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const allVars = getJobConfig(selectedJobFull).variables || [];
  const promptTemplate = getJobConfig(selectedJobFull).promptTemplate || '';
  const testData = getJobConfig(selectedJobFull).testData || {};
  const hasTestData = Object.keys(testData).length > 0;

  /** Fill inputs from config.testData (Build Rules or API). */
  function generateTestValues() {
    const filled: Record<string, string> = {};
    for (const v of allVars) {
      filled[v.name] = testData[v.name] || `[No test data for ${v.label}]`;
    }
    setVariables(filled);
    /* Also compose the prompt immediately */
    composePromptFromVars(filled);
  }

  /** Build the composed prompt from the template + current variable values */
  function composePromptFromVars(vars: Record<string, string>) {
    let composed = promptTemplate;
    for (const [key, val] of Object.entries(vars || variables)) {
      composed = composed.split(`{{${key}}}`).join(val || `{{${key}}}`);
    }
    setComposedPrompt(composed);
  }

  /** Update a variable and recompose the prompt */
  function handleVarChange(name: string, value: string) {
    const updated = { ...variables, [name]: value };
    setVariables(updated);
    composePromptFromVars(updated);
  }

  /** Compose the prompt from current vars (explicit button) */
  function handleCompose() {
    composePromptFromVars(variables);
  }

  /** Run the test — send the composed prompt to the LLM */
  async function runTest() {
    try {
      setTesting(true);
      setResult(null);
      /* Send the composed prompt directly (admin may have edited it) */
      if (!selectedJob) return;
      const data = await api.testProcessingJob(selectedJob, variables, composedPrompt);
      setResult(data);
    } catch (err: unknown) {
      notifications.show({
        title: 'Test Failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Stack gap="md">
      <Title order={4}>Test: {selectedJobFull.name}</Title>

      {/* ── Variable Inputs ───────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb={8}>
          <Text fw={600} size="sm">
            Variable Values
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="light" leftSection={<IconWand size={14} />} onClick={generateTestValues}>
              Generate Test Values
            </Button>
            <Button size="xs" variant="outline" leftSection={<IconEye size={14} />} onClick={handleCompose}>
              Compose Prompt
            </Button>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mb={hasTestData ? 12 : 4}>
          Enter values for all variables, or click &quot;Generate Test Values&quot; to use defaults from Build Rules or
          config.testData.
        </Text>
        {!hasTestData && (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={14} />} mb={12}>
            <Text size="xs">
              No test data configured. Set <strong>Default test values</strong> in <strong>Build Rules</strong>, or
              provide <Code>config.testData</Code> via <Code>PUT /api/processing-jobs/:id</Code>. You can still enter
              values manually.
            </Text>
          </Alert>
        )}

        <Grid>
          {allVars.map((v) => (
            <Grid.Col span={v.source === 'user' ? 6 : 12} key={v.name}>
              {v.source === 'user' ? (
                <TextInput
                  label={
                    <Group gap={4}>
                      <Text size="xs" fw={500}>
                        {v.label}
                      </Text>
                      <Badge size="xs" color="blue">
                        user
                      </Badge>
                    </Group>
                  }
                  placeholder={`Enter ${v.label}`}
                  value={variables[v.name] || ''}
                  onChange={(e) => handleVarChange(v.name, e.target.value)}
                />
              ) : (
                <Textarea
                  label={
                    <Group gap={4}>
                      <Text size="xs" fw={500}>
                        {v.label}
                      </Text>
                      <Badge size="xs" variant="outline" color="gray">
                        pipeline
                      </Badge>
                    </Group>
                  }
                  placeholder={`Enter test data for ${v.label} (normally auto-populated)`}
                  value={variables[v.name] || ''}
                  onChange={(e) => handleVarChange(v.name, e.target.value)}
                  autosize
                  minRows={2}
                  maxRows={6}
                  styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                />
              )}
            </Grid.Col>
          ))}
        </Grid>
      </Paper>

      {/* ── Composed Prompt (editable) ────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb={8}>
          <Text fw={600} size="sm">
            Message Sent to LLM
          </Text>
          <Group gap="xs">
            <Badge variant="light" size="sm">
              {composedPrompt.length} chars
            </Badge>
            <Button
              size="xs"
              leftSection={<IconPlayerPlay size={14} />}
              onClick={runTest}
              loading={testing}
              disabled={!composedPrompt.trim()}
            >
              Run Test
            </Button>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mb={8}>
          This is the final prompt that will be sent. You can edit it here before clicking &quot;Run Test&quot;.
        </Text>
        <Textarea
          value={composedPrompt}
          onChange={(e) => setComposedPrompt(e.target.value)}
          autosize
          minRows={8}
          maxRows={30}
          styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
        />
      </Paper>

      {/* ── Results: Raw Response + Formatted Response ── */}
      {result && (
        <Stack gap="md">
          {/* Metadata */}
          <Paper withBorder p="sm">
            <Group gap="lg">
              <Badge color="blue" variant="light">
                Duration: {result.durationMs}ms
              </Badge>
              <Badge color="gray" variant="light">
                Model: {result.model || 'unknown'}
              </Badge>
              {result.usage && (
                <>
                  <Badge color="gray" variant="light">
                    Prompt tokens: {result.usage.prompt_tokens}
                  </Badge>
                  <Badge color="gray" variant="light">
                    Completion tokens: {result.usage.completion_tokens}
                  </Badge>
                </>
              )}
              <Badge color={result.finishReason === 'stop' ? 'green' : 'yellow'} variant="light">
                Finish: {result.finishReason || 'unknown'}
              </Badge>
            </Group>
          </Paper>

          {/* Raw vs Formatted side-by-side */}
          <Grid>
            <Grid.Col span={6}>
              <Paper withBorder p="sm" h="100%">
                <Text fw={600} size="sm" mb={8}>
                  Raw Response
                </Text>
                <ScrollArea h={500}>
                  <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {result.raw || '(empty)'}
                  </Code>
                </ScrollArea>
              </Paper>
            </Grid.Col>
            <Grid.Col span={6}>
              <Paper withBorder p="sm" h="100%">
                <Text fw={600} size="sm" mb={8}>
                  Formatted Response
                </Text>
                <ScrollArea h={500}>
                  <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {result.formatted || '(empty)'}
                  </Code>
                </ScrollArea>
              </Paper>
            </Grid.Col>
          </Grid>

          {/* Formatting Steps */}
          {(result?.formattingSteps?.length ?? 0) > 0 && (
            <Paper withBorder p="sm">
              <Text fw={600} size="sm" mb={8}>
                Formatting Steps Applied
              </Text>
              <Stack gap={4}>
                {(result.formattingSteps ?? []).map((step: FormattingStepResult, i: number) => (
                  <Group key={i} gap="xs" wrap="wrap">
                    <Badge
                      size="xs"
                      variant="light"
                      color={step.rolledBack ? 'orange' : step.changed ? 'green' : 'gray'}
                    >
                      {i + 1}
                    </Badge>
                    <Text size="xs" fw={500}>
                      {step.label || step.type}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {step.rolledBack
                        ? `Rolled back (${step.before} chars preserved)`
                        : step.changed
                          ? `Changed (${step.before} → ${step.after} chars)`
                          : `No change (${step.before} chars)`}
                    </Text>
                    {step.error && (
                      <Badge size="xs" color="red">
                        {step.error}
                      </Badge>
                    )}
                    {step.warning && (
                      <Text size="xs" c="orange" fw={500}>
                        {step.warning}
                      </Text>
                    )}
                  </Group>
                ))}
              </Stack>
            </Paper>
          )}

          {/* Schema Validation */}
          <SchemaValidationPanel
            formattedText={result.formatted || ''}
            expectedSchema={getJobConfig(selectedJobFull).expectedSchema}
          />
        </Stack>
      )}
    </Stack>
  );
}

/* ══════════════════════════════════════════════════════════════
   SCHEMA VALIDATION PANEL
   ══════════════════════════════════════════════════════════════ */

/**
 * Validates the formatted LLM response against the job's expected response
 * schema and renders a field-by-field report with pass/warning/error indicators.
 */
function SchemaValidationPanel({
  formattedText,
  expectedSchema,
}: {
  formattedText: string;
  expectedSchema: ExpectedSchema | null | undefined;
}) {
  if (!formattedText) return null;

  const validation = validateResponseSchema(formattedText, expectedSchema);

  /** Format a field value for display (truncate long arrays/strings) */
  function formatValue(val: unknown) {
    if (val === null || val === undefined)
      return (
        <Text size="xs" c="dimmed" fs="italic">
          null
        </Text>
      );
    if (Array.isArray(val)) {
      return (
        <Group gap={4} wrap="wrap">
          {val.map((v, i) => (
            <Badge key={i} size="xs" variant="outline" color="gray">
              {String(v)}
            </Badge>
          ))}
        </Group>
      );
    }
    const str = String(val);
    if (str.length > 80)
      return (
        <Text size="xs" style={{ wordBreak: 'break-word' }}>
          {str.slice(0, 80)}…
        </Text>
      );
    return (
      <Text size="xs" style={{ wordBreak: 'break-word' }}>
        {str}
      </Text>
    );
  }

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600} size="sm">
          Schema Validation
        </Text>
        {validation.parseError ? (
          <Badge color="red" variant="filled" size="sm">
            JSON Parse Error
          </Badge>
        ) : (
          <Group gap="xs">
            <Badge color={validation.valid ? 'green' : 'red'} variant="filled" size="sm">
              {validation.valid ? 'Valid' : 'Issues Found'}
            </Badge>
            <Badge color="green" variant="light" size="xs">
              {validation.summary.passed} passed
            </Badge>
            {validation.summary.warnings > 0 && (
              <Badge color="yellow" variant="light" size="xs">
                {validation.summary.warnings} warnings
              </Badge>
            )}
            {validation.summary.errors > 0 && (
              <Badge color="red" variant="light" size="xs">
                {validation.summary.errors} errors
              </Badge>
            )}
            {validation.summary.missing > 0 && (
              <Badge color="gray" variant="light" size="xs">
                {validation.summary.missing} empty
              </Badge>
            )}
          </Group>
        )}
      </Group>

      {/* Parse error — stop here */}
      {validation.parseError && (
        <Alert color="red" variant="light" icon={<IconCircleX size={16} />}>
          <Text size="sm">{validation.parseError}</Text>
          <Text size="xs" c="dimmed" mt={4}>
            The formatted response could not be parsed as JSON. Check the formatting rules or the AI prompt to ensure
            valid JSON output.
          </Text>
        </Alert>
      )}

      {/* Unexpected extra fields */}
      {validation.unexpectedFields.length > 0 && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />} mb="sm">
          <Text size="sm" fw={500}>
            Unexpected fields in response
          </Text>
          <Text size="xs" c="dimmed">
            The following fields are not part of the expected response schema and may be ignored:{' '}
            {validation.unexpectedFields.map((f: string) => (
              <Badge key={f} size="xs" variant="outline" color="yellow" mx={2}>
                {f}
              </Badge>
            ))}
          </Text>
        </Alert>
      )}

      {/* Field-by-field table */}
      {!validation.parseError && (
        <ScrollArea>
          <Table
            striped
            highlightOnHover
            withTableBorder
            withColumnBorders
            verticalSpacing={4}
            style={{ fontSize: 12 }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 30 }}></Table.Th>
                <Table.Th style={{ width: 160 }}>Field</Table.Th>
                <Table.Th style={{ width: 70 }}>Type</Table.Th>
                <Table.Th>Value</Table.Th>
                <Table.Th style={{ width: 250 }}>Issues</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {validation.fields.map((f) => (
                <Table.Tr key={f.field}>
                  <Table.Td>
                    <StatusIcon status={f.status} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Text size="xs" fw={500}>
                        {f.label}
                      </Text>
                      {f.required && (
                        <Badge size="xs" color="red" variant="light">
                          req
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {f.field}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={f.expectedType === 'multi' ? 'violet' : 'blue'}>
                      {f.expectedType}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatValue(f.value)}</Table.Td>
                  <Table.Td>
                    {f.issues.length > 0 ? (
                      <Stack gap={2}>
                        {f.issues.map((issue: string, i: number) => (
                          <Text
                            key={i}
                            size="xs"
                            c={f.status === 'error' ? 'red' : f.status === 'warning' ? 'yellow.8' : 'dimmed'}
                          >
                            {issue}
                          </Text>
                        ))}
                      </Stack>
                    ) : (
                      <Text size="xs" c="green">
                        OK
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Paper>
  );
}

/* ══════════════════════════════════════════════════════════════
   ADVANCED TAB — Diagnostics, timeouts, retries, caching toggles
   ══════════════════════════════════════════════════════════════ */

/** Default advanced configuration values */
const DEFAULT_ADVANCED = {
  diagnostics: { enabled: true, mode: 'always' },
  timeout: { llmTimeoutMs: 0, totalTimeoutMs: 0 },
  retries: { enabled: false, maxRetries: 3, retryDelayMs: 1000 },
  caching: { enabled: false, ttlSeconds: 3600 },
};

function AdvancedTab({
  selectedJob,
  selectedJobFull,
  onRefresh,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
  onRefresh: () => Promise<void>;
}) {
  const [advanced, setAdvanced] = useState<AdvancedConfig>(DEFAULT_ADVANCED);
  const [requiresUserCreds, setRequiresUserCreds] = useState(false);
  const [saving, setSaving] = useState(false);

  /* Load advanced config + top-level flags from job when it changes */
  useEffect(() => {
    if (!selectedJobFull) return;
    const cfg = getJobConfig(selectedJobFull).advanced || {};
    setAdvanced({
      diagnostics: { ...DEFAULT_ADVANCED.diagnostics, ...cfg.diagnostics },
      timeout: { ...DEFAULT_ADVANCED.timeout, ...cfg.timeout },
      retries: { ...DEFAULT_ADVANCED.retries, ...cfg.retries },
      caching: { ...DEFAULT_ADVANCED.caching, ...cfg.caching },
    });
    setRequiresUserCreds(selectedJobFull.requires_user_credentials === true);
  }, [selectedJobFull]);

  if (!selectedJob) {
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab first to configure advanced settings.
      </Alert>
    );
  }
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  /** Update a nested key in the advanced config state */
  function updateSection(section: keyof AdvancedConfig, key: string, value: unknown) {
    setAdvanced((prev) => ({
      ...prev,
      [section]: { ...(prev[section] as Record<string, unknown>), [key]: value },
    }));
  }

  async function handleSave() {
    try {
      setSaving(true);
      const config = { ...getJobConfig(selectedJobFull), advanced };
      if (!selectedJob) return;
      await api.updateProcessingJob(selectedJob, { config, requires_user_credentials: requiresUserCreds });
      notifications.show({ title: 'Saved', message: 'Advanced settings updated', color: 'green' });
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="lg">
      <Title order={4}>{selectedJobFull.name} — Advanced Settings</Title>

      {/* ── Credentials ─────────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between">
          <Box>
            <Text fw={600} size="sm">
              Requires personal credentials
            </Text>
            <Text size="xs" c="dimmed">
              When enabled, users must store their own provider API key to run this job. Required for tasks that invoke
              MCP tools scoped to a user&apos;s account (Gmail, Drive, etc.).
            </Text>
          </Box>
          <Switch
            checked={requiresUserCreds}
            onChange={(e) => setRequiresUserCreds(e.currentTarget.checked)}
            label={requiresUserCreds ? 'Required' : 'Shared key'}
          />
        </Group>
      </Paper>

      {/* ── Diagnostics ─────────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Box>
            <Text fw={600} size="sm">
              Diagnostics
            </Text>
            <Text size="xs" c="dimmed">
              Log detailed timing and payload data for each AI call. Useful for debugging and performance monitoring.
            </Text>
          </Box>
          <Switch
            checked={advanced.diagnostics.enabled}
            onChange={(e) => updateSection('diagnostics', 'enabled', e.currentTarget.checked)}
            label={advanced.diagnostics.enabled ? 'Enabled' : 'Disabled'}
          />
        </Group>
        {advanced.diagnostics.enabled && (
          <Box mt="sm">
            <Text size="xs" fw={500} mb={4}>
              Diagnostics Mode
            </Text>
            <SegmentedControl
              size="xs"
              value={advanced.diagnostics.mode}
              onChange={(val) => updateSection('diagnostics', 'mode', val)}
              data={[
                { label: 'One-time (returned, not saved)', value: 'one-time' },
                { label: 'Always (saved to database)', value: 'always' },
              ]}
            />
          </Box>
        )}
      </Paper>

      {/* ── Timeouts ────────────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Box>
            <Text fw={600} size="sm">
              Timeouts
            </Text>
            <Text size="xs" c="dimmed">
              Per-job timeout override for LLM completion calls. Set to 0 to inherit from the provider or system
              default.
            </Text>
          </Box>
        </Group>
        <Grid mt="sm">
          <Grid.Col span={6}>
            <NumberInput
              label="LLM Timeout (ms)"
              description={
                advanced.timeout.llmTimeoutMs > 0
                  ? `${(advanced.timeout.llmTimeoutMs / 1000).toFixed(0)}s — overrides provider and system default`
                  : 'Inherits from provider → system default'
              }
              placeholder="0 = inherit"
              value={advanced.timeout.llmTimeoutMs || ''}
              onChange={(val) => updateSection('timeout', 'llmTimeoutMs', Number(val) || 0)}
              min={0}
              max={600000}
              step={5000}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <Text size="xs" c="dimmed" mt={28}>
              Priority: Job timeout → Provider timeout → System default (Settings page)
            </Text>
          </Grid.Col>
        </Grid>
      </Paper>

      {/* ── Retries ─────────────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Box>
            <Text fw={600} size="sm">
              Retries
            </Text>
            <Text size="xs" c="dimmed">
              Automatically retry failed LLM calls before reporting an error.
            </Text>
          </Box>
          <Switch
            checked={advanced.retries.enabled}
            onChange={(e) => updateSection('retries', 'enabled', e.currentTarget.checked)}
            label={advanced.retries.enabled ? 'Enabled' : 'Disabled'}
          />
        </Group>
        {advanced.retries.enabled && (
          <Grid mt="sm">
            <Grid.Col span={6}>
              <NumberInput
                label="Max Retries"
                description="Number of retry attempts"
                value={advanced.retries.maxRetries}
                onChange={(val) => updateSection('retries', 'maxRetries', val || 3)}
                min={1}
                max={10}
              />
            </Grid.Col>
            <Grid.Col span={6}>
              <NumberInput
                label="Retry Delay (ms)"
                description="Wait time between retries"
                value={advanced.retries.retryDelayMs}
                onChange={(val) => updateSection('retries', 'retryDelayMs', val || 1000)}
                min={100}
                max={30000}
                step={500}
              />
            </Grid.Col>
          </Grid>
        )}
      </Paper>

      {/* ── Response Caching ────────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Box>
            <Text fw={600} size="sm">
              Response Caching
            </Text>
            <Text size="xs" c="dimmed">
              Cache AI responses to avoid redundant API calls for identical inputs.
            </Text>
          </Box>
          <Switch
            checked={advanced.caching.enabled}
            onChange={(e) => updateSection('caching', 'enabled', e.currentTarget.checked)}
            label={advanced.caching.enabled ? 'Enabled' : 'Disabled'}
          />
        </Group>
        {advanced.caching.enabled && (
          <Box mt="sm">
            <NumberInput
              label="Cache TTL (seconds)"
              description="How long to keep cached responses"
              value={advanced.caching.ttlSeconds}
              onChange={(val) => updateSection('caching', 'ttlSeconds', val || 3600)}
              min={60}
              max={86400}
              step={300}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {advanced.caching.ttlSeconds >= 3600
                ? `≈ ${(advanced.caching.ttlSeconds / 3600).toFixed(1)} hours`
                : `≈ ${(advanced.caching.ttlSeconds / 60).toFixed(0)} minutes`}
            </Text>
          </Box>
        )}
      </Paper>

      <Group justify="flex-end">
        <Button onClick={handleSave} loading={saving}>
          Save Advanced Settings
        </Button>
      </Group>
    </Stack>
  );
}

/* ══════════════════════════════════════════════════════════════
   ANALYTICS TAB — Content, Speed, Accuracy metrics
   ══════════════════════════════════════════════════════════════
   Metrics are derived entirely from AI Manager data (diagnostic
   logs + schema validation). No calling-application feedback needed.

   Content  — % of expected schema fields populated in AI responses
   Speed    — LLM response time from diagnostic logs
   Accuracy — JSON validity, schema conformance, finish reason,
              formatting success (reuses the Test Rules validation pattern)
   ══════════════════════════════════════════════════════════════ */

/**
 * Validate a parsed JSON response against a job's expectedSchema config.
 * Returns field-level results for computing Content and Accuracy scores.
 * This is the generic, reusable version of the ICP_SCHEMA validator from
 * the Test Rules tab — works for any job regardless of calling application.
 */
function validateAgainstExpectedSchema(
  text: string,
  expectedSchema: ExpectedSchema | null | undefined,
): SchemaValidationResult {
  const result: SchemaValidationResult = {
    jsonValid: false,
    fieldsTotal: 0,
    fieldsPopulated: 0,
    fieldsCorrectType: 0,
    requiredTotal: 0,
    requiredPresent: 0,
    unexpectedFields: 0,
    fieldDetails: [] as SchemaFieldDetail[],
  };

  /* Try JSON parse */
  let parsed;
  try {
    /* Strip markdown fences if present */
    const clean = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    parsed = JSON.parse(clean);
    result.jsonValid = true;
  } catch {
    return result;
  }

  /* Non-object responses can't be validated field-by-field */
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return result;
  }

  const fields = expectedSchema?.fields || {};
  const schemaKeys = new Set(Object.keys(fields));

  for (const [name, def] of Object.entries(fields) as [string, SchemaFieldDefExtended][]) {
    result.fieldsTotal++;
    if (def.required) result.requiredTotal++;

    const val = parsed[name];
    const isPopulated = val != null && val !== '' && !(Array.isArray(val) && val.length === 0);

    /* Check type correctness */
    let typeCorrect = false;
    if (isPopulated) {
      result.fieldsPopulated++;
      if (def.required) result.requiredPresent++;

      if (def.type === 'array' && Array.isArray(val)) typeCorrect = true;
      else if (def.type === 'string' && typeof val === 'string') typeCorrect = true;
      else if (def.type === 'number' && typeof val === 'number') typeCorrect = true;
      else if (def.type === 'boolean' && typeof val === 'boolean') typeCorrect = true;
      else if (!def.type) typeCorrect = true; /* no type constraint */

      if (typeCorrect) result.fieldsCorrectType++;
    }

    result.fieldDetails.push({
      field: name,
      label: def.description || name,
      required: !!def.required,
      populated: isPopulated,
      typeCorrect,
      value: isPopulated ? (Array.isArray(val) ? val.join(', ') : String(val)).slice(0, 100) : null,
    });
  }

  /* Count unexpected fields not in the schema */
  result.unexpectedFields = Object.keys(parsed).filter((k) => !schemaKeys.has(k)).length;

  return result;
}

/**
 * Compute aggregate analytics from an array of diagnostic logs
 * and the job's expected schema.
 *
 * @param {Array} logs — diagnostic log entries
 * @param {object} expectedSchema — the job's expectedSchema config
 * @param {Set|null} contentFields — if provided, only these fields count
 *   towards the Content score. null = all fields count.
 */
function computeAnalytics(
  logs: DiagnosticLog[],
  expectedSchema: ExpectedSchema | null | undefined,
  contentFields: Set<string> | null = null,
): AnalyticsData {
  if (!logs || logs.length === 0) {
    return { hasData: false };
  }

  /* ── Speed Metrics ─────────────────────────────────── */
  const llmDurations = logs.map((l) => l.llm_timing?.durationMs).filter((d): d is number => typeof d === 'number');

  const totalDurations = logs.map((l) => l.total_duration_ms).filter((d): d is number => typeof d === 'number');

  const tokenUsage = logs
    .map((l) => l.llm_response?.usage)
    .filter((u): u is { prompt_tokens?: number; completion_tokens?: number } => !!u);

  const avgLlm =
    llmDurations.length > 0
      ? Math.round(llmDurations.reduce((a: number, b: number) => a + b, 0) / llmDurations.length)
      : null;
  const minLlm = llmDurations.length > 0 ? Math.min(...llmDurations) : null;
  const maxLlm = llmDurations.length > 0 ? Math.max(...llmDurations) : null;

  const avgTotal =
    totalDurations.length > 0
      ? Math.round(totalDurations.reduce((a: number, b: number) => a + b, 0) / totalDurations.length)
      : null;

  const avgPromptTokens =
    tokenUsage.length > 0
      ? Math.round(tokenUsage.reduce((a, u) => a + (u.prompt_tokens || 0), 0) / tokenUsage.length)
      : null;
  const avgCompletionTokens =
    tokenUsage.length > 0
      ? Math.round(tokenUsage.reduce((a, u) => a + (u.completion_tokens || 0), 0) / tokenUsage.length)
      : null;

  /* ── Content & Accuracy Metrics ────────────────────── */
  /* Run schema validation on each log's raw response */
  const validationResults = logs
    .map((l) => {
      const rawContent = l.llm_response?.rawContent;
      if (!rawContent) return null;
      return validateAgainstExpectedSchema(rawContent, expectedSchema);
    })
    .filter((v): v is SchemaValidationResult => v !== null);

  const jsonParseSuccessCount = validationResults.filter((v) => v.jsonValid).length;
  const jsonParseRate =
    validationResults.length > 0 ? Math.round((jsonParseSuccessCount / validationResults.length) * 100) : null;

  /* Content: average field coverage across successful parses */
  const validParses = validationResults.filter((v): v is SchemaValidationResult => v.jsonValid && v.fieldsTotal > 0);

  /* When contentFields is set, compute coverage only for those fields */
  let avgFieldCoverage = null;
  let avgRequiredCoverage = null;
  let scoredFieldCount = 0;

  if (validParses.length > 0) {
    const coverages = validParses.map((v) => {
      const relevant = contentFields ? v.fieldDetails.filter((f) => contentFields.has(f.field)) : v.fieldDetails;
      const total = relevant.length;
      const populated = relevant.filter((f) => f.populated).length;
      return total > 0 ? (populated / total) * 100 : 0;
    });
    avgFieldCoverage = Math.round(coverages.reduce((a: number, b: number) => a + b, 0) / coverages.length);

    /* Required fields coverage (always across all fields, not just selected) */
    const reqCoverages = validParses.map((v) => {
      const reqFields = v.fieldDetails.filter((f) => f.required);
      const total = reqFields.length;
      const present = reqFields.filter((f) => f.populated).length;
      return total > 0 ? (present / total) * 100 : 100;
    });
    avgRequiredCoverage = Math.round(reqCoverages.reduce((a: number, b: number) => a + b, 0) / reqCoverages.length);

    /* Track how many fields are scored */
    scoredFieldCount = contentFields ? contentFields.size : Object.keys(expectedSchema?.fields || {}).length;
  }

  /* Accuracy: type conformance rate */
  const avgTypeConformance =
    validParses.length > 0
      ? Math.round(
          validParses.reduce(
            (a: number, v: SchemaValidationResult) => a + (v.fieldsCorrectType / Math.max(v.fieldsPopulated, 1)) * 100,
            0,
          ) / validParses.length,
        )
      : null;

  /* Finish reason distribution */
  const finishReasons = logs.map((l) => l.llm_response?.finishReason).filter(Boolean);
  const stopCount = finishReasons.filter((r) => r === 'stop').length;
  const completionRate = finishReasons.length > 0 ? Math.round((stopCount / finishReasons.length) * 100) : null;

  /* Error rate from log status */
  const errorCount = logs.filter((l) => l.status === 'error').length;
  const errorRate = Math.round((errorCount / logs.length) * 100);

  /* ── Model / Agent Usage Breakdown ─────────────────── */
  const modelUsage = new Map();
  for (const log of logs) {
    const modelId =
      String(log?.llm_timing?.model || log?.llm_request?.model || log?.metadata?.primaryModel || 'unknown').trim() ||
      'unknown';
    const providerId = String(log?.llm_timing?.provider || log?.llm_request?.provider || 'unknown').trim() || 'unknown';
    const key = `${providerId}::${modelId}`;
    if (!modelUsage.has(key)) {
      modelUsage.set(key, {
        provider: providerId,
        model: modelId,
        calls: 0,
        success: 0,
        errors: 0,
        failoverCalls: 0,
        llmDurations: [],
        totalDurations: [],
      });
    }
    const row = modelUsage.get(key);
    row.calls += 1;
    if (log?.status === 'success') row.success += 1;
    if (log?.status === 'error') row.errors += 1;
    if (String(log?.metadata?.failoverUsed) === 'true') row.failoverCalls += 1;
    if (typeof log?.llm_timing?.durationMs === 'number') row.llmDurations.push(log.llm_timing.durationMs);
    if (typeof log?.total_duration_ms === 'number') row.totalDurations.push(log.total_duration_ms);
  }

  const modelBreakdown = [...modelUsage.values()]
    .map((row) => ({
      ...row,
      avgLlmMs:
        row.llmDurations.length > 0
          ? Math.round(row.llmDurations.reduce((a: number, b: number) => a + b, 0) / row.llmDurations.length)
          : null,
      avgTotalMs:
        row.totalDurations.length > 0
          ? Math.round(row.totalDurations.reduce((a: number, b: number) => a + b, 0) / row.totalDurations.length)
          : null,
      successRate: row.calls > 0 ? Math.round((row.success / row.calls) * 100) : 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));

  /* Field-level detail: how often each field is populated (across valid parses) */
  const fieldFrequency: Record<string, FieldFrequency> = {};
  for (const v of validParses) {
    for (const f of v.fieldDetails) {
      if (!fieldFrequency[f.field]) {
        fieldFrequency[f.field] = { field: f.field, label: f.label, required: f.required, count: 0, total: 0, rate: 0 };
      }
      const entry = fieldFrequency[f.field];
      if (entry) {
        entry.total++;
        if (f.populated) entry.count++;
      }
    }
  }
  const fieldBreakdown = Object.values(fieldFrequency).map((f) => ({
    ...f,
    rate: Math.round((f.count / f.total) * 100),
  }));

  /* Composite accuracy score (AI Manager-only levers):
     - JSON parse success (25%)
     - Required fields present (25%)
     - Type conformance (25%)
     - Completion rate / finish_reason (25%) */
  const accuracyScore =
    jsonParseRate != null && avgRequiredCoverage != null && avgTypeConformance != null && completionRate != null
      ? Math.round(
          jsonParseRate * 0.25 +
            (avgRequiredCoverage ?? 0) * 0.25 +
            (avgTypeConformance ?? 0) * 0.25 +
            completionRate * 0.25,
        )
      : null;

  const totalFailoverCalls = modelBreakdown.reduce((sum, m) => sum + m.failoverCalls, 0);
  const failoverRate = logs.length > 0 ? Math.round((totalFailoverCalls / logs.length) * 100) : 0;

  return {
    hasData: true,
    logCount: logs.length,
    /* Speed */
    avgLlm,
    minLlm,
    maxLlm,
    avgTotal,
    avgPromptTokens,
    avgCompletionTokens,
    llmDurations,
    /* Content */
    avgFieldCoverage,
    avgRequiredCoverage,
    validationCount: validParses.length,
    fieldBreakdown,
    scoredFieldCount,
    /* Accuracy */
    jsonParseRate,
    avgTypeConformance,
    completionRate,
    errorRate,
    accuracyScore,
    /* Model / Agent usage */
    distinctModels: modelBreakdown.length,
    modelBreakdown,
    /* Failover */
    totalFailoverCalls,
    failoverRate,
  };
}

/** Score badge with colour coding based on percentage */
/** Format milliseconds for display */
function fmtMs(ms: number | null | undefined) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function AnalyticsTab({
  selectedJob,
  selectedJobFull,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
}) {
  const [logs, setLogs] = useState<DiagnosticLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  /* Content scoring: which fields are "important" (checked) for the score */
  const [contentFields, setContentFields] = useState<Set<string>>(new Set());
  /* Sort state for field breakdown table */
  const [sortCol, setSortCol] = useState('rate'); /* field | required | count | rate */
  const [sortDir, setSortDir] = useState('asc'); /* asc | desc */

  const loadLogs = useCallback(async () => {
    if (!selectedJob) return;
    try {
      setLoading(true);
      const result = await api.listDiagnosticLogs({ processingJobId: selectedJob, limit: 50 });
      setLogs(result.data as unknown as DiagnosticLog[]);
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [selectedJob]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  /* Initialise contentFields from saved config or default to all fields */
  useEffect(() => {
    if (!selectedJobFull) return;
    const saved = getJobConfig(selectedJobFull).analytics?.contentFields;
    const allFields = Object.keys(getJobConfig(selectedJobFull).expectedSchema?.fields || {});
    if (Array.isArray(saved) && saved.length > 0) {
      setContentFields(new Set(saved));
    } else {
      /* Default: all fields selected */
      setContentFields(new Set(allFields));
    }
  }, [selectedJobFull]);

  if (!selectedJob || !selectedJobFull) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const expectedSchema = getJobConfig(selectedJobFull).expectedSchema || {};
  const allSchemaFields = Object.keys(expectedSchema?.fields || {});

  /* Compute analytics with the current content field selection */
  const activeContentFilter =
    contentFields.size > 0 && contentFields.size < allSchemaFields.length
      ? contentFields
      : null; /* null = all fields */
  const analytics = computeAnalytics(logs, expectedSchema, activeContentFilter);
  const diagEnabled = getJobConfig(selectedJobFull).advanced?.diagnostics?.enabled;
  const aiProfileName = selectedJobFull.ai_profile?.name || 'Not assigned';
  const providerName = selectedJobFull.ai_profile?.provider?.name || 'Unknown';

  /* ── Field selection helpers ────────────────────────── */
  function toggleField(field: string) {
    setContentFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function selectAll() {
    setContentFields(new Set(allSchemaFields));
  }

  function deselectAll() {
    setContentFields(new Set());
  }

  const allSelected = allSchemaFields.length > 0 && contentFields.size === allSchemaFields.length;
  const noneSelected = contentFields.size === 0;

  /* ── Save content field config ─────────────────────── */
  async function saveContentFieldConfig() {
    try {
      setSavingConfig(true);
      const config = {
        ...getJobConfig(selectedJobFull),
        analytics: {
          ...(getJobConfig(selectedJobFull).analytics || {}),
          contentFields: [...contentFields],
        },
      };
      if (!selectedJob) return;
      await api.updateProcessingJob(selectedJob, { config });
      notifications.show({ title: 'Saved', message: 'Content scoring fields saved to job config.', color: 'green' });
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSavingConfig(false);
    }
  }

  /* ── Sorting helpers ───────────────────────────────── */
  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir(col === 'field' ? 'asc' : 'asc');
    }
  }

  function sortedBreakdown(breakdown: FieldFrequency[]) {
    const sorted = [...breakdown];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'field') cmp = a.field.localeCompare(b.field);
      else if (sortCol === 'required') cmp = (a.required ? 1 : 0) - (b.required ? 1 : 0);
      else if (sortCol === 'count') cmp = a.count - b.count;
      else if (sortCol === 'rate') cmp = a.rate - b.rate;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={4}>{selectedJobFull.name} — Analytics</Title>
        <Group gap="xs">
          <Badge variant="light" color="blue" size="sm">
            AI Profile: {aiProfileName}
          </Badge>
          <Badge variant="light" color="gray" size="sm">
            Provider: {providerName}
          </Badge>
          <Tooltip label="Refresh data">
            <ActionIcon variant="subtle" onClick={loadLogs} loading={loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Enable diagnostics prompt */}
      {!diagEnabled && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm" fw={500}>
            Diagnostics are disabled for this job
          </Text>
          <Text size="xs" c="dimmed">
            Enable diagnostics in the Advanced tab (set mode to &quot;Always&quot;) and run the job a few times to
            collect analytics data. Content and Accuracy metrics require the raw LLM responses stored in diagnostic
            logs.
          </Text>
        </Alert>
      )}

      {!analytics.hasData ? (
        <Alert variant="light" color="gray" icon={<IconChartBar size={16} />}>
          <Text size="sm">
            No diagnostic logs found for this job.{' '}
            {diagEnabled
              ? 'Run the job to start collecting performance data.'
              : 'Enable diagnostics and run the job to start collecting performance data.'}
          </Text>
        </Alert>
      ) : (
        <Stack gap="md">
          {/* ── Score Cards Row ─────────────────────────── */}
          <Grid>
            {/* Content Card */}
            <Grid.Col span={4}>
              <Paper withBorder p="md" h="100%">
                <Stack gap="sm">
                  <Group gap="xs">
                    <ThemeIcon size="sm" variant="light" color="blue">
                      <IconChartBar size={14} />
                    </ThemeIcon>
                    <Text fw={600} size="sm">
                      Content
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    % of {activeContentFilter ? 'selected' : 'all'} schema fields populated by the AI response.
                  </Text>
                  <Center>
                    <ScoreBadge value={analytics.avgFieldCoverage} label="Field Coverage" />
                  </Center>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Required Fields
                    </Text>
                    <Text size="xs" fw={500}>
                      {analytics.avgRequiredCoverage != null ? `${analytics.avgRequiredCoverage}%` : '—'}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Fields Scored
                    </Text>
                    <Text size="xs" fw={500}>
                      {contentFields.size} / {allSchemaFields.length} selected
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Responses Analyzed
                    </Text>
                    <Text size="xs" fw={500}>
                      {analytics.validationCount} / {analytics.logCount}
                    </Text>
                  </Group>
                </Stack>
              </Paper>
            </Grid.Col>

            {/* Speed Card */}
            <Grid.Col span={4}>
              <Paper withBorder p="md" h="100%">
                <Stack gap="sm">
                  <Group gap="xs">
                    <ThemeIcon size="sm" variant="light" color="teal">
                      <IconActivity size={14} />
                    </ThemeIcon>
                    <Text fw={600} size="sm">
                      Speed
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    LLM response time from the AI provider.
                  </Text>
                  <Center>
                    <Badge
                      size="xl"
                      variant="filled"
                      color={
                        analytics.avgLlm != null
                          ? analytics.avgLlm < 5000
                            ? 'green'
                            : analytics.avgLlm < 15000
                              ? 'yellow'
                              : 'red'
                          : 'gray'
                      }
                    >
                      Avg: {fmtMs(analytics.avgLlm)}
                    </Badge>
                  </Center>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Fastest
                    </Text>
                    <Text size="xs" fw={500}>
                      {fmtMs(analytics.minLlm)}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Slowest
                    </Text>
                    <Text size="xs" fw={500}>
                      {fmtMs(analytics.maxLlm)}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Avg Total (incl. formatting)
                    </Text>
                    <Text size="xs" fw={500}>
                      {fmtMs(analytics.avgTotal)}
                    </Text>
                  </Group>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Avg Prompt Tokens
                    </Text>
                    <Text size="xs" fw={500}>
                      {analytics.avgPromptTokens?.toLocaleString() ?? '—'}
                    </Text>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Avg Completion Tokens
                    </Text>
                    <Text size="xs" fw={500}>
                      {analytics.avgCompletionTokens?.toLocaleString() ?? '—'}
                    </Text>
                  </Group>
                </Stack>
              </Paper>
            </Grid.Col>

            {/* Accuracy Card */}
            <Grid.Col span={4}>
              <Paper withBorder p="md" h="100%">
                <Stack gap="sm">
                  <Group gap="xs">
                    <ThemeIcon size="sm" variant="light" color="violet">
                      <IconCheck size={14} />
                    </ThemeIcon>
                    <Text fw={600} size="sm">
                      Accuracy
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Structural accuracy: JSON validity, schema conformance, type correctness, and response completion.
                  </Text>
                  <Center>
                    <ScoreBadge value={analytics.accuracyScore} label="Composite" />
                  </Center>
                  <Divider />
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      JSON Parse Rate
                    </Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        (analytics.jsonParseRate ?? 0) >= 90
                          ? 'green'
                          : (analytics.jsonParseRate ?? 0) >= 70
                            ? 'yellow'
                            : 'red'
                      }
                    >
                      {analytics.jsonParseRate ?? '—'}%
                    </Badge>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Type Conformance
                    </Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        (analytics.avgTypeConformance ?? 0) >= 90
                          ? 'green'
                          : (analytics.avgTypeConformance ?? 0) >= 70
                            ? 'yellow'
                            : 'red'
                      }
                    >
                      {analytics.avgTypeConformance ?? '—'}%
                    </Badge>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Completion Rate (stop)
                    </Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        (analytics.completionRate ?? 0) >= 90
                          ? 'green'
                          : (analytics.completionRate ?? 0) >= 70
                            ? 'yellow'
                            : 'red'
                      }
                    >
                      {analytics.completionRate ?? '—'}%
                    </Badge>
                  </Group>
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">
                      Error Rate
                    </Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={
                        (analytics.errorRate ?? 0) <= 5 ? 'green' : (analytics.errorRate ?? 0) <= 20 ? 'yellow' : 'red'
                      }
                    >
                      {analytics.errorRate}%
                    </Badge>
                  </Group>
                </Stack>
              </Paper>
            </Grid.Col>
          </Grid>

          {/* ── Failover Summary Card ────────────────────── */}
          {(analytics.totalFailoverCalls ?? 0) > 0 && (
            <Paper withBorder p="md" style={{ borderLeft: '3px solid var(--mantine-color-orange-5)' }}>
              <Group gap="xs" mb="xs">
                <ThemeIcon size="sm" variant="light" color="orange">
                  <IconAlertTriangle size={14} />
                </ThemeIcon>
                <Text fw={600} size="sm" c="orange.7">
                  Failover Summary
                </Text>
              </Group>
              <Group gap="xl">
                <Box>
                  <Text size="xs" c="dimmed">
                    Total Failover Triggers
                  </Text>
                  <Text size="lg" fw={700} c="orange">
                    {analytics.totalFailoverCalls}
                  </Text>
                </Box>
                <Box>
                  <Text size="xs" c="dimmed">
                    Failover Rate
                  </Text>
                  <Badge
                    size="md"
                    color={
                      (analytics.failoverRate ?? 0) <= 5
                        ? 'green'
                        : (analytics.failoverRate ?? 0) <= 20
                          ? 'orange'
                          : 'red'
                    }
                    variant="light"
                  >
                    {analytics.failoverRate}%
                  </Badge>
                </Box>
                <Box>
                  <Text size="xs" c="dimmed">
                    Total Calls
                  </Text>
                  <Text size="xs" fw={500}>
                    {analytics.logCount}
                  </Text>
                </Box>
              </Group>
              <Text size="xs" c="dimmed" mt="xs">
                {analytics.totalFailoverCalls} of {analytics.logCount} AI calls required failover to an alternate
                provider/model.
              </Text>
            </Paper>
          )}

          {/* ── Model / Agent Performance Breakdown ───────── */}
          {(analytics.modelBreakdown?.length ?? 0) > 0 && (
            <Paper withBorder p="md">
              <Group justify="space-between" mb="xs">
                <Box>
                  <Text fw={600} size="sm">
                    Model / Agent Performance (Historical)
                  </Text>
                  <Text size="xs" c="dimmed">
                    Aggregated across {analytics.logCount} diagnostic logs. Use this to compare models/agents used over
                    time.
                  </Text>
                </Box>
                <Badge variant="light" color="blue" size="sm">
                  {analytics.distinctModels} model{analytics.distinctModels === 1 ? '' : 's'}
                </Badge>
              </Group>
              <ScrollArea h={260}>
                <Table striped highlightOnHover withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Provider</Table.Th>
                      <Table.Th>Model / Agent</Table.Th>
                      <Table.Th ta="right">Calls</Table.Th>
                      <Table.Th ta="right">Success</Table.Th>
                      <Table.Th ta="right">Avg LLM</Table.Th>
                      <Table.Th ta="right">Avg Total</Table.Th>
                      <Table.Th ta="right">Failover Calls</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {analytics.modelBreakdown?.map((row) => (
                      <Table.Tr key={`${row.provider}:${row.model}`}>
                        <Table.Td>
                          <Text size="xs">{row.provider}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" ff="monospace">
                            {row.model}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs">{row.calls}</Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Badge
                            size="xs"
                            variant="light"
                            color={row.successRate >= 90 ? 'green' : row.successRate >= 70 ? 'yellow' : 'red'}
                          >
                            {row.successRate}%
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs">{fmtMs(row.avgLlmMs)}</Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs">{fmtMs(row.avgTotalMs)}</Text>
                        </Table.Td>
                        <Table.Td ta="right">
                          <Text size="xs">{row.failoverCalls}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          )}

          {/* ── Accuracy Explanation ────────────────────── */}
          <Paper withBorder p="sm">
            <Text size="xs" fw={500} mb={4}>
              How accuracy is measured (AI Manager-only signals)
            </Text>
            <Text size="xs" c="dimmed">
              The composite accuracy score is derived from four levers that require no feedback from calling
              applications:
            </Text>
            <SimpleGrid cols={2} spacing="xs" mt="xs">
              <Group gap="xs">
                <Badge size="xs" variant="outline" color="blue">
                  25%
                </Badge>
                <Text size="xs">
                  <strong>JSON Parse Rate</strong> — Can the response be parsed as valid JSON?
                </Text>
              </Group>
              <Group gap="xs">
                <Badge size="xs" variant="outline" color="blue">
                  25%
                </Badge>
                <Text size="xs">
                  <strong>Required Fields</strong> — Are all required schema fields present and non-null?
                </Text>
              </Group>
              <Group gap="xs">
                <Badge size="xs" variant="outline" color="blue">
                  25%
                </Badge>
                <Text size="xs">
                  <strong>Type Conformance</strong> — Do fields match expected types (string, array, number)?
                </Text>
              </Group>
              <Group gap="xs">
                <Badge size="xs" variant="outline" color="blue">
                  25%
                </Badge>
                <Text size="xs">
                  <strong>Completion Rate</strong> — Did the LLM finish normally (not truncated)?
                </Text>
              </Group>
            </SimpleGrid>
          </Paper>

          {/* ── Field Coverage Breakdown ──────────────────── */}
          {(analytics.fieldBreakdown?.length ?? 0) > 0 && (
            <Paper withBorder p="md">
              <Group justify="space-between" mb="xs">
                <Box>
                  <Text fw={600} size="sm">
                    Field Coverage Breakdown
                  </Text>
                  <Text size="xs" c="dimmed">
                    How often each expected field is populated across {analytics.validationCount} analyzed responses.
                    Check fields to include in the Content score. Click column headers to sort.
                  </Text>
                </Box>
                <Group gap="xs">
                  <Button size="xs" variant="subtle" onClick={allSelected ? deselectAll : selectAll}>
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </Button>
                  <Button
                    size="xs"
                    variant="light"
                    color="green"
                    leftSection={<IconDeviceFloppy size={14} />}
                    onClick={saveContentFieldConfig}
                    loading={savingConfig}
                    disabled={noneSelected}
                  >
                    Save Selection
                  </Button>
                </Group>
              </Group>

              {noneSelected && (
                <Alert variant="light" color="orange" icon={<IconAlertTriangle size={14} />} mb="xs">
                  <Text size="xs">
                    No fields selected. The Content score requires at least one field. Click &quot;Select All&quot; or
                    check individual fields.
                  </Text>
                </Alert>
              )}

              <ScrollArea
                h={Math.min(((analytics.fieldBreakdown as FieldFrequency[])?.length ?? 0) * 42 + 40, 500)}
                type="auto"
                offsetScrollbars
              >
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  withColumnBorders
                  verticalSpacing={4}
                  style={{ fontSize: 12 }}
                >
                  <Table.Thead
                    style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--mantine-color-body)' }}
                  >
                    <Table.Tr>
                      <Table.Th style={{ width: 40 }}>
                        <Checkbox
                          size="xs"
                          checked={allSelected}
                          indeterminate={!allSelected && !noneSelected}
                          onChange={() => (allSelected ? deselectAll() : selectAll())}
                          aria-label="Select all fields"
                        />
                      </Table.Th>
                      <SortHeader
                        col="field"
                        label="Field"
                        active={sortCol === 'field'}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        col="required"
                        label="Required"
                        width={90}
                        active={sortCol === 'required'}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        col="count"
                        label="Populated"
                        width={100}
                        active={sortCol === 'count'}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        col="rate"
                        label="Coverage"
                        width={100}
                        active={sortCol === 'rate'}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sortedBreakdown(analytics.fieldBreakdown ?? []).map((f) => (
                      <Table.Tr
                        key={f.field}
                        style={{
                          backgroundColor: contentFields.has(f.field) ? undefined : 'var(--mantine-color-gray-0)',
                          opacity: contentFields.has(f.field) ? 1 : 0.6,
                        }}
                      >
                        <Table.Td>
                          <Checkbox
                            size="xs"
                            checked={contentFields.has(f.field)}
                            onChange={() => toggleField(f.field)}
                            aria-label={`Include ${f.field} in content score`}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" fw={500}>
                            {f.field}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {f.required ? (
                            <Badge size="xs" color="red" variant="light">
                              req
                            </Badge>
                          ) : (
                            <Text size="xs" c="dimmed">
                              opt
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            {f.count} / {f.total}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            size="xs"
                            variant="light"
                            color={f.rate >= 90 ? 'green' : f.rate >= 50 ? 'yellow' : 'red'}
                          >
                            {f.rate}%
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          )}

          {/* ── Recent Response Times ─────────────────── */}
          {(analytics.llmDurations ?? []).length > 0 && (
            <Paper withBorder p="md">
              <Text fw={600} size="sm" mb="sm">
                Recent LLM Response Times
              </Text>
              <Group gap={4} wrap="wrap">
                {(analytics.llmDurations ?? []).slice(0, 25).map((d: number, i: number) => (
                  <Tooltip key={i} label={`Run #${i + 1}: ${fmtMs(d)}`}>
                    <Badge size="sm" variant="light" color={d < 5000 ? 'green' : d < 15000 ? 'yellow' : 'red'}>
                      {fmtMs(d)}
                    </Badge>
                  </Tooltip>
                ))}
              </Group>
            </Paper>
          )}
        </Stack>
      )}
    </Stack>
  );
}

/* DiagnosticsTab extracted to ./DiagnosticsTab.tsx */
