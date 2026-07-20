import {
  Stack,
  Group,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  TextInput,
  Select,
  Textarea,
  Center,
  Paper,
  Grid,
  ScrollArea,
  Divider,
  Box,
} from '@mantine/core';
import { IconChevronRight, IconArrowUp, IconArrowDown, IconX, IconAlertTriangle } from '@tabler/icons-react';
import type { RuleSet, FormattingRule, AppliedRule } from './types';
import VariablesReference from './VariablesReference';
import RuleSetSchemaEditor from './RuleSetSchemaEditor';

export default function RuleSetEditorPanel({
  rs,
  availableRules,
  onUpdate,
  onAddFormattingRule,
  onRemoveFormattingRule,
  onMoveFormattingRule,
  onUpdateFormattingRuleOptions,
}: {
  rs: RuleSet;
  availableRules: FormattingRule[];
  onUpdate: (patch: Partial<RuleSet>) => void;
  onAddFormattingRule: (ruleType: string) => void;
  onRemoveFormattingRule: (ruleIdx: number) => void;
  onMoveFormattingRule: (ruleIdx: number, direction: number) => void;
  onUpdateFormattingRuleOptions: (ruleIdx: number, options: Record<string, unknown>) => void;
}) {
  return (
    <>
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
              onChange={(e) => onUpdate({ key: e.target.value })}
              styles={{ input: { fontFamily: 'monospace' } }}
            />
          </Grid.Col>
          <Grid.Col span={4}>
            <TextInput
              label="Name"
              description="Human-readable label"
              placeholder="Analyze Company"
              value={rs.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
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
              onChange={(v) => onUpdate({ expectedFormat: v || 'json' })}
            />
          </Grid.Col>
          <Grid.Col span={12}>
            <TextInput
              label="Description"
              placeholder="Describe what this rule set does"
              value={rs.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
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
              onChange={(schema) => onUpdate({ expectedSchema: schema })}
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
          onChange={(e) => onUpdate({ promptTemplate: e.target.value })}
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
                      onClick={() => onAddFormattingRule(rule.type)}
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
                                    onChange={(e) => onUpdateFormattingRuleOptions(rIdx, { tagName: e.target.value })}
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
                                onClick={() => onMoveFormattingRule(rIdx, -1)}
                                disabled={rIdx === 0}
                              >
                                <IconArrowUp size={12} />
                              </ActionIcon>
                              <ActionIcon
                                size="xs"
                                variant="subtle"
                                onClick={() => onMoveFormattingRule(rIdx, 1)}
                                disabled={rIdx === rs.formattingRules.length - 1}
                              >
                                <IconArrowDown size={12} />
                              </ActionIcon>
                              <ActionIcon
                                size="xs"
                                variant="subtle"
                                color="red"
                                onClick={() => onRemoveFormattingRule(rIdx)}
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
                      onChange={(e) => onUpdate({ testData: { ...(rs.testData || {}), [v.name]: e.target.value } })}
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
                      onChange={(e) => onUpdate({ testData: { ...(rs.testData || {}), [v.name]: e.target.value } })}
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
    </>
  );
}
