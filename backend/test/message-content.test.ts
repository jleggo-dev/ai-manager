import { describe, it, expect } from 'vitest';
import {
  contentText,
  textFileBlock,
  toOpenAiWireMessages,
  withAttachmentParts,
  withImageParts,
} from '../src/lib/message-content.ts';

/**
 * The one seam where a turn's attachments become content parts (owner, 2026-09-11: files and
 * photos on the coach chat). Every provider dialect is built from this shape, so its rules are
 * pinned here: text first, then images, then documents; text-bearing files become prose; a file
 * with nothing to send is dropped; and nothing here ever inlines an image.
 */
describe('withAttachmentParts', () => {
  it('stays a plain string when there is nothing but the text', () => {
    expect(withAttachmentParts('hi', [], [])).toBe('hi');
    expect(withAttachmentParts('hi', [], [{ filename: 'x.pdf', mimeType: 'application/pdf' }])).toBe('hi');
  });

  it('orders text, then images, then documents', () => {
    const content = withAttachmentParts(
      'look',
      ['https://s/1.jpg'],
      [{ filename: 'labs.pdf', mimeType: 'application/pdf', fileId: 'file_1' }],
    );
    expect(content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', url: 'https://s/1.jpg' },
      { type: 'file', filename: 'labs.pdf', mimeType: 'application/pdf', fileId: 'file_1' },
    ]);
  });

  it('turns a text-bearing file into a labelled text part, never a file part', () => {
    const content = withAttachmentParts('see', [], [{ filename: 'log.csv', mimeType: 'text/csv', text: 'a,b\n1,2' }]);
    expect(content).toEqual([
      { type: 'text', text: 'see' },
      { type: 'text', text: '--- log.csv ---\na,b\n1,2' },
    ]);
    expect(textFileBlock({ filename: 'n.md', text: 'x' })).toBe('--- n.md ---\nx');
  });

  it('withImageParts is the images-only special case', () => {
    expect(withImageParts('t', ['u'])).toEqual(withAttachmentParts('t', ['u'], []));
  });

  it('contentText reads the text parts only — a file part contributes nothing', () => {
    const content = withAttachmentParts('a', ['u'], [{ filename: 'f.pdf', mimeType: 'application/pdf', data: 'QUJD' }]);
    expect(contentText(content)).toBe('a');
  });
});

describe('toOpenAiWireMessages', () => {
  it('maps a file part to the chat-completions `file` shape by id or as a data URL', () => {
    const wire = toOpenAiWireMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 't' },
          { type: 'file', filename: 'a.pdf', mimeType: 'application/pdf', fileId: 'file_a' },
          { type: 'file', filename: 'b.pdf', mimeType: 'application/pdf', data: 'QUJD' },
        ],
      },
    ]);
    expect(wire[0]?.content).toEqual([
      { type: 'text', text: 't' },
      { type: 'file', file: { filename: 'a.pdf', file_id: 'file_a' } },
      { type: 'file', file: { filename: 'b.pdf', file_data: 'data:application/pdf;base64,QUJD' } },
    ]);
  });
});
