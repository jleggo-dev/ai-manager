import { Group, Button, Textarea, Collapse, Stack } from '@mantine/core';
import { IconUpload } from '@tabler/icons-react';

interface ManageLlmsBulkImportProps {
  bulkOpened: boolean;
  bulkText: string;
  bulkImporting: boolean;
  onToggle: () => void;
  onBulkTextChange: (value: string) => void;
  onImport: () => void;
}

export function ManageLlmsBulkImport({
  bulkOpened,
  bulkText,
  bulkImporting,
  onToggle,
  onBulkTextChange,
  onImport,
}: ManageLlmsBulkImportProps) {
  return (
    <>
      <Group gap="xs">
        <Button variant="light" size="xs" leftSection={<IconUpload size={12} />} onClick={onToggle}>
          {bulkOpened ? 'Hide Bulk Import' : 'Bulk Import'}
        </Button>
      </Group>

      <Collapse in={bulkOpened}>
        <Stack gap="xs">
          <Textarea
            label="Paste model IDs (one per line)"
            placeholder={'gpt-5.3-codex\nanthropic-claude-4-sonnet\ngemini-3-pro'}
            value={bulkText}
            onChange={(e) => onBulkTextChange(e.target.value)}
            minRows={4}
            maxRows={8}
            styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
          />
          <Group justify="flex-end">
            <Button size="xs" onClick={onImport} loading={bulkImporting} disabled={!bulkText.trim()}>
              Import {bulkText.split('\n').filter((l) => l.trim()).length} model(s)
            </Button>
          </Group>
        </Stack>
      </Collapse>
    </>
  );
}
