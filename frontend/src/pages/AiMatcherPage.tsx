/**
 * AI Matcher — compare AI responses side-by-side
 *
 * Two modes:
 *   1. Import from Job — loads prompt template, variables, expected schema,
 *      and formatting rules from an existing processing job
 *   2. Free Prompt — user writes their own prompt
 *
 * Up to 4 AI "slots" can be configured (existing profile or ad-hoc)
 * and fired in parallel. Results display raw output, timing, token usage,
 * and schema validation (Job Import mode only).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Stack,
  Group,
  Paper,
  Text,
  Title,
  Badge,
  Button,
  Textarea,
  Select,
  SegmentedControl,
  Switch,
  SimpleGrid,
  Code,
  Loader,
  Table,
  ActionIcon,
  Collapse,
  Alert,
  ScrollArea,
} from '@mantine/core';
import {
  IconPlus,
  IconTrash,
  IconPlayerPlay,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconCoin,
  IconCheck,
  IconX,
  IconAlertTriangle,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import PageHeader from '../components/atoms/PageHeader';
import * as api from '../services/api';
import type {
  Provider,
  AiProfile,
  ProcessingJob,
  LlmModel,
  AiMatcherSlotResult,
  ExpectedSchema,
  SchemaFieldDef,
  FormattingStep,
  JobVariable,
} from '../types/api';
import { DEVS_AI_BUILTIN_TOOL_OPTIONS, DEFAULT_RUNTIME_OPTIONS } from '../lib/runtime-options';

interface RuntimeOptions {
  devs_ai?: {
    built_in_tools?: string[];
    [key: string]: unknown;
  };
  google_gemini?: {
    grounding_with_google_search?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface SlotConfig {
  source: string;
  profileId: string;
  providerId: string;
  profileType: string;
  externalAiId: string;
  runtimeOptions: RuntimeOptions;
}

interface NormalisedField {
  label: string;
  type: 'multi' | 'single';
  required: boolean;
}

interface SchemaValidationResult {
  valid: boolean;
  parseError: string | null;
  summary: { total: number; passed: number; errors: number };
}

const SLOT_COLORS = ['blue', 'green', 'orange', 'violet'];
const SLOT_LABELS = ['A', 'B', 'C', 'D'];

function emptySlot(): SlotConfig {
  return {
    source: 'profile',
    profileId: '',
    providerId: '',
    profileType: 'model',
    externalAiId: '',
    runtimeOptions: { ...DEFAULT_RUNTIME_OPTIONS } as RuntimeOptions,
  };
}

/* ──────────────────────────────────────────────────────────────────
   Lightweight schema validator (same logic as ProcessingJobManager)
   ────────────────────────────────────────────────────────────────── */

function normaliseSchemaFields(schema: ExpectedSchema): Record<string, NormalisedField> {
  const fields = schema?.fields || {};
  const normalised: Record<string, NormalisedField> = {};
  for (const [name, def] of Object.entries(fields) as [string, SchemaFieldDef][]) {
    normalised[name] = {
      label: def.description || name,
      type: def.type === 'array' ? 'multi' : 'single',
      required: !!def.required,
    };
  }
  return normalised;
}

function validateSchema(formattedText: string, expectedSchema: ExpectedSchema): SchemaValidationResult | null {
  const result: SchemaValidationResult = {
    valid: false,
    parseError: null,
    summary: { total: 0, passed: 0, errors: 0 },
  };
  if (!expectedSchema || !Object.keys(expectedSchema.fields || {}).length) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(formattedText);
  } catch (err) {
    result.parseError = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    result.parseError = `Expected JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`;
    return result;
  }

  const schema = normaliseSchemaFields(expectedSchema);
  for (const [fieldName, def] of Object.entries(schema)) {
    result.summary.total++;
    const present = fieldName in parsed && parsed[fieldName] !== null && parsed[fieldName] !== undefined;
    const val = parsed[fieldName];
    const isEmpty = present && (val === '' || (Array.isArray(val) && val.length === 0));
    if (present && !isEmpty) {
      result.summary.passed++;
    } else if (def.required) {
      result.summary.errors++;
    }
  }
  result.valid = result.summary.errors === 0 && !result.parseError;
  return result;
}

