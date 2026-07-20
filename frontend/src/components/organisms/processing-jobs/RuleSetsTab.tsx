import { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  Button,
  Text,
  Badge,
  ActionIcon,
  Loader,
  Center,
  Alert,
  Code,
  Paper,
  Title,
  Collapse,
  UnstyledButton,
  Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlus,
  IconTrash,
  IconChevronRight,
  IconChevronDown,
  IconBrain,
  IconDeviceFloppy,
} from '@tabler/icons-react';
import * as api from '../../../services/api';
import type { ProcessingJob } from '../../../types/api';
import type { RuleSet, FormattingRule, AppliedRule } from './types';
import { getJobConfig } from './types';
import RuleSetEditorPanel from './RuleSetEditorPanel';

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
            <RuleSetEditorPanel
              rs={rs}
              availableRules={availableRules}
              onUpdate={(patch) => updateRuleSet(rs.key, patch)}
              onAddFormattingRule={(ruleType) => addFormattingRule(rs.key, ruleType)}
              onRemoveFormattingRule={(ruleIdx) => removeFormattingRule(rs.key, ruleIdx)}
              onMoveFormattingRule={(ruleIdx, direction) => moveFormattingRule(rs.key, ruleIdx, direction)}
              onUpdateFormattingRuleOptions={(ruleIdx, options) =>
                updateFormattingRuleOptions(rs.key, ruleIdx, options)
              }
            />
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
