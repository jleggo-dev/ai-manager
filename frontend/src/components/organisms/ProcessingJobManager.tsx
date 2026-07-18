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
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlayerPlay,
  IconSettings,
  IconFilter,
  IconCheck,
  IconAlertTriangle,
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
import ScoreBadge from '../atoms/ScoreBadge';
import SortHeader from '../atoms/SortHeader';
import { useProcessingJobsData } from './processing-jobs/useProcessingJobsData';
import JobsTab from './processing-jobs/JobsTab';
import RuleSetsTab from './processing-jobs/RuleSetsTab';
import TestRuleSetTab from './processing-jobs/TestRuleSetTab';
import BuildRulesTab from './processing-jobs/BuildRulesTab';
import TestTab from './processing-jobs/TestTab';
import AdvancedTab from './processing-jobs/AdvancedTab';

import type {
  ExpectedSchema,
  SchemaFieldDefExtended,
  SchemaFieldDetail,
  SchemaValidationResult,
  FieldFrequency,
  AnalyticsData,
  DiagnosticLog,
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
