/**
 * Vibe-Coding Tools — integration guide for Lovable, Cursor, Claude Code, and other AI agents.
 * All heavy-lifting lives in downloadable .md / .ts / skill files; this page directs the user.
 */

import React, { useMemo, useState, type ReactNode } from 'react';
import {
  Stack,
  Paper,
  Text,
  Title,
  Button,
  List,
  ThemeIcon,
  CopyButton,
  Code,
  Divider,
  TextInput,
  Tabs,
  Badge,
  Alert,
  Group,
} from '@mantine/core';
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconCircleNumber1,
  IconCircleNumber2,
  IconCircleNumber3,
  IconCircleNumber4,
  IconSettings,
  IconListCheck,
  IconHeartHandshake,
  IconBrandVscode,
  IconRobot,
  IconInfoCircle,
} from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';

const AI_ADMIN_VERSION = '1.4.0';
const AI_ADMIN_URL = 'https://ai-manager-alpha-seven.vercel.app';

// Lovable files
const HANDBOOK_FILENAME = 'AI_ADMIN_LOVABLE_INTEGRATION.md';
const HANDBOOK_URL = `/integration/${HANDBOOK_FILENAME}`;
const EDGE_FN_FILENAME = 'ai-admin-supabase-edge-function.ts';
const EDGE_FN_URL = `/integration/${EDGE_FN_FILENAME}`;
const BUILDER_FILENAME = 'WORKFLOW_BUILDER_PROMPT.md';
const BUILDER_URL = `/integration/${BUILDER_FILENAME}`;
const TEST_SPEC_FILENAME = 'AI_ADMIN_TEST_PAGE_SPEC.md';
const TEST_SPEC_URL = `/integration/${TEST_SPEC_FILENAME}`;

// Coding-agent skill files (agentskills.io format — works in Cursor, Claude Code, Codex, Windsurf, etc.)
const INTEGRATION_SKILL_URL = '/skills/ai-admin-integration/SKILL.md';
const PROMPT_SKILL_URL = '/skills/prompt-engineering/SKILL.md';
const PROMPT_FRAMEWORKS_URL = '/skills/prompt-engineering/references/frameworks.md';
const PROMPT_AUDIT_URL = '/skills/prompt-engineering/references/audit-checklist.md';

// Shared reference docs
const INTEGRATION_DOC_URL = '/docs/INTEGRATION.md';
const API_DOC_URL = '/docs/API.md';
const MANIFEST_URL = '/docs/manifest.json';

// ──────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────

interface StepCardProps {
  n: number;
  title: string;
  children: ReactNode;
}

function StepCard({ n, title, children }: StepCardProps) {
  const icons = [IconCircleNumber1, IconCircleNumber2, IconCircleNumber3, IconCircleNumber4];
  const Num = icons[n - 1] || IconCircleNumber1;
  return (
    <Paper p="lg" radius="md" withBorder shadow="xs">
      <Stack gap="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ThemeIcon size={40} radius="md" variant="light" color="indigo">
            <Num size={22} stroke={1.5} />
          </ThemeIcon>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Step {n}
            </Text>
            <Title order={4} mt={2}>
              {title}
            </Title>
          </div>
        </div>
        {children}
      </Stack>
    </Paper>
  );
}

function CopyBlock({ value, label }: { value: string; label: string }) {
  return (
    <CopyButton value={value} timeout={2000}>
      {({ copied, copy }) => (
        <Button leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />} onClick={copy} variant="light">
          {copied ? 'Copied' : label}
        </Button>
      )}
    </CopyButton>
  );
}

// ──────────────────────────────────────────────────────────────
// Lovable tab content
// ──────────────────────────────────────────────────────────────

