/**
 * Coach chat session logic extracted from OnboardingChat (WEB-P2).
 *
 * Owns restore, send, SSE-drop recovery, and the StrictMode-safe streaming delta
 * reducer — testable without mounting chrome (Review pill / settings gear / disclaimer).
 * Req 5: also prepares confirm-first food actions in parallel with the coach reply.
 */
import { useRef, useState } from 'react';
import {
  openCoachSession,
  sendCoachMessage,
  getReview,
  prepareCoachFoodAction,
  stopCoachTurn,
  type CoachFoodAction,
} from '../../lib/api.ts';
import { capabilities } from '../../lib/capability/index.ts';
import { useCoachActivity } from './useCoachActivity.ts';
import { recoverTurnFromServer, useReplyNotifyArm, useResumeHealer } from './coach-recovery.ts';
import { useCoachTranscript } from './useCoachTranscript.ts';
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

/**
 * The goals the Broker has quietly picked up out of the conversation, for the chips above the
 * composer. Outside the hook because it needs nothing from it but a setter, and a hook body that
 * keeps inlining one-off async fetches is how a 150-line ceiling gets hit (CLAUDE.md).
 *
 * Silent on failure by design: these chips are a bonus on top of the conversation, and an error
 * banner over a chat because a decoration could not load is worse than no chips.
 */
async function loadCapturedGoals(set: (g: CapturedGoal[]) => void): Promise<void> {
  try {
    const r = await getReview();
    set(r.goals.map((g) => ({ id: g.goal_id, title: g.title, area: g.area })));
  } catch {
    /* the chips are a bonus; never let them surface as a failure */
  }
}

/**
 * The two ways a streaming turn changes the transcript, as pure functions.
 *
 * Lifted out of `useCoachChat` when it hit the 150-line ceiling — and the split is the right one
 * regardless: these are transformations OF a transcript, not behaviour of a hook. Neither mutates
 * the existing turn, which is what keeps them safe under StrictMode's double-invoke.
 */
function withLastCoachFilled(turns: CoachTurn[], text: string): CoachTurn[] {
  const last = turns[turns.length - 1];
  if (last?.role === 'coach' && !last.text) return [...turns.slice(0, -1), { ...last, text }];
  return [...turns, { role: 'coach', text }];
}

/** Append a streamed delta to the coach turn in progress; a no-op if there is not one. */
function withDelta(turns: CoachTurn[], delta: string): CoachTurn[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'coach') return turns;
  return [...turns.slice(0, -1), { ...last, text: last.text + delta }];
}

/**
 * The server said one generation ended (a tool round, a nudge) — close the bubble being filled
 * and open a fresh one for what follows. Only when there is something to close: a break on an
 * empty bubble would stack blanks. Applied lazily, on the first delta AFTER the frame, so a
 * generation that turns out to have no text never leaves an empty bubble behind.
 */
function withSegmentBreak(turns: CoachTurn[]): CoachTurn[] {
  const last = turns[turns.length - 1];
  if (!last || last.role !== 'coach' || !last.text.trim()) return turns;
  return [...turns, { role: 'coach', text: '' }];
}

/**
 * The three writers a streaming turn hands to the transport, built OVER the raw `setTurns` (a
 * useState setter, stable for the component's life). Outside the hook because they are wiring,
 * not behaviour — and because the hook body sits against the 150-line ceiling (CLAUDE.md: extract
 * before a function grows). `pendingBreak` lives in this closure: a segment frame arrived and the
 * NEXT delta must open a new bubble (see withSegmentBreak for why it waits for the delta).
 */
function makeStreamWriters(setTurns: (up: (t: CoachTurn[]) => CoachTurn[]) => void) {
  let pendingBreak = false;
  return {
    /** Every turn starts bubble-continuous; a leftover break from a dropped stream must not leak. */
    resetSegmentBreak: () => {
      pendingBreak = false;
    },
    noteSegment: () => {
      pendingBreak = true;
    },
    applyStreamDelta: (delta: string) => {
      const broke = pendingBreak;
      pendingBreak = false;
      setTurns((t) => withDelta(broke ? withSegmentBreak(t) : t, delta));
    },
    fillLastCoach: (text: string) => setTurns((t) => withLastCoachFilled(t, text)),
  };
}

