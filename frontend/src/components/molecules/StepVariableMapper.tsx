/**
 * Molecule – StepVariableMapper
 * Full-page step editor with drag-and-drop input variable mapping
 * and output variable naming.
 */
import { useMemo, useState } from 'react';
import { Stack, Group, Text, Paper, Title } from '@mantine/core';
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { IconGripVertical, IconListCheck } from '@tabler/icons-react';
import { InputMappingSection } from './step-variable-mapper/InputMappingSection';
import { OutputMappingSection } from './step-variable-mapper/OutputMappingSection';
import { StepMetadataForm } from './step-variable-mapper/StepMetadataForm';
import { sanitizeVarName } from './step-variable-mapper/helpers';
import type { StepVariableMapperProps } from './step-variable-mapper/types';

export type { AvailableVariable } from './step-variable-mapper/types';

export default function StepVariableMapper({
  step,
  stepIndex,
  jobs,
  allStepKeys,
  availableVars,
  onUpdate,
}: StepVariableMapperProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const selectedJob = useMemo(() => jobs.find((j) => j.id === step.processing_job_id), [jobs, step.processing_job_id]);
  const jobInputVars = selectedJob?.config?.variables || [];
  const jobOutputFields = useMemo(
    () =>
      Object.entries(selectedJob?.config?.expectedSchema?.fields || {}).map(([field, schema]) => ({
        field,
        schema: schema as { type?: string },
      })),
    [selectedJob],
  );

  const inputMappings = step.config?.inputMappings || {};
  const outputMappings = step.config?.outputMappings || {};

  function updateInputMapping(jobVar: string, workflowVar: string | null) {
    const updated = { ...inputMappings };
    if (workflowVar) updated[jobVar] = workflowVar;
    else delete updated[jobVar];
    onUpdate({ config: { ...step.config, inputMappings: updated } });
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

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <Stack gap="md">
        <Group gap="sm">
          <IconListCheck size={20} opacity={0.6} />
          <Title order={4}>
            Step {stepIndex + 1}: {step.name || '(unnamed)'}
          </Title>
        </Group>

        <StepMetadataForm step={step} jobs={jobs} allStepKeys={allStepKeys} onUpdate={onUpdate} />

        {!selectedJob && (
          <Paper p="lg" withBorder ta="center">
            <Text c="dimmed">Select a processing job above to configure variable mappings.</Text>
          </Paper>
        )}

        {selectedJob && jobInputVars.length > 0 && (
          <InputMappingSection
            jobInputVars={jobInputVars}
            availableVars={availableVars}
            inputMappings={inputMappings}
            onUpdateMapping={updateInputMapping}
          />
        )}

        {selectedJob && jobOutputFields.length > 0 && (
          <OutputMappingSection
            outputFields={jobOutputFields}
            outputMappings={outputMappings}
            onUpdateOutput={updateOutputMapping}
          />
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
