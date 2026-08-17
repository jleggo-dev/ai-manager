import { type ReactNode } from 'react';
import { MicButton } from '../../components/MicButton.tsx';
import { CoachFace } from '../../components/CoachFace.tsx';
import { useAutoGrow } from './useAutoGrow.ts';

/** A plain square. Every chat app uses one for stop; there is nothing to be clever about here. */
const StopIcon = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
    <rect x="3.5" y="3.5" width="8" height="8" rx="1.6" fill="#fff" />
  </svg>
);

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

/**
 * The composer, and the one honest thing it does while Cadence is talking: nothing.
 *
 * A live field with a dead send button reads as a bug, so the whole control greys out and says
 * what it is waiting for. This is a stopgap with a known end: once the upstream API exposes
 * pause/resume mid-stream, this becomes a stop button — and it should, for every coach chat and
 * not just onboarding, because "I've heard enough" is a normal thing to want to say to someone
 * who is still talking.
 *
 * The AI disclosure sits under the composer wearing Cadence's own face, not an abstract mark: the
 * disclosure is about who is speaking, so it belongs to the speaker.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  streaming,
  showDisclaimer,
  above,
  placeholder = 'Message your coach…',
  rootRef,
  onStop,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  streaming: boolean;
  showDisclaimer: boolean;
  /** Overridden on the opening turn to model what a useful answer looks like. */
  placeholder?: string;
  /** Measured by the chat so it can reserve exactly this much room (useFloatingInset). */
  rootRef?: (el: HTMLElement | null) => void;
  /** Interrupt her mid-sentence. Absent = no stop offered (the ongoing tab passes it too). */
  onStop?: () => void;
  /** Rides above the field inside the same floating stack (the Broker's live captures). */
  above?: ReactNode;
}) {
  // Re-fits on every render, so it follows the text, `streaming` blanking the field, and — the
  // one that was broken — the tab finally becoming visible. See useAutoGrow.
  const taRef = useAutoGrow();

  return (
    <div className="composer-wrap" ref={rootRef}>
      {above}
      <div className={`composer${streaming ? ' is-locked' : ''}`}>
        <textarea
          ref={taRef}
          className="field"
          rows={1}
          value={streaming ? '' : value}
          disabled={streaming}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={streaming ? 'Cadence is replying — tap stop to interrupt' : placeholder}
        />
        {streaming ? (
          // A live Stop, not a dead arrow. Someone who has just realised they mistyped should not
          // have to sit and watch an answer to the wrong question arrive before they can fix it.
          <button className="send send-stop" onClick={onStop} aria-label="Stop" disabled={!onStop}>
            <StopIcon />
          </button>
        ) : (
          <>
            {/* The mic is ALWAYS here — mounted and visible — and both of those are bugs paid for.
                It was once the `else` branch of the send button, so the first dictated word made
                the field non-empty, React unmounted MicButton, and its cleanup called abort(),
                discarding the pending final: dictation killed itself after one word. Mounting it
                permanently fixed that but left it hidden whenever the field had text, which is
                its own trap — you could dictate exactly once. Stop talking and your words are in
                the field, so the mic vanishes; fix a misheard word by hand and it vanishes; type
                a sentence first and it was never there. In an app whose whole promise is that you
                can just talk to it, the mic disappearing the moment you have said anything is
                close to the worst possible moment for it to go. It costs 34px to keep. */}
            <span className="mic-slot">
              <MicButton value={value} onChange={onChange} disabled={false} />
            </span>
            {value.trim() && (
              <button className="send" onClick={onSend} aria-label="Send">
                <SendIcon />
              </button>
            )}
          </>
        )}
      </div>
      {showDisclaimer && (
        <div className="chat-disclaimer">
          <CoachFace size={18} ring={false} />
          <span>{"I'm AI and can make mistakes — please double-check what I say."}</span>
        </div>
      )}
    </div>
  );
}