/* ──────────────────────────────────────────────────────────────────
   AI Slot Card
   ────────────────────────────────────────────────────────────────── */

interface AiSlotCardProps {
  slot: SlotConfig;
  index: number;
  providers: Provider[];
  profiles: AiProfile[];
  onChange: (index: number, slot: SlotConfig) => void;
  onRemove: (index: number) => void;
}

function AiSlotCard({ slot, index, providers, profiles, onChange, onRemove }: AiSlotCardProps) {
  const shouldFetch = slot.source === 'custom' && !!slot.providerId;
  const [fetchedAis, setFetchedAis] = useState<AiProfile[]>([]);
  const [fetchedModels, setFetchedModels] = useState<LlmModel[]>([]);

  const availableAis = shouldFetch ? fetchedAis : [];
  const availableModels = shouldFetch ? fetchedModels : [];

  const selectedProvider = providers.find((p) => p.id === slot.providerId);
  const providerType = selectedProvider?.type || '';

  useEffect(() => {
    if (!shouldFetch) return;
    if (slot.profileType === 'agent') {
      api
        .listProviderAis(slot.providerId, 'ALL')
        .then((data) => setFetchedAis(data || []))
        .catch(() => setFetchedAis([]));
    } else {
      api
        .listProviderModels(slot.providerId)
        .then((data) => setFetchedModels(data || []))
        .catch(() => setFetchedModels([]));
    }
  }, [shouldFetch, slot.providerId, slot.profileType]);

  function update(patch: Partial<SlotConfig>) {
    onChange(index, { ...slot, ...patch });
  }

  function toggleTool(tool: string) {
    const current = slot.runtimeOptions?.devs_ai?.built_in_tools || [];
    const next = current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool];
    update({
      runtimeOptions: { ...slot.runtimeOptions, devs_ai: { ...slot.runtimeOptions.devs_ai, built_in_tools: next } },
    });
  }

  const color = SLOT_COLORS[index];
  const label = SLOT_LABELS[index];

  const providerOptions = providers.map((p) => ({ value: p.id, label: `${p.name} (${p.type})` }));
  const profileOptions = profiles
    .filter((p) => p.is_active)
    .map((p) => ({ value: p.id, label: `${p.name} — ${p.provider?.name || ''}` }));

  const agentOptions = availableAis.map((a) => ({ value: a.id, label: a.name }));
  const modelOptions = (() => {
    const groups: Record<string, { value: string; label: string }[]> = {};
    for (const m of availableModels) {
      const g = m.category || 'Models';
      if (!groups[g]) groups[g] = [];
      groups[g].push({ value: m.model_id, label: m.display_name || m.model_id });
    }
    return Object.entries(groups).map(([group, items]) => ({ group, items }));
  })();

  return (
    <Paper withBorder p="sm" radius="md" style={{ borderLeft: `4px solid var(--mantine-color-${color}-5)` }}>
      <Group justify="space-between" mb="xs">
        <Badge color={color} variant="filled" size="lg">
          Slot {label}
        </Badge>
        <ActionIcon size="sm" variant="subtle" color="red" onClick={() => onRemove(index)}>
          <IconTrash size={14} />
        </ActionIcon>
      </Group>

      <SegmentedControl
        size="xs"
        fullWidth
        mb="xs"
        value={slot.source}
        onChange={(v) => update({ source: v ?? '', profileId: '', providerId: '', externalAiId: '' })}
        data={[
          { value: 'profile', label: 'Existing profile' },
          { value: 'custom', label: 'Custom' },
        ]}
      />

      {slot.source === 'profile' && (
        <Select
          size="xs"
          placeholder="Select an AI profile"
          data={profileOptions}
          value={slot.profileId}
          onChange={(v) => update({ profileId: v ?? '' })}
          searchable
        />
      )}

      {slot.source === 'custom' && (
        <Stack gap="xs">
          <Select
            size="xs"
            label="Provider"
            placeholder="Select provider"
            data={providerOptions}
            value={slot.providerId}
            onChange={(v) => {
              const val = v ?? '';
              update({ providerId: val, externalAiId: '' });
            }}
            searchable
          />

          {slot.providerId && providerType !== 'google-gemini' && (
            <SegmentedControl
              size="xs"
              fullWidth
              value={slot.profileType}
              onChange={(v) => update({ profileType: v ?? '', externalAiId: '' })}
              data={[
                { value: 'agent', label: 'Agent' },
                { value: 'model', label: 'Model' },
              ]}
            />
          )}

          {slot.providerId && slot.profileType === 'agent' && agentOptions.length > 0 && (
            <Select
              size="xs"
              label="Agent"
              placeholder="Select agent"
              data={agentOptions}
              value={slot.externalAiId}
              onChange={(v) => {
                const val = v ?? '';
                update({ externalAiId: val });
              }}
              searchable
            />
          )}
          {slot.providerId && slot.profileType === 'agent' && agentOptions.length === 0 && (
            <Textarea
              size="xs"
              label="Agent ID"
              placeholder="Paste agent UUID"
              value={slot.externalAiId}
              onChange={(e) => update({ externalAiId: e.currentTarget.value })}
              minRows={1}
              autosize
            />
          )}
          {slot.providerId && slot.profileType === 'model' && modelOptions.length > 0 && (
            <Select
              size="xs"
              label="Model"
              placeholder="Select model"
              data={modelOptions}
              value={slot.externalAiId}
              onChange={(v) => {
                const val = v ?? '';
                update({ externalAiId: val });
              }}
              searchable
            />
          )}
          {slot.providerId && slot.profileType === 'model' && modelOptions.length === 0 && (
            <Textarea
              size="xs"
              label="Model ID"
              placeholder="Paste model ID"
              value={slot.externalAiId}
              onChange={(e) => update({ externalAiId: e.currentTarget.value })}
              minRows={1}
              autosize
            />
          )}

          {slot.providerId && providerType === 'devs-ai' && slot.profileType === 'model' && (
            <Paper p="xs" withBorder radius="sm">
              <Text size="xs" fw={600} mb={4}>
                Tools
              </Text>
              <Group gap="xs">
                {DEVS_AI_BUILTIN_TOOL_OPTIONS.map((t) => (
                  <Switch
                    key={t.key}
                    size="xs"
                    label={t.label}
                    checked={(slot.runtimeOptions?.devs_ai?.built_in_tools || []).includes(t.key)}
                    onChange={() => toggleTool(t.key)}
                  />
                ))}
              </Group>
            </Paper>
          )}

          {slot.providerId && providerType === 'google-gemini' && (
            <Switch
              size="xs"
              label="Grounding with Google Search"
              checked={slot.runtimeOptions?.google_gemini?.grounding_with_google_search || false}
              onChange={(e) =>
                update({
                  runtimeOptions: {
                    ...slot.runtimeOptions,
                    google_gemini: { grounding_with_google_search: e.currentTarget.checked },
                  },
                })
              }
            />
          )}
        </Stack>
      )}
    </Paper>
  );
}

