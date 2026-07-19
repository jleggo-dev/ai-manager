import { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  Button,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  TextInput,
  Select,
  Textarea,
  Loader,
  Center,
  Alert,
  Code,
  Paper,
  Grid,
  ScrollArea,
  Divider,
  Box,
  Title,
  Collapse,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconTrash,
  IconChevronRight,
  IconChevronDown,
  IconArrowUp,
  IconArrowDown,
  IconX,
  IconAlertTriangle,
  IconBrain,
  IconDeviceFloppy,
} from '@tabler/icons-react';
import * as api from '../../../services/api';
import type { ProcessingJob } from '../../../types/api';
import type { RuleSet, FormattingRule, AppliedRule } from './types';
import { getJobConfig } from './types';
import VariablesReference from './VariablesReference';
import RuleSetSchemaEditor from './RuleSetSchemaEditor';

/* ══════════════════════════════════════════════════════════════
   RULE SETS TAB  (chat-mode jobs only)
   Replaces the single Build Rules editor with an accordion of
   named rule sets — each with its own key, prompt template,
   variables, expected format, formatting rules, and test data.
   ══════════════════════════════════════════════════════════════ */

/**
 * A fresh empty rule set object. The key is editable after creation.
 */
function emptyRuleSet(index: number) {
  return {
    key: `rule-set-${index + 1}`,
    name: '',
    description: '',
    promptTemplate: '',
    variables: [],
    expectedFormat: 'json',
    expectedSchema: null,
    formattingRules: [],
    testData: {},
  };
}

