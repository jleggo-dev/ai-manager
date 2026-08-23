/**
 * ai-profiles/JobsAsToolsPanel
 * -----------------------------
 * Chat-mode "Jobs as tools" config rows inside the profile form modal.
 * Extracted from ProfileFormModal (FE-02) as a structural, behavior-preserving move.
 */

import type { Dispatch, SetStateAction } from 'react';
import { ActionIcon, Button, Group, NumberInput, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

export interface ToolJobFormRow {
  jobSlug: string;
  exposeAs: string;
  description: string;
  /** Per-tool result cap in characters. Empty inherits profile → provider → system default. */
  maxOutputChars: number | null;
}

interface JobsAsToolsPanelProps {
  toolJobs: ToolJobFormRow[];
  setToolJobs: Dispatch<SetStateAction<ToolJobFormRow[]>>;
  processingJobs: Array<{ slug: string; name: string }>;
}

export default function JobsAsToolsPanel({ toolJobs, setToolJobs, processingJobs }: JobsAsToolsPanelProps) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="sm">
        <Text size="sm" fw={600}>
          Jobs as tools
        </Text>
        <Text size="xs" c="dimmed">
          Expose processing jobs as model-callable tools. AI Admin runs the linked job server-side when the model
          invokes the tool (devs-ai v1 tool.call or devs-ai-v2 function_call).
        </Text>
        <Text size="xs" c="dimmed">
          <strong>Max output</strong> caps one result from this tool. The better fix for a large result is a bounded
          array in the job&apos;s expected schema — the provider enforces that. This is the backstop: over the limit, a
          JSON result is replaced with an error object the model can retry against, and plain text is cut at a line
          boundary and told so. Leave empty to inherit the profile, provider, then system default.
        </Text>
        {toolJobs.length === 0 && (
          <Text size="xs" c="dimmed">
            No tool jobs configured.
          </Text>
        )}
        {toolJobs.map((row, index) => (
          <Group key={`tool-job-${index}`} align="flex-end" wrap="nowrap">
            <Select
              label="Processing job"
              placeholder="Select job"
              searchable
              style={{ flex: 1 }}
              data={processingJobs.map((j) => ({
                value: j.slug,
                label: `${j.name} (${j.slug})`,
              }))}
              value={row.jobSlug || null}
              onChange={(value) =>
                setToolJobs((prev) => prev.map((r, i) => (i === index ? { ...r, jobSlug: value || '' } : r)))
              }
            />
            <TextInput
              label="Expose as"
              placeholder="tool_name"
              style={{ flex: 1 }}
              value={row.exposeAs}
              onChange={(e) =>
                setToolJobs((prev) => prev.map((r, i) => (i === index ? { ...r, exposeAs: e.currentTarget.value } : r)))
              }
            />
            <TextInput
              label="Description"
              placeholder="Optional"
              style={{ flex: 1 }}
              value={row.description}
              onChange={(e) =>
                setToolJobs((prev) =>
                  prev.map((r, i) => (i === index ? { ...r, description: e.currentTarget.value } : r)),
                )
              }
            />
            <NumberInput
              label="Max output"
              placeholder="Inherit"
              style={{ width: 120 }}
              min={500}
              max={500000}
              step={1000}
              value={row.maxOutputChars ?? ''}
              onChange={(val) =>
                setToolJobs((prev) =>
                  prev.map((r, i) => (i === index ? { ...r, maxOutputChars: val ? Number(val) : null } : r)),
                )
              }
            />
            <ActionIcon
              color="red"
              variant="subtle"
              aria-label="Remove tool job"
              onClick={() => setToolJobs((prev) => prev.filter((_, i) => i !== index))}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() =>
            setToolJobs((prev) => [...prev, { jobSlug: '', exposeAs: '', description: '', maxOutputChars: null }])
          }
        >
          Add tool job
        </Button>
      </Stack>
    </Paper>
  );
}
