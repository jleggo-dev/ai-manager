import { describe, it, expect } from 'vitest';
import type { OccurrenceSession, SessionItem } from './types/occurrence.ts';
import { deriveWalkthrough, condense, inferTool, stepCaptureMode, type WalkthroughStep } from './walkthrough.ts';

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
  // The catalog tells the coach `tool: null` is safe. These pin the ordering that makes that
  // true: a tool-specific field is unambiguous and outranks any quantity. Before this, the first
  // case below became a bare TIMER and the second became READ — the widget silently vanished.
  it('a journal bank with a duration is a timed journal, never a bare timer', () => {
    const t = inferTool({ name: 'Morning pages', journal_bank: 'free_write', duration_min: 20 });
    expect(t.kind).toBe('journal');
    expect(t.kind === 'journal' && t.minutes).toBe(20);
  });
  it('a bank alone is a journal, not read', () => {
    expect(inferTool({ name: 'Gratitude', journal_bank: 'three_good_things' }).kind).toBe('journal');
  });
  it('a grounding game outranks a duration', () => {
    expect(inferTool({ name: 'Noticing', grounding_game: 'senses', duration_min: 5 }).kind).toBe('grounding');
  });
  it('bells mean a sit, not a timer', () => {
    expect(inferTool({ name: 'Sit', meditate_bells: 'start_end', duration_min: 10 }).kind).toBe('meditate');
  });
  it('an explicit pattern infers breathing; a bare duration still never does', () => {
    expect(inferTool({ name: 'Settle', breath_pattern: 'box', breath_cycles: 6 }).kind).toBe('breathing');
    expect(inferTool({ name: 'Breathing', duration_min: 5 }).kind).toBe('timer');
  });
  it('junk field values fall through to the quantity path, never crash', () => {
    expect(inferTool({ name: 'X', journal_bank: 'not_a_bank', duration_min: 2 }).kind).toBe('timer');
    expect(inferTool({ name: 'Y', grounding_game: 'not_a_game' }).kind).toBe('read');
  });

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

describe('the cues a timer reads off its own step (step-cues.ts)', () => {
  // From the 2026-09-06 ruck: the 50-min timer auto-advanced at 50:00 and could not be told the
  // ruck ran to 110; the calf stretch said "switch sides" and nothing marked halfway.
  it('a long timer is open-ended — it keeps running past its target until stopped', () => {
    expect(inferTool({ name: 'Ruck', duration_min: 50, tool: 'timer' })).toEqual({
      kind: 'timer',
      seconds: 3000,
      chime: true,
      open_ended: true,
    });
    // Inferred from the duration alone, the same rule applies.
    expect(inferTool({ name: 'Easy walk', duration_min: 10 })).toMatchObject({ kind: 'timer', open_ended: true });
  });
  it('a short hold is not — a 60s stretch still chimes and moves on', () => {
    expect(inferTool({ name: 'Wall sit', duration_min: 1 })).toEqual({ kind: 'timer', seconds: 60, chime: true });
  });
  it('the coach states per_side, and her word beats the cue text either way', () => {
    expect(inferTool({ name: 'Calf stretch', duration_min: 1, tool: 'timer', per_side: true })).toEqual({
      kind: 'timer',
      seconds: 60,
      chime: true,
      switch_sides: true,
    });
    // She said no: a cue that happens to say "each side" does not overrule her.
    expect(
      inferTool({ name: 'Wall sit', duration_min: 1, tool: 'timer', per_side: false, detail: 'Feel it on each side.' }),
    ).toEqual({ kind: 'timer', seconds: 60, chime: true });
  });
  it('"switch sides" in the cue or the title adds the halfway chime — the fallback for older sessions', () => {
    expect(
      inferTool({ name: 'Calf stretch against wall', duration_min: 1, detail: 'Hold 30s, then switch sides.' }),
    ).toEqual({ kind: 'timer', seconds: 60, chime: true, switch_sides: true });
    expect(inferTool({ name: 'Hip flexor stretch (each side)', duration_min: 2, tool: 'timer' })).toMatchObject({
      switch_sides: true,
    });
    // The near-miss: a side plank is ONE side.
    expect(inferTool({ name: 'Side plank', duration_min: 1 })).toEqual({ kind: 'timer', seconds: 60, chime: true });
  });
});

describe('a feeling_log about a body part becomes a free-text check on that part', () => {
  // "Knee check-in" prescribed as a feeling_log asked settled / wired / foggy about a knee.
  it('reroutes by the named part, asking in the coach’s voice', () => {
    expect(inferTool({ name: 'Knee check-in', tool: 'feeling_log' })).toEqual({
      kind: 'checkoff',
      prompt: 'How is the knee?',
    });
  });
  it('the coach’s own question wins when she wrote one', () => {
    expect(inferTool({ name: 'Ankle check', tool: 'feeling_log', detail: 'Any pinch on the outside?' })).toEqual({
      kind: 'checkoff',
      prompt: 'Any pinch on the outside?',
    });
  });
  it('a real feeling log is untouched', () => {
    expect(inferTool({ name: 'How are you doing?', tool: 'feeling_log' })).toEqual({ kind: 'feeling_log' });
    expect(inferTool({ name: 'Mood check', tool: 'feeling_log' })).toEqual({ kind: 'feeling_log' });
  });
});

