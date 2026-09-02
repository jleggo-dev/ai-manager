/**
 * The precedence ruling, pinned (owner, 2026-09-02): **the coach wins on tempo.**
 *
 * She is now told each piece's settled tempo in {{repertoire}}, so a bpm she prescribed is an
 * informed decision — "a notch slower this week, clean over fast" — and a stored number must never
 * quietly overrule it. The settled tempo FILLS what she left empty; it does not replace what she
 * set. Without a test this inverts the first time someone reaches for the "obvious" `??` the other
 * way round, and nothing would throw: you would simply never be able to change a tempo again.
 */
import { describe, expect, it } from 'vitest';
import type { OccurrenceSession, RepertoireItem } from '@cadence/shared';
import { fillSettledTempos } from './session-generate.ts';

const PIANO = 'goal-piano';

const piece = (label: string, meta: Record<string, unknown> | null, goal: string | null = PIANO): RepertoireItem =>
  ({
    item_id: `id-${label}`,
    user_id: 'u1',
    goal_id: goal,
    label,
    status: 'known',
    kind: 'piece',
    meta,
    started_at: '2026-08-01T00:00:00.000Z',
    learned_at: null,
    last_practiced_at: null,
  }) as RepertoireItem;

const session = (item: Record<string, unknown>): OccurrenceSession => ({
  blocks: [{ label: 'Practice', items: [{ name: 'Écossaise (Hummel)', duration_min: 10, ...item }] }],
  note: '',
  generated_at: '2026-09-02T00:00:00.000Z',
  version: 1,
});

const only = (s: OccurrenceSession) => s.blocks[0]!.items[0]!;

describe('fillSettledTempos — the coach wins', () => {
  const items = [piece('Écossaise (Hummel)', { tempo_bpm: 72, tempo_meter: 3 })];

  it('KEEPS a tempo the coach prescribed, settled tempo notwithstanding', () => {
    const s = session({ metronome_bpm: 60 });
    fillSettledTempos(s, items, PIANO);
    expect(only(s).metronome_bpm).toBe(60);
  });

  it('fills the tempo when she left it empty', () => {
    const s = session({});
    fillSettledTempos(s, items, PIANO);
    expect(only(s).metronome_bpm).toBe(72);
    expect(only(s).metronome_meter).toBe(3);
  });

  it('fills the METER alongside a prescribed bpm — she rarely sets it, they do', () => {
    const s = session({ metronome_bpm: 60 });
    fillSettledTempos(s, items, PIANO);
    expect(only(s).metronome_bpm).toBe(60);
    expect(only(s).metronome_meter).toBe(3);
  });

  it('keeps a meter she did prescribe', () => {
    const s = session({ metronome_bpm: 60, metronome_meter: 4 });
    fillSettledTempos(s, items, PIANO);
    expect(only(s).metronome_meter).toBe(4);
  });
});

describe('fillSettledTempos — it stays out of the way', () => {
  it('adds nothing when the piece has no settled tempo', () => {
    const s = session({});
    fillSettledTempos(s, [piece('Écossaise (Hummel)', null)], PIANO);
    expect(only(s).metronome_bpm).toBeUndefined();
  });

  it('adds nothing when no piece matches the step — no pulse on a step that had none', () => {
    const s = session({});
    fillSettledTempos(s, [piece('Minuet in G', { tempo_bpm: 88 })], PIANO);
    expect(only(s).metronome_bpm).toBeUndefined();
  });

  it('will not reach across goals for a tempo', () => {
    const s = session({});
    fillSettledTempos(s, [piece('Écossaise (Hummel)', { tempo_bpm: 72 }, 'goal-run')], PIANO);
    expect(only(s).metronome_bpm).toBeUndefined();
  });

  it('bounds a hand-edited tempo rather than handing the dock a 4000', () => {
    const s = session({});
    fillSettledTempos(s, [piece('Écossaise (Hummel)', { tempo_bpm: 4000 })], PIANO);
    expect(only(s).metronome_bpm).toBe(240);
  });

  it('survives an empty session and empty repertoire without throwing', () => {
    const empty: OccurrenceSession = { blocks: [], note: '', generated_at: '', version: 1 };
    expect(() => fillSettledTempos(empty, [], PIANO)).not.toThrow();
    const s = session({});
    fillSettledTempos(s, [], PIANO);
    expect(only(s).metronome_bpm).toBeUndefined();
  });
});
