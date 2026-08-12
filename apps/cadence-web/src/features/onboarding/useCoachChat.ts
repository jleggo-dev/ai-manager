/**
 * Coach chat session logic extracted from OnboardingChat (WEB-P2).
 *
 * Owns restore, send, SSE-drop recovery, and the StrictMode-safe streaming delta
 * reducer — testable without mounting chrome (Review pill / settings gear / disclaimer).
 * Req 5: also prepares confirm-first food actions in parallel with the coach reply.
 */
import { useEffect, useRef, useState } from 'react';
import {
  openCoachSession,
  sendCoachMessage,
  getReview,
  getCurrentCoach,
  prepareCoachFoodAction,
  stopCoachTurn,
  type CoachFoodAction,
} from '../../lib/api.ts';
import { capabilities } from '../../lib/capability/index.ts';
import { healthOfferAnswered } from './health-digest.ts';

export interface CoachTurn {
  role: 'user' | 'coach';
  text: string;
}

/**
 * What the Broker has heard so far, surfaced as it lands rather than saved for the review.
 * Titles, not a count: "2 goals" tells you the coach heard something, but only the words back
 * tell you it heard the right thing — and the whole promise is that nothing at review is a surprise.
 */
export interface CapturedGoal {
  id: string;
  title: string;
  area: string;
}

const RECOVER_ATTEMPTS = 6;
const RECOVER_DELAY_MS = 800;

export type UseCoachChatArgs = {
  intent?: 'onboarding' | 'ongoing';
  /** Injected for tests (default: real setTimeout). */
  delay?: (ms: number) => Promise<void>;
};

function turnsWindow(turns: CoachTurn[], nextUser: string): string {
  const prior = turns
    .slice(-8)
    .map((t) => `${t.role === 'coach' ? 'Coach' : 'User'}: ${t.text}`)
    .join('\n');
  return prior ? `${prior}\nUser: ${nextUser}` : `User: ${nextUser}`;
}

export function useCoachChat({ intent = 'onboarding', delay }: UseCoachChatArgs = {}) {
  const wait = delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const [turns, setTurns] = useState<CoachTurn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [capturedGoals, setCapturedGoals] = useState<CapturedGoal[]>([]);
  const [restored, setRestored] = useState(false);
  const [foodAction, setFoodAction] = useState<CoachFoodAction | null>(null);
  const sessionId = useRef<string | null>(null);
  // Live only while a turn is streaming — the Stop button's handle on it.
  const abort = useRef<AbortController | null>(null);
  const stopped = useRef(false);

  async function refreshCaptured() {
    try {
      const r = await getReview();
      setCapturedGoals(r.goals.map((g) => ({ id: g.goal_id, title: g.title, area: g.area })));
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

  /**
   * One turn, streamed. `echo: false` is the app speaking on the user's behalf — her reply is
   * what they should see, not a synthetic message in their voice that they did not write.
   */
  async function deliver(text: string, echo = true) {
    const window = turnsWindow(turns, text);
    setTurns((t) => [...t, ...(echo ? [{ role: 'user' as const, text }] : []), { role: 'coach' as const, text: '' }]);
    setStreaming(true);
    // Confirm-first food draft in parallel with the coach stream (never blocks reply). Only for
    // something the user actually said — an app note is not a meal.
    //
    // And never during ONBOARDING. There is no plan yet and no nutrition module running, so there
    // is nothing to log a meal against — every draft it could produce during intake is a false
    // positive by construction. Running it anyway is how "I do at least one beast a year, but I
    // had to skip it this year" opened a sheet offering to log one Spartan Beast for breakfast at
    // ~2000 kcal, mid-way through building a training plan. The classifier's own guards matter for
    // the ongoing conversation; here the whole surface is simply wrong.
    if (echo && intent !== 'onboarding')
      void prepareCoachFoodAction({ message: text, window })
        .then((r) => {
          if (r.status === 'ok' && r.action) setFoodAction(r.action);
        })
        .catch(() => {
          /* soft-fail — chat still works */
        });
    try {
      if (!sessionId.current)
        sessionId.current = (
          await openCoachSession({
            intent,
            // TWO facts, kept apart on purpose. Sending "already asked" as "not available" made
            // the coach tell an iPhone user that Apple Health only works on iPhone.
            healthAvailable: capabilities.health.isAvailable(),
            healthAnswered: healthOfferAnswered(),
          })
        ).sessionId;
      abort.current = new AbortController();
      stopped.current = false;
      const { completed } = await sendCoachMessage(sessionId.current, text, applyStreamDelta, abort.current.signal);
      if (!completed && !stopped.current && !(await recoverFromServer())) {
        fillLastCoach('⚠️ Connection dropped — send again to continue.');
      }
    } catch (err) {
      // A deliberate stop is not a failure: keep what she had said and hand the composer back.
      if (stopped.current) {
        fillLastCoach('…');
        return;
      }
      // The user gets a warm, useless sentence — correct, they can't act on a stack trace. But it
      // was ALSO all anyone got: this catch discarded the error, so "Auth failed" from the API and
      // a dropped wifi connection produced the identical screen, and the only way to tell them
      // apart was to reproduce the call by hand against production. Log what actually happened.
      console.error('[cadence/coach] turn failed', err);
      if (!(await recoverFromServer())) fillLastCoach('Something hiccuped on my end — say that again?');
    } finally {
      abort.current = null;
      setStreaming(false);
      setTimeout(refreshCaptured, 900);
    }
  }

  /**
   * Ask Cadence to speak without the user having typed. Used when the app hands her something
   * mid-conversation — today, the Apple Health history someone just shared — and she needs to
   * actually say what she makes of it rather than sitting on it until the next question.
   *
   * The prompt is wrapped so the API strips it from the restored transcript and the Broker's
   * capture window (routes/coach.ts): it is the app talking, and rendering it in the user's own
   * bubble would show them a message they never wrote.
   */
  async function nudge(note: string) {
    if (streaming) return;
    await deliver(`<note>${note}</note>`, false);
  }

  /**
   * Stop her mid-sentence. Whatever she had already said stays on screen — it is part of the
   * conversation and deleting it would be pretending it never happened — and the composer comes
   * back so the user can correct themselves, which is the reason they reached for Stop.
   *
   * Two halves, and both are needed. Aborting ends our read; `stopCoachTurn` ends the GENERATION,
   * because the server deliberately keeps draining a dropped stream so a phone that loses signal
   * never loses a reply. Without the second half, stopping cost a full billed turn that reappeared
   * whole on the next restore — the opposite of what the button says.
   */
  function stop() {
    if (!abort.current) return;
    stopped.current = true;
    abort.current.abort();
    abort.current = null;
    if (sessionId.current) void stopCoachTurn(sessionId.current);
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    await deliver(text);
  }

  return {
    turns,
    input,
    setInput,
    streaming,
    capturedGoals,
    restored,
    send,
    stop,
    nudge,
    foodAction,
    clearFoodAction: () => setFoodAction(null),
    // Exported for unit tests of recovery / delta helpers without full send path.
    recoverFromServer,
    fillLastCoach,
    applyStreamDelta,
    sessionId,
  };
}
