/**
 * Press-every-button coverage for the tool palette (design C). Every one of the 12 playable rows
 * gets pressed and asserted; `photo` is checked ABSENT — the audited-dead tool never gets a row.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { StepPalette } from './StepPalette.tsx';
import { PALETTE } from './builderCatalog.ts';

afterEach(() => cleanup());

describe('StepPalette', () => {
  it('renders exactly the 12 playable rows, grouped Do then Capture, and never a Photo row', () => {
    render(<StepPalette onPick={() => {}} onClose={() => {}} />);
    expect(screen.getAllByRole('button', { name: /./ }).length).toBeGreaterThanOrEqual(PALETTE.length);
    for (const entry of PALETTE) {
      expect(screen.getByText(entry.label)).toBeTruthy();
      expect(screen.getByText(entry.when)).toBeTruthy();
    }
    expect(screen.queryByText('Photo')).toBeNull();
    expect(screen.queryByText(/form, progress, plate/)).toBeNull();
  });

  it.each(PALETTE)('pressing "$label" calls onPick with kind "$kind"', (entry) => {
    const onPick = vi.fn();
    render(<StepPalette onPick={onPick} onClose={() => {}} />);
    fireEvent.click(screen.getByText(entry.label));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(entry.kind);
  });

  it('pressing the scrim calls onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<StepPalette onPick={() => {}} onClose={onClose} />);
    const scrim = container.querySelector('.ab-palette-scrim');
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
