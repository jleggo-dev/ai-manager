import { describe, it, expect } from 'vitest';
import type { OccurrenceSession, SessionItem } from './types/occurrence.ts';
import { deriveWalkthrough, condense, inferTool, stepCaptureMode } from './walkthrough.ts';

/** The redesign's canonical example: "Easy run (zone 2)" — 4 steps, 30 min total, condenses to 13. */
const runSession: OccurrenceSession = {
  blocks: [
    {
      label: 'Warm-up',
      items: [{ name: 'Warm up', detail: 'Walk briskly for 3 minutes to ease into it.', duration_min: 3 }],
    },
    {
      label: 'Main',
      items: [
        { name: 'Find your zone', duration_min: 2 },
        { name: 'Run', detail: 'Keep it conversational.', duration_min: 20, video_query: 'zone 2 running form' },
      ],
    },
    { label: 'Cool down', items: [{ name: 'Cool down', duration_min: 5 }] },
  ],
  note: 'Keep it easy on the knee.',
  generated_at: '2026-07-26T00:00:00.000Z',
  version: 1,
};

describe('inferTool', () => {
  it('reads quantities in priority order: sets → reps, duration → timer, distance → checkoff, else read', () => {
    expect(inferTool({ name: 'Squat', sets: 3, reps: 5, load: '95 lb' })).toEqual({
      kind: 'reps',
      sets: 3,
      reps: 5,
      load: '95 lb',
    });
    expect(inferTool({ name: 'Plank', duration_min: 0.5 })).toEqual({ kind: 'timer', seconds: 30, chime: true });
    expect(inferTool({ name: 'Tempo', distance_km: 5 })).toEqual({ kind: 'checkoff', label: '5 km' });
    expect(inferTool({ name: 'Box breathing', detail: 'In 4, hold 4, out 4.' })).toEqual({ kind: 'read' });
  });

  it('omits absent reps/load rather than emitting undefined', () => {
    expect(inferTool({ name: 'AMRAP push-ups', sets: 2 })).toEqual({ kind: 'reps', sets: 2 });
  });

  it("honors the coach's explicit tool over quantity inference (the plank-vs-sit judgment)", () => {
    // A 1-min "find a seat" HAS a duration but must NOT become a timer.
    expect(inferTool({ name: 'Find a comfortable seat', duration_min: 1, tool: 'read' })).toEqual({ kind: 'read' });
    // A 1-min plank IS a timer.
    expect(inferTool({ name: 'Plank', duration_min: 1, tool: 'timer' })).toEqual({
      kind: 'timer',
      seconds: 60,
      chime: true,
    });
    // Explicit tool wins even against a strong quantity signal.
    expect(inferTool({ name: 'Loaded carry', sets: 3, tool: 'checkoff' })).toEqual({ kind: 'checkoff' });
  });

  it("fills an explicit tool's config from the item, with safe defaults", () => {
    expect(inferTool({ name: 'Reflect', tool: 'journal', detail: 'What went well?' })).toEqual({
      kind: 'journal',
      prompt: 'What went well?',
      mode: 'either',
    });
    // A timer with no duration falls back to a 60s default.
    expect(inferTool({ name: 'Hold', tool: 'timer' })).toEqual({ kind: 'timer', seconds: 60, chime: true });
  });
});

