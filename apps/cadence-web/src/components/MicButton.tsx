import { useCallback, useEffect, useRef, useState } from 'react';
import { capabilities } from '../lib/capability/index.ts';
import type { DictationSession } from '../lib/capability/index.ts';
import { joinSpeech } from './joinSpeech.ts';

/**
 * Voice input via the capability seam (Web Speech API on web). Feature-detected:
 * renders NOTHING where dictation isn't available (Firefox, insecure origins) —
 * on real phones the OS keyboard's dictation covers those cases anyway.
 *
 * Composition rule (the classic double-type bug): never append deltas. Capture the field's
 * value at press (base), then every result event recomposes base + finals + current interim.
 * Android Chrome auto-ends on silence and fires onend WITHOUT onerror — button state syncs
 * there. abort() on unmount and when the caller signals send.
 */

const MicIcon = ({ active }: { active: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
    <rect x="5.2" y="1.5" width="4.6" height="8" rx="2.3" fill={active ? '#fff' : 'currentColor'} />
    <path
      className="stroke"
      d="M3 7.5a4.5 4.5 0 0 0 9 0M7.5 12v2"
      stroke={active ? '#fff' : 'currentColor'}
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

export function MicButton({
  value,
  onChange,
  disabled,
  autoStart,
  onListeningChange,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /**
   * Open already listening. Voice is not a separate interface — it is the chat screen with the mic
   * live (design 05c) — so the caller sets this instead of building a second surface.
   */
  autoStart?: boolean;
  /** Told whenever dictation starts or stops, so a caller can keep the control on screen. */
  onListeningChange?: (listening: boolean) => void;
}) {
  const [supported] = useState(() => capabilities.dictation.isAvailable());
  const [listening, setListeningState] = useState(false);
  const wantOnRef = useRef(false);
  const onListeningRef = useRef(onListeningChange);
  onListeningRef.current = onListeningChange;
  const setListening = useCallback((next: boolean) => {
    setListeningState(next);
    onListeningRef.current?.(next);
  }, []);
  const recRef = useRef<DictationSession | null>(null);
  const baseRef = useRef('');
  const aliveRef = useRef(true);
  // Keep the latest value visible to the closure without re-creating the recognizer.
  const valueRef = useRef(value);
  valueRef.current = value;

  // `start` is defined below; the ref lets the auto-start effect reach it without re-ordering the
  // whole component (and it is assigned during render, so it is set before any effect runs).
  const startRef = useRef<() => void>(() => {});

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      recRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (autoStart && supported && !disabled) startRef.current();
    // Once, on open — a re-run would restart a mic the user deliberately stopped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop() {
    wantOnRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      // DETACH before stopping. WebKit can deliver one last final result after `stop()`, and that
      // handler's closure still holds `baseRef` as it was when dictation STARTED. Left attached,
      // the late event recomposes from that stale base and overwrites anything typed since — the
      // user watches their own edit vanish under a transcript, which is indistinguishable from
      // the app eating their words.
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.stop();
    }
    setListening(false);
  }

  function start() {
    if (disabled) return;
    const rec = capabilities.dictation.createSession();
    if (!rec) return;
    recRef.current = rec;
    baseRef.current = valueRef.current ? valueRef.current.replace(/\s+$/, '') + ' ' : '';
    let finals = '';
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      if (!aliveRef.current) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      // Join with a space unless the transcript already brings its own leading whitespace —
      // Chrome does, WebKit's behaviour here is not something the types promise either way, and
      // "helloworld" is a worse failure than a double space (which the trim below tidies anyway).
      onChange(joinSpeech(baseRef.current, finals, interim));
    };
    rec.onend = () => {
      if (!aliveRef.current) return;
      // WebKit ends the stream by itself after a pause, mid-sentence and without an error. If the
      // user still has the mic ON, restart the SAME recognizer so the accumulated `finals` closure
      // survives — calling the component's start() would re-read baseRef from the field this very
      // session has been writing into, and duplicate everything said so far. Same approach as
      // features/walkthrough/tools/useHandsFree.ts.
      if (wantOnRef.current) {
        try {
          rec.start();
          return;
        } catch (err) {
          // InvalidStateError when it has not finished tearing down — fall through and stop.
          console.warn('[cadence/dictation] could not resume after pause', err);
        }
      }
      setListening(false);
    };
    rec.onerror = (e: { error?: string }) => {
      // Quiet for the USER — a failed dictation attempt should not become an error screen; the
      // keyboard is right there. Never quiet for US: this discarded the error object entirely,
      // and a dead mic on all nine of its render sites went unnoticed for exactly that reason.
      // `not-allowed` here means iOS refused the permission, which on this app meant the Info.plist
      // had no NSMicrophoneUsageDescription / NSSpeechRecognitionUsageDescription to ask with.
      console.warn('[cadence/dictation] recognition error:', e?.error ?? e);
      if (aliveRef.current) setListening(false);
    };
    try {
      wantOnRef.current = true;
      rec.start();
      setListening(true);
    } catch (err) {
      wantOnRef.current = false;
      console.warn('[cadence/dictation] could not start recognition', err);
      setListening(false);
    }
  }

  startRef.current = start;

  if (!supported) return null;

  return (
    <button
      className={`mic${listening ? ' mic-on' : ''}`}
      onClick={() => (listening ? stop() : start())}
      disabled={disabled}
      aria-label={listening ? 'Stop dictation' : 'Dictate'}
      title={listening ? 'Stop dictation' : 'Dictate'}
      type="button"
    >
      <MicIcon active={listening} />
    </button>
  );
}