function buildLovableMasterPrompt(apiKey: string, baseUrl: string) {
  const key = apiKey.trim() || '<paste your AI Admin API key here>';
  const url = baseUrl.trim() || AI_ADMIN_URL;
  return `Build the AI Admin integration for this project.

AI Admin docs: ${AI_ADMIN_URL}/docs/manifest.json lists all available documentation. If the docs have been uploaded to this project in /docs, read them there. Otherwise, the latest versions are always available at:
- ${AI_ADMIN_URL}/integration/${HANDBOOK_FILENAME} (start here)
- ${AI_ADMIN_URL}/integration/${EDGE_FN_FILENAME} (Edge Function reference code)

Use these values when generating the Edge Function and Supabase secret configuration:
- AI_ADMIN_API_KEY: ${key}
- AI_ADMIN_BASE_URL: ${url}

Follow ${HANDBOOK_FILENAME} as the primary source of truth. Use ${EDGE_FN_FILENAME} as the starting point for the Edge Function code.`;
}

function buildLovableStandingInstructions() {
  return `This project uses AI Admin (v${AI_ADMIN_VERSION}) to power all AI features. When I ask you to add AI, change how AI works, build a workflow, or anything involving AI-powered functionality, read the files in the /docs folder first and follow them.

Docs in /docs:
- ${HANDBOOK_FILENAME} — how the AI integration works (start here)
- ${EDGE_FN_FILENAME} — reference code for the Edge Function
- ${BUILDER_FILENAME} — how to turn a request like "add AI that does X" into jobs and workflows
- ${TEST_SPEC_FILENAME} — how to build a test page to verify it works

If something doesn't work as documented, the docs may be outdated. Ask the user to download the latest files from AI Admin (Vibe-Coding Tools page) at ${AI_ADMIN_URL} or check the changelog at ${AI_ADMIN_URL}/docs/CHANGELOG.md for recent changes.`;
}

function LovableTab({ onNavigate }: { onNavigate: (key: string, params?: Record<string, unknown>) => void }) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const masterPrompt = useMemo(() => buildLovableMasterPrompt(apiKey, baseUrl), [apiKey, baseUrl]);
  const standingInstructions = useMemo(() => buildLovableStandingInstructions(), []);

  return (
    <Stack gap="lg">
      {/* Step 1 */}
      <StepCard n={1} title="Download the integration pack">
        <Text size="sm">These files tell Lovable&apos;s AI how to connect to AI Admin. Download all four.</Text>
        <Stack gap="xs" mt="xs">
          <Button component="a" href={HANDBOOK_URL} download={HANDBOOK_FILENAME} leftSection={<IconDownload size={18} />} variant="filled" fullWidth>
            Integration handbook (.md)
          </Button>
          <Button component="a" href={EDGE_FN_URL} download={EDGE_FN_FILENAME} leftSection={<IconDownload size={18} />} variant="light" fullWidth>
            Edge Function starter code (.ts)
          </Button>
          <Button component="a" href={BUILDER_URL} download={BUILDER_FILENAME} leftSection={<IconDownload size={18} />} variant="light" fullWidth>
            Workflow builder reference (.md)
          </Button>
          <Button component="a" href={TEST_SPEC_URL} download={TEST_SPEC_FILENAME} leftSection={<IconDownload size={18} />} variant="light" fullWidth>
            Test page spec (.md)
          </Button>
        </Stack>
      </StepCard>

      {/* Step 2 */}
      <StepCard n={2} title="Upload to Lovable and add project instructions">
        <Text size="sm">
          Upload all four files to your Lovable project. Tell Lovable: <strong>&quot;Store these files in a /docs folder.&quot;</strong>
        </Text>
        <Text size="sm" c="dimmed" mt={4}>
          These files are versioned. If you update AI Admin, re-download the latest from this page to keep your integration docs current.
        </Text>
        <Text size="sm" mt="xs">
          Then open your <strong>project instructions</strong> (settings area where Lovable keeps standing rules) and paste this:
        </Text>
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="sm">
          {standingInstructions}
        </Code>
        <CopyBlock value={standingInstructions} label="Copy project instructions" />
      </StepCard>

      {/* Step 3 */}
      <StepCard n={3} title="Prompt Lovable to build the integration">
        <Text size="sm">
          Create an API key in <strong>Settings → API keys</strong>, then paste it and your AI Admin URL below.
        </Text>
        <Button variant="subtle" size="xs" leftSection={<IconSettings size={16} />} onClick={() => onNavigate?.('settings', { tab: 'api-keys' })}>
          Open Settings → API keys
        </Button>
        <TextInput label="Your AI Admin API key" placeholder="aim_sk_…" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} size="sm" />
        <TextInput label="Your AI Admin URL" placeholder="https://your-ai-admin-domain.com" value={baseUrl} onChange={(e) => setBaseUrl(e.currentTarget.value)} size="sm" />
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="xs">
          {masterPrompt}
        </Code>
        <CopyBlock value={masterPrompt} label="Copy prompt" />
      </StepCard>

      {/* Step 4 */}
      <StepCard n={4} title="Test it">
        <Text size="sm" fw={600}>Create two test jobs in AI Admin</Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <strong>Job 1 — smoke test:</strong> Open <strong>Jobs</strong>, create a job with the prompt{' '}
            <Code>Reply with exactly the word SMOKE_OK and nothing else.</Code> Copy the job ID.
          </List.Item>
          <List.Item>
            <strong>Job 2 — variables:</strong> Create a job with the prompt{' '}
            <Code>{'Write one friendly sentence about {{topic}}. Keep the style {{tone}}.'}</Code> Copy the job ID.
          </List.Item>
        </List>
        <Button variant="subtle" size="xs" leftSection={<IconListCheck size={16} />} onClick={() => onNavigate?.('processing-jobs')}>
          Open Jobs
        </Button>
        <Divider my="xs" />
        <Text size="sm" fw={600}>Prompt Lovable to build a test page</Text>
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }} mt="xs">
          Build an integration test page following the spec in /docs/{TEST_SPEC_FILENAME}
        </Code>
        <CopyBlock value={`Build an integration test page following the spec in /docs/${TEST_SPEC_FILENAME}`} label="Copy test page prompt" />
        <Divider my="xs" />
        <Text size="sm" fw={600}>Verification checklist</Text>
        <Text size="sm" c="dimmed" mb={4}>In Lovable (test page):</Text>
        <List size="sm" spacing={4}>
          <List.Item>Smoke test shows <strong>SMOKE_OK</strong></List.Item>
          <List.Item>Variable test response matches the topic and tone you entered</List.Item>
          <List.Item>Streaming test shows text appearing gradually (not all at once)</List.Item>
        </List>
        <Text size="sm" c="dimmed" mt="sm" mb={4}>In AI Admin:</Text>
        <List size="sm" spacing={4}>
          <List.Item><strong>Jobs</strong> → click your test job → recent test runs appear</List.Item>
          <List.Item><strong>Diagnostics</strong> → requests from your calling application show up</List.Item>
        </List>
      </StepCard>
    </Stack>
  );
}

