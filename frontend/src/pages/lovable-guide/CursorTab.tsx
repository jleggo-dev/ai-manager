/**
 * Cursor / agentskills.io integration guide tab.
 */

import { useMemo, useState } from 'react';
import { Stack, Text, Button, List, Code, Divider, TextInput, Alert } from '@mantine/core';
import { IconDownload, IconSettings, IconInfoCircle } from '@tabler/icons-react';
import { CopyBlock, StepCard } from './GuideShared';
import {
  AI_ADMIN_URL,
  API_DOC_URL,
  BUILDER_FILENAME,
  BUILDER_URL,
  INTEGRATION_DOC_URL,
  INTEGRATION_SKILL_URL,
  MANIFEST_URL,
  PROMPT_AUDIT_URL,
  PROMPT_FRAMEWORKS_URL,
  PROMPT_SKILL_URL,
} from './constants';

function buildCursorRule(baseUrl: string) {
  const url = baseUrl.trim() || '<your-ai-admin-url>';
  return `---
description: AI Admin integration rules for this project. Applied when adding AI features, building workflows, calling the AI Admin API, or prompting about LLM integrations.
---

This project integrates with AI Admin (${url}) for all AI features.

## When asked to add AI functionality

1. Fetch ${AI_ADMIN_URL}/docs/manifest.json to discover available docs and jump to relevant sections.
2. Follow the integration pattern decision tree:
   - One-shot prompt → POST /api/ai-matcher/run-slot
   - Repeatable task → POST /api/processing-jobs/:id/test (optional Idempotency-Key header)
   - Streaming chat → POST /api/chat-sessions + SSE messages
   - Resume a past chat → POST /api/chat-sessions/resume (by sessionId or externalChatId)
   - Multi-step pipeline → workflow with variable mappings (nested outputMappings paths supported)
   - Scheduled/event-driven → POST /api/triggers/:slug/run
   - Config in git → POST /api/sync (upsert by slug)
   - CI prompt tests → POST /api/processing-jobs/:id/eval
3. NEVER expose aim_sk_ API keys in client code. Use server-side proxy.
4. Set callingApplication: "cursor:<project-name>" on every job/chat call.

## When writing prompt templates

- Use {{variableName}} placeholders matching workflow inputMappings
- Instruct JSON output when step uses outputMappings; set expectedResponseFormat: "json"
- Run the prompt audit checklist before shipping

## Reference docs

- Integration patterns: ${AI_ADMIN_URL}/docs/INTEGRATION.md
- API reference: ${AI_ADMIN_URL}/docs/API.md
- Workflow decomposition: ${AI_ADMIN_URL}/integration/WORKFLOW_BUILDER_PROMPT.md`;
}

function buildCursorFirstPrompt(baseUrl: string) {
  const url = baseUrl.trim() || AI_ADMIN_URL;
  return `This project uses AI Admin for all AI features. The AI Admin instance is at ${url}.

Before implementing any AI feature, fetch the section-level navigation index:
${AI_ADMIN_URL}/docs/manifest.json

Then read only the sections relevant to the task (do not load the entire handbook unless needed).
The integration skill in .cursor/skills/ai-admin-integration/ will guide you on auth, patterns, and workflow decomposition.
The prompt-engineering skill in .cursor/skills/prompt-engineering/ will guide you on writing job prompt templates.`;
}