describe('measure — the one tool with no item.tool route', () => {
  // `measure` is deliberately excluded from `SessionItemTool` (tool-catalog.ts): the coach never
  // emits it, so `measure_metric`/`measure_unit` are the ONLY way an item becomes a measure step —
  // there is no `tool: 'measure'` to test alongside the others above.
  it('infers from metric + unit together', () => {
    expect(inferTool({ name: 'Weigh in', measure_metric: 'Weight', measure_unit: 'kg' })).toEqual({
      kind: 'measure',
      metric: 'Weight',
      unit: 'kg',
    });
  });

  it('a unit alone is enough to infer measure, even with a duration on the item', () => {
    expect(inferTool({ name: 'Body weight', measure_unit: 'lb', duration_min: 2 }).kind).toBe('measure');
  });

  it('degrades honestly: no metric falls back to the item name, no unit is an empty string (never "undefined")', () => {
    expect(inferTool({ name: 'Wingspan', measure_unit: 'cm' })).toEqual({
      kind: 'measure',
      metric: 'Wingspan',
      unit: 'cm',
    });
    expect(inferTool({ name: 'Reach', measure_metric: 'Reach' })).toEqual({
      kind: 'measure',
      metric: 'Reach',
      unit: '',
    });
  });

  it('measure-specific fields outrank the quantity fallback chain (sets/duration/distance)', () => {
    expect(inferTool({ name: 'Post-run weigh-in', measure_unit: 'kg', sets: 3, duration_min: 5 }).kind).toBe('measure');
  });

  it('blank strings are not a signal — falls through to read, same as any other absent field', () => {
    expect(inferTool({ name: 'Nothing here', measure_metric: '  ', measure_unit: '' })).toEqual({ kind: 'read' });
  });

  it('captures structured data, like reps/photo/journal', () => {
    expect(stepCaptureMode({ kind: 'measure', metric: 'Weight', unit: 'kg' })).toBe('structured');
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

  it('projects a measure item end to end (a client-built activity, not a coach one)', () => {
    const w = deriveWalkthrough({
      ...runSession,
      blocks: [{ label: 'Weigh-in', items: [{ name: 'Body weight', measure_metric: 'Weight', measure_unit: 'kg' }] }],
    });
    expect(w.steps[0]?.tool).toEqual({ kind: 'measure', metric: 'Weight', unit: 'kg' });
    expect(w.steps[0]?.minutes).toBe(1); // the measure floor — no duration on a numeric entry
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

describe('the metronome rides along', () => {
  // The whole design in one assertion: attaching a pulse must not change what the step IS. Before
  // this test the failure mode to fear was a metronome that looked like a tool and quietly replaced
  // the timer it was meant to accompany — the same class of bug the inferTool cases above pin.
  const piano = (extra: Record<string, unknown>) =>
    deriveWalkthrough({
      blocks: [{ label: 'Practice', items: [{ name: 'Hanon no. 1', duration_min: 10, ...extra }] }],
      note: '',
      generated_at: '2026-08-29T00:00:00.000Z',
      version: 1,
    }).steps[0] as WalkthroughStep;

  it('attaches the pulse WITHOUT displacing the tool', () => {
    const step = piano({ metronome_bpm: 72, metronome_meter: 3 });
    expect(step.tool.kind).toBe('timer'); // still a timer step, now with a beat
    expect(step.metronome).toEqual({ bpm: 72, meter: 3 });
  });

  it('is absent on every step the coach did not ask for one on', () => {
    expect(piano({}).metronome).toBeUndefined();
    expect(piano({ metronome_meter: 4 }).metronome).toBeUndefined(); // a meter alone is not a pulse
  });

  it('defaults the meter but never the tempo', () => {
    expect(piano({ metronome_bpm: 60 }).metronome).toEqual({ bpm: 60, meter: 4 });
  });

  it('clamps a tempo nobody can play rather than dropping the step', () => {
    const step = piano({ metronome_bpm: 900, metronome_meter: 99 });
    expect(step.metronome).toEqual({ bpm: 240, meter: 12 });
    expect(step.title).toBe('Hanon no. 1');
  });

  it('rides along with a journal step too — a practice log can have a beat', () => {
    const step = piano({ journal_bank: 'free_write', metronome_bpm: 88 });
    expect(step.tool.kind).toBe('journal');
    expect(step.metronome?.bpm).toBe(88);
  });
});
