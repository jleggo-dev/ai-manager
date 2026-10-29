/**
 * The Leftovers window — every choice is a button, so every choice gets a row: it saves what was
 * tapped, it says which is on, and nothing stored reads as the default.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsLeftovers } from './SettingsLeftovers.tsx';

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('SettingsLeftovers', () => {
  it('seven days is on until the user picks another', () => {
    render(<SettingsLeftovers />);
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each(['3', '7', '14'])('tapping %s days saves it and shows it on', (n) => {
    render(<SettingsLeftovers />);
    fireEvent.click(screen.getByRole('button', { name: `${n} days` }));
    expect(window.localStorage.getItem('cadence.leftoverWindowDays')).toBe(n);
    expect(screen.getByRole('button', { name: `${n} days` })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each(['30', 'abc', '0'])('a stored %s that is not a choice reads as seven', (raw) => {
    window.localStorage.setItem('cadence.leftoverWindowDays', raw);
    render(<SettingsLeftovers />);
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
  });
});
