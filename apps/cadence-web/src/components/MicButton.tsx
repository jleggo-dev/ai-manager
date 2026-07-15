import { useEffect, useRef, useState } from 'react';

/**
 * Voice input via the Web Speech API. Feature-detected: renders NOTHING where the API is
 * missing (Firefox) or the origin isn't secure (works on localhost; not http://<lan-ip>) —
 * on real phones the OS keyboard's dictation covers those cases anyway.
 *
 * Composition rule (the classic double-type bug): never append deltas. Capture the field's
 * value at press (base), then every result event recomposes base + finals + current interim.
 * Android Chrome auto-ends on silence and fires onend WITHOUT onerror — button state syncs
 * there. abort() on unmount and when the caller signals send.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const MicIcon = ({ active }: { active: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
    <rect x="5.2" y="1.5" width="4.6" height="8" rx="2.3" fill={active ? '#fff' : 'currentColor'} />
    <path className="stroke" d="M3 7.5a4.5 4.5 0 0 0 9 0M7.5 12v2" stroke={active ? '#fff' : 'currentColor'} fill="none" strokeLinecap="round" />
  </svg>
);

export function MicButton({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef('');
  const aliveRef = useRef(true);
  // Keep the latest value visible to the closure without re-creating the recognizer.
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      recRef.current?.abort();
    };
  }, []);

  if (!supported) return null;

  function stop() {
    recRef.current?.stop();
    setListening(false);
  }

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor || disabled) return;
    const rec = new Ctor();
    recRef.current = rec;
    baseRef.current = valueRef.current ? valueRef.current.replace(/\s+$/, '') + ' ' : '';
    let finals = '';
    rec.lang = navigator.language || 'en-US';
    rec.continuous = false;
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
      onChange((baseRef.current + finals + interim).trimStart());
    };
    rec.onend = () => {
      if (aliveRef.current) setListening(false); // fires without onerror on silence — sync here
    };
    rec.onerror = () => {
      if (aliveRef.current) setListening(false); // not-allowed/network — quiet reset, no coach-voice error
    };
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

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
