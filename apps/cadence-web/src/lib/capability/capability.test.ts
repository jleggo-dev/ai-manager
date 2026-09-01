import { describe, it, expect, vi } from 'vitest';
import { capabilities } from './index.ts';
import { webCapabilities } from './web.ts';

describe('capability seam — platform selection', () => {
  it('resolves to the web implementations outside the Capacitor shell', () => {
    // jsdom is a plain browser context: isNativePlatform() must be false, so the seam
    // hands back the exact web object (no native plugin code on any web path).
    expect(capabilities).toBe(webCapabilities);
  });
});

describe('capability seam — push notifications on web', () => {
  it('reports unavailable and hands back an inert unsubscribe — no APNs, nothing ever fires', () => {
    // The guard App.tsx's push-arrival wiring relies on (Gap 6): the web build subscribes
    // through the same seam and must get a listener that never fires and a teardown that
    // never throws — not a crash for want of a Capacitor plugin.
    expect(capabilities.push.isAvailable()).toBe(false);
    const handler = vi.fn();
    const unsubscribe = capabilities.push.onNotification(handler);
    expect(handler).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});

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
