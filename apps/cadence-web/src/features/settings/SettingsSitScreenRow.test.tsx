/**
 * The "Screen during a sit" row: two choices, each a button that writes the per-device preference
 * (lib/sit-screen.ts), the one in force pressed; one plain line and nothing else on the row.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsSitScreenRow } from './SettingsSitScreenRow.tsx';
import { SIT_SCREEN_KEY, readSitScreen } from '../../lib/sit-screen.ts';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const choice = (label: string) => screen.getByRole('button', { name: label });

describe('SettingsSitScreenRow', () => {
  it('opens on "goes dark" when nothing is stored, with the one line under the label', () => {
    render(<SettingsSitScreenRow />);
    expect(screen.getByText('Screen during a sit')).toBeInTheDocument();
    expect(screen.getByText('The bells still ring either way.')).toBeInTheDocument();
    expect(choice('goes dark')).toHaveAttribute('aria-pressed', 'true');
    expect(choice('stays on')).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens on what this phone was told', () => {
    window.localStorage.setItem(SIT_SCREEN_KEY, 'on');
    render(<SettingsSitScreenRow />);
    expect(choice('stays on')).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['stays on', 'on'],
    ['goes dark', 'dark'],
  ] as const)('tapping "%s" writes %s and presses that choice', (label, stored) => {
    window.localStorage.setItem(SIT_SCREEN_KEY, stored === 'on' ? 'dark' : 'on');
    render(<SettingsSitScreenRow />);
    fireEvent.click(choice(label));
    expect(readSitScreen()).toBe(stored);
    expect(choice(label)).toHaveAttribute('aria-pressed', 'true');
  });

  it('says nothing else on the row', () => {
    render(<SettingsSitScreenRow />);
    const text = screen.getByText('Screen during a sit').closest('.room-row')!.textContent;
    expect(text).toBe('Screen during a sitThe bells still ring either way.goes darkstays on');
  });
});
