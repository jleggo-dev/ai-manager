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
 *
 * Structural split (FE-03): molecules under components/molecules/ai-matcher/,
 * hooks for slots/execution/prompt, pure helpers in lib/ai-matcher.ts.
 * Prompt composition uses lib/interpolate via composeMatcherPrompt.
 */

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
  SimpleGrid,
  Loader,
} from '@mantine/core';
import { IconPlus, IconPlayerPlay, IconCheck, IconX } from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';
import { AiSlotCard } from '../components/molecules/ai-matcher/AiSlotCard';
import { MatcherResultsSection } from '../components/molecules/ai-matcher/MatcherResultsSection';
import { useAiMatcherSlots } from '../hooks/useAiMatcherSlots';
import { useAiMatcherExecution } from '../hooks/useAiMatcherExecution';
import { useAiMatcherPrompt } from '../hooks/useAiMatcherPrompt';
import { SLOT_LABELS } from '../lib/ai-matcher';

export default function AiMatcherPage() {
  const {
    providers,
    profiles,
    loadingRef,
    mode,
    resetPromptMode,
    selectedJobId,
    setSelectedJobId,
    variables,
    handleVarChange,
    prompt,
    setPrompt,
    jobOptions,
    allVars,
    expectedSchema,
    formattingRules,
  } = useAiMatcherPrompt();

  const { slots, updateSlot, removeSlot, addSlot, canAddSlot } = useAiMatcherSlots();
  const { running, results, completedCount, totalSlotCount, runComparison, clearResults } = useAiMatcherExecution();

  if (loadingRef)
    return (
      <Stack align="center" py="xl">
        <Loader />
        <Text size="sm" c="dimmed">
          Loading reference data...
        </Text>
      </Stack>
    );

  return (
    <Stack gap="md">
      <PageHeader title="AI Matcher" description="Send the same prompt to multiple AIs and compare their responses." />

      <Paper withBorder p="md" radius="md">
        <Title order={5} mb="xs">
          Prompt
        </Title>
        <SegmentedControl
          size="xs"
          mb="sm"
          value={mode}
          onChange={(v) => {
            resetPromptMode(v);
            clearResults();
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
                {allVars.map((v) => (
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

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="xs">
          <Title order={5}>AI slots</Title>
          {canAddSlot && (
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

      <Group gap="md" align="center">
        <Button
          size="md"
          leftSection={running ? <Loader size={16} color="white" /> : <IconPlayerPlay size={16} />}
          disabled={running || !prompt.trim()}
          onClick={() => runComparison({ prompt, slots, formattingRules })}
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

      {results && <MatcherResultsSection results={results} expectedSchema={expectedSchema} />}
    </Stack>
  );
}
