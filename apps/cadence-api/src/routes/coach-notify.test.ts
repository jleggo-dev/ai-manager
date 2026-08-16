import { describe, it, expect } from 'vitest';
import { firstLine } from './coach.ts';

/**
 * The lock-screen body for "Cadence replied".
 *
 * The rule (owner, 2026-08-16) is that leaving a chat always earns a notification when she's done.
 * A notification that says only "you have a reply" makes someone open the app to learn nothing —
 * so the body carries her opening sentence, and has to survive whatever shape a turn comes in.
 */
describe('firstLine', () => {
  it('carries her first sentence, without the punctuation-hunting showing', () => {
    expect(firstLine("Alright, looking at it — 8.8 km in 77 minutes. That's your longest run to date.")).toBe(
      'Alright, looking at it — 8.8 km in 77 minutes.',
    );
  });

  it('flattens the newlines a streamed reply is full of', () => {
    expect(firstLine('Two things.\n\n- one\n- two')).toBe('Two things.');
  });

  it('truncates a sentence too long to be a notification, and says so', () => {
    const out = firstLine(`${'word '.repeat(80)}and then a stop.`);
    expect(out.length).toBeLessThanOrEqual(141);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves a short reply with no terminator exactly as she wrote it', () => {
    expect(firstLine('Got it')).toBe('Got it');
  });

  it('is not fooled by a decimal into stopping mid-number', () => {
    expect(firstLine('You ran 8.8 km today. Nice work.')).toBe('You ran 8.8 km today.');
  });

  it('survives an empty or whitespace-only reply rather than throwing', () => {
    expect(firstLine('   \n  ')).toBe('');
  });
});