describe('deriveWalkthrough', () => {
  const w = deriveWalkthrough(runSession);

  it('flattens blocks into ordered steps with sequential ids and the block label as group', () => {
    expect(w.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(w.steps.map((s) => s.title)).toEqual(['Warm up', 'Find your zone', 'Run', 'Cool down']);
    expect(w.steps.map((s) => s.group)).toEqual(['Warm-up', 'Main', 'Main', 'Cool down']);
  });

  it('carries the cue as body and the how-to as video_query, and totals the per-step minutes', () => {
    expect(w.steps.map((s) => s.body)).toEqual([
      'Walk briskly for 3 minutes to ease into it.',
      undefined,
      'Keep it conversational.',
      undefined,
    ]);
    expect(w.steps.map((s) => s.video_query)).toEqual([undefined, undefined, 'zone 2 running form', undefined]);
    expect(w.steps.map((s) => s.minutes)).toEqual([3, 2, 20, 5]);
    expect(w.total_min).toBe(30);
  });

  it('flags the single longest step as the core', () => {
    expect(w.steps.filter((s) => s.core).map((s) => s.title)).toEqual(['Run']);
  });

  it('uses per-tool floors when an item has no explicit duration', () => {
    const s = deriveWalkthrough({
      ...runSession,
      blocks: [{ label: 'Main', items: [{ name: 'Squat', sets: 3, reps: 5 }] }],
    });
    expect(s.steps.map((x) => x.minutes)).toEqual([3]); // reps floor
    expect(s.total_min).toBe(3);
  });

  it('is total on empty/absent input', () => {
    expect(deriveWalkthrough(null)).toEqual({ steps: [], total_min: 0 });
    expect(deriveWalkthrough({ ...runSession, blocks: [] })).toEqual({ steps: [], total_min: 0 });
  });

  it('is deterministic — same session projects to an identical walkthrough', () => {
    expect(deriveWalkthrough(runSession)).toEqual(deriveWalkthrough(runSession));
  });
});

describe('deriveWalkthrough — circuit blocks', () => {
  const circuitItems: SessionItem[] = [
    { name: 'Band pull-aparts', sets: 2, reps: 15, load: 'light band' },
    { name: 'Plank', sets: 2, duration_min: 1 },
  ];
  const circuitSession: OccurrenceSession = {
    blocks: [{ label: 'Conditioning circuit', mode: 'circuit', items: circuitItems }],
    note: '',
    generated_at: '2026-07-28T00:00:00.000Z',
    version: 1,
  };

  it('projects a circuit block to ONE step whose tool rotates the items (reps vs timed hold)', () => {
    const w = deriveWalkthrough(circuitSession);
    expect(w.steps).toHaveLength(1);
    expect(w.steps[0]?.title).toBe('Conditioning circuit');
    expect(w.steps[0]?.tool).toEqual({
      kind: 'circuit',
      rounds: 2,
      exercises: [
        { name: 'Band pull-aparts', reps: 15, load: 'light band' },
        { name: 'Plank', seconds: 60 },
      ],
    });
  });

  it("defaults rounds to the items' max sets, and honors an explicit rounds", () => {
    expect(deriveWalkthrough(circuitSession).steps[0]?.tool).toMatchObject({ rounds: 2 });
    const explicit = deriveWalkthrough({
      ...circuitSession,
      blocks: [{ label: 'Conditioning circuit', mode: 'circuit', rounds: 3, items: circuitItems }],
    });
    expect(explicit.steps[0]?.tool).toMatchObject({ rounds: 3 });
  });

  it('leaves a straight block (no mode) flattened, one step per item', () => {
    const straight = deriveWalkthrough({
      ...circuitSession,
      blocks: [{ label: 'Main', items: circuitItems }],
    });
    expect(straight.steps.map((s) => s.title)).toEqual(['Band pull-aparts', 'Plank']);
  });

  it('captures structured data (the rounds done)', () => {
    expect(stepCaptureMode({ kind: 'circuit', rounds: 2, exercises: [] })).toBe('structured');
  });
});

describe('stepCaptureMode', () => {
  it('classifies tools into orient / guided / capture', () => {
    expect(stepCaptureMode({ kind: 'rings', source: 'nutrition' })).toBe('none');
    expect(stepCaptureMode({ kind: 'insight', card: 'streak' })).toBe('none');
    expect(stepCaptureMode({ kind: 'timer', seconds: 30 })).toBe('done');
    expect(stepCaptureMode({ kind: 'read' })).toBe('done');
    expect(stepCaptureMode({ kind: 'reps', sets: 3 })).toBe('structured');
    expect(stepCaptureMode({ kind: 'journal', prompt: 'How was it?', mode: 'either' })).toBe('structured');
  });
});

describe('condense — "I have less time"', () => {
  it('keeps the setup step plus the core at half, matching the 13-minute example', () => {
    const short = condense(deriveWalkthrough(runSession));
    expect(short.steps.map((s) => s.title)).toEqual(['Warm up', 'Run']);
    expect(short.steps.map((s) => s.minutes)).toEqual([3, 10]);
    expect(short.total_min).toBe(13);
  });

  it('never drops the core and floors a halved core at 2 minutes', () => {
    const w = deriveWalkthrough({
      ...runSession,
      blocks: [
        {
          label: 'Main',
          items: [
            { name: 'Setup', duration_min: 1 },
            { name: 'Filler', duration_min: 1 },
            { name: 'The point', duration_min: 3 },
          ],
        },
      ],
    });
    const short = condense(w);
    expect(short.steps.map((s) => s.title)).toEqual(['Setup', 'The point']);
    expect(short.steps.map((s) => s.minutes)).toEqual([1, 2]); // round(3/2)=2, floor holds
  });

  it('leaves a ≤2-step task untouched', () => {
    const w = deriveWalkthrough({
      ...runSession,
      blocks: [
        {
          label: 'Main',
          items: [
            { name: 'Warm up', duration_min: 2 },
            { name: 'Go', duration_min: 10 },
          ],
        },
      ],
    });
    expect(condense(w)).toEqual(w);
  });

  it('when the first step is itself the core, keeps just that step (halved)', () => {
    const w = deriveWalkthrough({
      ...runSession,
      blocks: [
        {
          label: 'Main',
          items: [
            { name: 'Long run', duration_min: 40 },
            { name: 'Stretch', duration_min: 5 },
            { name: 'Notes', duration_min: 2 },
          ],
        },
      ],
    });
    const short = condense(w);
    expect(short.steps.map((s) => s.title)).toEqual(['Long run']);
    expect(short.total_min).toBe(20);
  });
});

describe('journal steps always open with a usable question', () => {
  const step = (item: Record<string, unknown>) =>
    deriveWalkthrough({ blocks: [{ label: 'x', items: [{ name: 'Write', tool: 'journal', ...item }] }] } as never)
      .steps[0];

  it("the coach's own question wins over a bank it also named", () => {
    const t = step({ detail: 'Free-write the scene you left yesterday.', journal_bank: 'three_good_things' });
    expect(t?.tool.kind === 'journal' && t.tool.prompt).toBe('Free-write the scene you left yesterday.');
  });

  it('falls back to the named bank when the coach wrote no question', () => {
    const t = step({ journal_bank: 'free_write' });
    expect(t?.tool.kind === 'journal' && t.tool.prompt).toBeTruthy();
    expect(t?.tool.kind === 'journal' && t.tool.prompt).not.toBe('What do you want to write?');
  });

  // The live coach really does emit journal items with neither field (seen on a study activity),
  // so this last resort has to read sensibly for craft, study and devotion — not just for a workout.
  it('degrades to a practice-neutral line, never a workout assumption', () => {
    const t = step({});
    expect(t?.tool.kind === 'journal' && t.tool.prompt).toBe('What do you want to write?');
    expect(t?.tool.kind === 'journal' && t.tool.prompt).not.toMatch(/how it went|workout|session|training/i);
  });
});
