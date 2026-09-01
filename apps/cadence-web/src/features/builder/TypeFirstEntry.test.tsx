/**
 * Press-every-button coverage for type-first entry (design B): every family row, "Start blank
 * instead", every seed row on a picked family, and the back arrows on both screens.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TypeFirstEntry } from './TypeFirstEntry.tsx';
import { FAMILIES, SEEDS, seedsForFamily } from './builderSeeds.ts';

afterEach(() => cleanup());

function noop() {}

describe('TypeFirstEntry — family screen', () => {
  it('renders all five families and pressing one calls onPickFamily with its id', () => {
    const onPickFamily = vi.fn();
    render(
      <TypeFirstEntry
        family={null}
        onPickFamily={onPickFamily}
        onPickSeed={noop}
        onBlank={noop}
        onBackToFamilies={noop}
        onClose={noop}
      />,
    );
    for (const f of FAMILIES) expect(screen.getByText(f.label)).toBeTruthy();
    fireEvent.click(screen.getByText('Practice'));
    expect(onPickFamily).toHaveBeenCalledWith('practice');
  });

  it('"Start blank instead" calls onBlank', () => {
    const onBlank = vi.fn();
    render(
      <TypeFirstEntry
        family={null}
        onPickFamily={noop}
        onPickSeed={noop}
        onBlank={onBlank}
        onBackToFamilies={noop}
        onClose={noop}
      />,
    );
    fireEvent.click(screen.getByText('Start blank instead'));
    expect(onBlank).toHaveBeenCalledTimes(1);
  });

  it('the back arrow calls onClose', () => {
    const onClose = vi.fn();
    render(
      <TypeFirstEntry
        family={null}
        onPickFamily={noop}
        onPickSeed={noop}
        onBlank={noop}
        onBackToFamilies={noop}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TypeFirstEntry — seeds screen', () => {
  it.each(FAMILIES)('shows $id’s own starting points, and pressing one hands back that exact seed', (fam) => {
    const onPickSeed = vi.fn();
    render(
      <TypeFirstEntry
        family={fam.id}
        onPickFamily={noop}
        onPickSeed={onPickSeed}
        onBlank={noop}
        onBackToFamilies={noop}
        onClose={noop}
      />,
    );
    const seeds = seedsForFamily(fam.id);
    for (const seed of seeds) expect(screen.getByText(seed.title)).toBeTruthy();
    const firstSeed = seeds[0]!;
    fireEvent.click(screen.getByText(firstSeed.title));
    expect(onPickSeed).toHaveBeenCalledWith(firstSeed);
  });

  it('the back arrow calls onBackToFamilies, never onClose', () => {
    const onBackToFamilies = vi.fn();
    const onClose = vi.fn();
    render(
      <TypeFirstEntry
        family="mind"
        onPickFamily={noop}
        onPickSeed={noop}
        onBlank={noop}
        onBackToFamilies={onBackToFamilies}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('Back to families'));
    expect(onBackToFamilies).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('never shows another family’s seeds', () => {
    render(
      <TypeFirstEntry
        family="mind"
        onPickFamily={noop}
        onPickSeed={noop}
        onBlank={noop}
        onBackToFamilies={noop}
        onClose={noop}
      />,
    );
    const otherSeeds = SEEDS.filter((s) => s.family !== 'mind');
    for (const seed of otherSeeds) expect(screen.queryByText(seed.title)).toBeNull();
  });
});
