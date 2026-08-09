import { useEffect, useRef, useState } from 'react';

/**
 * Hands-free timer control (interval design D). Mid-burpee nobody aims at a 50px button, and this
 * is the **third** answer to that, not the first — auto-advance means you rarely need to touch
 * anything, the 232px ring is the reliable tap target, and voice is the opt-in extra on top.
 *
 * It is workable on the web precisely because the job is tiny: **four words, matched loosely,
 * while one screen is open.** What it is not is a wake-word assistant. The mic is granted per-site
 * and on some browsers the audio is processed off-device, so:
 *
 *   • **opt-in only** — never listening until someone turns it on, and never persisted across
 *     sessions or steps;
 *   • **visibly on** — the chip pulses while the mic is live, so nobody is unsure;
 *   • **never the only way** — every command it accepts has a button, and an unsupported browser
 *     or a denied permission degrades to an explanatory chip that blocks nothing;
 *   • **silent on a miss** — anything outside the grammar does nothing at all, because a timer
 *     that argues with you mid-set is worse than one that ignores you.
 *
 * "Restart" is the one destructive-ish word, so it asks once ("Say restart again to confirm")
 * rather than throwing away a run someone is four rounds into.
 */
export type HandsFreeCommand = 'start' | 'pause' | 'skip' | 'next' | 'restart';

/**
 * The grammar. Matched as a substring of the transcript, so "okay, pause" and "pause it" both
 * land; the synonyms are the words people actually shout.
 *
 * `skip` and `next` are deliberately separate commands rather than synonyms, because they mean
 * opposite things about what you did: **skip** is "don't make me do this bit" (an interval phase
 * you're cutting short), **next** is "I've finished this bit" (a circuit move you just completed
 * and want logged). A tool that accepts one must not silently answer to the other — that is the
 * difference between a rep counted and a rep thrown away.
 */
const GRAMMAR: ReadonlyArray<{ command: HandsFreeCommand; words: readonly string[] }> = [
  { command: 'restart', words: ['restart', 'start over', 'start again'] },
  { command: 'pause', words: ['pause', 'stop', 'hold on'] },
  { command: 'skip', words: ['skip'] },
  { command: 'next', words: ['next', 'done', 'got it'] },
  { command: 'start', words: ['start', 'resume', 'go', 'continue'] },
];

/** The word each command is announced by, for the chip's "listening for …" line. */
export const COMMAND_WORD: Record<HandsFreeCommand, string> = {
  start: 'start',
  pause: 'pause',
  skip: 'skip',
  next: 'next',
  restart: 'restart',
};

/**
 * The command a transcript names, restricted to what this surface actually accepts. Anything else
 * — including a real command the surface has no use for — returns null and is ignored in silence.
 *
 * Order matters: "restart" contains "start", so the longer word is tested first. The array above is
 * already in that order; this comment keeps the reason next to the code that depends on it.
 */
export function matchCommand(transcript: string, accepted?: readonly HandsFreeCommand[]): HandsFreeCommand | null {
  const said = transcript.toLowerCase();
  for (const entry of GRAMMAR) {
    if (accepted && !accepted.includes(entry.command)) continue;
    if (entry.words.some((w) => said.includes(w))) return entry.command;
  }
  return null;
}

export type HandsFreeStatus = 'off' | 'listening' | 'confirm' | 'unavailable';

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Is voice control even possible here? Checked before the toggle is offered, so an unsupported
 *  browser sees an honest "Mic unavailable" chip rather than a control that silently does nothing. */
export function handsFreeSupported(): boolean {
  return recognitionCtor() !== null;
}

export interface HandsFree {
  status: HandsFreeStatus;
  /** The word that just landed, for the chip's sub-line. Clears itself after two seconds. */
  heard: HandsFreeCommand | null;
  /** What this surface listens for, so the chip can never promise a word that does nothing here. */
  accepted: readonly HandsFreeCommand[];
}

/**
 * Listen while `enabled`, and hand matched commands to `onCommand`. The recogniser is torn down
 * whenever `enabled` goes false or the component unmounts — leaving the step, backgrounding the
 * app or finishing the session all drop the mic, because scope is the whole safety story here.
 */
export function useHandsFree(
  enabled: boolean,
  onCommand: (c: HandsFreeCommand) => void,
  /** The commands this surface can actually act on. A plain countdown has no phase to skip and a
   *  circuit has no clock to pause — promising those words and then ignoring them is worse than
   *  not offering them. */
  accepted: readonly HandsFreeCommand[] = ['start', 'pause', 'skip', 'restart'],
): HandsFree {
  const [status, setStatus] = useState<HandsFreeStatus>('off');
  const [heard, setHeard] = useState<HandsFreeCommand | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  /** Set when "restart" has been heard once and is waiting to be said again. */
  const awaitingConfirm = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      setHeard(null);
      awaitingConfirm.current = false;
      return undefined;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setStatus('unavailable');
      return undefined;
    }

    let stopped = false;
    let recognition: RecognitionLike;
    try {
      recognition = new Ctor();
    } catch {
      setStatus('unavailable');
      return undefined;
    }
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event) => {
      const results = event.results;
      const latest = results[results.length - 1]?.[0]?.transcript ?? '';
      const command = matchCommand(latest, accepted);
      if (!command) return; // a miss is silent, always
      if (command === 'restart' && !awaitingConfirm.current) {
        awaitingConfirm.current = true;
        setStatus('confirm');
        return;
      }
      awaitingConfirm.current = false;
      setStatus('listening');
      setHeard(command);
      onCommandRef.current(command);
    };
    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are ordinary in a quiet gym; only a real refusal kills the chip.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        stopped = true;
        setStatus('unavailable');
      }
    };
    // Browsers end the stream on their own after a silence; restart it so "listening" stays true.
    recognition.onend = () => {
      if (stopped) return;
      try {
        recognition.start();
      } catch {
        setStatus('unavailable');
      }
    };

    try {
      recognition.start();
      setStatus('listening');
    } catch {
      setStatus('unavailable');
      return undefined;
    }

    return () => {
      stopped = true;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        /* already torn down — nothing to release */
      }
    };
  }, [enabled, accepted]);

  // The landed word is a glance, not a log: two seconds, then back to plain listening.
  useEffect(() => {
    if (!heard) return undefined;
    const id = setTimeout(() => setHeard(null), 2000);
    return () => clearTimeout(id);
  }, [heard]);

  return { status, heard, accepted };
}
