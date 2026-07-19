/**
 * Single AI Matcher slot configuration card (profile or ad-hoc).
 * Extracted from AiMatcherPage.tsx (FE-03).
 */

import { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  Paper,
  Text,
  Badge,
  Textarea,
  Select,
  SegmentedControl,
  Switch,
  ActionIcon,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import * as api from '../../../services/api';
import type { Provider, AiProfile, LlmModel } from '../../../types/api';
import { DEVS_AI_BUILTIN_TOOL_OPTIONS } from '../../../lib/runtime-options';
import { SLOT_COLORS, SLOT_LABELS, type SlotConfig } from '../../../lib/ai-matcher';

export interface AiSlotCardProps {
  slot: SlotConfig;
  index: number;
  providers: Provider[];
  profiles: AiProfile[];
  onChange: (index: number, slot: SlotConfig) => void;
  onRemove: (index: number) => void;
}

export function AiSlotCard({ slot, index, providers, profiles, onChange, onRemove }: AiSlotCardProps) {
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
        <ActionIcon
          size="sm"
          variant="subtle"
          color="red"
          aria-label={`Remove slot ${label}`}
          onClick={() => onRemove(index)}
        >
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
              onChange={(v) => update({ externalAiId: v ?? '' })}
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
              onChange={(v) => update({ externalAiId: v ?? '' })}
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