/* ──────────────────────────────────────────────────────────────────
   JSON Field Table — renders parsed JSON as a scannable table
   ────────────────────────────────────────────────────────────────── */

function ObjectMiniTable({ obj }: { obj: Record<string, unknown> }) {
  return (
    <Table withColumnBorders style={{ tableLayout: 'fixed' }}>
      <Table.Tbody>
        {Object.entries(obj).map(([k, v]) => (
          <Table.Tr key={k}>
            <Table.Td style={{ width: 100, verticalAlign: 'top' }}>
              <Text size="xs" fw={600} ff="monospace" c="dimmed">
                {k}
              </Text>
            </Table.Td>
            <Table.Td>{formatCellValue(v, true)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function formatCellValue(val: unknown, nested = false) {
  if (val === null || val === undefined)
    return (
      <Text size="xs" c="dimmed" fs="italic">
        null
      </Text>
    );
  if (typeof val === 'boolean')
    return (
      <Badge size="xs" color={val ? 'green' : 'gray'} variant="light">
        {String(val)}
      </Badge>
    );

  if (Array.isArray(val)) {
    if (val.length === 0)
      return (
        <Text size="xs" c="dimmed" fs="italic">
          []
        </Text>
      );
    const hasObjects = val.some((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (hasObjects) {
      return (
        <Stack gap={6}>
          {val.map((item, idx) => (
            <Paper key={idx} withBorder p={4} radius="sm" bg="var(--mantine-color-gray-0)">
              {item && typeof item === 'object' && !Array.isArray(item) ? (
                <ObjectMiniTable obj={item as Record<string, unknown>} />
              ) : (
                <Text size="xs">{String(item)}</Text>
              )}
            </Paper>
          ))}
        </Stack>
      );
    }
    return <Text size="xs">{val.join('; ')}</Text>;
  }

  if (typeof val === 'object') {
    if (nested) return <Code style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>{JSON.stringify(val, null, 2)}</Code>;
    return <ObjectMiniTable obj={val as Record<string, unknown>} />;
  }

  const str = String(val);
  if (str.length > 300)
    return (
      <Text size="xs" lineClamp={4}>
        {str}
      </Text>
    );
  return <Text size="xs">{str}</Text>;
}

function JsonFieldTable({ text }: { text: string }) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const entries = Object.entries(parsed);
  if (entries.length === 0) return null;

  return (
    <ScrollArea.Autosize mah={350}>
      <Table striped withTableBorder withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: '30%' }}>Field</Table.Th>
            <Table.Th>Value</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {entries.map(([key, val]) => (
            <Table.Tr key={key}>
              <Table.Td>
                <Text size="xs" fw={600} ff="monospace">
                  {key}
                </Text>
              </Table.Td>
              <Table.Td>{formatCellValue(val)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Result Card
   ────────────────────────────────────────────────────────────────── */

interface ResultCardProps {
  result: AiMatcherSlotResult;
  index: number;
  expectedSchema: ExpectedSchema | null;
}

function ResultCard({ result, index, expectedSchema }: ResultCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const color = SLOT_COLORS[index];
  const label = SLOT_LABELS[index];
  const isError = result.status === 'error';
  const responseText = result.formatted || result.raw || '';
  const schemaResult = !isError && expectedSchema ? validateSchema(responseText, expectedSchema) : null;
  const hasJsonTable =
    !isError &&
    (() => {
      try {
        const p = JSON.parse(responseText);
        return typeof p === 'object' && p !== null && !Array.isArray(p);
      } catch (_e) {
        return false;
      }
    })();

  return (
    <Paper withBorder p="sm" radius="md" style={{ borderLeft: `4px solid var(--mantine-color-${color}-5)` }}>
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <Badge color={color} variant="filled" size="sm">
            Slot {label}
          </Badge>
          {isError ? (
            <Badge color="red" variant="light" size="sm">
              Error
            </Badge>
          ) : (
            <Badge color="green" variant="light" size="sm">
              Success
            </Badge>
          )}
        </Group>
        {!isError && (
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => setShowRaw(!showRaw)}
            rightSection={showRaw ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
          >
            {showRaw ? 'Hide raw' : 'Show raw'}
          </Button>
        )}
      </Group>

      {isError && (
        <Alert color="red" variant="light" mb="xs">
          {result.error}
        </Alert>
      )}

      {!isError && (
        <>
          <Group gap="md" mb="xs" wrap="wrap">
            <Group gap={4}>
              <IconClock size={14} />
              <Text size="xs" fw={600}>
                {result.durationMs}ms
              </Text>
            </Group>
            {result.usage && (
              <Group gap={4}>
                <IconCoin size={14} />
                <Text size="xs">
                  {(result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0)} tokens
                </Text>
              </Group>
            )}
            <Text size="xs" c="dimmed">
              {result.provider} / {result.model}
            </Text>
            {result.profileName && (
              <Badge size="xs" variant="outline">
                {result.profileName}
              </Badge>
            )}
          </Group>

          {schemaResult && (
            <Group gap="xs" mb="xs">
              {schemaResult.parseError ? (
                <Badge color="red" size="xs" leftSection={<IconX size={10} />}>
                  Parse error
                </Badge>
              ) : (
                <>
                  <Badge
                    color={schemaResult.valid ? 'green' : 'orange'}
                    size="xs"
                    leftSection={schemaResult.valid ? <IconCheck size={10} /> : <IconAlertTriangle size={10} />}
                  >
                    {schemaResult.summary.passed}/{schemaResult.summary.total} fields
                  </Badge>
                  {schemaResult.summary.errors > 0 && (
                    <Badge color="red" size="xs">
                      {schemaResult.summary.errors} missing required
                    </Badge>
                  )}
                </>
              )}
            </Group>
          )}

          {/* Primary view: JSON field table if parseable, otherwise formatted text */}
          {hasJsonTable ? (
            <JsonFieldTable text={responseText} />
          ) : (
            <ScrollArea.Autosize mah={250}>
              <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {responseText || '(empty)'}
              </Code>
            </ScrollArea.Autosize>
          )}

          {/* Drill-down: raw JSON + formatting steps + metadata */}
          <Collapse in={showRaw}>
            <Stack gap="xs" mt="xs">
              {result.formatted && (
                <>
                  <Text size="xs" fw={600}>
                    Formatted response
                  </Text>
                  <ScrollArea.Autosize mah={200}>
                    <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                      {result.formatted}
                    </Code>
                  </ScrollArea.Autosize>
                </>
              )}
              <Text size="xs" fw={600}>
                Raw response
              </Text>
              <ScrollArea.Autosize mah={200}>
                <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                  {result.raw}
                </Code>
              </ScrollArea.Autosize>
              {result.formattingSteps && result.formattingSteps.length > 0 && (
                <>
                  <Text size="xs" fw={600}>
                    Formatting steps
                  </Text>
                  <Group gap={4}>
                    {result.formattingSteps.map((s: FormattingStep, i: number) => (
                      <Badge key={i} size="xs" variant="light" color={s.changed ? 'blue' : 'gray'}>
                        {s.label || s.type}
                      </Badge>
                    ))}
                  </Group>
                </>
              )}
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  Finish: {result.finishReason || '—'}
                </Text>
                {result.usage && (
                  <Text size="xs" c="dimmed">
                    In: {result.usage.prompt_tokens || 0} / Out: {result.usage.completion_tokens || 0}
                  </Text>
                )}
              </Group>
            </Stack>
          </Collapse>
        </>
      )}
    </Paper>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Main Page
   ────────────────────────────────────────────────────────────────── */

export default function AiMatcherPage() {
  /* Reference data */
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);

  /* Prompt config */
  const [mode, setMode] = useState('free');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [fetchedJobFull, setFetchedJobFull] = useState<ProcessingJob | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState('');

  const selectedJobFull = useMemo(
    () => (selectedJobId && fetchedJobFull?.id === selectedJobId ? fetchedJobFull : null),
    [selectedJobId, fetchedJobFull],
  );

  /* AI slots */
  const [slots, setSlots] = useState<SlotConfig[]>([emptySlot()]);

  /* Results — array sized to slot count, each entry null (pending), or a result object */
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<(AiMatcherSlotResult | null)[] | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalSlotCount, setTotalSlotCount] = useState(0);

  /* Load reference data */
  useEffect(() => {
    Promise.all([api.listProviders(), api.listAiProfiles(), api.listProcessingJobs()])
      .then(([p, a, j]) => {
        setProviders(p.data || []);
        setProfiles(a.data || []);
        setJobs(j.data || []);
      })
      .catch((err) =>
        notifications.show({
          title: 'Failed to load data',
          message: err instanceof Error ? err.message : 'Request failed',
          color: 'red',
        }),
      )
      .finally(() => setLoadingRef(false));
  }, []);

  const composePrompt = useCallback((template: string, vars: Record<string, string>) => {
    let composed = template;
    for (const [key, val] of Object.entries(vars || {})) {
      composed = composed.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val || `{{${key}}}`));
    }
    setPrompt(composed);
  }, []);

  /* Load full job config when a job is selected */
  useEffect(() => {
    if (!selectedJobId) return;
    api
      .getProcessingJob(selectedJobId)
      .then((j) => {
        setFetchedJobFull(j);
        const vars: Record<string, string> = {};
        for (const v of j.config?.variables || []) {
          vars[v.name] = j.config?.testData?.[v.name] || '';
        }
        setVariables(vars);
        composePrompt(j.config?.promptTemplate || '', vars);
      })
      .catch((err) =>
        notifications.show({
          title: 'Failed to load job',
          message: err instanceof Error ? err.message : 'Request failed',
          color: 'red',
        }),
      );
  }, [selectedJobId, composePrompt]);

  function handleVarChange(name: string, value: string) {
    const updated = { ...variables, [name]: value };
    setVariables(updated);
    if (selectedJobFull) composePrompt(selectedJobFull.config?.promptTemplate || '', updated);
  }

  function updateSlot(index: number, slot: SlotConfig) {
    setSlots((prev) => prev.map((s, i) => (i === index ? slot : s)));
  }
  function removeSlot(index: number) {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  }
  function addSlot() {
    if (slots.length < 4) setSlots((prev) => [...prev, emptySlot()]);
  }

  /* Fire each slot independently so results appear as they complete */
  async function runComparison() {
    const trimmed = prompt.trim();
    if (!trimmed) {
      notifications.show({ title: 'Missing prompt', message: 'Enter a prompt before running.', color: 'orange' });
      return;
    }

    const validSlots = slots.filter((s) => {
      if (s.source === 'profile') return !!s.profileId;
      return !!s.providerId && !!s.externalAiId;
    });
    if (validSlots.length === 0) {
      notifications.show({ title: 'No AI configured', message: 'Configure at least one AI slot.', color: 'orange' });
      return;
    }

    const formattingRules =
      mode === 'job' && selectedJobFull?.config?.formattingRules ? selectedJobFull.config.formattingRules : [];

    const placeholders = validSlots.map(() => null);
    setResults(placeholders);
    setCompletedCount(0);
    setTotalSlotCount(validSlots.length);
    setRunning(true);

    const promises = validSlots.map((s, idx) => {
      const slot =
        s.source === 'profile'
          ? { type: 'profile', profileId: s.profileId }
          : {
              type: 'adhoc',
              providerId: s.providerId,
              externalAiId: s.externalAiId,
              profileType: s.profileType,
              mode: 'completion',
              runtimeOptions: s.runtimeOptions,
            };

      return api
        .runAiMatcherSlot({ prompt: trimmed, slot, formattingRules, slotIndex: idx })
        .then((data) => {
          setResults((prev) => prev?.map((r, i) => (i === idx ? data : r)) ?? null);
          setCompletedCount((c) => c + 1);
        })
        .catch((err) => {
          const errorResult: AiMatcherSlotResult = {
            slotIndex: idx,
            status: 'error',
            raw: null,
            formatted: null,
            formattingSteps: null,
            durationMs: null,
            model: 'unknown',
            provider: null,
            profileName: null,
            usage: null,
            finishReason: null,
            error: err instanceof Error ? err.message : 'Request failed',
          };
          setResults((prev) => prev?.map((r, i) => (i === idx ? errorResult : r)) ?? null);
          setCompletedCount((c) => c + 1);
        });
    });

    await Promise.allSettled(promises);
    setRunning(false);
  }

  if (loadingRef)
    return (
      <Stack align="center" py="xl">
        <Loader />
        <Text size="sm" c="dimmed">
          Loading reference data...
        </Text>
      </Stack>
    );

  const jobOptions = jobs.map((j) => ({ value: j.id, label: `${j.name} (${j.slug})` }));
  const allVars = selectedJobFull?.config?.variables || [];
  const expectedSchema = mode === 'job' ? (selectedJobFull?.config?.expectedSchema ?? null) : null;

  const successResults = (results || []).filter((r): r is AiMatcherSlotResult => r !== null && r.status === 'success');
  const fastest = successResults.length > 0 ? Math.min(...successResults.map((r) => r.durationMs ?? Infinity)) : null;

  return (
    <Stack gap="md">
      <PageHeader title="AI Matcher" description="Send the same prompt to multiple AIs and compare their responses." />

      {/* ── Section 1: Prompt Configuration ──────────────────── */}
      <Paper withBorder p="md" radius="md">
        <Title order={5} mb="xs">
          Prompt
        </Title>
        <SegmentedControl
          size="xs"
          mb="sm"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setPrompt('');
            setSelectedJobId('');
            setFetchedJobFull(null);
            setVariables({});
            setResults(null);
          }}
          data={[
            { value: 'free', label: 'Free prompt' },
            { value: 'job', label: 'Import from job' },
          ]}
        />

        {mode === 'job' && (
          <Stack gap="xs" mb="sm">
            <Select
              size="xs"
              label="Processing job"
              placeholder="Select a job to import"
              data={jobOptions}
              value={selectedJobId}
              onChange={(v) => setSelectedJobId(v || '')}
              searchable
              clearable
            />
            {allVars.length > 0 && (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {allVars.map((v: JobVariable) => (
                  <Textarea
                    key={v.name}
                    size="xs"
                    label={v.label || v.name}
                    description={v.source === 'pipeline' ? 'Pipeline variable' : undefined}
                    placeholder={v.description || ''}
                    value={variables[v.name] || ''}
                    onChange={(e) => handleVarChange(v.name, e.currentTarget.value)}
                    minRows={1}
                    autosize
                  />
                ))}
              </SimpleGrid>
            )}
          </Stack>
        )}

        <Textarea
          size="sm"
          label={mode === 'job' ? 'Composed prompt (editable)' : 'Prompt'}
          placeholder="Enter the prompt to send to all AIs..."
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          minRows={4}
          autosize
          maxRows={20}
        />
      </Paper>

      {/* ── Section 2: AI Slots ──────────────────────────────── */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="xs">
          <Title order={5}>AI slots</Title>
          {slots.length < 4 && (
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addSlot}>
              Add slot
            </Button>
          )}
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
          {slots.map((slot, i) => (
            <AiSlotCard
              key={`slot-${i}`}
              slot={slot}
              index={i}
              providers={providers}
              profiles={profiles}
              onChange={updateSlot}
              onRemove={removeSlot}
            />
          ))}
        </SimpleGrid>
      </Paper>

      {/* ── Run Button ────────────────────────────────────────── */}
      <Group gap="md" align="center">
        <Button
          size="md"
          leftSection={running ? <Loader size={16} color="white" /> : <IconPlayerPlay size={16} />}
          disabled={running || !prompt.trim()}
          onClick={runComparison}
        >
          {running
            ? `Running (${completedCount}/${totalSlotCount})...`
            : `Compare ${slots.length} AI${slots.length > 1 ? 's' : ''}`}
        </Button>
        {running && results && (
          <Group gap={6}>
            {results.map((r, i) => (
              <Badge
                key={i}
                size="sm"
                color={r === null ? 'gray' : r.status === 'success' ? 'green' : 'red'}
                variant={r === null ? 'outline' : 'filled'}
                leftSection={
                  r === null ? (
                    <Loader size={10} color="gray" />
                  ) : r.status === 'success' ? (
                    <IconCheck size={10} />
                  ) : (
                    <IconX size={10} />
                  )
                }
              >
                {SLOT_LABELS[i]}
              </Badge>
            ))}
          </Group>
        )}
      </Group>

      {/* ── Section 3: Results ────────────────────────────────── */}
      {results && results.some((r) => r !== null) && (
        <Stack gap="md">
          <Title order={5}>Results</Title>

          {/* Comparison summary table */}
          <Paper withBorder p="xs" radius="md">
            <ScrollArea>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Slot</Table.Th>
                    <Table.Th>Provider / Model</Table.Th>
                    <Table.Th>Duration</Table.Th>
                    <Table.Th>Tokens</Table.Th>
                    {expectedSchema && <Table.Th>Fields</Table.Th>}
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {results.map((r, i) => {
                    if (r === null) {
                      return (
                        <Table.Tr key={i}>
                          <Table.Td>
                            <Badge color={SLOT_COLORS[i]} variant="filled" size="xs">
                              {SLOT_LABELS[i]}
                            </Badge>
                          </Table.Td>
                          <Table.Td colSpan={expectedSchema ? 5 : 4}>
                            <Group gap={6}>
                              <Loader size={12} />
                              <Text size="xs" c="dimmed">
                                Running...
                              </Text>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      );
                    }
                    const schema =
                      r.status === 'success' && expectedSchema
                        ? validateSchema(r.formatted ?? r.raw ?? '', expectedSchema)
                        : null;
                    const isFastest = r.status === 'success' && r.durationMs === fastest;
                    return (
                      <Table.Tr key={i} bg={isFastest ? 'var(--mantine-color-green-0)' : undefined}>
                        <Table.Td>
                          <Badge color={SLOT_COLORS[i]} variant="filled" size="xs">
                            {SLOT_LABELS[i]}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" lineClamp={1}>
                            {r.provider || '—'} / {r.model || '—'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            <Text size="xs" fw={isFastest ? 700 : 400}>
                              {r.durationMs != null ? `${r.durationMs}ms` : '—'}
                            </Text>
                            {isFastest && (
                              <Badge size="xs" color="green" variant="light">
                                Fastest
                              </Badge>
                            )}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs">
                            {r.usage ? (r.usage.prompt_tokens || 0) + (r.usage.completion_tokens || 0) : '—'}
                          </Text>
                        </Table.Td>
                        {expectedSchema && (
                          <Table.Td>
                            {schema ? (
                              schema.parseError ? (
                                <Badge size="xs" color="red">
                                  Parse error
                                </Badge>
                              ) : (
                                <Text size="xs">
                                  {schema.summary.passed}/{schema.summary.total}
                                </Text>
                              )
                            ) : (
                              '—'
                            )}
                          </Table.Td>
                        )}
                        <Table.Td>
                          <Badge size="xs" color={r.status === 'success' ? 'green' : 'red'} variant="light">
                            {r.status}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>

          {/* Individual result cards */}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            {results.map((r, i) => {
              if (r === null) {
                return (
                  <Paper
                    key={i}
                    withBorder
                    p="sm"
                    radius="md"
                    style={{ borderLeft: `4px solid var(--mantine-color-${SLOT_COLORS[i]}-5)` }}
                  >
                    <Group gap="xs" mb="xs">
                      <Badge color={SLOT_COLORS[i]} variant="filled" size="sm">
                        Slot {SLOT_LABELS[i]}
                      </Badge>
                      <Badge color="gray" variant="outline" size="sm" leftSection={<Loader size={10} />}>
                        Running
                      </Badge>
                    </Group>
                    <Stack align="center" py="lg">
                      <Loader size="sm" />
                      <Text size="xs" c="dimmed">
                        Waiting for response...
                      </Text>
                    </Stack>
                  </Paper>
                );
              }
              return <ResultCard key={i} result={r} index={i} expectedSchema={expectedSchema ?? null} />;
            })}
          </SimpleGrid>
        </Stack>
      )}
    </Stack>
  );
}
