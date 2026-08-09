/**
 * API-02 — characterization tests for the pure session-normalize helpers.
 * Bounds + video_query URL strip are a security/UX backstop against model-invented links.
 */
import { describe, it, expect } from 'vitest';
import { coachingPhase, normalizeSession } from './session-normalize.ts';

describe('coachingPhase', () => {
  it('maps log counts to discover / calibrate / progress', () => {
    expect(coachingPhase(0)).toBe('discover');
    expect(coachingPhase(1)).toBe('calibrate');
    expect(coachingPhase(2)).toBe('calibrate');
    expect(coachingPhase(3)).toBe('progress');
    expect(coachingPhase(10)).toBe('progress');
  });
});

describe('normalizeSession', () => {
  it('returns null when raw is null or blocks is missing', () => {
    expect(normalizeSession(null)).toBeNull();
    expect(normalizeSession({})).toBeNull();
    expect(normalizeSession({ blocks: 'nope' })).toBeNull();
  });

  it('returns null when no usable blocks survive (empty / nameless items)', () => {
    expect(normalizeSession({ blocks: [] })).toBeNull();
    expect(normalizeSession({ blocks: [{ label: 'Main', items: [] }] })).toBeNull();
    expect(normalizeSession({ blocks: [{ label: 'Main', items: [{ name: '' }] }] })).toBeNull();
    expect(normalizeSession({ blocks: [{ label: 'Main', items: [{ name: '   ' }] }] })).toBeNull();
  });

  it('preserves a circuit block mode + capped rounds; drops an off-catalog mode', () => {
    const circuit = normalizeSession({
      blocks: [{ label: 'Circuit', mode: 'circuit', rounds: 3, items: [{ name: 'Burpees', reps: 10 }] }],
    });
    expect(circuit?.blocks[0]).toMatchObject({ mode: 'circuit', rounds: 3 });

    // rounds is capped so a bad number can't balloon the circuit player.
    const big = normalizeSession({
      blocks: [{ label: 'Circuit', mode: 'circuit', rounds: 999, items: [{ name: 'Burpees', reps: 10 }] }],
    });
    expect(big?.blocks[0]?.rounds).toBe(10);

    // an off-catalog mode → undefined (= straight); rounds mean nothing without a circuit.
    const straight = normalizeSession({
      blocks: [{ label: 'Main', mode: 'superset', rounds: 3, items: [{ name: 'Row', reps: 8 }] }],
    });
    expect(straight?.blocks[0]?.mode).toBeUndefined();
    expect(straight?.blocks[0]?.rounds).toBeUndefined();
  });

  it('keeps a well-formed session and stamps version + generated_at', () => {
    const session = normalizeSession({
      note: 'Ease into volume.',
      blocks: [
        {
          label: 'Main',
          items: [{ name: 'Goblet squat', sets: 3, reps: 8, load: '40 lb', detail: 'Brace hard' }],
        },
      ],
    });
    expect(session).not.toBeNull();
    expect(session!.version).toBe(1);
    expect(session!.note).toBe('Ease into volume.');
    expect(session!.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(session!.blocks).toHaveLength(1);
    expect(session!.blocks[0]).toEqual({
      label: 'Main',
      items: [
        {
          name: 'Goblet squat',
          sets: 3,
          reps: 8,
          load: '40 lb',
          duration_min: undefined,
          distance_km: undefined,
          detail: 'Brace hard',
          video_query: null,
        },
      ],
    });
  });

  it('defaults block label to Session when missing', () => {
    const session = normalizeSession({
      blocks: [{ items: [{ name: 'Run' }] }],
    });
    expect(session).not.toBeNull();
    expect(session!.blocks[0]?.label).toBe('Session');
  });

  it('truncates to MAX_BLOCKS (6) and MAX_ITEMS (12)', () => {
    const blocks = Array.from({ length: 8 }, (_, bi) => ({
      label: `B${bi}`,
      items: Array.from({ length: 15 }, (_, ii) => ({ name: `item-${bi}-${ii}` })),
    }));
    const session = normalizeSession({ blocks });
    expect(session).not.toBeNull();
    expect(session!.blocks).toHaveLength(6);
    for (const b of session!.blocks) {
      expect(b.items).toHaveLength(12);
    }
  });

  it('strips model-invented video_query URLs (http, youtube, www)', () => {
    const session = normalizeSession({
      blocks: [
        {
          label: 'Main',
          items: [
            { name: 'Deadlift', video_query: 'https://youtube.com/watch?v=abc' },
            { name: 'Press', video_query: 'http://youtu.be/xyz' },
            { name: 'Row', video_query: 'www.example.com/row' },
            { name: 'Squat', video_query: 'YOUTUBE.COM/shorts/1' },
            { name: 'Hinge', video_query: 'romanian deadlift cue' },
          ],
        },
      ],
    });
    expect(session).not.toBeNull();
    const queries = session!.blocks[0]!.items.map((i) => i.video_query);
    expect(queries).toEqual([null, null, null, null, 'romanian deadlift cue']);
  });

  it('drops non-positive / non-finite numeric fields', () => {
    const session = normalizeSession({
      blocks: [
        {
          label: 'Main',
          items: [
            {
              name: 'Easy jog',
              sets: 0,
              reps: -1,
              duration_min: Number.NaN,
              distance_km: Infinity,
            },
          ],
        },
      ],
    });
    expect(session).not.toBeNull();
    const item = session!.blocks[0]!.items[0]!;
    expect(item.sets).toBeUndefined();
    expect(item.reps).toBeUndefined();
    expect(item.duration_min).toBeUndefined();
    expect(item.distance_km).toBeUndefined();
  });

  it('keeps a whitelisted coach tool and drops anything off-catalog (REQ8)', () => {
    const session = normalizeSession({
      blocks: [
        {
          label: 'Main',
          items: [
            { name: 'Plank', duration_min: 1, tool: 'timer' },
            { name: 'Find a seat', duration_min: 1, tool: 'read' },
            { name: 'Mystery', tool: 'laser' },
            { name: 'Untagged' },
          ],
        },
      ],
    });
    const tools = session!.blocks[0]!.items.map((i) => i.tool);
    expect(tools).toEqual(['timer', 'read', undefined, undefined]);
  });

  it('stores a bounded interval plan, and only on items that are actually intervals', () => {
    const session = normalizeSession({
      blocks: [
        {
          label: 'Conditioning',
          items: [
            // Out of range in every direction — the stored plan must still be playable.
            {
              name: 'Bike sprints',
              tool: 'interval',
              interval_work_sec: 40,
              interval_recover_sec: 20,
              interval_rounds: 999,
              interval_warmup_sec: 5000,
            },
            // EMOM: an explicit 0 recover must survive, not fall back to the 20s default.
            {
              name: 'Every minute',
              tool: 'interval',
              interval_work_sec: 60,
              interval_recover_sec: 0,
              interval_rounds: 10,
            },
            // Tagged interval with no numbers at all — defaults, so the player always has a plan.
            { name: 'Something hard', tool: 'interval' },
            { name: 'Plank', duration_min: 1, tool: 'timer' },
          ],
        },
      ],
    });
    const [sprints, emom, bare, plank] = session!.blocks[0]!.items;
    expect(sprints).toMatchObject({ interval_rounds: 20, interval_warmup_sec: 900, interval_work_sec: 40 });
    expect(emom).toMatchObject({ interval_work_sec: 60, interval_recover_sec: 0, interval_rounds: 10 });
    expect(bare).toMatchObject({ interval_work_sec: 40, interval_recover_sec: 20, interval_rounds: 6 });
    expect(plank!.interval_work_sec).toBeUndefined();
  });

  it('infers the interval plan from the numbers alone when the coach forgot the tag', () => {
    const session = normalizeSession({
      blocks: [{ label: 'Main', items: [{ name: 'Hill repeats', interval_work_sec: 45, interval_rounds: 8 }] }],
    });
    expect(session!.blocks[0]!.items[0]).toMatchObject({ interval_work_sec: 45, interval_rounds: 8 });
  });
});
