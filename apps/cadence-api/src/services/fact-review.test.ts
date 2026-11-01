/**
 * The weekly fact review end to end, with the job and every repo mocked: what is sent, what is
 * written, what is dropped, the caps, the already-open skip — and the trigger, which claims the
 * recap week once and never lets a failure out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FollowUp } from '../repos/follow-ups.ts';

const m = vi.hoisted(() => ({
  runJobBySlug: vi.fn(),
  getUser: vi.fn(),
  listEquipment: vi.fn(),
  listGoals: vi.fn(),
  listEpisodeRanges: vi.fn(),
  listOpenFollowUps: vi.fn(),
  noteFollowUp: vi.fn(),
  claimFactReviewWeek: vi.fn(),
}));

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: m.runJobBySlug }));
vi.mock('../repos/users.ts', () => ({ getUser: m.getUser }));
vi.mock('../repos/equipment.ts', () => ({ listEquipment: m.listEquipment }));
vi.mock('../repos/goals.ts', () => ({ listGoals: m.listGoals }));
vi.mock('../repos/episodes.ts', () => ({ listEpisodeRanges: m.listEpisodeRanges }));
vi.mock('../repos/follow-ups.ts', () => ({ listOpenFollowUps: m.listOpenFollowUps, noteFollowUp: m.noteFollowUp }));
vi.mock('../repos/recaps.ts', () => ({ claimFactReviewWeek: m.claimFactReviewWeek }));

const { runFactReview, MAX_FINDINGS_PER_RUN, MAX_OPEN_FACT_REVIEWS } = await import('./fact-review.ts');
const { maybeRunFactReview, FACT_REVIEW_MIN_DAYS_BETWEEN } = await import('./fact-review-trigger.ts');

const USER = 'u-fact-review';
const TODAY = '2026-10-31';

/** e1 gym membership (Feb), c1 the gym closed — the design's own example. */
function seedFile() {
  m.getUser.mockResolvedValue({
    id: USER,
    baseline: {
      constraints: [{ id: 'k1', label: 'gym closed for renovation', kind: 'life', plan_around: true }],
      starting_point: { doing_now: ['lifts at the gym twice a week'] },
      preferences: { dietary: ['vegetarian'] },
    },
    dietary_profile: { allergens: ['peanuts'] },
  });
  m.listEquipment.mockResolvedValue([
    {
      equipment_id: 'x',
      name: 'gym membership',
      category: 'other',
      owned: true,
      recommended_by: null,
      linked_goal_ids: [],
      created_at: new Date('2026-02-01T10:00:00Z'),
    },
  ]);
  m.listGoals.mockResolvedValue([]);
  m.listEpisodeRanges.mockResolvedValue([{ type: 'custom', start: '2026-06-01', end: '2026-06-30' }]);
}

const finding = (question: string, over: Record<string, unknown> = {}) => ({
  fact_ids: ['e1', 'c1'],
  kind: 'stale',
  evidence: '[e1] "gym membership" (added 2026-02-01) and [c1] "gym closed for renovation".',
  question,
  ...over,
});
const answer = (...findings: unknown[]) => ({ raw: '', formatted: JSON.stringify({ findings }) });

const open = (text: string, source: 'coach' | 'fact-review'): FollowUp => ({
  follow_up_id: `${text.length}0000000-0000-4000-a000-000000000000`,
  text,
  due_on: null,
  created_at: '2026-10-20T00:00:00Z',
  age_days: 11,
  source,
});

beforeEach(() => {
  vi.clearAllMocks();
  seedFile();
  m.listOpenFollowUps.mockResolvedValue([]);
  m.noteFollowUp.mockImplementation(async (_u: string, input: { text: string }) => ({
    ...open(input.text, 'fact-review'),
  }));
  m.runJobBySlug.mockResolvedValue(answer());
  m.claimFactReviewWeek.mockResolvedValue(true);
});

