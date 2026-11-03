import type { ButtonHTMLAttributes } from 'react';
import { commitButtonClass } from './commitButtonClass.ts';

/**
 * The green commit button: Log, Save, Done, Apply — the one way to say "do it".
 *
 * Owner ruling 2026-11-02: orange opens a door (`.cta`), green commits the thing you just did.
 * Before this, ten screens each drew their own green button with its own corners, padding, text
 * size and edge depth; now the look lives in styles/commit-button.css alone. Pass a screen's own
 * `className` only for layout (flex, margin, width) — never to restyle it.
 *
 * - `size="full"` (default): the foot of a sheet or screen.
 * - `size="compact"`: inside a card or panel.
 * - `inline`: hugs its label instead of filling the row.
 *
 * `type` defaults to "button" so it never submits a form by accident.
 */
export interface CommitButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'full' | 'compact';
  inline?: boolean;
}

export function CommitButton({
  size = 'full',
  inline = false,
  className,
  type = 'button',
  ...rest
}: CommitButtonProps) {
  return <button type={type} className={commitButtonClass(size, inline, className)} {...rest} />;
}