// ──────────────────────────────────────────────────────────────
// Cursor tab content
// ──────────────────────────────────────────────────────────────

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

function CursorTab({ onNavigate }: { onNavigate: (key: string, params?: Record<string, unknown>) => void }) {
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
          open standard — they also work in Claude Code, Codex, Windsurf, Goose, and 40+ other agents. See the Claude tab for Claude-specific instructions.
        </Text>
      </Alert>

      {/* Step 1 */}
      <StepCard n={1} title="Download the skills and reference docs">
        <Text size="sm">
          Skills auto-activate when you ask Cursor to add AI features or write prompt templates. Download and place them in your project or your global Cursor skills folder.
        </Text>
        <Text size="xs" c="dimmed" mt={4}>
          Project skills (shared with team): <Code>.cursor/skills/</Code> &nbsp;|&nbsp; Personal skills (all your projects):{' '}
          <Code>~/.cursor/skills/</Code>
        </Text>
        <Stack gap="xs" mt="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">Skills (auto-activate in Cursor)</Text>
          <Button component="a" href={INTEGRATION_SKILL_URL} download="SKILL.md" leftSection={<IconDownload size={18} />} variant="filled" fullWidth>
            ai-admin-integration / SKILL.md
          </Button>
          <Button component="a" href={PROMPT_SKILL_URL} download="SKILL.md" leftSection={<IconDownload size={18} />} variant="filled" fullWidth>
            prompt-engineering / SKILL.md
          </Button>
          <Button component="a" href={PROMPT_FRAMEWORKS_URL} download="frameworks.md" leftSection={<IconDownload size={18} />} variant="light" fullWidth>
            prompt-engineering / references / frameworks.md
          </Button>
          <Button component="a" href={PROMPT_AUDIT_URL} download="audit-checklist.md" leftSection={<IconDownload size={18} />} variant="light" fullWidth>
            prompt-engineering / references / audit-checklist.md
          </Button>
        </Stack>
        <Stack gap="xs" mt="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">Reference docs (read on demand)</Text>
          <Button component="a" href={INTEGRATION_DOC_URL} download="INTEGRATION.md" leftSection={<IconDownload size={18} />} variant="subtle" fullWidth>
            Integration guide (.md)
          </Button>
          <Button component="a" href={API_DOC_URL} download="API.md" leftSection={<IconDownload size={18} />} variant="subtle" fullWidth>
            API reference (.md)
          </Button>
          <Button component="a" href={BUILDER_URL} download={BUILDER_FILENAME} leftSection={<IconDownload size={18} />} variant="subtle" fullWidth>
            Workflow builder reference (.md)
          </Button>
          <Button component="a" href={MANIFEST_URL} download="manifest.json" leftSection={<IconDownload size={18} />} variant="subtle" fullWidth>
            Section-level manifest (.json)
          </Button>
        </Stack>
      </StepCard>

      {/* Step 2 */}
      <StepCard n={2} title="Install skills into Cursor">
        <Text size="sm">
          Place each downloaded <Code>SKILL.md</Code> and its <Code>references/</Code> folder into the matching directory:
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
          If you cloned this AI Admin repo, these skills are already installed at <Code>.cursor/skills/</Code> — no download needed.
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
          In the project you are building with Cursor, create a rule file at{' '}
          <Code>.cursor/rules/ai-admin.mdc</Code>. This gives Cursor standing context about the integration without you having to repeat it every chat.
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
          Paste this into a new Cursor chat to orient it before asking for a feature. The skills will activate automatically from there.
        </Text>
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="xs">
          {firstPrompt}
        </Code>
        <CopyBlock value={firstPrompt} label="Copy first-chat prompt" />
        <Divider my="xs" />
        <Text size="sm" fw={600}>Verify the skills are working</Text>
        <List size="sm" spacing={4} mt={4}>
          <List.Item>
            Ask Cursor: <em>&quot;I want to add a processing job that summarizes documents. What should I do?&quot;</em> — it should reference AI Admin patterns.
          </List.Item>
          <List.Item>
            Ask Cursor: <em>&quot;Help me write a prompt template for extracting company info as JSON.&quot;</em> — it should apply the prompt engineering skill.
          </List.Item>
        </List>
      </StepCard>
    </Stack>
  );
}