describe('runFactReview', () => {
  it('sends the numbered facts and what is already open, and never allergies or dietary choices', async () => {
    m.listOpenFollowUps.mockResolvedValue([
      open('Is the race still on?', 'fact-review'),
      open('Ask about the knee', 'coach'),
    ]);
    await runFactReview(USER, TODAY);
    expect(m.runJobBySlug).toHaveBeenCalledTimes(1);
    const [user, slug, vars] = m.runJobBySlug.mock.calls[0]!;
    expect(user).toBe(USER);
    expect(slug).toBe('fact-review');
    expect(vars.facts).toContain('[c1] constraint: "gym closed for renovation"');
    expect(vars.facts).toContain('[n1] doing_now: "lifts at the gym twice a week"');
    expect(vars.facts).toContain('[e1] equipment: "gym membership" — added 2026-02-01');
    expect(vars.facts).toContain('[d1] detour: "custom detour" — 2026-06-01 to 2026-06-30; ended');
    expect(vars.facts).not.toMatch(/peanut|vegetarian/i);
    // Only its own open questions — the coach's promise is hers, not something it found.
    expect(vars.already_asked).toBe('- Is the race still on?');
  });

  it('reads detours over the past year and the next three months', async () => {
    await runFactReview(USER, TODAY);
    expect(m.listEpisodeRanges).toHaveBeenCalledWith(USER, '2025-10-31', '2027-01-29');
  });

  it('writes each finding as a fact-review follow-up: the question as text, the evidence with the facts resolved', async () => {
    m.runJobBySlug.mockResolvedValue(answer(finding('You mentioned the gym closed in June — are you back there?')));
    const out = await runFactReview(USER, TODAY);
    expect(out).toMatchObject({ ran: true, reason: 'reviewed', found: 1, written: 1 });
    expect(m.noteFollowUp).toHaveBeenCalledTimes(1);
    const [user, input] = m.noteFollowUp.mock.calls[0]!;
    expect(user).toBe(USER);
    expect(input.text).toBe('You mentioned the gym closed in June — are you back there?');
    expect(input.source).toBe('fact-review');
    expect(input.evidence).toContain('stale: [e1] "gym membership"');
    expect(input.evidence).toContain('[e1] equipment: "gym membership" — added 2026-02-01; other');
    expect(input.evidence).toContain('[c1] constraint: "gym closed for renovation"');
  });

  it('drops a finding without evidence, writes the rest, and counts the drop', async () => {
    m.runJobBySlug.mockResolvedValue(
      answer(
        finding('Are you back at the gym?', { evidence: '' }),
        finding('Is the gym open again?', { evidence: 'These disagree.' }),
        finding('Do you still have the membership?'),
      ),
    );
    const out = await runFactReview(USER, TODAY);
    expect(out.dropped.no_evidence).toBe(2);
    expect(out.written).toBe(1);
    expect(m.noteFollowUp.mock.calls.map((c) => c[1].text)).toEqual(['Do you still have the membership?']);
  });

  it(`writes at most ${MAX_FINDINGS_PER_RUN} in one run, and counts the rest`, async () => {
    m.runJobBySlug.mockResolvedValue(answer(finding('a?'), finding('b?'), finding('c?'), finding('d?'), finding('e?')));
    const out = await runFactReview(USER, TODAY);
    expect(out.written).toBe(MAX_FINDINGS_PER_RUN);
    expect(out.over_cap).toBe(5 - MAX_FINDINGS_PER_RUN);
    expect(m.noteFollowUp).toHaveBeenCalledTimes(MAX_FINDINGS_PER_RUN);
  });

  it(`keeps no more than ${MAX_OPEN_FACT_REVIEWS} of its questions open across weeks`, async () => {
    m.listOpenFollowUps.mockResolvedValue([open('first?', 'fact-review'), open('second?', 'fact-review')]);
    m.runJobBySlug.mockResolvedValue(answer(finding('a?'), finding('b?')));
    const out = await runFactReview(USER, TODAY);
    expect(out.written).toBe(MAX_OPEN_FACT_REVIEWS - 2);
  });

  it('makes no model call when its open questions are already at the ceiling', async () => {
    m.listOpenFollowUps.mockResolvedValue(
      Array.from({ length: MAX_OPEN_FACT_REVIEWS }, (_, i) => open(`q${i}?`, 'fact-review')),
    );
    const out = await runFactReview(USER, TODAY);
    expect(out).toMatchObject({ ran: false, reason: 'no_room' });
    expect(m.runJobBySlug).not.toHaveBeenCalled();
  });

  it('coach follow-ups never count against its ceiling', async () => {
    m.listOpenFollowUps.mockResolvedValue(Array.from({ length: 8 }, (_, i) => open(`promise ${i}`, 'coach')));
    m.runJobBySlug.mockResolvedValue(answer(finding('a?')));
    expect((await runFactReview(USER, TODAY)).written).toBe(1);
  });

  it('skips a finding whose question is already open as a fact-review follow-up', async () => {
    m.listOpenFollowUps.mockResolvedValue([open('Are you back at the gym?', 'fact-review')]);
    m.runJobBySlug.mockResolvedValue(answer(finding('are you back at the gym'), finding('Is it one race or two?')));
    const out = await runFactReview(USER, TODAY);
    expect(out.already_open).toBe(1);
    expect(m.noteFollowUp.mock.calls.map((c) => c[1].text)).toEqual(['Is it one race or two?']);
  });

  it('makes no model call with fewer than two facts — nothing can disagree', async () => {
    m.getUser.mockResolvedValue({ id: USER, baseline: { constraints: [] } });
    m.listEquipment.mockResolvedValue([]);
    m.listEpisodeRanges.mockResolvedValue([]);
    const out = await runFactReview(USER, TODAY);
    expect(out).toMatchObject({ ran: false, reason: 'too_few_facts' });
    expect(m.runJobBySlug).not.toHaveBeenCalled();
  });

  it('an unreadable answer writes nothing and says so', async () => {
    m.runJobBySlug.mockResolvedValue({ raw: 'Sorry, I cannot help with that.', formatted: '' });
    const out = await runFactReview(USER, TODAY);
    expect(out).toMatchObject({ ran: true, reason: 'unreadable', written: 0 });
    expect(m.noteFollowUp).not.toHaveBeenCalled();
  });

  it('an empty findings list is a clean week', async () => {
    const out = await runFactReview(USER, TODAY);
    expect(out).toMatchObject({ ran: true, reason: 'reviewed', found: 0, written: 0 });
  });
});

