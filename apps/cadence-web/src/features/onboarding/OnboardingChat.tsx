import { useEffect, useRef, useState } from 'react';
import { openCoachSession, sendCoachMessage, getReview, getCurrentCoach } from '../../lib/api.ts';
import { Stepper } from '../../components/Stepper.tsx';
import { Orb } from '../../components/Orb.tsx';
import { MicButton } from '../../components/MicButton.tsx';

interface Turn {
  role: 'user' | 'coach';
  text: string;
}

const SendIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden>
    <path className="stroke" d="M2 8.5h11M8.5 4l5 4.5-5 4.5" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The coach chat. Two chromes: 'onboarding' (mockup screen 01 — wordmark header, goal counter
 * → Review, stepper, own .app wrapper) and 'none' (bare chat + composer for the Coach TAB,
 * which lives inside MainTabs' .app shell). Streams the Coach over SSE; the Broker captures
 * goals/equipment in the background. Honors the server's freshness verdict: a `stale` restore
 * starts a fresh thread and does NOT render the old transcript (a visible transcript the new
 * session can't see reads as amnesia). 409-safe: send disabled while streaming.
 */
export function OnboardingChat({
  onReview,
  intent = 'onboarding',
  chrome = 'onboarding',
}: {
  onReview?: () => void;
  intent?: 'onboarding' | 'ongoing';
  chrome?: 'onboarding' | 'none';
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [captured, setCaptured] = useState(0);
  const [restored, setRestored] = useState(false); // false until the server history loads
  const sessionId = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // Auto-grow the composer to fit what's typed, up to ~5 rows (the CSS max-height); only past that
  // does it scroll. Keep overflow HIDDEN while growing so no scrollbar shows until it's actually
  // needed (Claude-style) — measure with it hidden, then flip to auto only when we hit the cap.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.overflowY = 'hidden';
    ta.style.height = 'auto';
    const max = parseFloat(getComputedStyle(ta).maxHeight) || Infinity;
    const overflowing = ta.scrollHeight > max;
    ta.style.height = `${overflowing ? max : ta.scrollHeight}px`;
    if (overflowing) ta.style.overflowY = 'auto';
  }, [input]);

  // Restore the conversation from the server (source of truth) before painting, so a returning
  // user sees their history appear in one go — not the fresh greeting flashing then filling in.
  useEffect(() => {
    getCurrentCoach()
      .then((c) => {
        // A stale thread (idle >7d, or onboarding chatter after the plan committed) is NOT
        // adopted: leave sessionId null so the next send opens a fresh session with a fresh
        // dossier, and show the greeting instead of a transcript the new session can't see.
        if (c.sessionId && !c.stale) {
          sessionId.current = c.sessionId;
          setTurns(c.messages.map((m) => ({ role: m.role, text: m.content })));
        }
      })
      .catch(() => {
        /* fresh start */
      })
      .finally(() => {
        // Unconditional: goals can exist without a session (e.g. App.tsx routed here on
        // stage 'in_progress' from captured goals alone) — the counter must reflect the
        // server's real count either way, not just when a chat session happened to restore.
        refreshCaptured();
        setRestored(true);
      });
  }, []);

  async function refreshCaptured() {
    try {
      const r = await getReview();
      setCaptured(r.goals.length);
    } catch {
      /* ignore */
    }
  }

  // Pull the authoritative conversation back from the server to HEAL a dropped turn: the
  // coach reply is persisted server-side even if our stream connection died. Polls briefly
  // because the server finalizes the turn shortly after the model finishes.
  async function recoverFromServer(): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 800));
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

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setTurns((t) => [...t, { role: 'user', text }, { role: 'coach', text: '' }]);
    setStreaming(true);
    try {
      if (!sessionId.current) sessionId.current = (await openCoachSession({ intent })).sessionId;
      const { completed } = await sendCoachMessage(sessionId.current, text, (delta) => {
        // Pure update — never mutate the existing turn (StrictMode double-invokes
        // updaters in dev, which doubled every delta when we mutated in place).
        setTurns((t) => {
          const last = t[t.length - 1];
          if (!last || last.role !== 'coach') return t;
          return [...t.slice(0, -1), { ...last, text: last.text + delta }];
        });
      });
      // Dropped mid-reply: the server finished + persisted it — recover instead of losing it.
      if (!completed && !(await recoverFromServer())) {
        fillLastCoach('⚠️ Connection dropped — send again to continue.');
      }
    } catch {
      // Network error: try to recover a server-side reply; never show raw errors in coach voice.
      if (!(await recoverFromServer())) fillLastCoach('Something hiccuped on my end — say that again?');
    } finally {
      setStreaming(false);
      setTimeout(refreshCaptured, 900); // capture runs fire-and-forget on the server
    }
  }

  const inner = (
    <>
      <div className="chat">
          {!restored ? (
            <div className="chat-loading">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          ) : (
            <div className="ai-row">
              <Orb />
              <div className="bubble ai">
                {intent === 'ongoing'
                  ? "Hey — good to see you 👋 How's your rhythm feeling? If something needs to shift — more, less, a different day — say the word and I'll adjust your plan."
                  : "Hi — I'm your Cadence coach 👋 Tell me what you'd like to work on — a first 10k, eating better, a steadier mind, the daily pages — and I'll take notes as we talk. What's on your mind?"}
              </div>
            </div>
          )}
          {restored &&
            turns.map((t, i) =>
            t.role === 'coach' ? (
              <div className="ai-row" key={i}>
                <Orb />
                <div className="bubble ai">
                  {t.text || (
                    <span className="typing">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="bubble me" key={i}>
                {t.text}
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
        <div className="composer">
          <textarea
            ref={taRef}
            className="field"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline (so multi-line messages are easy to compose).
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message your coach…"
          />
          <MicButton value={input} onChange={setInput} disabled={streaming} />
          <button className="send" onClick={send} disabled={streaming} aria-label="Send">
            <SendIcon />
          </button>
        </div>
    </>
  );

  // Tab chrome ('none'): bare chat + composer, hosted by MainTabs' .app shell.
  if (chrome === 'none') return inner;

  // Onboarding chrome: wordmark header + goal counter + stepper + own .app wrapper.
  return (
    <>
      <div className="app-head">
        <div className="wordmark">
          <Orb />
          Cadence
        </div>
        <button className="counter" onClick={onReview} title="Confirm what I heard & set your rhythm">
          {captured > 0 && <span className="pulse" />}
          <b>{captured}</b>
          <span>{captured === 1 ? 'goal' : 'goals'} · Review →</span>
        </button>
      </div>
      <Stepper active={0} />
      <div className="app">{inner}</div>
    </>
  );
}
