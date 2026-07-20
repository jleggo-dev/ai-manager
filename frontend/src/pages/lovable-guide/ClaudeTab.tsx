/**
 * Claude Code integration guide tab.
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

function buildClaudeMemory(baseUrl: string) {
  const url = baseUrl.trim() || '<your-ai-admin-url>';
  return `# AI Admin integration

This project integrates with AI Admin (${url}) for all AI features.

## When adding AI functionality

- Fetch ${AI_ADMIN_URL}/docs/manifest.json to navigate docs by section.
- Pattern: one-shot → run-slot | templated → processing-jobs test (+ Idempotency-Key) | streaming → chat sessions | resume → chat-sessions/resume | pipeline → workflow | scheduled → triggers/:slug/run | config → /api/sync | CI eval → processing-jobs/:id/eval.
- NEVER expose aim_sk_ keys in client code. Proxy through server/edge function.
- Always set callingApplication: "claude:<project-name>" on every job/chat call.
- Wait for SSE [DONE] before sending the next message (409 if concurrent).
- To continue a past conversation, POST /api/chat-sessions/resume with sessionId (or externalChatId), then send messages as usual.

## Prompt templates

- Use {{variableName}} placeholders matching workflow inputMappings.
- Instruct JSON output + set expectedResponseFormat: "json" when using outputMappings.
- Apply the prompt-engineering skill audit checklist before shipping.

## Reference docs

Integration guide: ${AI_ADMIN_URL}/docs/INTEGRATION.md
API reference: ${AI_ADMIN_URL}/docs/API.md
Workflow decomposition: ${AI_ADMIN_URL}/integration/WORKFLOW_BUILDER_PROMPT.md`;
}

function buildClaudeFirstPrompt(baseUrl: string) {
  const url = baseUrl.trim() || AI_ADMIN_URL;
  return `This project uses AI Admin for all AI features. The AI Admin instance is at ${url}.

Before implementing any AI feature, fetch the section-level navigation index:
${AI_ADMIN_URL}/docs/manifest.json

The ai-admin-integration skill (installed via the skills below) will guide you on auth, integration patterns, and workflow decomposition. The prompt-engineering skill will guide you on writing reliable job prompt templates.`;
}

export function ClaudeTab({ onNavigate }: { onNavigate: (key: string, params?: Record<string, unknown>) => void }) {
  const [baseUrl, setBaseUrl] = useState('');
  const claudeMemory = useMemo(() => buildClaudeMemory(baseUrl), [baseUrl]);
  const firstPrompt = useMemo(() => buildClaudeFirstPrompt(baseUrl), [baseUrl]);

  return (
    <Stack gap="lg">
      <Alert icon={<IconInfoCircle size={18} />} color="violet" variant="light">
        <Text size="sm">
          The skills below follow the{' '}
          <Text component="a" href="https://agentskills.io" target="_blank" rel="noreferrer" c="violet" td="underline">
            agentskills.io
          </Text>{' '}
          open standard — the same files also work in Cursor, Codex, Windsurf, and others. See the Cursor tab for
          Cursor-specific install paths.
        </Text>
      </Alert>

      {/* Step 1 */}
      <StepCard n={1} title="Download the skills and reference docs">
        <Text size="sm">Skills auto-activate in Claude Code when you ask about AI integration or prompt design.</Text>
        <Text size="xs" c="dimmed" mt={4}>
          Project skills (shared with team): <Code>.claude/skills/</Code> &nbsp;|&nbsp; Personal skills (all your
          projects): <Code>~/.claude/skills/</Code>
        </Text>
        <Stack gap="xs" mt="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Skills (auto-activate)
          </Text>
          <Button
            component="a"
            href={INTEGRATION_SKILL_URL}
            download="SKILL.md"
            leftSection={<IconDownload size={18} />}
            variant="filled"
            color="violet"
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
            color="violet"
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
            color="violet"
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
            color="violet"
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
      <StepCard n={2} title="Install skills into Claude Code">
        <Text size="sm">
          Place each downloaded <Code>SKILL.md</Code> and its <Code>references/</Code> folder into the matching
          directory:
        </Text>
        <Code block style={{ fontSize: 12 }} mt="xs">
          {`# Project skills (shared with team via git)
.claude/skills/
  ai-admin-integration/
    SKILL.md
  prompt-engineering/
    SKILL.md
    references/
      frameworks.md
      audit-checklist.md

# OR personal skills (your machine, all projects)
~/.claude/skills/   (same structure)`}
        </Code>
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
      <StepCard n={3} title="Add AI Admin context to your CLAUDE.md">
        <Text size="sm">
          In the project you are building with Claude Code, add the following block to your <Code>CLAUDE.md</Code> file
          (create it at the project root if it doesn&apos;t exist). This gives Claude persistent context about the
          integration.
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
          {claudeMemory}
        </Code>
        <CopyBlock value={claudeMemory} label="Copy CLAUDE.md block" />
      </StepCard>

      {/* Step 4 */}
      <StepCard n={4} title="Start your first AI feature">
        <Text size="sm">Paste this into a new Claude Code session to orient it before asking for a feature:</Text>
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="xs">
          {firstPrompt}
        </Code>
        <CopyBlock value={firstPrompt} label="Copy first-session prompt" />
        <Divider my="xs" />
        <Text size="sm" fw={600}>
          Verify the skills are working
        </Text>
        <List size="sm" spacing={4} mt={4}>
          <List.Item>
            Ask Claude: <em>&quot;I want to add a processing job that summarizes documents. What should I do?&quot;</em>{' '}
            — it should reference AI Admin patterns.
          </List.Item>
          <List.Item>
            Ask Claude: <em>&quot;Help me write a prompt template for extracting company info as JSON.&quot;</em> — it
            should apply the prompt engineering skill.
          </List.Item>
        </List>
      </StepCard>
    </Stack>
  );
}
