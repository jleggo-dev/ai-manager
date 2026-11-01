import { useState } from 'react';

export const THATS_IT = "That's it";

/**
 * The one-line field behind "Something else" and "Another amount": a typed answer when the
 * buttons do not have it. One component for both, so the field, its send button and the Enter
 * rule cannot drift. Enter sends unless the keyboard is still composing (an IME's in-progress
 * text must not be sent half-written); the field takes focus when it opens, since opening it is
 * the intent to type.
 */
export function OwnAnswerField({
  label,
  placeholder,
  canSend,
  disabled,
  inputMode,
  maxLength,
  onSend,
}: {
  label: string;
  placeholder: string;
  /** Whether the current text is sendable (a number for an amount, any words for an answer). */
  canSend: (text: string) => boolean;
  disabled?: boolean;
  inputMode?: 'decimal' | 'text';
  maxLength?: number;
  onSend: (text: string) => void;
}) {
  const [own, setOwn] = useState('');
  const send = () => {
    if (canSend(own) && !disabled) onSend(own);
  };
  return (
    <div className="fa-own">
      <input
        className="wiz-in"
        autoFocus
        value={own}
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        {...(inputMode ? { inputMode } : {})}
        {...(maxLength ? { maxLength } : {})}
        onChange={(e) => setOwn(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();
        }}
      />
      <button type="button" className="fa-chip" disabled={disabled || !canSend(own)} onClick={send}>
        {THATS_IT}
      </button>
    </div>
  );
}
