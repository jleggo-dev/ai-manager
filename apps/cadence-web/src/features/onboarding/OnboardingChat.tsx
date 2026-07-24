import { useEffect, useRef, useState } from 'react';
import { Orb } from '../../components/Orb.tsx';
import { MicButton } from '../../components/MicButton.tsx';
import { useCoachChat } from './useCoachChat.ts';

const SendIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden>
    <path
      className="stroke"
      d="M2 8.5h11M8.5 4l5 4.5-5 4.5"
      stroke="#fff"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const GearIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden>
    <circle className="stroke" cx="8.5" cy="8.5" r="2.6" />
    <path
      className="stroke"
      d="M8.5 1.6v2M8.5 13.4v2M1.6 8.5h2M13.4 8.5h2M3.6 3.6l1.4 1.4M12 12l1.4 1.4M13.4 3.6L12 5M5 12l-1.4 1.4"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The coach chat, Claude-style: the coach speaks in the open (plain full-width text, no bubble);
 * only the user's turns get a bubble, so the type can breathe. Two chromes: 'onboarding' (floating
 * Review pill + the AI disclaimer footer, its own full-screen shell) and 'none' (the Coach TAB,
 * hosted inside MainTabs' .app shell, with a floating settings gear via `onSettings`). Streams the
 * Coach over SSE; the Scribe captures goals/equipment in the background. Session/stream logic
 * lives in `useCoachChat` so drop-recovery is unit-testable without this chrome.
 */
export function OnboardingChat({
  onReview,
  onSettings,
  intent = 'onboarding',
  chrome = 'onboarding',
}: {
  onReview?: () => void;
  onSettings?: () => void;
  intent?: 'onboarding' | 'ongoing';
  chrome?: 'onboarding' | 'none';
}) {
  const { turns, input, setInput, streaming, captured, restored, send } = useCoachChat({ intent });
  const chatRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [flash, setFlash] = useState(false);
  const prevCaptured = useRef(captured);

  // Flash the Review pill when the captured-goal count rises — a new goal was just heard, so pull
  // the eye to Review. One-shot: add the class, clear it after the animation so it can re-fire.
  useEffect(() => {
    if (captured > prevCaptured.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1600);
      prevCaptured.current = captured;
      return () => clearTimeout(t);
    }
    prevCaptured.current = captured;
  }, [captured]);

  // Scroll only the chat pane — scrollIntoView would pan the page/shell on mobile.
  useEffect(() => {
    const chat = chatRef.current;
    if (!chat) return;
    chat.scrollTop = chat.scrollHeight;
  }, [turns]);

  // Auto-grow the composer to fit what's typed, up to ~5 rows (the CSS max-height).
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

  const composer = (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={taRef}
          className="field"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message your coach…"
        />
        {input.trim() ? (
          <button className="send" onClick={send} disabled={streaming} aria-label="Send">
            <SendIcon />
          </button>
        ) : (
          <MicButton value={input} onChange={setInput} disabled={streaming} />
        )}
      </div>
      {chrome === 'onboarding' && (
        <div className="chat-disclaimer">
          <Orb />
          <span>{"I'm AI and can make mistakes — please double-check what I say."}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="chatscreen">
      {onSettings && (
        <button className="float-gear" onClick={onSettings} aria-label="Settings" title="Settings">
          <GearIcon />
        </button>
      )}
      {chrome === 'onboarding' && (
        <button
          className={`float-review${flash ? ' flash' : ''}`}
          onClick={onReview}
          title="Confirm what I heard & set your rhythm"
        >
          {captured > 0 && <span className="pulse" />}
          <b>{captured}</b>
          <span>{captured === 1 ? 'goal' : 'goals'} · Review →</span>
        </button>
      )}
      <div className="chat" ref={chatRef}>
        {!restored ? (
          <div className="chat-loading">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : (
          <div className="coach-msg">
            {intent === 'ongoing'
              ? "Hey — good to see you 👋 How's your rhythm feeling? If something needs to shift — more, less, a different day — say the word and I'll adjust your plan."
              : "Hi — I'm your coach, Cadence 👋 Tell me what you'd like to work on — a first 10k, eating better, a steadier mind, the daily pages — and I'll take notes as we talk. What's on your mind?"}
          </div>
        )}
        {restored &&
          turns.map((t, i) =>
            t.role === 'coach' ? (
              <div className="coach-msg" key={i}>
                {t.text || (
                  <span className="typing">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            ) : (
              <div className="bubble me" key={i}>
                {t.text}
              </div>
            ),
          )}
      </div>
      {composer}
    </div>
  );
}
