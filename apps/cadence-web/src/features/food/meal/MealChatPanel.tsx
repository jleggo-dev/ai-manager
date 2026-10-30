/**
 * Her face, tapped — a chat about THIS meal, as a second panel inside the drawer (canvas "Cadence
 * Quick Log" 1c, 2026-10-29). It replaced the hop to the coach tab: the cart stays pinned at the
 * top, ‹ Breakfast goes back to the shelves with it intact, and nothing here logs anything — the
 * doors log, she advises.
 *
 * It is the ONE conversation, not a side channel: `useCoachChat` is the coach tab's own session
 * hook, so every turn runs through AI Admin and lands in the same transcript. The panel shows only
 * this visit's turns. She speaks first — the app whispers the meal to her as a note (the same note
 * the hop carried, asking for replies that fit here) and her opener is a real reply, not a line the
 * app wrote in her voice. The quick questions are the person's words, changing with the meal's
 * state: empty, in the cart, logged.
 */
import { useEffect, useRef, useState } from 'react';
import { CoachFace } from '../../../components/CoachFace.tsx';
import { fmtKcal } from '../bracket/copy.ts';
import { useCoachChat } from '../../onboarding/useCoachChat.ts';
import { QUICK_QUESTIONS, type MealChatState } from './mealChatQuestions.ts';

export function MealChatPanel({
  mealTitle,
  chips,
  kcal,
  state,
  note,
  onBack,
}: {
  mealTitle: string;
  /** The cart as its chips read ("2× Banana", "Yogurt bowl"); empty when nothing is in it. */
  chips: string[];
  kcal: number;
  state: MealChatState;
  /** What she is told about the meal before she opens — see `quickLogCoachNote(…, inDrawer)`. */
  note: string;
  onBack: () => void;
}) {
  const chat = useCoachChat({ intent: 'ongoing' });
  const [from, setFrom] = useState<number | null>(null);
  const thread = useRef<HTMLDivElement>(null);

  // Once the transcript is restored, mark where this visit starts and let her open on the meal.
  useEffect(() => {
    if (from !== null || !chat.restored || chat.streaming) return;
    setFrom(chat.turns.length);
    void chat.nudge(note);
  }, [chat, from, note]);

  const turns = from === null ? [] : chat.turns.slice(from);
  const latest = turns[turns.length - 1]?.text;
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, latest]);

  const ask = (q: string) => void chat.sendText(q);
  const ctx = chips.length ? chips : [state === 'logged' ? 'Logged' : 'Nothing yet'];

  return (
    <div className="ms-chat" role="dialog" aria-label={`Talk about ${mealTitle}`}>
      <div className="ms-grab" aria-hidden="true" />
      <div className="ms-chat-head">
        <button type="button" className="ms-chat-back" onClick={onBack}>
          <span aria-hidden>‹</span>
          {mealTitle}
        </button>
        <CoachFace size={36} />
      </div>
      <div className="ms-chat-ctx">
        <div className="ms-chat-ctx-chips">
          {ctx.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <span className="ms-chat-ctx-k">
          <b>{fmtKcal(kcal)}</b>
          <i>KCAL</i>
        </span>
      </div>
      <div className="ms-chat-thread" ref={thread} aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'coach' ? 'ms-chat-her' : 'ms-chat-me'}>
            {t.text || (t.role === 'coach' ? <span className="ms-chat-dots" aria-label="The coach is typing" /> : null)}
          </div>
        ))}
        {!chat.streaming && from !== null && (
          <div className="ms-chat-qs">
            {QUICK_QUESTIONS[state].map((q) => (
              <button type="button" key={q} onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className="ms-chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void chat.send();
        }}
      >
        <input
          value={chat.input}
          onChange={(e) => chat.setInput(e.target.value)}
          placeholder="Ask about this meal…"
          aria-label="Ask about this meal"
          disabled={chat.streaming}
        />
        <button type="submit" aria-label="Send" disabled={chat.streaming || !chat.input.trim()}>
          ↑
        </button>
      </form>
    </div>
  );
}
