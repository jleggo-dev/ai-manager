/**
 * Molecule – StepVariableMapper
 * Full-page step editor with drag-and-drop input variable mapping
 * and output variable naming.
 */
import { useMemo } from 'react';
import {
  Stack,
  Group,
  TextInput,
  Select,
  Switch,
  Text,
  Paper,
  Badge,
  Table,
  ActionIcon,
  Tooltip,
  Title,
  Divider,
  Box,
} from '@mantine/core';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { IconGripVertical, IconX, IconArrowRight, IconCircleFilled, IconListCheck } from '@tabler/icons-react';
import { useState } from 'react';
import { slugify } from '../../lib/slugify';
import type { ProcessingJob, WorkflowStepConfig } from '../../types/api';

export interface AvailableVariable {
  name: string;
  source: string;
}

interface StepFormData {
  _uid: string;
  step_key: string;
  name: string;
  processing_job_id: string | null;
  is_required?: boolean;
  depends_on: string[];
  config: WorkflowStepConfig;
}

interface Props {
  step: StepFormData;
  stepIndex: number;
  jobs: ProcessingJob[];
  allStepKeys: string[];
  availableVars: AvailableVariable[];
  onUpdate: (updates: Partial<StepFormData>) => void;
}

/* ── Draggable variable card ──────────────────────────────── */

function DraggableVar({ variable }: { variable: AvailableVariable }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `drag-${variable.name}`,
    data: { varName: variable.name },
  });

  return (
    <Paper
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      p="xs"
      withBorder
      style={{
        cursor: 'grab',
        opacity: isDragging ? 0.4 : 1,
        userSelect: 'none',
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <IconGripVertical size={14} opacity={0.4} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={600} truncate="end">
            {variable.name}
          </Text>
          <Badge size="xs" variant="light" color="blue">
            {variable.source}
          </Badge>
        </div>
      </Group>
    </Paper>
  );
}

/* ── Droppable mapping cell ───────────────────────────────── */

function DropZone({
  jobVarName,
  mappedValue,
  availableVars,
  onClear,
}: {
  jobVarName: string;
  mappedValue: string | undefined;
  availableVars: AvailableVariable[];
  onClear: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: `drop-${jobVarName}` });
  const sourceVar = mappedValue ? availableVars.find((v) => v.name === mappedValue) : null;

  if (mappedValue) {
    return (
      <Group ref={setNodeRef} gap={4} wrap="nowrap">
        <Badge
          size="lg"
          variant="filled"
          color="green"
          rightSection={
            <ActionIcon
              variant="transparent"
              size="xs"
              c="white"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
            >
              <IconX size={12} />
            </ActionIcon>
          }
          style={{ maxWidth: 180 }}
        >
          <Text size="xs" truncate="end">
            {mappedValue}
          </Text>
        </Badge>
        {sourceVar && (
          <Text size="xs" c="dimmed" truncate="end">
            {sourceVar.source}
          </Text>
        )}
      </Group>
    );
  }

  return (
    <Box
      ref={setNodeRef}
      p="xs"
      style={(theme) => ({
        border: `2px dashed ${isOver ? theme.colors.blue[5] : theme.colors.dark[4]}`,
        borderRadius: theme.radius.sm,
        background: isOver ? theme.colors.dark[5] : 'transparent',
        minHeight: 36,
        display: 'flex',
        alignItems: 'center',
        transition: 'all 150ms ease',
      })}
    >
      <Text size="xs" c="dimmed">
        {isOver ? 'Drop here' : 'Drag variable here'}
      </Text>
    </Box>
  );
}

/* ── Main component ───────────────────────────────────────── */