// ──────────────────────────────────────────────────────────────
// Claude Code tab content
// ──────────────────────────────────────────────────────────────

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

function ClaudeTab({ onNavigate }: { onNavigate: (key: string, params?: Record<string, unknown>) => void }) {
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
          open standard — the same files also work in Cursor, Codex, Windsurf, and others. See the Cursor tab for Cursor-specific install paths.
        </Text>
      </Alert>

      {/* Step 1 */}
      <StepCard n={1} title="Download the skills and reference docs">
        <Text size="sm">Skills auto-activate in Claude Code when you ask about AI integration or prompt design.</Text>
        <Text size="xs" c="dimmed" mt={4}>
          Project skills (shared with team): <Code>.claude/skills/</Code> &nbsp;|&nbsp; Personal skills (all your projects):{' '}
          <Code>~/.claude/skills/</Code>
        </Text>
        <Stack gap="xs" mt="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">Skills (auto-activate)</Text>
          <Button component="a" href={INTEGRATION_SKILL_URL} download="SKILL.md" leftSection={<IconDownload size={18} />} variant="filled" color="violet" fullWidth>
            ai-admin-integration / SKILL.md
          </Button>
          <Button component="a" href={PROMPT_SKILL_URL} download="SKILL.md" leftSection={<IconDownload size={18} />} variant="filled" color="violet" fullWidth>
            prompt-engineering / SKILL.md
          </Button>
          <Button component="a" href={PROMPT_FRAMEWORKS_URL} download="frameworks.md" leftSection={<IconDownload size={18} />} variant="light" color="violet" fullWidth>
            prompt-engineering / references / frameworks.md
          </Button>
          <Button component="a" href={PROMPT_AUDIT_URL} download="audit-checklist.md" leftSection={<IconDownload size={18} />} variant="light" color="violet" fullWidth>
            prompt-engineering / references / audit-checklist.md
          </Button>
        </Stack>
        <Stack gap="xs" mt="sm">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">Reference docs (read on demand)</Text>
          <Button component="a" href={INTEGRATION_DOC_URL} download="INTEGRATION.md" leftSection={<IconDownload size={18} />} variant="subtle" fullWidth>
            Integration guide (.md)
          </Button>
          <Button component="a" href={API_DOC_URL} download="API.md" leftSection={<IconDownload size={18} />} variant="subtle" fullWidth>
            API reference (.md)
          </Button>
          <Button component="a" href={BUILDER_URL} download={BUILDER_FILENAME} leftSection={<IconDownload size={18} />} variant="subtle" fullWidth>
            Workflow builder reference (.md)
          </Button>
          <Button component="a" href={MANIFEST_URL} download="manifest.json" leftSection={<IconDownload size={18} />} variant="subtle" fullWidth>
            Section-level manifest (.json)
          </Button>
        </Stack>
      </StepCard>

      {/* Step 2 */}
      <StepCard n={2} title="Install skills into Claude Code">
        <Text size="sm">
          Place each downloaded <Code>SKILL.md</Code> and its <Code>references/</Code> folder into the matching directory:
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
          In the project you are building with Claude Code, add the following block to your{' '}
          <Code>CLAUDE.md</Code> file (create it at the project root if it doesn&apos;t exist). This gives Claude persistent context about the integration.
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
        <Text size="sm">
          Paste this into a new Claude Code session to orient it before asking for a feature:
        </Text>
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="xs">
          {firstPrompt}
        </Code>
        <CopyBlock value={firstPrompt} label="Copy first-session prompt" />
        <Divider my="xs" />
        <Text size="sm" fw={600}>Verify the skills are working</Text>
        <List size="sm" spacing={4} mt={4}>
          <List.Item>
            Ask Claude: <em>&quot;I want to add a processing job that summarizes documents. What should I do?&quot;</em> — it should reference AI Admin patterns.
          </List.Item>
          <List.Item>
            Ask Claude: <em>&quot;Help me write a prompt template for extracting company info as JSON.&quot;</em> — it should apply the prompt engineering skill.
          </List.Item>
        </List>
      </StepCard>
    </Stack>
  );
}

