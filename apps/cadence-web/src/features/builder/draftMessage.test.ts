/**
 * What "Ask the coach" sends from inside a draft. She cannot adjust what she cannot see, and a draft
 * is on nobody's server — so the steps travel in the message, and this is the table that pins what
 * each kind of step turns into. It appears as the USER's own bubble, so it has to read like a
 * person talking, not a dump.
 */
import { describe, it, expect } from 'vitest';
import type { BuilderCard } from './builderSession.ts';
import { describeDraft } from './draftMessage.ts';

const card = (label: string, items: BuilderCard['block']['items']): BuilderCard => ({
  id: `c-${label}`,
  block: { label, items },
});

describe('describeDraft — the steps that travel with the ask', () => {
  it('names the activity and lists each block with its steps under it', () => {
    const out = describeDraft('Hotel HIIT', [
      card('Warm-up', [{ name: 'Jumping jacks', duration_min: 2 }]),
      card('Main', [{ name: 'Push-ups', sets: 3, reps: 10 }]),
    ]);

    expect(out).toBe(
      [
        `Can you look at the activity I'm putting together — "Hotel HIIT"?`,
        '',
        'Warm-up',
        '- Jumping jacks — 2 min',
        'Main',
        '- Push-ups — 3 × 10',
      ].join('\n'),
    );
  });

  // The table: every field a step can carry, and what it reads as.
  it.each([
    [{ name: 'Squats', sets: 3, reps: 12 }, '- Squats — 3 × 12'],
    [{ name: 'Bench', sets: 4 }, '- Bench — 4 sets'],
    [{ name: 'Pull-ups', reps: 8 }, '- Pull-ups — 8 reps'],
    [{ name: 'Plank', duration_min: 3 }, '- Plank — 3 min'],
    [{ name: 'Run', distance_km: 5 }, '- Run — 5 km'],
    [{ name: 'Row', sets: 3, reps: 10, load: '55 lb' }, '- Row — 3 × 10, 55 lb'],
    [{ name: 'Breathe', duration_min: 5, detail: 'slow out-breath' }, '- Breathe — 5 min, slow out-breath'],
    // Nothing specified is a bare name, never a trailing dash.
    [{ name: 'Stretch' }, '- Stretch'],
  ])('renders %j as %s', (item, line) => {
    expect(
      describeDraft('X', [card('Main', [item])])
        ?.split('\n')
        .at(-1),
    ).toBe(line);
  });

  /**
   * Found by looking at it in `?preview=builder`, which is what the preview is for. A card IS a
   * block and the builder makes one step per card, so three strength steps are three blocks all
   * labelled "Main" — and the message repeated that heading over every one of them.
   */
  it('writes a block heading once, not over every card that shares it', () => {
    const out = describeDraft('Hotel HIIT', [
      card('Warm-up', [{ name: 'Jumping jacks', duration_min: 2 }]),
      card('Main', [{ name: 'Push-ups', sets: 3, reps: 10 }]),
      card('Main', [{ name: 'Goblet squat', sets: 3, reps: 12, load: '35 lb' }]),
    ]);

    expect(out?.split('\n').filter((l) => l === 'Main')).toHaveLength(1);
    expect(out).toContain('- Push-ups — 3 × 10');
    expect(out).toContain('- Goblet squat — 3 × 12, 35 lb');
  });

  // Near-miss: a label that comes BACK after a different one is a real new section, so it repeats.
  it('writes a heading again when the draft returns to it after another', () => {
    const out = describeDraft('X', [
      card('Main', [{ name: 'Push-ups' }]),
      card('Finisher', [{ name: 'Plank' }]),
      card('Main', [{ name: 'Rows' }]),
    ]);

    expect(out?.split('\n').filter((l) => l === 'Main')).toHaveLength(2);
  });

  it('skips a half-added step rather than sending a bare dash', () => {
    const out = describeDraft('X', [card('Main', [{ name: 'Real step' }, { name: '   ' }])]);

    expect(out).toContain('- Real step');
    expect(out).not.toContain('-  ');
  });

  it('skips a block whose steps are all blank — including its label', () => {
    const out = describeDraft('X', [card('Empty', [{ name: '' }]), card('Main', [{ name: 'Real step' }])]);

    expect(out).not.toContain('Empty');
    expect(out).toContain('Main');
  });

  it('an unnamed draft still asks, without an empty pair of quotes', () => {
    const out = describeDraft('  ', [card('Main', [{ name: 'Scales' }])]);

    expect(out?.split('\n')[0]).toBe(`Can you look at the activity I'm putting together?`);
  });

  // Near-misses: nothing to ask about means no door at all — the caller hides the button on null.
  it.each([
    ['no cards', [] as BuilderCard[]],
    ['cards with no usable steps', [card('Main', [{ name: '' }])]],
  ])('returns null for %s', (_label, cards) => {
    expect(describeDraft('Hotel HIIT', cards)).toBeNull();
  });
});
