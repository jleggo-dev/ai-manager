/**
 * Molecule – WorkflowHelpDrawer
 * ------------------------------
 * Contextual help drawer explaining how workflows, variables,
 * dependencies, and testing work in AI Admin.
 */

import { Drawer, Stack, Text, Title, Code, Table, Paper, Divider, Badge, Group, Anchor } from '@mantine/core';

interface Props {
  opened: boolean;
  onClose: () => void;
}

export default function WorkflowHelpDrawer({ opened, onClose }: Props) {
  return (
    <Drawer opened={opened} onClose={onClose} title="Workflow Guide" position="right" size="lg" padding="lg">
      <Stack gap="md">
        <section>
          <Title order={4} mb="xs">
            What is a Workflow?
          </Title>
          <Text size="sm">
            A workflow groups multiple <strong>Processing Jobs</strong> into ordered steps within a single chat session.
            Each step has its own prompt template and variables, but the AI retains full conversation context across all
            steps.
          </Text>
          <Paper p="sm" mt="xs" withBorder>
            <Group gap="xs" wrap="nowrap">
              <Badge variant="light" size="sm">
                Workflow
              </Badge>
              <Text size="xs" c="dimmed">
                →
              </Text>
              <Badge variant="outline" size="sm">
                Step 1 (Job A)
              </Badge>
              <Text size="xs" c="dimmed">
                →
              </Text>
              <Badge variant="outline" size="sm">
                Step 2 (Job B)
              </Badge>
              <Text size="xs" c="dimmed">
                →
              </Text>
              <Badge variant="outline" size="sm">
                Step 3 (Job C)
              </Badge>
            </Group>
          </Paper>
        </section>

        <Divider />

        <section>
          <Title order={4} mb="xs">
            How Variables Work
          </Title>
          <Text size="sm" mb="xs">
            Each step uses the variables defined by its linked Processing Job. The caller sends <Code>variables</Code>{' '}
            with each step invocation.
          </Text>
          <Table withTableBorder style={{ fontSize: 13 }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Source</Table.Th>
                <Table.Th>Description</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>
                  <Badge size="xs" variant="light" color="gray">
                    user
                  </Badge>
                </Table.Td>
                <Table.Td>Provided by the calling application for each step request</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  <Badge size="xs" variant="light" color="violet">
                    pipeline
                  </Badge>
                </Table.Td>
                <Table.Td>Provided automatically by the system or upstream integration</Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          <Text size="sm" c="dimmed" mt="xs">
            The <strong>Variable Flow</strong> panel in the workflow detail view shows which variables appear at each
            step and their source.
          </Text>
        </section>

        <Divider />

        <section>
          <Title order={4} mb="xs">
            Dependencies
          </Title>
          <Text size="sm">
            Steps can depend on other steps via the <strong>Depends On</strong> field. A step with unmet dependencies
            returns a <Code>400</Code> error when triggered.
          </Text>
          <Text size="sm" mt="xs">
            A step is &quot;completed&quot; once a user message with that step&apos;s key has been recorded in the chat
            history — it does not require the assistant to finish replying.
          </Text>
        </section>

        <Divider />

        <section>
          <Title order={4} mb="xs">
            Cross-Step Context
          </Title>
          <Text size="sm">
            The AI sees the <strong>full conversation history</strong> from all previous steps and free-form messages.
            This means structured responses from earlier steps inform later ones through the LLM&apos;s context window —
            not through explicit variable passing.
          </Text>
          <Text size="sm" mt="xs" fw={500}>
            Tip: Structure step outputs as JSON so downstream steps can reference specific fields from the conversation.
          </Text>
        </section>

        <Divider />

        <section>
          <Title order={4} mb="xs">
            Testing Workflows
          </Title>
          <Text size="sm">
            Use the <strong>Test Workflow</strong> feature to simulate execution:
          </Text>
          <Stack gap={4} mt="xs">
            <Text size="sm">
              • <strong>Dry Run</strong> — previews interpolated prompts using each job&apos;s test data without calling
              the LLM. Great for verifying variable coverage and prompt construction.
            </Text>
            <Text size="sm">
              • <strong>Live Run</strong> — executes each step against the real LLM, showing streaming responses and
              token usage. Use this for end-to-end verification.
            </Text>
          </Stack>
          <Text size="sm" c="dimmed" mt="xs">
            Each Processing Job&apos;s <strong>Test Data</strong> (configured in Jobs → Build Rules) provides default
            values for the simulation.
          </Text>
        </section>

        <Divider />

        <section>
          <Title order={4} mb="xs">
            Integration Pattern
          </Title>
          <Text size="sm">From your Edge Function or API client:</Text>
          <Code block style={{ fontSize: 11, marginTop: 8 }}>
            {`// 1. Open a session with the workflow
{ "mode": "open-chat-session",
  "workflowSlug": "my-workflow",
  "callingApplication": "lovable:my-app" }

// 2. Trigger steps (or send free-form messages)
{ "mode": "send-chat-message-stream",
  "sessionId": "<id>",
  "stepKey": "generate-timeline",
  "variables": { "productName": "...", "launchDate": "..." } }

// 3. Mix free-form and structured steps freely`}
          </Code>
        </section>

        <Divider />

        <Anchor href="/integration/AI_ADMIN_LOVABLE_INTEGRATION.md" target="_blank" size="sm">
          View Full Integration Documentation →
        </Anchor>
      </Stack>
    </Drawer>
  );
}
