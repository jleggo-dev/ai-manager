import { describe, expect, it } from 'vitest';
import {
  TEMPO_BPM_KEY,
  pickDueNext,
  renderRepertoire,
  settledTempo,
  tempoMeta,
  type RepertoireLike,
} from './repertoire.ts';

const item = (label: string, over: Partial<RepertoireLike> = {}): RepertoireLike => ({
  label,
  status: 'known',
  ...over,
});

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

describe('pickDueNext', () => {
  it('picks the known item resting longest', () => {
    const items = [
      item('A Short Story', { last_practiced_at: daysAgo(1) }),
      item('Écossaise', { last_practiced_at: daysAgo(19) }),
      item('Minuet in G', { last_practiced_at: daysAgo(9) }),
    ];
    expect(pickDueNext(items)?.label).toBe('Écossaise');
  });

  it('a never-practiced item rests longer than any practiced one', () => {
    const items = [
      item('Écossaise', { last_practiced_at: '2020-01-01T00:00:00Z' }),
      item('Arietta', { last_practiced_at: null }),
    ];
    expect(pickDueNext(items)?.label).toBe('Arietta');
  });

  it('only known items rotate — working and parked are never due', () => {
    const items = [item('Melody', { status: 'working' }), item('Cradle Song', { status: 'parked' })];
    expect(pickDueNext(items)).toBeNull();
  });

  it('ties break stably (started_at, then label), not by row order', () => {
    const items = [
      item('B piece', { last_practiced_at: null, started_at: '2026-08-02T00:00:00Z' }),
      item('A piece', { last_practiced_at: null, started_at: '2026-08-02T00:00:00Z' }),
      item('C piece', { last_practiced_at: null, started_at: '2026-08-01T00:00:00Z' }),
    ];
    expect(pickDueNext(items)?.label).toBe('C piece');
    expect(pickDueNext([...items].reverse())?.label).toBe('C piece');
  });
});

describe('renderRepertoire', () => {
  it('groups by status, marks the due item, and dates by relative day-count', () => {
    // One clock for the fixtures AND the render. The file's `daysAgo` calls Date.now() itself, a
    // few instructions after `now` is captured — same millisecond on a fast machine, but any
    // ≥1ms hiccup between the two reads makes floor(20d − ε) land on 19 and this test fail. It
    // did, on a busy CI runner (2026-09-01); exact day-counts must derive from the injected now.
    const now = Date.now();
    const at = (n: number): string => new Date(now - n * 86_400_000).toISOString();
    const text = renderRepertoire(
      [
        item('Melody', { status: 'working', kind: 'piece', last_practiced_at: at(1) }),
        item('Écossaise', { kind: 'piece', last_practiced_at: at(20) }),
        item('A Short Story', { kind: 'piece', last_practiced_at: at(0.2) }),
        item('Cradle Song', { status: 'parked' }),
      ],
      now,
    );
    expect(text).toContain('Working on now:');
    expect(text).toContain('- Melody (piece; worked yesterday)');
    expect(text).toContain('rotation pool');
    expect(text).toContain('- Écossaise (piece; worked 20 days ago; DUE NEXT by rotation)');
    expect(text).toContain('- A Short Story (piece; worked today)');
    expect(text).toContain('Set aside for now: Cradle Song');
  });

  it('orders the known pool longest-rest first and a cut never drops the due item', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      item(`Piece ${String(i).padStart(2, '0')}`, { last_practiced_at: daysAgo(i) }),
    );
    const text = renderRepertoire(many);
    // Piece 19 rests longest → due, and must lead the list despite 20 > cap.
    const lines = text.split('\n');
    expect(lines[1]).toContain('Piece 19');
    expect(lines[1]).toContain('DUE NEXT by rotation');
    expect(text).toContain('…and 5 more on file'); // 20 known, cap 15 — the cut says so
  });

  it('renders empty for an empty list, so callers can omit the section cleanly', () => {
    expect(renderRepertoire([])).toBe('');
  });
});

describe('the settled tempo', () => {
  it('reads a stored tempo back', () => {
    expect(settledTempo({ tempo_bpm: 72, tempo_meter: 3 })).toEqual({ bpm: 72, meter: 3 });
  });

  it('is undefined when there is none — absence must not become a default tempo', () => {
    expect(settledTempo(null)).toBeUndefined();
    expect(settledTempo(undefined)).toBeUndefined();
    expect(settledTempo({})).toBeUndefined();
    expect(settledTempo({ composer: 'Hummel' })).toBeUndefined();
  });

  it('ignores a tempo stored as something other than a number', () => {
    expect(settledTempo({ tempo_bpm: '72' })).toBeUndefined();
    expect(settledTempo({ tempo_bpm: null })).toBeUndefined();
  });

  it('bounds a stored tempo — a hand-edited row cannot hand the dock a 4000', () => {
    expect(settledTempo({ tempo_bpm: 4000 })).toEqual({ bpm: 240, meter: 4 });
  });

  it('defaults only the meter, never the tempo', () => {
    expect(settledTempo({ tempo_bpm: 60 })).toEqual({ bpm: 60, meter: 4 });
  });

  it('round-trips through the patch it writes', () => {
    expect(settledTempo(tempoMeta({ bpm: 88, meter: 6 }))).toEqual({ bpm: 88, meter: 6 });
    expect(Object.keys(tempoMeta({ bpm: 88, meter: 6 }))).toContain(TEMPO_BPM_KEY);
  });
});

describe('renderRepertoire tells the coach the tempo', () => {
  it('names the settled tempo on the item line', () => {
    const out = renderRepertoire([item('Écossaise (Hummel)', { meta: { tempo_bpm: 72 } })]);
    expect(out).toContain('settled tempo 72 bpm');
  });

  it('names an unusual meter but stays quiet about the common one', () => {
    expect(renderRepertoire([item('Waltz', { meta: { tempo_bpm: 90, tempo_meter: 3 } })])).toContain(
      'settled tempo 90 bpm, 3 to the bar',
    );
    const common = renderRepertoire([item('Study', { meta: { tempo_bpm: 90, tempo_meter: 4 } })]);
    expect(common).toContain('settled tempo 90 bpm');
    expect(common).not.toContain('to the bar');
  });

  it('says nothing at all for an item with no tempo on file', () => {
    expect(renderRepertoire([item('Minuet')])).not.toContain('settled tempo');
  });

  it('keeps the rotation mark alongside the tempo', () => {
    const out = renderRepertoire([item('Solo', { meta: { tempo_bpm: 66 } })]);
    expect(out).toContain('settled tempo 66 bpm');
    expect(out).toContain('DUE NEXT by rotation');
  });
});