// ──────────────────────────────────────────────────────────────
// Page root
// ──────────────────────────────────────────────────────────────

interface LovableGuidePageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

export default function LovableGuidePage({ onNavigate }: LovableGuidePageProps) {
  return (
    <Stack gap="xl" maw={820}>
      <PageHeader
        title="Vibe-Coding Tools"
        description="Download integration files and skills for your AI coding tool of choice, then start building AI-powered features against AI Admin."
      />

      <Tabs defaultValue="lovable" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="lovable" leftSection={<IconHeartHandshake size={16} />}>
            Lovable
          </Tabs.Tab>
          <Tabs.Tab value="cursor" leftSection={<IconBrandVscode size={16} />}>
            <Group gap={6}>
              Cursor
              <Badge size="xs" variant="light" color="indigo">+ Windsurf, Codex…</Badge>
            </Group>
          </Tabs.Tab>
          <Tabs.Tab value="claude" leftSection={<IconRobot size={16} />}>
            Claude Code
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="lovable" pt="lg">
          <LovableTab onNavigate={onNavigate} />
        </Tabs.Panel>

        <Tabs.Panel value="cursor" pt="lg">
          <CursorTab onNavigate={onNavigate} />
        </Tabs.Panel>

        <Tabs.Panel value="claude" pt="lg">
          <ClaudeTab onNavigate={onNavigate} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