export default function RuleSetsTab({
  selectedJob,
  selectedJobFull,
  availableRules,
  onRefresh,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
  availableRules: FormattingRule[];
  onRefresh: () => Promise<void>;
}) {
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null); /* key of the open accordion panel */
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedJobFull) return;
    const existing = getJobConfig(selectedJobFull).ruleSets;
    if (Array.isArray(existing) && existing.length > 0) {
      setRuleSets(existing);
      setExpanded(null);
    } else {
      const first = emptyRuleSet(0);
      setRuleSets([first]);
      setExpanded(null);
    }
  }, [selectedJobFull]);

  if (!selectedJob) {
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab first.
      </Alert>
    );
  }
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  /* ── Helpers ── */
  function updateRuleSet(key: string, patch: Partial<RuleSet>) {
    setRuleSets((prev) => prev.map((rs) => (rs.key === key ? { ...rs, ...patch } : rs)));
  }

  function addRuleSet() {
    const rs = emptyRuleSet(ruleSets.length);
    /* Make key unique if default conflicts */
    let uniqueKey = rs.key;
    let suffix = 1;
    while (ruleSets.some((r) => r.key === uniqueKey)) {
      uniqueKey = `${rs.key}-${suffix++}`;
    }
    rs.key = uniqueKey;
    setRuleSets((prev) => [...prev, rs]);
    setExpanded(rs.key);
  }

  function deleteRuleSet(key: string) {
    const next = ruleSets.filter((rs) => rs.key !== key);
    setRuleSets(next);
    if (expanded === key) setExpanded(next[0]?.key || null);
  }

  function addFormattingRule(rsKey: string, ruleType: string) {
    updateRuleSet(rsKey, {
      formattingRules: [
        ...(ruleSets.find((r) => r.key === rsKey)?.formattingRules || []),
        { type: ruleType, order: (ruleSets.find((r) => r.key === rsKey)?.formattingRules || []).length, options: {} },
      ],
    });
  }

  function removeFormattingRule(rsKey: string, ruleIdx: number) {
    const rs = ruleSets.find((r) => r.key === rsKey);
    if (!rs) return;
    updateRuleSet(rsKey, { formattingRules: rs.formattingRules.filter((_: AppliedRule, i: number) => i !== ruleIdx) });
  }

  function moveFormattingRule(rsKey: string, ruleIdx: number, direction: number) {
    const rs = ruleSets.find((r) => r.key === rsKey);
    if (!rs) return;
    const list = [...rs.formattingRules];
    const swap = ruleIdx + direction;
    if (swap < 0 || swap >= list.length) return;
    const a = list[ruleIdx];
    const b = list[swap];
    if (a === undefined || b === undefined) return;
    list[ruleIdx] = b;
    list[swap] = a;
    updateRuleSet(rsKey, { formattingRules: list.map((r, i) => ({ ...r, order: i })) });
  }

  function updateFormattingRuleOptions(rsKey: string, ruleIdx: number, options: Record<string, unknown>) {
    const rs = ruleSets.find((r) => r.key === rsKey);
    if (!rs) return;
    updateRuleSet(rsKey, {
      formattingRules: rs.formattingRules.map((r: AppliedRule, i: number) =>
        i === ruleIdx ? { ...r, options: { ...r.options, ...options } } : r,
      ),
    });
  }

  async function handleSave() {
    /* Validate: each rule set needs a non-empty key */
    for (const rs of ruleSets) {
      if (!rs.key?.trim()) {
        notifications.show({ title: 'Validation', message: 'All rule sets must have a key.', color: 'yellow' });
        return;
      }
    }
    /* Check for duplicate keys */
    const keys = ruleSets.map((rs) => rs.key.trim());
    if (new Set(keys).size !== keys.length) {
      notifications.show({ title: 'Validation', message: 'Rule set keys must be unique.', color: 'yellow' });
      return;
    }
    try {
      setSaving(true);
      const config = {
        ...getJobConfig(selectedJobFull),
        ruleSets: ruleSets.map((rs) => ({ ...rs, key: rs.key.trim() })),
      };
      if (!selectedJob) return;
      await api.updateProcessingJob(selectedJob, { config });
      notifications.show({ title: 'Saved', message: 'Rule sets saved successfully.', color: 'green' });
      await onRefresh();
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={4}>{selectedJobFull.name} — Rule Sets</Title>
        <Group gap="xs">
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addRuleSet}>
            Add Rule Set
          </Button>
          <Button size="sm" leftSection={<IconDeviceFloppy size={14} />} onClick={handleSave} loading={saving}>
            Save All Rule Sets
          </Button>
        </Group>
      </Group>

      <Alert variant="light" color="blue" icon={<IconBrain size={14} />}>
        <Text size="xs">
          Rule Sets let this chat-mode job expose multiple invokable prompts. Each set has its own key, template,
          variables, and formatting rules. Calling apps trigger a rule set via <Code>ruleSetKey</Code> when sending a
          chat message.
        </Text>
      </Alert>

      {ruleSets.length === 0 && (
        <Center py="xl">
          <Stack align="center" gap={8}>
            <Text c="dimmed">No rule sets configured.</Text>
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addRuleSet}>
              Add your first rule set
            </Button>
          </Stack>
        </Center>
      )}

      {ruleSets.map((rs, rsIdx) => (
        <Paper key={rs.key} withBorder>
          {/* ── Accordion Header ── */}
          <UnstyledButton w="100%" onClick={() => setExpanded(expanded === rs.key ? null : rs.key)} p="sm">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                {expanded === rs.key ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                <Box>
                  <Group gap={6}>
                    <Text fw={600} size="sm">
                      {rs.name || `Rule Set ${rsIdx + 1}`}
                    </Text>
                    <Badge size="xs" variant="outline" color="blue">
                      {rs.key || 'no-key'}
                    </Badge>
                    {rs.formattingRules?.length > 0 && (
                      <Badge size="xs" color="gray" variant="light">
                        {rs.formattingRules.length} rule{rs.formattingRules.length !== 1 ? 's' : ''}
                      </Badge>
                    )}
                    {rs.variables?.length > 0 && (
                      <Badge size="xs" color="violet" variant="light">
                        {rs.variables.length} var{rs.variables.length !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </Group>
                  {rs.description && (
                    <Text size="xs" c="dimmed">
                      {rs.description}
                    </Text>
                  )}
                </Box>
              </Group>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteRuleSet(rs.key);
                }}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          </UnstyledButton>

          <Collapse in={expanded === rs.key}>
            <Divider />
            <Stack gap="md" p="md">
              {/* ── Identity ── */}
              <Grid>
                <Grid.Col span={4}>
                  <TextInput
                    label="Key"
                    description="Unique identifier used by calling apps (e.g. analyze-company)"
                    placeholder="my-rule-set-key"
                    value={rs.key}
                    onChange={(e) => updateRuleSet(rs.key, { key: e.target.value })}
                    styles={{ input: { fontFamily: 'monospace' } }}
                  />
                </Grid.Col>
                <Grid.Col span={4}>
                  <TextInput
                    label="Name"
                    description="Human-readable label"
                    placeholder="Analyze Company"
                    value={rs.name}
                    onChange={(e) => updateRuleSet(rs.key, { name: e.target.value })}
                  />
                </Grid.Col>
                <Grid.Col span={4}>
                  <Select
                    label="Expected Format"
                    description="What the AI should return"
                    data={[
                      { value: 'json', label: 'JSON object' },
                      { value: 'text', label: 'Plain text' },
                      { value: 'markdown', label: 'Markdown' },
                    ]}
                    value={rs.expectedFormat || 'json'}
                    onChange={(v) => updateRuleSet(rs.key, { expectedFormat: v || 'json' })}
                  />
                </Grid.Col>
                <Grid.Col span={12}>
                  <TextInput
                    label="Description"
                    placeholder="Describe what this rule set does"
                    value={rs.description}
                    onChange={(e) => updateRuleSet(rs.key, { description: e.target.value })}
                  />
                </Grid.Col>
              </Grid>

              {/* ── Variables (read-only — managed by the calling application) ── */}
              <Divider
                label={
                  <Group gap={4}>
                    <Text size="xs" fw={600}>
                      Variables
                    </Text>
                    <Badge size="xs" color="violet">
                      {rs.variables?.length || 0}
                    </Badge>
                  </Group>
                }
                labelPosition="left"
              />
              {rs.variables?.length > 0 ? (
                <VariablesReference variables={rs.variables} />
              ) : (
                <Text size="xs" c="dimmed">
                  No variables defined for this rule set.
                </Text>
              )}

              {/* ── Expected Response Schema ── */}
              {rs.expectedFormat === 'json' && (
                <>
                  <Divider
                    label={
                      <Text size="xs" fw={600}>
                        Expected Response Schema
                      </Text>
                    }
                    labelPosition="left"
                  />
                  <RuleSetSchemaEditor
                    schema={rs.expectedSchema}
                    onChange={(schema) => updateRuleSet(rs.key, { expectedSchema: schema })}
                  />
                </>
              )}

              {/* ── Prompt Template ── */}
              <Divider
                label={
                  <Text size="xs" fw={600}>
                    Prompt Template
                  </Text>
                }
                labelPosition="left"
              />

              <Textarea
                description="Full prompt sent to the AI. Use {{variableName}} placeholders for dynamic data."
                value={rs.promptTemplate}
                onChange={(e) => updateRuleSet(rs.key, { promptTemplate: e.target.value })}
                autosize
                minRows={10}
                maxRows={35}
                styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
              />

              {/* ── Formatting Rules ── */}
              <Divider
                label={
                  <Text size="xs" fw={600}>
                    Formatting Rules
                  </Text>
                }
                labelPosition="left"
              />
              <Grid>
                <Grid.Col span={6}>
                  <Paper withBorder p="sm" h="100%">
                    <Text fw={600} size="sm" mb={8}>
                      Select a Rule
                    </Text>
                    <Text size="xs" c="dimmed" mb={12}>
                      Click to add formatting rules for this rule set
                    </Text>
                    <ScrollArea h={400}>
                      <Stack gap={4}>
                        {availableRules.map((rule) => (
                          <Paper
                            key={rule.type}
                            withBorder
                            p="xs"
                            style={{ cursor: 'pointer' }}
                            onClick={() => addFormattingRule(rs.key, rule.type)}
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
                    <Text fw={600} size="sm" mb={8}>
                      Applied Rules
                    </Text>
                    <Text size="xs" c="dimmed" mb={12}>
                      Rules will be applied to AI responses in this order:
                    </Text>
                    <ScrollArea h={400}>
                      {!rs.formattingRules || rs.formattingRules.length === 0 ? (
                        <Center py="xl">
                          <Stack align="center" gap={4}>
                            <Text size="sm" c="dimmed">
                              No formatting rules configured.
                            </Text>
                            <Text size="xs" c="dimmed">
                              Click on rules in the left panel to add them.
                            </Text>
                          </Stack>
                        </Center>
                      ) : (
                        <Stack gap={4}>
                          {rs.formattingRules.map((rule: AppliedRule, rIdx: number) => {
                            const meta = availableRules.find((r) => r.type === rule.type);
                            return (
                              <Paper key={`${rule.type}-${rIdx}`} withBorder p="xs">
                                <Group justify="space-between" wrap="nowrap">
                                  <Group gap="xs" wrap="nowrap">
                                    <Text size="xs" c="dimmed" fw={600}>
                                      {rIdx + 1}.
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
                                          onChange={(e) =>
                                            updateFormattingRuleOptions(rs.key, rIdx, { tagName: e.target.value })
                                          }
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
                                      onClick={() => moveFormattingRule(rs.key, rIdx, -1)}
                                      disabled={rIdx === 0}
                                    >
                                      <IconArrowUp size={12} />
                                    </ActionIcon>
                                    <ActionIcon
                                      size="xs"
                                      variant="subtle"
                                      onClick={() => moveFormattingRule(rs.key, rIdx, 1)}
                                      disabled={rIdx === rs.formattingRules.length - 1}
                                    >
                                      <IconArrowDown size={12} />
                                    </ActionIcon>
                                    <ActionIcon
                                      size="xs"
                                      variant="subtle"
                                      color="red"
                                      onClick={() => removeFormattingRule(rs.key, rIdx)}
                                    >
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

              {/* ── Test Data (default values for variables) ── */}
              {rs.variables?.length > 0 && (
                <>
                  <Divider
                    label={
                      <Text size="xs" fw={600}>
                        Default Test Data
                      </Text>
                    }
                    labelPosition="left"
                  />
                  <Text size="xs" c="dimmed">
                    Pre-fill variable values used when testing this rule set. Won&apos;t affect production calls.
                  </Text>
                  <Grid>
                    {rs.variables.map((v) => (
                      <Grid.Col span={v.source === 'user' ? 6 : 12} key={v.name}>
                        {v.source === 'user' ? (
                          <TextInput
                            label={
                              <Group gap={4}>
                                <Text size="xs">{v.label || v.name}</Text>
                                <Badge size="xs" color="blue">
                                  user
                                </Badge>
                              </Group>
                            }
                            placeholder={`Test value for ${v.label || v.name}`}
                            value={rs.testData?.[v.name] || ''}
                            onChange={(e) =>
                              updateRuleSet(rs.key, { testData: { ...(rs.testData || {}), [v.name]: e.target.value } })
                            }
                          />
                        ) : (
                          <Textarea
                            label={
                              <Group gap={4}>
                                <Text size="xs">{v.label || v.name}</Text>
                                <Badge size="xs" variant="outline" color="gray">
                                  pipeline
                                </Badge>
                              </Group>
                            }
                            placeholder={`Test data for ${v.label || v.name}`}
                            value={rs.testData?.[v.name] || ''}
                            onChange={(e) =>
                              updateRuleSet(rs.key, { testData: { ...(rs.testData || {}), [v.name]: e.target.value } })
                            }
                            autosize
                            minRows={2}
                            maxRows={5}
                            styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                          />
                        )}
                      </Grid.Col>
                    ))}
                  </Grid>
                </>
              )}
            </Stack>
          </Collapse>
        </Paper>
      ))}

      {ruleSets.length > 0 && (
        <Group justify="flex-end">
          <Button leftSection={<IconDeviceFloppy size={14} />} onClick={handleSave} loading={saving}>
            Save All Rule Sets
          </Button>
        </Group>
      )}
    </Stack>
  );
}