describe('maybeRunFactReview — the check-in close trigger', () => {
  it('claims the recap week with the weekly gap, then runs', async () => {
    m.runJobBySlug.mockResolvedValue(answer(finding('Are you back at the gym?')));
    const out = await maybeRunFactReview(USER, '2026-10-26');
    expect(m.claimFactReviewWeek).toHaveBeenCalledWith(USER, '2026-10-26', FACT_REVIEW_MIN_DAYS_BETWEEN);
    expect(out).toMatchObject({ ran: true, written: 1 });
  });

  it('a week already claimed (a re-confirm, a double tap) runs nothing', async () => {
    m.claimFactReviewWeek.mockResolvedValue(false);
    const out = await maybeRunFactReview(USER, '2026-10-26');
    expect(out).toMatchObject({ ran: false, reason: 'already_reviewed' });
    expect(m.runJobBySlug).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '2026-10-6', 'this week', '2026-10-26T00:00:00Z', ' 2026-10-26'])(
    'no recap week (%s) claims nothing',
    async (week) => {
      const out = await maybeRunFactReview(USER, week);
      expect(out.reason).toBe('no_week');
      expect(m.claimFactReviewWeek).not.toHaveBeenCalled();
    },
  );

  it('a thrown job is logged and swallowed — the check-in it rides on is unaffected', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.runJobBySlug.mockRejectedValue(new Error('provider 400'));
    await expect(maybeRunFactReview(USER, '2026-10-26')).resolves.toMatchObject({ ran: false, reason: 'failed' });
    expect(err).toHaveBeenCalled();
    expect(m.noteFollowUp).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('a failed claim (0062 not applied yet) is swallowed the same way, and nothing runs', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.claimFactReviewWeek.mockRejectedValue(new Error('column "fact_reviewed_at" does not exist'));
    await expect(maybeRunFactReview(USER, '2026-10-26')).resolves.toMatchObject({ reason: 'failed' });
    expect(m.runJobBySlug).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('a failed write is swallowed too', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.runJobBySlug.mockResolvedValue(answer(finding('Are you back at the gym?')));
    m.noteFollowUp.mockRejectedValue(new Error('db down'));
    await expect(maybeRunFactReview(USER, '2026-10-26')).resolves.toMatchObject({ reason: 'failed' });
    err.mockRestore();
  });
});