export function CursorTab({ onNavigate }: { onNavigate: (key: string, params?: Record<string, unknown>) => void }) {
  const [baseUrl, setBaseUrl] = useState('');
  const cursorRule = useMemo(() => buildCursorRule(baseUrl), [baseUrl]);
  const firstPrompt = useMemo(() => buildCursorFirstPrompt(baseUrl), [baseUrl]);

  return (
    <Stack gap="lg">
      <Alert icon={<IconInfoCircle size={18} />} color="indigo" variant="light">
        <Text size="sm">
          The skills below follow the{' '}
          <Text component="a" href="https://agentskills.io" target="_blank" rel="noreferrer" c="indigo" td="underline">
            agentskills.io
          </Text>{' '}
          open standard — they also work in Claude Code, Codex, Windsurf, Goose, and 40+ other agents. See the Claude
          tab for Claude-specific instructions.
        </Text>
      </Alert>

      {/* Step 1 */}
      <StepCard n={1} title="Download the skills and reference docs">
        <Text size="sm">
          Skills auto-activate when you ask Cursor to add AI features or write prompt templates. Download and place them
          in your project or your global Cursor skills folder.
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          Project skills (shared with team): <Code>.cursor/skills/</Code> &nbsp;|&nbsp; Personal skills (all your
          projects): <Code>~/.cursor/skills/</Code>
        </Text>
        <Stack gap="xs" mt="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Skills (auto-activate in Cursor)
          </Text>
          <Button
            component="a"
            href={INTEGRATION_SKILL_URL}
            download="SKILL.md"
            leftSection={<IconDownload size={18} />}
            variant="filled"
            fullWidth
          >
            ai-admin-integration / SKILL.md
          </Button>
          <Button
            component="a"
            href={PROMPT_SKILL_URL}
            download="SKILL.md"
            leftSection={<IconDownload size={18} />}
            variant="filled"
            fullWidth
          >
            prompt-engineering / SKILL.md
          </Button>
          <Button
            component="a"
            href={PROMPT_FRAMEWORKS_URL}
            download="frameworks.md"
            leftSection={<IconDownload size={18} />}
            variant="light"
            fullWidth
          >
            prompt-engineering / references / frameworks.md
          </Button>
          <Button
            component="a"
            href={PROMPT_AUDIT_URL}
            download="audit-checklist.md"
            leftSection={<IconDownload size={18} />}
            variant="light"
            fullWidth
          >
            prompt-engineering / references / audit-checklist.md
          </Button>
        </Stack>
        <Stack gap="xs" mt="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Reference docs (read on demand)
          </Text>
          <Button
            component="a"
            href={INTEGRATION_DOC_URL}
            download="INTEGRATION.md"
            leftSection={<IconDownload size={18} />}
            variant="subtle"
            fullWidth
          >
            Integration guide (.md)
          </Button>
          <Button
            component="a"
            href={API_DOC_URL}
            download="API.md"
            leftSection={<IconDownload size={18} />}
            variant="subtle"
            fullWidth
          >
            API reference (.md)
          </Button>
          <Button
            component="a"
            href={BUILDER_URL}
            download={BUILDER_FILENAME}
            leftSection={<IconDownload size={18} />}
            variant="subtle"
            fullWidth
          >
            Workflow builder reference (.md)
          </Button>
          <Button
            component="a"
            href={MANIFEST_URL}
            download="manifest.json"
            leftSection={<IconDownload size={18} />}
            variant="subtle"
            fullWidth
          >
            Section-level manifest (.json)
          </Button>
        </Stack>
      </StepCard>

      {/* Step 2 */}
      <StepCard n={2} title="Install skills into Cursor">
        <Text size="sm">
          Place each downloaded <Code>SKILL.md</Code> and its <Code>references/</Code> folder into the matching
          directory:
        </Text>
        <Code block style={{ fontSize: 12 }} mt="xs">
          {`# Project skills (shared with team via git)
.cursor/skills/
  ai-admin-integration/
    SKILL.md
  prompt-engineering/
    SKILL.md
    references/
      frameworks.md
      audit-checklist.md

# OR personal skills (your machine, all projects)
~/.cursor/skills/   (same structure)`}
        </Code>
        <Text size="sm" c="dimmed" mt="xs">
          If you cloned this AI Admin repo, these skills are already installed at <Code>.cursor/skills/</Code> — no
          download needed.
        </Text>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconSettings size={16} />}
          onClick={() => onNavigate?.('settings', { tab: 'api-keys' })}
        >
          Open Settings → API keys (to create a key for your project)
        </Button>
      </StepCard>

      {/* Step 3 */}
      <StepCard n={3} title="Add a Cursor rule to your target project">
        <Text size="sm">
          In the project you are building with Cursor, create a rule file at <Code>.cursor/rules/ai-admin.mdc</Code>.
          This gives Cursor standing context about the integration without you having to repeat it every chat.
        </Text>
        <Text size="sm" c="dimmed" mt={4}>
          Enter your AI Admin URL to personalise the rule:
        </Text>
        <TextInput
          label="Your AI Admin URL"
          placeholder="https://your-ai-admin-domain.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
          size="sm"
          mt="xs"
        />
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="sm">
          {cursorRule}
        </Code>
        <CopyBlock value={cursorRule} label="Copy rule (.mdc content)" />
      </StepCard>

      {/* Step 4 */}
      <StepCard n={4} title="Start your first AI feature">
        <Text size="sm">
          Paste this into a new Cursor chat to orient it before asking for a feature. The skills will activate
          automatically from there.
        </Text>
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="xs">
          {firstPrompt}
        </Code>
        <CopyBlock value={firstPrompt} label="Copy first-chat prompt" />
        <Divider my="xs" />
        <Text size="sm" fw={600}>
          Verify the skills are working
        </Text>
        <List size="sm" spacing={4} mt={4}>
          <List.Item>
            Ask Cursor: <em>&quot;I want to add a processing job that summarizes documents. What should I do?&quot;</em>{' '}
            — it should reference AI Admin patterns.
          </List.Item>
          <List.Item>
            Ask Cursor: <em>&quot;Help me write a prompt template for extracting company info as JSON.&quot;</em> — it
            should apply the prompt engineering skill.
          </List.Item>
        </List>
      </StepCard>
    </Stack>
  );
}
