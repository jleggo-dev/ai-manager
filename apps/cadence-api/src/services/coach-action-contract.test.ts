/**
 * What every action hands back — the contract test (HARNESS-V3 C4, gap 3).
 *
 * An action that changes their data, or puts something on their screen to accept, answers in one
 * of three shapes, and its FIRST line says which: `changed:` (tool-response.ts `toolChangeText`),
 * `nothing changed:` (`toolNothingChangedText`), or a fault (`toolActionFaultText`). Her
 * confirmation to the user is then read from what the tool stated, not inferred from prose — the
 * gap that let "I've updated it" follow a call that changed nothing.
 *
 * This walks EVERY registered action against a small faked store: at least one call that changes
 * something and one that changes nothing, each asserted by shape. The table is keyed by tool name
 * and checked against the registry, so a new action without a row here fails by name.
 *
 * The fakes stand in at the repo and external-service boundary only; the actions' own logic
 * (matching, merging, verifying after the write) runs for real. Per-action behaviour is pinned in
 * each action's own test file — this one asks only "which of the three did it say".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

/** The faked store. Writes land on it, so actions that read their own write back see it. */
const db = vi.hoisted(() => ({
  user: {} as Row & { baseline?: Row & { constraints?: Row[] }; macro_targets?: Row; home_location?: Row | null },
  plan: null as Row | null,
  equipment: [] as Array<{ equipment_id: string; name: string; category: string }>,
}));

const fake = vi.hoisted(() => ({
  buildNextWeek: vi.fn(),
  buildWeekAhead: vi.fn(),
  extendHorizon: vi.fn(),
  enterEpisode: vi.fn(),
  reviseSession: vi.fn(),
  startReplanRun: vi.fn(),
  logMeal: vi.fn(),
  previewDescribedMeal: vi.fn(),
  logOccurrence: vi.fn(),
  composeProgressLayout: vi.fn(),
  geocodeCity: vi.fn(),
  removeOccurrence: vi.fn(),
}));

