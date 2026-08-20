/**
 * Thread mode: when the provider keeps the conversation, a turn sends ONLY what the server thread
 * has not seen — plus the instructions, which the spec says are never carried over between
 * threaded responses. Sending the full transcript beside a thread pointer is not redundancy; the
 * thread wins and the input is ignored (measured 2026-08-16), which is how injected context would
 * silently vanish.
 */
import { describe, it, expect } from 'vitest';
import { sliceForThread } from '../src/ai-manager/thread-mode.ts';
import { v2ThreadingEnabled } from '../src/services/ai-profile-runtime-options.ts';
import type { ChatMessage } from '../src/types.ts';

const m = (role: string, content: string) => ({ role, content }) as ChatMessage;

describe('sliceForThread', () => {
  it('sends the system rows and only what follows the last assistant turn', () => {
    const out = sliceForThread([
      m('system', 'persona'),
      m('user', 'hello'),
      m('assistant', 'hi there'),
      m('user', '<context source="broker">fresh dossier</context>'),
      m('user', 'what should I eat tonight?'),
    ]);
    expect(out.map((x) => x.content)).toEqual([
      'persona',
      '<context source="broker">fresh dossier</context>',
      'what should I eat tonight?',
    ]);
  });

  /**
   * The persona must ride EVERY threaded turn: instructions are not carried over between threaded
   * responses, so leaving system rows behind would strip the coach of her instructions from turn
   * two onward. This is also what keeps a mid-thread persona refresh effective.
   */
  it('keeps every system row wherever it sits, and keeps it first', () => {
    const out = sliceForThread([
      m('system', 'persona'),
      m('user', 'a'),
      m('assistant', 'b'),
      m('system', '[Conversation summary]\nfrom a stateless stretch'),
      m('user', 'c'),
    ]);
    expect(out.map((x) => x.role)).toEqual(['system', 'system', 'user']);
    expect(out[2]?.content).toBe('c');
  });

  it('degenerates to everything when no assistant turn exists yet (a first turn)', () => {
    const msgs = [m('system', 'persona'), m('user', 'context block'), m('user', 'first message')];
    expect(sliceForThread(msgs)).toEqual(msgs);
  });

  it('handles an empty transcript without inventing anything', () => {
    expect(sliceForThread([])).toEqual([]);
  });

  it('sends nothing but instructions when the assistant turn is the newest row', () => {
    const out = sliceForThread([m('system', 'persona'), m('user', 'a'), m('assistant', 'b')]);
    expect(out.map((x) => x.role)).toEqual(['system']);
  });
});

describe('v2ThreadingEnabled', () => {
  it('is OFF by default — stateless full-history is the unflagged behaviour, unchanged', () => {
    expect(v2ThreadingEnabled('devs-ai-v2', {})).toBe(false);
    expect(v2ThreadingEnabled('devs-ai-v2', { devs_ai_v2: {} })).toBe(false);
  });

  it('turns on only for devs-ai-v2 with the flag set', () => {
    expect(v2ThreadingEnabled('devs-ai-v2', { devs_ai_v2: { threading: true } })).toBe(true);
  });

  /** A provider with no server-side thread must never be told to thread, whatever the options say. */
  it('never turns on for another provider, even with the flag present', () => {
    expect(v2ThreadingEnabled('devs-ai', { devs_ai_v2: { threading: true } })).toBe(false);
    expect(v2ThreadingEnabled('google-gemini', { devs_ai_v2: { threading: true } })).toBe(false);
    expect(v2ThreadingEnabled('', { devs_ai_v2: { threading: true } })).toBe(false);
  });
});
