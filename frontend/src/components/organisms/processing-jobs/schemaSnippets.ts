/**
 * Prompt-ready snippet builders + clipboard helper shared by
 * VariablesReference and ResponseSchemaViewer. Moved verbatim out of
 * ProcessingJobManager.tsx as part of the FE-01 split — no logic change.
 */

import { notifications } from '@mantine/notifications';
import type { SchemaFieldDefExtended } from './types';

/** Build a prompt-ready snippet for a single response field. */
export function buildFieldSnippet(name: string, def: SchemaFieldDefExtended) {
  if (def.type === 'array' && def.items?.type === 'object' && def.items.fields) {
    const subLines = Object.entries(def.items.fields)
      .map(
        ([sn, sd]) =>
          `      "${sn}": "${(sd as SchemaFieldDefExtended).type}${(sd as SchemaFieldDefExtended).required ? ' (required)' : ''} — ${(sd as SchemaFieldDefExtended).description || ''}"`,
      )
      .join(',\n');
    return `"${name}": [\n  {\n${subLines}\n  }\n]`;
  }
  const req = def.required ? ' (required)' : '';
  return `"${name}": "${def.type}${req} — ${def.description || ''}"`;
}

/** Build the full schema as a prompt-ready JSON block. */
export function buildFullSchemaSnippet(fields: Record<string, SchemaFieldDefExtended>) {
  const lines = Object.entries(fields).map(([name, def]) => {
    if (def.type === 'array' && def.items?.type === 'object' && def.items.fields) {
      const subLines = Object.entries(def.items.fields)
        .map(([sn, sd]) => `      "${sn}": "${sd.type}${sd.required ? ' (required)' : ''} — ${sd.description || ''}"`)
        .join(',\n');
      return `  "${name}": [\n    {\n${subLines}\n    }\n  ]`;
    }
    const req = def.required ? ' (required)' : '';
    return `  "${name}": "${def.type}${req} — ${def.description || ''}"`;
  });
  return `{\n${lines.join(',\n')}\n}`;
}

/** Copy text to clipboard with a notification. */
export function copyToClipboard(text: string, label: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      notifications.show({ title: 'Copied', message: `${label} copied to clipboard`, color: 'teal', autoClose: 2000 });
    })
    .catch(() => {
      notifications.show({ title: 'Copy failed', message: 'Could not access clipboard', color: 'red' });
    });
}