vi.mock('../repos/users.ts', () => ({
  getUser: async () => db.user,
  setPendingPlan: async () => undefined,
  setPendingWeekReview: async () => undefined,
  setPendingRepertoireReview: async () => undefined,
  setPendingQuestionnaire: async () => undefined,
  setMacroTargets: async (_u: string, next: Row) => {
    db.user.macro_targets = next;
  },
  setHomeLocation: async (_u: string, loc: Row) => {
    db.user.home_location = loc;
  },
  mergeCapturedConstraints: async (_u: string, rows: Row[]) => {
    db.user.baseline!.constraints = [...(db.user.baseline!.constraints ?? []), ...rows];
  },
  removeCapturedConstraint: async () => false,
  renameCapturedConstraint: async () => null,
}));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: async () => db.plan }));
vi.mock('../repos/activities.ts', () => ({
  listActivities: async () => [
    {
      activity_id: 'a1',
      commitment_id: 'aaaaaaaa-1111-4111-8111-111111111111',
      plan_id: 'p1',
      title: 'Easy run',
      kind: 'user',
      schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', duration_min: 40 },
      completion_source: 'self_report',
      goal_id: 'g1',
    },
  ],
  listActivitiesByIds: async () => [],
}));
vi.mock('../repos/goals.ts', () => ({
  listGoals: async () => [
    {
      goal_id: 'g1',
      title: 'Read 100 books',
      status: 'committed',
      measure: { target: 100, unit: 'books' },
      timeframe: {},
    },
  ],
  listGoalsByStatus: async () => [{ goal_id: 'g1', title: 'Read 100 books' }],
  updateGoal: async () => undefined,
  setGoalStatus: async () => undefined,
  retireGoal: async () => ({}),
  restoreGoal: async () => ({}),
}));
vi.mock('../repos/goal-events.ts', () => ({ insertGoalEvent: async () => ({}) }));
vi.mock('../repos/occurrences.ts', () => ({
  listLoggedForCorrection: async () => [
    {
      occurrence_id: 'o1',
      date: '2026-08-12',
      title: 'Easy run',
      status: 'done',
      value: { distance_km: 3 },
      recurrence: '',
      log: null,
    },
  ],
  listRecentForLogging: async () => [{ occurrence_id: 'o1', date: '2026-08-12', title: 'Easy run', logged: false }],
  listOccurrences: async () => [{ occurrence_id: 'o-e', activity_id: 'a1', date: '2026-09-15', status: 'pending' }],
  correctOccurrenceLog: async () => undefined,
  deleteOccurrence: async () => undefined,
}));
vi.mock('../repos/equipment.ts', () => ({
  listEquipment: async () => db.equipment,
  insertEquipment: async (_u: string, e: { name: string; category: string }) => {
    db.equipment.push({ equipment_id: `e${db.equipment.length + 1}`, ...e });
  },
  updateEquipment: async () => undefined,
  deleteEquipment: async () => undefined,
}));
vi.mock('../repos/follow-ups.ts', () => ({
  FOLLOW_UP_ID_PREFIX: 8,
  noteFollowUp: async (_u: string, i: { text: string; due_on: string | null }) => ({
    follow_up_id: '3f9a2c1d-0000-4000-8000-000000000000',
    text: i.text,
    due_on: i.due_on,
  }),
  closeFollowUp: async () => ({ follow_up_id: '3f9a2c1d-0000-4000-8000-000000000000', text: 'ask about the race' }),
}));
vi.mock('../repos/repertoire.ts', () => ({
  listRepertoire: async () => [],
  upsertRepertoireItem: async (_u: string, item: { label: string; status: string }) => ({
    item: { item_id: 'i1', goal_id: null, label: item.label, status: item.status },
    learnedNow: false,
  }),
}));
vi.mock('../repos/episodes.ts', () => ({ getActiveEpisode: async () => null }));
vi.mock('../repos/occurrence-sessions.ts', () => ({
  listUpcomingForRevision: async () => [{ occurrence_id: 'o9', date: '2026-09-03', title: 'Strength' }],
}));
vi.mock('./repertoire-practice.ts', async () => ({
  ...(await vi.importActual<typeof import('./repertoire-practice.ts')>('./repertoire-practice.ts')),
  invalidateSessionsFor: async () => undefined,
}));
vi.mock('./week-build.ts', () => ({ buildNextWeek: fake.buildNextWeek, buildWeekAhead: fake.buildWeekAhead }));
vi.mock('./plan-horizon.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./plan-horizon.ts')>()),
  extendHorizon: fake.extendHorizon,
}));
vi.mock('./episode.ts', () => ({ enterEpisode: fake.enterEpisode }));
vi.mock('./session-generate.ts', () => ({ reviseSession: fake.reviseSession }));
vi.mock('./replan-start.ts', () => ({ startReplanRun: fake.startReplanRun }));
vi.mock('./plan-run.ts', () => ({ readPlanRun: () => null }));
vi.mock('./nutrition.ts', () => ({ logMeal: fake.logMeal }));
// log_meal reads the words the coach-led way before it writes (food-log-described.ts); the read is
// faked at its own boundary so the action's choice of what to log, and what to hand back, runs for real.
vi.mock('./food-described-meal.ts', () => ({ previewDescribedMeal: fake.previewDescribedMeal }));
vi.mock('./session-log.ts', () => ({ logOccurrence: fake.logOccurrence }));
vi.mock('./progress-layout-compose.ts', () => ({ composeProgressLayout: fake.composeProgressLayout }));
vi.mock('./weather/weather.ts', () => ({ geocodeCity: fake.geocodeCity }));
vi.mock('./occurrence-edit.ts', () => ({
  moveOccurrence: async () => ({ status: 'ok' }),
  duplicateOccurrence: async () => ({ status: 'ok' }),
  removeOccurrence: fake.removeOccurrence,
}));

const { COACH_ACTION_TOOLS } = await import('./coach-actions.ts');
const { toolOutputShape } = await import('./tool-response.ts');

type Shape = 'changed' | 'nothing-changed' | 'fault';
interface Case {
  label: string;
  params: Record<string, unknown>;
  want: Shape;
  /** Point a fake at the outcome this case needs, after the defaults are reset. */
  setup?: () => void;
}

/** A day `n` from today, YYYY-MM-DD — pause_week reads the real clock. */
const daysFromNow = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const QUESTIONS = [
  { id: 'days_free', label: 'Which days are usually free?', kind: 'multi', options: ['Mon', 'Wed'] },
  { id: 'session_length', label: 'How long can a session be?', kind: 'number' },
];

/** The coach-led read of "a banana": one record row, priced by the store, her words on it. */
const describedBanana = () => ({
  meal: 'snack',
  items: [
    {
      name: 'Banana, raw',
      qty: 1,
      unit: 'medium',
      est: { kcal: 105, source: 'ledger' },
      food_id: 'f-banana',
      said: 'a banana',
      basis: 'record',
      source_label: 'USDA',
    },
  ],
  macros: { kcal: 105, source: 'ledger' },
  confidence: null,
  flags: {},
  raw_text: 'a banana',
  coach: { reached: true, calls: 1, checked: [] },
});

/** Bad or empty input changes nothing — every action gets this row. */
const empty = (want: Shape = 'nothing-changed'): Case => ({ label: 'no arguments', params: {}, want });

