import { useState, useEffect } from 'react';
import {
  Stack,
  Title,
  Alert,
  Switch,
  Textarea,
  Divider,
  Grid,
  Paper,
  Text,
  ScrollArea,
  Box,
  Group,
  Button,
  Center,
  Loader,
  ActionIcon,
  Tooltip,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconChevronRight, IconArrowUp, IconArrowDown, IconX } from '@tabler/icons-react';
import * as api from '../../../services/api';
import type { ProcessingJob } from '../../../types/api';
import type { FormattingRule, AppliedRule } from './types';
import { getJobConfig } from './types';
import VariablesReference from './VariablesReference';
import ResponseSchemaViewer from './ResponseSchemaViewer';

export default function BuildRulesTab({
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