export function useCoachChat({ intent = 'onboarding', delay }: UseCoachChatArgs = {}) {
  const wait = delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // What she is doing right now, in words (useCoachActivity) — shown beside the typing dots.
  const { activity, noteActivity, clearActivity } = useCoachActivity();
  const [capturedGoals, setCapturedGoals] = useState<CapturedGoal[]>([]);
  const [foodAction, setFoodAction] = useState<CoachFoodAction | null>(null);
  const sessionId = useRef<string | null>(null);
  /**
   * The transcript itself: painted from the device, reconciled with the server, remembered when it
   * settles. Its own hook because it is its own responsibility — see useCoachTranscript.
   */
  const { turns, setTurns, earlierTurns, cursor, restored, painted } = useCoachTranscript({
    sessionId,
    streaming,
    onSettled: () => void loadCapturedGoals(setCapturedGoals),
  });
  // Live only while a turn is streaming — the Stop button's handle on it.
  const abort = useRef<AbortController | null>(null);
  const stopped = useRef(false);
  const notifyArm = useReplyNotifyArm(sessionId);
  const healer = useResumeHealer({
    recover: () => recoverFromServer(),
    // Leaving mid-turn arms the "Cadence replied" ping — the server cannot see it happen.
    onLeave: notifyArm.arm,
    onHealed: () => {
      abort.current?.abort();
      abort.current = null;
      setStreaming(false);
      clearActivity();
    },
  });

  /** Thin wrapper so callers (and this hook's tests) keep one entry point; the polling
   *  conversation itself lives in coach-recovery.ts. */
  async function recoverFromServer(): Promise<boolean> {
    return recoverTurnFromServer({
      wait,
      onRecovered: (sid, next) => {
        sessionId.current = sid;
        setTurns(next);
      },
    });
  }

  const { resetSegmentBreak, noteSegment, applyStreamDelta, fillLastCoach } = useRef(
    makeStreamWriters(setTurns),
  ).current;

  /**
   * One turn, streamed. `echo: false` is the app speaking on the user's behalf — her reply is
   * what they should see, not a synthetic message in their voice that they did not write.
   *
   * Returns whether the turn actually landed. `nudge` and `send` both ignore it (their own
   * on-screen fallbacks — a retracted note, a "connection dropped" reply — already say what
   * happened); `sendText` is the one caller that acts on it, because an auto-sent message with
   * nowhere left to retry from would otherwise just vanish.
   */
  async function deliver(text: string, echo = true): Promise<boolean> {
    const window = turnsWindow(turns, text);
    setTurns((t) => [...t, ...(echo ? [{ role: 'user' as const, text }] : []), { role: 'coach' as const, text: '' }]);
    setStreaming(true);
    notifyArm.startTurn();
    healer.begin();
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
    // A failed APP-initiated turn (echo=false — a nudge, not something they typed) must retract
    // its pending bubble rather than error at them: "send again to continue" about a message they
    // never sent reads as the app malfunctioning, which it is — but it should fail quietly.
    const retractPendingNote = () =>
      setTurns((t) => {
        const last = t[t.length - 1];
        return last?.role === 'coach' && !last.text ? t.slice(0, -1) : t;
      });
    let ok = true;
    try {
      if (!sessionId.current) {
        sessionId.current = (
          await openCoachSession({
            intent,
            // TWO facts, kept apart on purpose. Sending "already asked" as "not available" made
            // the coach tell an iPhone user that Apple Health only works on iPhone.
            healthAvailable: capabilities.health.isAvailable(),
            healthAnswered: healthOfferAnswered(),
          })
        ).sessionId;
        // They backgrounded while this round-trip was in the air, and the arm had no thread to
        // name. It does now — and this is still the same turn, so it is still the right one to ask.
        notifyArm.sessionOpened();
      }
      abort.current = new AbortController();
      stopped.current = false;
      resetSegmentBreak();
      const { completed } = await sendCoachMessage(
        sessionId.current,
        text,
        applyStreamDelta,
        abort.current.signal,
        noteActivity,
        noteSegment,
      );
      if (!completed && !stopped.current && !healer.recovered.current && !(await recoverFromServer())) {
        if (echo) fillLastCoach('⚠️ Connection dropped — send again to continue.');
        else retractPendingNote();
        ok = false;
      }
    } catch (err) {
      // The resume healer already collected this reply — the fetch we were holding is just a
      // corpse from being backgrounded, and it has nothing to report.
      if (healer.recovered.current) return true;
      // A deliberate stop is not a failure: keep what she had said and hand the composer back.
      if (stopped.current) {
        fillLastCoach('…');
        return true;
      }
      // The user gets a warm, useless sentence — correct, they can't act on a stack trace. But it
      // was ALSO all anyone got: this catch discarded the error, so "Auth failed" from the API and
      // a dropped wifi connection produced the identical screen, and the only way to tell them
      // apart was to reproduce the call by hand against production. Log what actually happened.
      console.error('[cadence/coach] turn failed', err);
      if (!(await recoverFromServer())) {
        if (echo) fillLastCoach('Something hiccuped on my end — say that again?');
        else retractPendingNote();
        ok = false;
      }
    } finally {
      abort.current = null;
      setStreaming(false);
      clearActivity();
      healer.end();
      setTimeout(() => void loadCapturedGoals(setCapturedGoals), 900);
    }
    return ok;
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

  /**
   * `deliver`'s own guard, generalized so a caller with text that never touched the composer (an
   * auto-send) goes through the exact same visible-bubble, real-turn call `send()` uses below, and
   * gets back whether it actually landed. Deliberately does NOT touch `input` — that is the
   * composer's own state, and a caller passing its own text has no reason to also clear a box it
   * never wrote into (which would erase an unrelated draft the user happened to be mid-typing).
   */
  async function sendText(text: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed || streaming) return false;
    return deliver(trimmed);
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    await sendText(text);
  }

  return {
    turns,
    earlierTurns,
    input,
    setInput,
    streaming,
    activity,
    capturedGoals,
    restored,
    /** See useCoachTranscript: `painted` gates the transcript, `restored` gates anything that
     *  must not act on a guess. `cursor` is where reading back starts. */
    painted,
    cursor,
    send,
    sendText,
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