const CASES: Record<string, Case[]> = {
  propose_plan_change: [
    { label: 'no edits', params: { edits: [] }, want: 'nothing-changed' },
    {
      label: 'move a commitment',
      params: { edits: [{ action: 'move', activity: 'Easy run', days: ['friday'] }] },
      want: 'changed',
    },
  ],
  update_goal: [
    empty(),
    { label: 'retarget', params: { goal: 'Read 100 books', action: 'retarget', target: 50 }, want: 'changed' },
  ],
  correct_log: [
    empty(),
    {
      label: 'correct a distance',
      params: { activity: 'Easy run', date: '2026-08-12', metrics: { distance_km: 5 } },
      want: 'changed',
    },
  ],
  update_constraint: [
    empty(),
    { label: 'add one', params: { constraint: 'night shifts', action: 'add', kind: 'life' }, want: 'changed' },
  ],
  update_equipment: [
    empty(),
    { label: 'add one', params: { item: 'rowing machine', action: 'add', category: 'cardio' }, want: 'changed' },
  ],
  open_week_review: [
    { label: 'no plan', params: {}, want: 'nothing-changed', setup: () => (db.plan = null) },
    { label: 'a week to review', params: {}, want: 'changed' },
  ],
  build_next_week: [
    {
      label: 'week still running',
      params: {},
      want: 'nothing-changed',
      setup: () => fake.buildNextWeek.mockResolvedValue({ status: 'not_due' }),
    },
    { label: 'a finished week', params: {}, want: 'changed' },
  ],
  shape_week: [
    empty(),
    { label: 'extend', params: { action: 'extend', days: 14 }, want: 'changed' },
    { label: 'build ahead', params: { action: 'build_ahead' }, want: 'changed' },
    { label: 'pause', params: { action: 'pause', end: daysFromNow(3) }, want: 'changed' },
  ],
  rebuild: [
    empty(),
    { label: 'one session', params: { scope: 'session', session: 'Strength', steer: 'add abs' }, want: 'changed' },
    { label: 'the whole week', params: { scope: 'week', steer: 'more recovery' }, want: 'changed' },
  ],
  edit_calendar: [
    empty(),
    { label: 'delete one', params: { action: 'delete', date: '2026-09-15', title: 'Easy run' }, want: 'changed' },
  ],
  log_meal: [
    empty(),
    { label: 'a banana', params: { text: 'a banana' }, want: 'changed' },
    {
      label: 'a part waits on their answer',
      params: { text: 'milk' },
      want: 'nothing-changed',
      setup: () =>
        fake.previewDescribedMeal.mockResolvedValue({
          ...describedBanana(),
          items: [{ name: 'milk', basis: 'none', question: 'Whole milk or 2%?' }],
          macros: null,
          raw_text: 'milk',
        }),
    },
    {
      label: 'the ledger throws',
      params: { text: 'a banana' },
      want: 'fault',
      setup: () => fake.logMeal.mockRejectedValue(new Error('down')),
    },
    {
      label: 'the read fails past its fallback',
      params: { text: 'a banana' },
      want: 'fault',
      setup: () => fake.previewDescribedMeal.mockRejectedValue(new Error('down')),
    },
  ],
  set_micro_target: [
    empty(),
    {
      label: 'a doctor’s number',
      params: { nutrient: 'vitamin_c_mg', amount: 2000, why: 'her doctor' },
      want: 'changed',
    },
  ],
  propose_progress_layout: [
    empty(),
    { label: 'composed', params: { what_they_want: 'pages written' }, want: 'changed' },
    {
      label: 'the composer throws',
      params: { what_they_want: 'pages written' },
      want: 'fault',
      setup: () => fake.composeProgressLayout.mockRejectedValue(new Error('down')),
    },
  ],
  set_home_location: [empty(), { label: 'a city', params: { place: 'Denver' }, want: 'changed' }],
  note_follow_up: [empty(), { label: 'a note', params: { text: 'ask about the race' }, want: 'changed' }],
  close_follow_up: [empty(), { label: 'by id', params: { id: '3f9a2c1d' }, want: 'changed' }],
  update_repertoire: [
    empty(),
    { label: 'one piece', params: { items: [{ label: 'Arietta', status: 'known' }] }, want: 'changed' },
  ],
  offer_repertoire_review: [
    empty(),
    { label: 'a book', params: { collection: 'Suzuki Piano Book 2' }, want: 'changed' },
  ],
  send_questionnaire: [empty(), { label: 'two questions', params: { questions: QUESTIONS }, want: 'changed' }],
  log_session: [
    empty(),
    { label: 'a report', params: { session: 'Easy run', report: 'felt good' }, want: 'changed' },
    {
      label: 'the write comes back empty',
      params: { session: 'Easy run', report: 'felt good' },
      want: 'fault',
      setup: () => fake.logOccurrence.mockResolvedValue(null),
    },
  ],
  set_macro_targets: [empty(), { label: 'new numbers', params: { kcal: 2100, why: 'a reason' }, want: 'changed' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user = {
    timezone: null,
    pending_plan: null,
    baseline: { sex: 'male', age: 40, constraints: [{ id: 'c1', label: 'left knee', plan_around: true }] },
    macro_targets: { kcal: 2000 },
    home_location: null,
  };
  db.plan = { plan_id: 'p1', version: 2, generated_at: '2026-08-24T00:00:00.000Z' };
  db.equipment = [{ equipment_id: 'e1', name: '2x50lb dumbbells', category: 'strength' }];
  fake.buildNextWeek.mockResolvedValue({ status: 'built', version: 13 });
  fake.buildWeekAhead.mockResolvedValue({ status: 'built', builtThrough: '2026-09-20', occurrences: 9 });
  fake.extendHorizon.mockResolvedValue({ status: 'extended', horizonDays: 14, endsOn: '2026-09-12', materialized: 9 });
  fake.enterEpisode.mockImplementation(async (_u: string, e: { start: string; end: string }) => ({
    episode: { start: e.start, end: e.end },
  }));
  fake.reviseSession.mockResolvedValue({
    status: 'revised',
    occ: {},
    session: { blocks: [{ items: [1, 2] }], note: 'n' },
  });
  fake.startReplanRun.mockResolvedValue('started');
  fake.previewDescribedMeal.mockResolvedValue(describedBanana());
  fake.logMeal.mockResolvedValue({
    date: '2026-10-31',
    meal: 'snack',
    items: [{ name: 'Banana, raw', qty: 1, unit: 'medium', est: { kcal: 105 }, food_id: 'f-banana' }],
    macros: { kcal: 105 },
    provisional: false,
  });
  fake.logOccurrence.mockResolvedValue({ summary: 'felt good' });
  fake.composeProgressLayout.mockResolvedValue({ ok: true, draft_id: 'd1', layout: {} });
  fake.geocodeCity.mockResolvedValue({ lat: 39.7392, lon: -104.9903, label: 'Denver, CO, US' });
  fake.removeOccurrence.mockResolvedValue('ok');
});

describe('every action answers in one of three shapes', () => {
  /** The table is the gate: a registered action with no row fails here, by name. */
  it('has a row for every registered action, and every row changes something once and nothing once', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(COACH_ACTION_TOOLS).sort());
    for (const [name, cases] of Object.entries(CASES)) {
      const wants = new Set(cases.map((c) => c.want));
      expect(wants.has('changed'), `${name} has no case that changes something`).toBe(true);
      expect(wants.has('nothing-changed'), `${name} has no case that changes nothing`).toBe(true);
    }
  });

  for (const [name, cases] of Object.entries(CASES)) {
    for (const c of cases) {
      it(`${name} — ${c.label} → ${c.want}`, async () => {
        c.setup?.();
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const out = await COACH_ACTION_TOOLS[name]!.run('u1', c.params);
          expect(toolOutputShape(out), `${name} answered:\n${out}`).toBe(c.want);
        } finally {
          quiet.mockRestore();
        }
      });
    }
  }
});

