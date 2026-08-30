import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BPM,
  DEFAULT_METER,
  MAX_BPM,
  MAX_TAP_INTERVALS,
  MIN_BPM,
  TAP_RESET_MS,
  beatInBar,
  beatIndexAt,
  clampBpm,
  clampMeter,
  isDownbeat,
  normalizeMetronome,
  secondsPerBeat,
  tapTempo,
  tempoMarking,
} from './metronome.ts';

describe('clampBpm', () => {
  it('keeps a tempo in range and rounds it', () => {
    expect(clampBpm(72)).toBe(72);
    expect(clampBpm(72.4)).toBe(72);
    expect(clampBpm(72.6)).toBe(73);
  });

  it('bounds what the coach asks for rather than refusing it', () => {
    expect(clampBpm(400)).toBe(MAX_BPM);
    expect(clampBpm(4)).toBe(MIN_BPM);
  });

  it('falls back to the default on nonsense', () => {
    expect(clampBpm(undefined)).toBe(DEFAULT_BPM);
    expect(clampBpm(null)).toBe(DEFAULT_BPM);
    expect(clampBpm(Number.NaN)).toBe(DEFAULT_BPM);
    expect(clampBpm(Number.POSITIVE_INFINITY)).toBe(DEFAULT_BPM);
  });
});

describe('clampMeter', () => {
  it('bounds and rounds', () => {
    expect(clampMeter(4)).toBe(4);
    expect(clampMeter(99)).toBe(12);
    expect(clampMeter(0)).toBe(1);
    expect(clampMeter(undefined)).toBe(DEFAULT_METER);
  });
});

describe('normalizeMetronome', () => {
  it('is undefined without a tempo — absence is how a step opts out', () => {
    expect(normalizeMetronome(undefined)).toBeUndefined();
    expect(normalizeMetronome(null, 4)).toBeUndefined();
    expect(normalizeMetronome(Number.NaN)).toBeUndefined();
  });

  it('clamps both fields when a tempo is present', () => {
    expect(normalizeMetronome(72, 3)).toEqual({ bpm: 72, meter: 3 });
    expect(normalizeMetronome(999, 99)).toEqual({ bpm: MAX_BPM, meter: 12 });
  });

  it('defaults the meter when only a tempo is given', () => {
    expect(normalizeMetronome(60)).toEqual({ bpm: 60, meter: DEFAULT_METER });
  });
});

describe('the beat as arithmetic', () => {
  it('spaces clicks by the tempo', () => {
    expect(secondsPerBeat(60)).toBe(1);
    expect(secondsPerBeat(120)).toBe(0.5);
  });

  it('derives the beat from elapsed time, not from a counter', () => {
    expect(beatIndexAt(0, 60)).toBe(0);
    expect(beatIndexAt(0.99, 60)).toBe(0);
    expect(beatIndexAt(1, 60)).toBe(1);
    expect(beatIndexAt(9.5, 60)).toBe(9);
  });

  it('survives a backgrounded tab — a long jump lands on the right beat', () => {
    expect(beatIndexAt(600, 120)).toBe(1200);
  });

  it('is total on bad input', () => {
    expect(beatIndexAt(-5, 60)).toBe(0);
    expect(beatIndexAt(Number.NaN, 60)).toBe(0);
  });

  it('walks the bar and accents the first beat', () => {
    const bar = [0, 1, 2, 3, 4, 5].map((b) => beatInBar(b, 4));
    expect(bar).toEqual([0, 1, 2, 3, 0, 1]);
    expect(isDownbeat(0, 4)).toBe(true);
    expect(isDownbeat(4, 4)).toBe(true);
    expect(isDownbeat(1, 4)).toBe(false);
  });

  it('accents nothing in a bar of one', () => {
    expect(isDownbeat(0, 1)).toBe(false);
    expect(isDownbeat(7, 1)).toBe(false);
  });
});

describe('tempoMarking', () => {
  it('names the tempo the way a score does', () => {
    expect(tempoMarking(35)).toBe('Grave');
    expect(tempoMarking(50)).toBe('Largo');
    expect(tempoMarking(72)).toBe('Adagio');
    expect(tempoMarking(90)).toBe('Andante');
    expect(tempoMarking(112)).toBe('Moderato');
    expect(tempoMarking(140)).toBe('Allegro');
    expect(tempoMarking(180)).toBe('Presto');
    expect(tempoMarking(220)).toBe('Prestissimo');
  });

  it('names every tempo in range', () => {
    for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm++) expect(tempoMarking(bpm)).toBeTruthy();
  });
});

describe('tapTempo', () => {
  it('needs two taps to make an interval', () => {
    expect(tapTempo([])).toBeNull();
    expect(tapTempo([1000])).toBeNull();
  });

  it('reads an even series', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([0, 1000, 2000])).toBe(60);
  });

  it('averages an uneven human hand', () => {
    // 480 / 520 / 500 → mean 500 ms → 120 bpm
    expect(tapTempo([0, 480, 1000, 1500])).toBe(120);
  });

  it('restarts at a long gap instead of averaging across it', () => {
    const taps = [0, 1000, 2000, 2000 + TAP_RESET_MS + 500, 2000 + TAP_RESET_MS + 1000];
    expect(tapTempo(taps)).toBe(120); // the 500 ms restart, not a blend with the 60 bpm series
  });

  it('follows a tempo change rather than dragging the whole history along', () => {
    const slow = [0, 1000, 2000, 3000];
    const fast = [3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500];
    expect(tapTempo([...slow, ...fast])).toBe(120);
  });

  it('averages at most MAX_TAP_INTERVALS intervals', () => {
    const many = Array.from({ length: 40 }, (_, i) => i * 500);
    expect(tapTempo(many)).toBe(120);
    expect(MAX_TAP_INTERVALS).toBeGreaterThan(0);
  });

  it('clamps a frantic or glacial series into range', () => {
    expect(tapTempo([0, 10, 20, 30])).toBe(MAX_BPM);
    expect(tapTempo([0, 2900])).toBe(MIN_BPM);
  });

  it('ignores a non-advancing pair', () => {
    expect(tapTempo([1000, 1000])).toBeNull();
  });
});
