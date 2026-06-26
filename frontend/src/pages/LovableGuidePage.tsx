/**
 * Connect Lovable — streamlined 4-step setup guide.
 * All heavy-lifting lives in downloadable .md / .ts files that
 * Lovable's LLM reads directly; this page just directs the user.
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
} from '@tabler/icons-react';
import PageHeader from '../components/atoms/PageHeader';

const AI_ADMIN_VERSION = '1.1.0';
const AI_ADMIN_URL = 'https://ai-admin.vercel.app';
const HANDBOOK_FILENAME = 'AI_ADMIN_LOVABLE_INTEGRATION.md';
const HANDBOOK_URL = `/integration/${HANDBOOK_FILENAME}`;
const EDGE_FN_FILENAME = 'ai-admin-supabase-edge-function.ts';
const EDGE_FN_URL = `/integration/${EDGE_FN_FILENAME}`;
const BUILDER_FILENAME = 'WORKFLOW_BUILDER_PROMPT.md';
const BUILDER_URL = `/integration/${BUILDER_FILENAME}`;
const TEST_SPEC_FILENAME = 'AI_ADMIN_TEST_PAGE_SPEC.md';
const TEST_SPEC_URL = `/integration/${TEST_SPEC_FILENAME}`;

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

function buildMasterPrompt(apiKey: string, baseUrl: string) {
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

function buildStandingInstructions() {
  return `This project uses AI Admin (v${AI_ADMIN_VERSION}) to power all AI features. When I ask you to add AI, change how AI works, build a workflow, or anything involving AI-powered functionality, read the files in the /docs folder first and follow them.

Docs in /docs:
- ${HANDBOOK_FILENAME} — how the AI integration works (start here)
- ${EDGE_FN_FILENAME} — reference code for the Edge Function
- ${BUILDER_FILENAME} — how to turn a request like "add AI that does X" into jobs and workflows
- ${TEST_SPEC_FILENAME} — how to build a test page to verify it works

If something doesn't work as documented, the docs may be outdated. Ask the user to download the latest files from AI Admin (Connect Lovable page) at ${AI_ADMIN_URL} or check the changelog at ${AI_ADMIN_URL}/docs/CHANGELOG.md for recent changes.`;
}

interface LovableGuidePageProps {
  onNavigate: (key: string, params?: Record<string, unknown>) => void;
  pageParams: Record<string, unknown>;
  workspaceRole?: string | null;
}

export default function LovableGuidePage({ onNavigate, workspaceRole: _workspaceRole }: LovableGuidePageProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  const masterPrompt = useMemo(() => buildMasterPrompt(apiKey, baseUrl), [apiKey, baseUrl]);
  const standingInstructions = useMemo(() => buildStandingInstructions(), []);

  return (
    <Stack gap="xl" maw={820}>
      <PageHeader
        title="Connect Lovable"
        description="Download the integration files, upload them to Lovable, prompt it to build the connection, then verify everything works."
      />

      {/* ── Step 1: Download ──────────────────────────────────────── */}
      <StepCard n={1} title="Download the integration pack">
        <Text size="sm">These files tell Lovable&apos;s AI how to connect to AI Admin. Download all four.</Text>
        <Stack gap="xs" mt="xs">
          <Button
            component="a"
            href={HANDBOOK_URL}
            download={HANDBOOK_FILENAME}
            leftSection={<IconDownload size={18} />}
            variant="filled"
            fullWidth
          >
            Integration handbook (.md)
          </Button>
          <Button
            component="a"
            href={EDGE_FN_URL}
            download={EDGE_FN_FILENAME}
            leftSection={<IconDownload size={18} />}
            variant="light"
            fullWidth
          >
            Edge Function starter code (.ts)
          </Button>
          <Button
            component="a"
            href={BUILDER_URL}
            download={BUILDER_FILENAME}
            leftSection={<IconDownload size={18} />}
            variant="light"
            fullWidth
          >
            Workflow builder reference (.md)
          </Button>
          <Button
            component="a"
            href={TEST_SPEC_URL}
            download={TEST_SPEC_FILENAME}
            leftSection={<IconDownload size={18} />}
            variant="light"
            fullWidth
          >
            Test page spec (.md)
          </Button>
        </Stack>
      </StepCard>

      {/* ── Step 2: Upload & project instructions ────────────────── */}
      <StepCard n={2} title="Upload to Lovable and add project instructions">
        <Text size="sm">
          Upload all four files to your Lovable project. Tell Lovable:{' '}
          <strong>&quot;Store these files in a /docs folder.&quot;</strong>
        </Text>
        <Text size="sm" c="dimmed" mt={4}>
          These files are versioned. If you update AI Admin, re-download the latest from this page to keep your
          integration docs current.
        </Text>
        <Text size="sm" mt="xs">
          Then open your <strong>project instructions</strong> (settings area where Lovable keeps standing rules) and
          paste this:
        </Text>
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="sm">
          {standingInstructions}
        </Code>
        <CopyButton value={standingInstructions} timeout={2000}>
          {({ copied, copy }) => (
            <Button
              leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              onClick={copy}
              variant="light"
            >
              {copied ? 'Copied' : 'Copy project instructions'}
            </Button>
          )}
        </CopyButton>
      </StepCard>

      {/* ── Step 3: Prompt Lovable to build ─────────────────────── */}
      <StepCard n={3} title="Prompt Lovable to build the integration">
        <Text size="sm">
          Create an API key in <strong>Settings → API keys</strong>, then paste it and your AI Admin URL below. The
          prompt tells Lovable to build the Edge Function using the docs you uploaded. Your URL is also used in the
          project instructions (Step 2) so Lovable can direct you to the latest docs if needed.
        </Text>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconSettings size={16} />}
          onClick={() => onNavigate?.('settings', { tab: 'api-keys' })}
        >
          Open Settings → API keys
        </Button>
        <TextInput
          label="Your AI Admin API key"
          placeholder="aim_sk_…"
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
          size="sm"
        />
        <TextInput
          label="Your AI Admin URL"
          placeholder="https://your-ai-admin-domain.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
          size="sm"
        />
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} mt="xs">
          {masterPrompt}
        </Code>
        <CopyButton value={masterPrompt} timeout={2000}>
          {({ copied, copy }) => (
            <Button
              leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              onClick={copy}
              variant="light"
            >
              {copied ? 'Copied' : 'Copy prompt'}
            </Button>
          )}
        </CopyButton>
      </StepCard>

      {/* ── Step 4: Test ─────────────────────────────────────────── */}
      <StepCard n={4} title="Test it">
        <Text size="sm" fw={600}>
          Create two test jobs in AI Admin
        </Text>
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
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconListCheck size={16} />}
          onClick={() => onNavigate?.('processing-jobs')}
        >
          Open Jobs
        </Button>

        <Divider my="xs" />

        <Text size="sm" fw={600}>
          Prompt Lovable to build a test page
        </Text>
        <Text size="sm">Paste this into Lovable&apos;s chat:</Text>
        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }} mt="xs">
          Build an integration test page following the spec in /docs/{TEST_SPEC_FILENAME}
        </Code>
        <CopyButton
          value={`Build an integration test page following the spec in /docs/${TEST_SPEC_FILENAME}`}
          timeout={2000}
        >
          {({ copied, copy }) => (
            <Button
              leftSection={copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              onClick={copy}
              variant="light"
              size="sm"
            >
              {copied ? 'Copied' : 'Copy test page prompt'}
            </Button>
          )}
        </CopyButton>

        <Divider my="xs" />

        <Text size="sm" fw={600}>
          Verification checklist
        </Text>
        <Text size="sm" c="dimmed" mb={4}>
          In Lovable (test page):
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            Smoke test shows <strong>SMOKE_OK</strong>
          </List.Item>
          <List.Item>Variable test response matches the topic and tone you entered</List.Item>
          <List.Item>Streaming test shows text appearing gradually (not all at once)</List.Item>
        </List>
        <Text size="sm" c="dimmed" mt="sm" mb={4}>
          In AI Admin:
        </Text>
        <List size="sm" spacing={4}>
          <List.Item>
            <strong>Jobs</strong> → click your test job → recent test runs appear
          </List.Item>
          <List.Item>
            <strong>Diagnostics</strong> → requests from your calling application show up
          </List.Item>
        </List>
      </StepCard>
    </Stack>
  );
}
