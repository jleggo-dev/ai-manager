import { useEffect, useRef, type ReactNode } from 'react';
import { MicButton } from '../../components/MicButton.tsx';
import { CoachFace } from '../../components/CoachFace.tsx';

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
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  streaming: boolean;
  showDisclaimer: boolean;
  /** Overridden on the opening turn to model what a useful answer looks like. */
  placeholder?: string;
  /** Rides above the field inside the same floating stack (the Broker's live captures). */
  above?: ReactNode;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow to fit what's typed, up to ~5 rows (the CSS max-height). Picks compose into the
  // same field, so a multi-select answer grows it exactly as typing would.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.overflowY = 'hidden';
    // Collapse before measuring so `scrollHeight` can only be the content. `auto` would let the
    // flex row stretch the field first, and the measurement would come back as the stretched box.
    ta.style.height = '0px';
    const max = parseFloat(getComputedStyle(ta).maxHeight) || Infinity;
    const overflowing = ta.scrollHeight > max;
    ta.style.height = `${overflowing ? max : ta.scrollHeight}px`;
    if (overflowing) ta.style.overflowY = 'auto';
    // `streaming` blanks the field while Cadence talks; the height has to follow it both ways.
  }, [value, streaming]);

  return (
    <div className="composer-wrap">
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
          placeholder={streaming ? 'Cadence is replying…' : placeholder}
        />
        {streaming ? (
          <span className="send is-dead" aria-hidden>
            <SendIcon />
          </span>
        ) : value.trim() ? (
          <button className="send" onClick={onSend} aria-label="Send">
            <SendIcon />
          </button>
        ) : (
          <MicButton value={value} onChange={onChange} disabled={false} />
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