/**
 * The walk above runs two or three paths per action; an action has a dozen. So the source is held
 * to the same rule: no action file returns a hand-built string or line list — every return goes
 * through one of the three helpers (or a local helper that does). A new path typed as
 * `return 'Done — …'` fails here with its file and line.
 */
describe('no action returns a hand-built string', () => {
  const RAW_RETURN = /\breturn\s+(['"`]|\[)/;
  const COMMENT = /^\s*(\/\/|\*|\/\*)/;

  it.each([
    ["return 'Done — it is set.';", true],
    ["if (!query) return 'No session was named.';", true], // a guard on one line counts too
    ["const returned = ['a'];", false], // a word that starts with "return" is not one
    ['return `Logged ${x}.`;', true],
    ['return ["a", "b"].join("\\n");', true],
    ["return toolChangeText({ changed: ['x'] });", false],
    ['return refused(`no title`);', false], // a local helper that returns through toolNothingChangedText
    ["return paused ? 'a pause' : 'a detour';", false], // a label helper, not an answer
  ])('%s → raw: %s', (line, raw) => {
    expect(RAW_RETURN.test(line)).toBe(raw);
  });

  it('holds for every action source file', () => {
    const dir = new URL('./', import.meta.url);
    const files = readdirSync(dir).filter(
      (f) => (/^coach-action-.+\.ts$/.test(f) || f === 'coach-actions.ts') && !f.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(10);
    const raw: string[] = [];
    for (const f of files) {
      readFileSync(new URL(f, dir), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!COMMENT.test(line) && RAW_RETURN.test(line)) raw.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
        });
    }
    expect(raw, 'return through toolChangeText / toolNothingChangedText / toolActionFaultText').toEqual([]);
  });
});