export default function StepVariableMapper({ step, stepIndex, jobs, allStepKeys, availableVars, onUpdate }: Props) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const selectedJob = useMemo(() => jobs.find((j) => j.id === step.processing_job_id), [jobs, step.processing_job_id]);
  const jobInputVars = selectedJob?.config?.variables || [];
  const jobOutputFields = useMemo(
    () => Object.entries(selectedJob?.config?.expectedSchema?.fields || {}),
    [selectedJob],
  );

  const inputMappings = step.config?.inputMappings || {};
  const outputMappings = step.config?.outputMappings || {};

  const jobOptions = jobs.map((j) => ({ value: j.id, label: `${j.name} (${j.slug})` }));
  const depOptions = allStepKeys.filter((k) => k !== step.step_key).map((k) => ({ value: k, label: k }));

  function updateInputMapping(jobVar: string, workflowVar: string | null) {
    const updated = { ...inputMappings };
    if (workflowVar) updated[jobVar] = workflowVar;
    else delete updated[jobVar];
    onUpdate({ config: { ...step.config, inputMappings: updated } });
  }

  function sanitizeVarName(raw: string): string {
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_')
      .replace(/(^_|_$)/g, '');
  }

  function updateOutputMapping(outputField: string, rawValue: string) {
    const updated = { ...outputMappings };
    const sanitized = sanitizeVarName(rawValue);
    if (sanitized) updated[outputField] = sanitized;
    else delete updated[outputField];
    onUpdate({ config: { ...step.config, outputMappings: updated } });
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const varName = (active.data.current as { varName: string })?.varName;
    const dropId = over.id as string;
    if (!varName || !dropId.startsWith('drop-')) return;

    const jobVar = dropId.replace('drop-', '');
    updateInputMapping(jobVar, varName);
  }

  const activeDragVar = activeDragId ? availableVars.find((v) => `drag-${v.name}` === activeDragId) : null;

  const mappedCount = jobInputVars.filter((v) => inputMappings[v.name]).length;
  const unmappedCount = jobInputVars.length - mappedCount;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <Stack gap="md">
        <Group gap="sm">
          <IconListCheck size={20} opacity={0.6} />
          <Title order={4}>
            Step {stepIndex + 1}: {step.name || '(unnamed)'}
          </Title>
        </Group>

        {/* Step metadata */}
        <Paper p="md" withBorder>
          <Group gap="sm" wrap="wrap" align="flex-end">
            <TextInput
              label="Step Key"
              placeholder="generate-timeline"
              value={step.step_key}
              onChange={(e) => onUpdate({ step_key: slugify(e.target.value) || e.target.value })}
              style={{ flex: '1 1 160px' }}
              required
            />
            <TextInput
              label="Name"
              placeholder="Generate Timeline"
              value={step.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              style={{ flex: '1 1 200px' }}
              required
            />
            <Select
              label="Processing Job"
              placeholder="Select a job"
              data={jobOptions}
              value={step.processing_job_id}
              onChange={(v) => onUpdate({ processing_job_id: v })}
              searchable
              style={{ flex: '2 1 260px' }}
              required
            />
            <Select
              label="Depends on"
              placeholder="None"
              data={depOptions}
              value={step.depends_on?.[0] || null}
              onChange={(v) => onUpdate({ depends_on: v ? [v] : [] })}
              clearable
              style={{ flex: '1 1 150px' }}
            />
            <Switch
              label="Required"
              checked={step.is_required || false}
              onChange={(e) => onUpdate({ is_required: e.currentTarget.checked })}
              mt={24}
            />
          </Group>
        </Paper>

        {!selectedJob && (
          <Paper p="lg" withBorder ta="center">
            <Text c="dimmed">Select a processing job above to configure variable mappings.</Text>
          </Paper>
        )}

        {/* Input mapping section */}
        {selectedJob && jobInputVars.length > 0 && (
          <>
            <Divider
              label={
                <Group gap="xs">
                  <Text size="sm" fw={600}>
                    Input Mapping
                  </Text>
                  {unmappedCount > 0 && (
                    <Badge size="xs" color="orange" variant="light">
                      {unmappedCount} unmapped
                    </Badge>
                  )}
                  {unmappedCount === 0 && mappedCount > 0 && (
                    <Badge size="xs" color="green" variant="light">
                      All mapped
                    </Badge>
                  )}
                </Group>
              }
              labelPosition="center"
            />

            <Group align="flex-start" gap="md" wrap="nowrap" style={{ minHeight: 200 }}>
              {/* Available variables panel */}
              <Paper p="sm" withBorder style={{ flex: '0 0 220px', maxHeight: 500, overflow: 'auto' }}>
                <Text size="xs" fw={600} mb="xs">
                  Available at this step ({availableVars.length})
                </Text>
                <Stack gap={6}>
                  {availableVars.length === 0 && (
                    <Text size="xs" c="dimmed">
                      No variables available. Define workflow input variables in the Application Call panel, or add
                      output mappings to earlier steps.
                    </Text>
                  )}
                  {availableVars.map((v) => (
                    <DraggableVar key={v.name} variable={v} />
                  ))}
                </Stack>
              </Paper>

              {/* Arrow */}
              <Stack justify="center" style={{ alignSelf: 'center' }}>
                <IconArrowRight size={20} opacity={0.3} />
              </Stack>

              {/* Job expects table */}
              <Paper p="sm" withBorder style={{ flex: 1 }}>
                <Text size="xs" fw={600} mb="xs">
                  Job Expects ({jobInputVars.length} inputs)
                </Text>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 20 }} />
                      <Table.Th>Variable</Table.Th>
                      <Table.Th>Description</Table.Th>
                      <Table.Th>Mapped From</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {jobInputVars.map((v) => {
                      const isMapped = !!inputMappings[v.name];
                      return (
                        <Table.Tr key={v.name}>
                          <Table.Td>
                            <Tooltip label={isMapped ? 'Mapped' : 'Unmapped'}>
                              <IconCircleFilled
                                size={10}
                                color={isMapped ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-orange-6)'}
                              />
                            </Tooltip>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" fw={500}>
                              {v.label || v.name}
                            </Text>
                            {v.label && (
                              <Text size="xs" c="dimmed">
                                {v.name}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {v.description || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td style={{ minWidth: 180 }}>
                            <DropZone
                              jobVarName={v.name}
                              mappedValue={inputMappings[v.name]}
                              availableVars={availableVars}
                              onClear={() => updateInputMapping(v.name, null)}
                            />
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Paper>
            </Group>
          </>
        )}

        {/* Output mapping section */}
        {selectedJob && jobOutputFields.length > 0 && (
          <>
            <Divider label="Job Outputs" labelPosition="center" />

            <Text size="xs" c="dimmed">
              Output field names are defined by the processing job. Assign workflow variable names so later steps can
              consume them via input mappings.
            </Text>

            <Paper p="sm" withBorder>
              <Text size="xs" fw={600} mb="xs">
                This step produces ({jobOutputFields.length} outputs)
              </Text>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Output Field (from job)</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Workflow Variable Name</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {jobOutputFields.map(([field, schema]) => (
                    <Table.Tr key={field}>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {field}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" variant="outline" color="gray">
                          {schema.type || 'any'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <TextInput
                          placeholder="e.g. project_timeline"
                          value={outputMappings[field] || ''}
                          onChange={(e) => updateOutputMapping(field, e.target.value)}
                          size="xs"
                          style={{ maxWidth: 250 }}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          </>
        )}
      </Stack>

      <DragOverlay>
        {activeDragVar && (
          <Paper p="xs" withBorder shadow="md" style={{ cursor: 'grabbing' }}>
            <Group gap="xs">
              <IconGripVertical size={14} opacity={0.4} />
              <Text size="sm" fw={600}>
                {activeDragVar.name}
              </Text>
            </Group>
          </Paper>
        )}
      </DragOverlay>
    </DndContext>
  );
}
