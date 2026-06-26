/**
 * Molecule – WorkflowStepSidebar
 * Vertical navigation sidebar for the workflow editor.
 * Shows "Application Call" entry at top, each step, and an Add Step button.
 */
import { Stack, UnstyledButton, Text, Badge, Group, ActionIcon, Tooltip, Paper } from '@mantine/core';
import { IconPlus, IconPhoneCall, IconArrowUp, IconArrowDown, IconTrash } from '@tabler/icons-react';

export interface SidebarStepItem {
  _uid: string;
  step_key: string;
  name: string;
  processing_job_id: string | null;
  is_required?: boolean;
}

interface Props {
  steps: SidebarStepItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddStep: () => void;
  onMoveStep: (index: number, direction: number) => void;
  onRemoveStep: (index: number) => void;
}

export default function WorkflowStepSidebar({
  steps,
  selectedId,
  onSelect,
  onAddStep,
  onMoveStep,
  onRemoveStep,
}: Props) {
  const isAppCallSelected = selectedId === null;

  return (
    <Stack gap="xs" w={210} miw={210}>
      <UnstyledButton
        onClick={() => onSelect(null)}
        p="sm"
        style={(theme) => ({
          borderRadius: theme.radius.sm,
          border: `2px solid ${isAppCallSelected ? theme.colors.blue[6] : theme.colors.dark[4]}`,
          background: isAppCallSelected ? theme.colors.dark[5] : 'transparent',
          transition: 'border-color 150ms ease',
        })}
      >
        <Group gap="xs">
          <IconPhoneCall size={16} opacity={0.7} />
          <div>
            <Text size="sm" fw={600}>
              Application Call
            </Text>
            <Text size="xs" c="dimmed">
              Workflow config
            </Text>
          </div>
        </Group>
      </UnstyledButton>

      {steps.map((step, i) => {
        const isSelected = selectedId === step._uid;
        return (
          <Paper
            key={step._uid}
            p="xs"
            style={(theme) => ({
              border: `2px solid ${isSelected ? theme.colors.blue[6] : theme.colors.dark[4]}`,
              background: isSelected ? theme.colors.dark[5] : 'transparent',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
              borderRadius: theme.radius.sm,
            })}
            onClick={() => onSelect(step._uid)}
          >
            <Group justify="space-between" gap={4} wrap="nowrap">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="xs" fw={600} truncate="end">
                  Step {i + 1}
                  {step.name ? `: ${step.name}` : ''}
                </Text>
                {step.step_key && (
                  <Text size="xs" c="dimmed" truncate="end">
                    {step.step_key}
                  </Text>
                )}
                <Group gap={4} mt={2}>
                  {!step.processing_job_id && (
                    <Badge size="xs" color="orange" variant="light">
                      No job
                    </Badge>
                  )}
                  {step.is_required && (
                    <Badge size="xs" variant="dot" color="blue">
                      Required
                    </Badge>
                  )}
                </Group>
              </div>
              <Stack gap={0}>
                <Tooltip label="Move up" position="left" withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="xs"
                    disabled={i === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveStep(i, -1);
                    }}
                  >
                    <IconArrowUp size={12} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Move down" position="left" withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="xs"
                    disabled={i === steps.length - 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveStep(i, 1);
                    }}
                  >
                    <IconArrowDown size={12} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Remove step" position="left" withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="xs"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveStep(i);
                    }}
                  >
                    <IconTrash size={12} />
                  </ActionIcon>
                </Tooltip>
              </Stack>
            </Group>
          </Paper>
        );
      })}

      <UnstyledButton
        onClick={onAddStep}
        p="sm"
        style={(theme) => ({
          borderRadius: theme.radius.sm,
          border: `2px dashed ${theme.colors.dark[4]}`,
          textAlign: 'center',
          transition: 'border-color 150ms ease',
          '&:hover': { borderColor: theme.colors.blue[6] },
        })}
      >
        <Group gap={4} justify="center">
          <IconPlus size={14} />
          <Text size="sm" c="dimmed">
            Add Step
          </Text>
        </Group>
      </UnstyledButton>
    </Stack>
  );
}
