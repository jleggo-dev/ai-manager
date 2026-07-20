/**
 * Coach chat session logic extracted from OnboardingChat (WEB-P2).
 *
 * Owns restore, send, SSE-drop recovery, and the StrictMode-safe streaming delta
 * reducer — testable without mounting chrome (Review pill / settings gear / disclaimer).
 */
import { useEffect, useRef, useState } from 'react';
import { openCoachSession, sendCoachMessage, getReview, getCurrentCoach } from '../../lib/api.ts';

export interface CoachTurn {
  role: 'user' | 'coach';
  text: string;
}

const RECOVER_ATTEMPTS = 6;
const RECOVER_DELAY_MS = 800;

export type UseCoachChatArgs = {
  intent?: 'onboarding' | 'ongoing';
  /** Injected for tests (default: real setTimeout). */
  delay?: (ms: number) => Promise<void>;
};

export function useCoachChat({ intent = 'onboarding', delay }: UseCoachChatArgs = {}) {
  const wait = delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const [turns, setTurns] = useState<CoachTurn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [captured, setCaptured] = useState(0);
  const [restored, setRestored] = useState(false);
  const sessionId = useRef<string | null>(null);

  async function refreshCaptured() {
    try {
      const r = await getReview();
      setCaptured(r.goals.length);
    } catch {
      /* ignore */
    }
  }

  // Restore the conversation from the server (source of truth) before painting.
  useEffect(() => {
    getCurrentCoach()
      .then((c) => {
        // A stale thread is NOT adopted: leave sessionId null so the next send opens fresh.
        if (c.sessionId && !c.stale) {
          sessionId.current = c.sessionId;
          setTurns(c.messages.map((m) => ({ role: m.role, text: m.content })));
        }
      })
      .catch(() => {
        /* fresh start */
      })
      .finally(() => {
        refreshCaptured();
        setRestored(true);
      });
  }, []);

  // Pull the authoritative conversation back from the server to HEAL a dropped turn.
  async function recoverFromServer(): Promise<boolean> {
    for (let i = 0; i < RECOVER_ATTEMPTS; i++) {
      await wait(RECOVER_DELAY_MS);
      try {
        const c = await getCurrentCoach();
        const last = c.messages[c.messages.length - 1];
        if (c.sessionId && last?.role === 'coach' && last.content.trim()) {
          sessionId.current = c.sessionId;
          setTurns(c.messages.map((m) => ({ role: m.role, text: m.content })));
          return true;
        }
      } catch {
        /* retry */
      }
    }
    return false;
  }

  function fillLastCoach(text: string) {
    setTurns((t) => {
      const last = t[t.length - 1];
      if (last?.role === 'coach' && !last.text) return [...t.slice(0, -1), { ...last, text }];
      return [...t, { role: 'coach', text }];
    });
  }

  /** Pure delta reducer — never mutates the existing turn (StrictMode double-invoke safe). */
  function applyStreamDelta(delta: string) {
    setTurns((t) => {
      const last = t[t.length - 1];
      if (!last || last.role !== 'coach') return t;
      return [...t.slice(0, -1), { ...last, text: last.text + delta }];
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text }, { role: 'coach', text: '' }]);
    setStreaming(true);
    try {
      if (!sessionId.current) sessionId.current = (await openCoachSession({ intent })).sessionId;
      const { completed } = await sendCoachMessage(sessionId.current, text, applyStreamDelta);
      if (!completed && !(await recoverFromServer())) {
        fillLastCoach('⚠️ Connection dropped — send again to continue.');
      }
    } catch {
      if (!(await recoverFromServer())) fillLastCoach('Something hiccuped on my end — say that again?');
    } finally {
      setStreaming(false);
      setTimeout(refreshCaptured, 900);
    }
  }

  return {
    turns,
    input,
    setInput,
    streaming,
    captured,
    restored,
    send,
    // Exported for unit tests of recovery / delta helpers without full send path.
    recoverFromServer,
    fillLastCoach,
    applyStreamDelta,
    sessionId,
  };
}
