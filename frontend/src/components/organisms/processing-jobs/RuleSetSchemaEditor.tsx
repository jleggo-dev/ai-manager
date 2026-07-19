/**
 * Inline JSON editor for a rule set's expected response schema. Moved
 * verbatim out of ProcessingJobManager.tsx as part of the FE-01 split.
 */

import { useState } from 'react';
import { Stack, Group, Button, Textarea, Text, Code, Paper } from '@mantine/core';
import ResponseSchemaViewer from './ResponseSchemaViewer';
import type { ExpectedSchema } from './types';

export default function RuleSetSchemaEditor({
  schema,
  onChange,
}: {
  schema: ExpectedSchema | null;
  onChange: (schema: ExpectedSchema | null) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const hasSchema = schema && typeof schema === 'object' && schema.fields && Object.keys(schema.fields).length > 0;

  function startEditing() {
    setJsonText(
      hasSchema
        ? JSON.stringify(schema, null, 2)
        : JSON.stringify(
            {
              fields: {
                example_field: {
                  label: 'Example Field',
                  type: 'single',
                  required: true,
                  description: 'Description of this field',
                  allowedValues: null,
                },
              },
            },
            null,
            2,
          ),
    );
    setParseError(null);
    setIsEditing(true);
  }

  function handleSaveSchema() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed.fields || typeof parsed.fields !== 'object') {
        setParseError('Schema must have a "fields" object at the top level.');
        return;
      }
      setParseError(null);
      onChange(parsed);
      setIsEditing(false);
    } catch (err: unknown) {
      setParseError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (hasSchema && !isEditing) {
    return (
      <Stack gap="xs">
        <ResponseSchemaViewer expectedSchema={schema} />
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={startEditing}>
            Edit Schema JSON
          </Button>
          <Button size="xs" variant="subtle" color="red" onClick={() => onChange(null)}>
            Remove Schema
          </Button>
        </Group>
      </Stack>
    );
  }

  if (isEditing) {
    return (
      <Stack gap="xs">
        <Textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          autosize
          minRows={8}
          maxRows={25}
          styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
          error={parseError}
        />
        <Text size="xs" c="dimmed">
          Define the fields the AI should return. Each field needs: <Code>label</Code>, <Code>type</Code>{' '}
          (single/multi/array), <Code>required</Code> (true/false), and optionally <Code>allowedValues</Code> (array or
          null for free-text) and <Code>description</Code>.
        </Text>
        <Group gap="xs">
          <Button size="xs" onClick={handleSaveSchema}>
            Apply Schema
          </Button>
          <Button size="xs" variant="subtle" onClick={() => setIsEditing(false)}>
            Cancel
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Paper withBorder p="sm" style={{ borderStyle: 'dashed' }}>
      <Group justify="space-between">
        <Stack gap={2}>
          <Text size="sm" c="dimmed">
            No response schema defined for this rule set.
          </Text>
          <Text size="xs" c="dimmed">
            Define a schema to validate and structure AI JSON responses — same format as Build Rules.
          </Text>
        </Stack>
        <Button size="xs" variant="light" onClick={startEditing}>
          Add Schema
        </Button>
      </Group>
    </Paper>
  );
}
