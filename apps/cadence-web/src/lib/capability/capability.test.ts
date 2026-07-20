import { describe, it, expect, vi } from 'vitest';
import { capabilities } from './index.ts';

describe('capability seam — dictation', () => {
  it('reports unavailable and returns null sessions when SpeechRecognition is missing', () => {
    const w = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    const prev = { SpeechRecognition: w.SpeechRecognition, webkitSpeechRecognition: w.webkitSpeechRecognition };
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;

    expect(capabilities.dictation.isAvailable()).toBe(false);
    expect(capabilities.dictation.createSession()).toBeNull();

    w.SpeechRecognition = prev.SpeechRecognition;
    w.webkitSpeechRecognition = prev.webkitSpeechRecognition;
  });

  it('creates a session when a SpeechRecognition constructor is present', () => {
    const start = vi.fn();
    const Ctor = vi.fn(function (this: { start: () => void }) {
      this.start = start;
    });
    const w = window as unknown as { SpeechRecognition?: unknown };
    const prev = w.SpeechRecognition;
    w.SpeechRecognition = Ctor;

    expect(capabilities.dictation.isAvailable()).toBe(true);
    const session = capabilities.dictation.createSession();
    expect(Ctor).toHaveBeenCalled();
    expect(session).toBeTruthy();
    session?.start();
    expect(start).toHaveBeenCalled();

    w.SpeechRecognition = prev;
  });
});
