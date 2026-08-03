import { describe, it, expect } from 'vitest';
import { MAX_NOW_ITEMS, areaForTool, normalizeNowMenu, nowMenuMeta, type NowMenuAction } from './now-menu.ts';
import { SESSION_TOOL_KINDS } from './tool-catalog.ts';

const TOOLS = SESSION_TOOL_KINDS as readonly string[];
const ACTIVITIES = ['act-1', 'act-2'];

const tool = (t: string, params: Record<string, unknown> = {}) => ({ kind: 'tool', tool: t, params });

describe('nowMenuMeta — the app derives it, never the coach', () => {
  it('describes a breath row from what will actually play', () => {
    // box is 16s a round; six rounds is 96s.
    expect(nowMenuMeta(tool('breathing', { breath_pattern: 'box', breath_cycles: 6 }) as NowMenuAction)).toBe(
      'about 2 min',
    );
  });

  it('says "under a minute" for a genuinely short one', () => {
    expect(
      nowMenuMeta(tool('breathing', { breath_pattern: 'extended_exhale', breath_cycles: 3 }) as NowMenuAction),
    ).toBe('under a minute');
  });

  it('cannot promise longer than the safety cap allows', () => {
    // The coach asks for 500 rounds of the gated pattern; the cap decides what the row may claim.
    const meta = nowMenuMeta(tool('breathing', { breath_pattern: 'up_shift', breath_cycles: 500 }) as NowMenuAction);
    expect(meta).toBe('under a minute');
  });

  it('names the bells on a sit', () => {
    expect(nowMenuMeta(tool('meditate', { duration_min: 5, meditate_bells: 'start_end' }) as NowMenuAction)).toBe(
      '5 min · one bell',
    );
    expect(nowMenuMeta(tool('meditate', { duration_min: 5, meditate_bells: 'none' }) as NowMenuAction)).toBe(
      '5 min · no bells',
    );
  });

  it('promises "no scores" on grounding, because that is the reassurance that matters before a tap', () => {
    const meta = nowMenuMeta(tool('grounding', { grounding_game: 'senses' }) as NowMenuAction);
    expect(meta).toMatch(/no scores/);
  });

  it('says nothing rather than guessing for a plan activity', () => {
    expect(nowMenuMeta({ kind: 'activity', activityId: 'act-1' })).toBeUndefined();
  });

  it('says nothing rather than guessing when a tool has no parameters', () => {
    expect(nowMenuMeta(tool('timer') as NowMenuAction)).toBeUndefined();
    expect(nowMenuMeta(tool('reps') as NowMenuAction)).toBeUndefined();
  });
});

describe('areaForTool', () => {
  it('tones the mind tools from the mind pillar', () => {
    for (const t of ['breathing', 'meditate', 'grounding', 'journal'] as const) {
      expect(areaForTool(t)).toBe('mind');
    }
  });
});

describe('normalizeNowMenu', () => {
  it('keeps good rows and stamps ids', () => {
    const out = normalizeNowMenu(
      { items: [{ label: 'Three long exhales', action: tool('breathing', { breath_pattern: 'extended_exhale' }) }] },
      TOOLS,
      ACTIVITIES,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('n1');
    expect(out[0]?.area).toBe('mind');
  });

  it('accepts an EMPTY menu — nothing sensible to offer is a real state, not an error', () => {
    expect(normalizeNowMenu({ items: [] }, TOOLS, ACTIVITIES)).toEqual([]);
    expect(normalizeNowMenu(null, TOOLS, ACTIVITIES)).toEqual([]);
    expect(normalizeNowMenu(undefined, TOOLS, ACTIVITIES)).toEqual([]);
  });

  it('drops a row pointing at a tool we never wrote', () => {
    const out = normalizeNowMenu({ items: [{ label: 'Hypnosis', action: tool('hypnosis') }] }, TOOLS, ACTIVITIES);
    expect(out).toEqual([]);
  });

  it('drops a STALE activity rather than rendering a row that fails under a thumb', () => {
    const out = normalizeNowMenu(
      {
        items: [
          { label: 'Gone', action: { kind: 'activity', activityId: 'deleted' } },
          { label: 'Still here', action: { kind: 'activity', activityId: 'act-1' } },
        ],
      },
      TOOLS,
      ACTIVITIES,
    );
    expect(out.map((i) => i.label)).toEqual(['Still here']);
  });

  it('drops rows with no label', () => {
    expect(normalizeNowMenu({ items: [{ label: '   ', action: tool('breathing') }] }, TOOLS, ACTIVITIES)).toEqual([]);
  });

  it('de-duplicates identical actions', () => {
    const out = normalizeNowMenu(
      {
        items: [
          { label: 'Breathe', action: tool('breathing', { breath_pattern: 'box' }) },
          { label: 'Breathe again', action: tool('breathing', { breath_pattern: 'box' }) },
        ],
      },
      TOOLS,
      ACTIVITIES,
    );
    expect(out).toHaveLength(1);
  });

  it('caps the list', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      label: `Item ${i}`,
      action: tool('meditate', { duration_min: i + 1 }),
    }));
    expect(normalizeNowMenu({ items }, TOOLS, ACTIVITIES)).toHaveLength(MAX_NOW_ITEMS);
  });

  it('allows at most ONE pin — a second is just a list again', () => {
    const out = normalizeNowMenu(
      {
        items: [
          { label: 'A', action: tool('breathing', { breath_pattern: 'box' }), pinned: true, coachLine: 'I will count' },
          { label: 'B', action: tool('grounding', { grounding_game: 'senses' }), pinned: true },
        ],
      },
      TOOLS,
      ACTIVITIES,
    );
    expect(out.filter((i) => i.pinned)).toHaveLength(1);
    expect(out[0]?.coachLine).toBe('I will count');
  });

  it('floats the pin to the top wherever it arrived', () => {
    const out = normalizeNowMenu(
      {
        items: [
          { label: 'Ordinary', action: tool('meditate', { duration_min: 5 }) },
          { label: 'Pinned', action: tool('breathing', { breath_pattern: 'box' }), pinned: true },
        ],
      },
      TOOLS,
      ACTIVITIES,
    );
    expect(out[0]?.label).toBe('Pinned');
  });

  it('survives junk without throwing', () => {
    const out = normalizeNowMenu({ items: [null, 42, 'nope', {}] as unknown[] }, TOOLS, ACTIVITIES);
    expect(out).toEqual([]);
  });
});
