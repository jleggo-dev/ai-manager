/**
 * `edit_calendar` (owner, 2026-09-15: "she should be able to adjust the calendar and the plan") —
 * the hold menu from chat. What is worth pinning: a session is found by date and title the way
 * the calendar read shows them (exact, then a distinct start; two matches are handed back to be
 * named apart, none lists the day); the edit goes through the hold menu's own service with the
 * coach named as source; and every refusal names what did NOT happen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const getActivePlan = vi.fn();
const listActivities = vi.fn();
const listOccurrences = vi.fn();
const moveOccurrence = vi.fn();
const duplicateOccurrence = vi.fn();
const removeOccurrence = vi.fn();

vi.mock('../repos/users.ts', () => ({ getUser: (...a: unknown[]) => getUser(...a) }));
vi.mock('../repos/plans.ts', () => ({ getActivePlan: (...a: unknown[]) => getActivePlan(...a) }));
vi.mock('../repos/activities.ts', () => ({
  listActivities: (...a: unknown[]) => listActivities(...a),
  listActivitiesByIds: vi.fn(async () => []),
}));
vi.mock('../repos/occurrences.ts', () => ({ listOccurrences: (...a: unknown[]) => listOccurrences(...a) }));
vi.mock('./occurrence-edit.ts', () => ({
  moveOccurrence: (...a: unknown[]) => moveOccurrence(...a),
  duplicateOccurrence: (...a: unknown[]) => duplicateOccurrence(...a),
  removeOccurrence: (...a: unknown[]) => removeOccurrence(...a),
}));

const { EDIT_CALENDAR } = await import('./coach-action-edit-calendar.ts');

const USER = 'u1';
const act = (activity_id: string, title: string) => ({
  activity_id,
  title,
  kind: 'user',
  category: 'run',
  schedule: {},
});
const row = (occurrence_id: string, activity_id: string) => ({
  occurrence_id,
  activity_id,
  date: '2026-09-15',
  status: 'pending',
});

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ timezone: 'America/Toronto' });
  getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 24 });
  listActivities.mockResolvedValue([
    act('a-hill', 'Hill intervals'),
    act('a-box', 'Box breathing practice'),
    act('a-hillw', 'Hill walk'),
  ]);
  listOccurrences.mockResolvedValue([row('o-hill', 'a-hill'), row('o-box', 'a-box')]);
  moveOccurrence.mockResolvedValue({ status: 'ok', occurrence_id: 'o-hill' });
  duplicateOccurrence.mockResolvedValue({ status: 'ok', occurrence_id: 'o-copy' });
  removeOccurrence.mockResolvedValue('ok');
});

describe('edit_calendar — finding the session', () => {
  it.each([
    ['the exact title', 'Hill intervals'],
    ['case and spacing do not matter', '  hill   INTERVALS '],
    ['a distinct start of the title', 'hill int'],
    ['a distinct word inside it', 'intervals'],
  ])('%s names it', async (_label, title) => {
    const out = await EDIT_CALENDAR.run(USER, { action: 'move', date: '2026-09-15', title, to: '2026-09-17' });
    expect(moveOccurrence).toHaveBeenCalledWith(USER, 'o-hill', '2026-09-17', 'America/Toronto', 'coach');
    expect(out).toContain('Done — "Hill intervals" moved from 2026-09-15 to 2026-09-17');
  });

  it('two matches are handed back to be named apart, and nothing moves', async () => {
    listOccurrences.mockResolvedValue([row('o-hill', 'a-hill'), row('o-hillw', 'a-hillw')]);
    const out = await EDIT_CALENDAR.run(USER, { action: 'move', date: '2026-09-15', title: 'hill', to: '2026-09-17' });
    expect(moveOccurrence).not.toHaveBeenCalled();
    expect(out).toMatch(/2 sessions on 2026-09-15 match "hill": "Hill intervals", "Hill walk"\. Name one exactly\./);
  });

  it('no match lists what the day holds, so she can name it', async () => {
    const out = await EDIT_CALENDAR.run(USER, { action: 'delete', date: '2026-09-15', title: 'Easy run' });
    expect(removeOccurrence).not.toHaveBeenCalled();
    expect(out).toContain(
      'nothing called "Easy run" sits on 2026-09-15. That day holds: "Hill intervals", "Box breathing practice".',
    );
  });

  it('an empty day says so rather than listing nothing', async () => {
    listOccurrences.mockResolvedValue([]);
    const out = await EDIT_CALENDAR.run(USER, { action: 'delete', date: '2026-09-15', title: 'Easy run' });
    expect(out).toContain('Nothing at all is written on that day.');
  });
});

describe('edit_calendar — the three edits and what she is told', () => {
  it('copy goes through the hold menu’s copy, as the coach', async () => {
    const out = await EDIT_CALENDAR.run(USER, {
      action: 'copy',
      date: '2026-09-15',
      title: 'Box breathing',
      to: '2026-09-18',
    });
    expect(duplicateOccurrence).toHaveBeenCalledWith(USER, 'o-box', '2026-09-18', 'America/Toronto', 'coach');
    expect(out).toContain('a copy of "Box breathing practice" now sits on 2026-09-18');
  });

  it('delete needs no "to", and says the commitment itself still repeats', async () => {
    const out = await EDIT_CALENDAR.run(USER, { action: 'delete', date: '2026-09-15', title: 'Hill intervals' });
    expect(removeOccurrence).toHaveBeenCalledWith(USER, 'o-hill', 'coach');
    expect(out).toContain('"Hill intervals" is off 2026-09-15');
    expect(out).toContain('still repeats as planned');
  });

  it.each([
    [
      'a day outside this week is refused with the week named, and points at the plan change',
      { status: 'out_of_range', from: '2026-09-15', to: '2026-09-21' },
      /outside this week \(2026-09-15 to 2026-09-21\).*propose_plan_change/,
    ],
    [
      'a same-day conflict is refused naming the row that is there',
      { status: 'conflict', existing_occurrence_id: 'o-x', existing_status: 'done' },
      /"Hill intervals" already sits on 2026-09-17 \(done\)/,
    ],
    [
      'a row that vanished is refused, pointing back at the plan read',
      { status: 'not_found' },
      /could not be found on 2026-09-15/,
    ],
  ])('%s', async (_label, result, want) => {
    moveOccurrence.mockResolvedValue(result);
    const out = await EDIT_CALENDAR.run(USER, {
      action: 'move',
      date: '2026-09-15',
      title: 'Hill intervals',
      to: '2026-09-17',
    });
    expect(out).toMatch(/^Nothing was changed on their calendar:/);
    expect(out).toMatch(want);
  });
});

describe('edit_calendar — refusals before anything is read', () => {
  it.each([
    [
      'an unknown action',
      { action: 'swap', date: '2026-09-15', title: 'x', to: '2026-09-17' },
      /not one of move, copy, delete/,
    ],
    [
      'a date not in ISO form',
      { action: 'move', date: 'tuesday', title: 'x', to: '2026-09-17' },
      /not a day in YYYY-MM-DD form/,
    ],
    ['no title', { action: 'move', date: '2026-09-15', title: '', to: '2026-09-17' }, /no session title was given/],
    ['a move with no "to"', { action: 'move', date: '2026-09-15', title: 'x' }, /a move needs "to"/],
    ['a copy with a bad "to"', { action: 'copy', date: '2026-09-15', title: 'x', to: 'friday' }, /a copy needs "to"/],
  ])('%s', async (_label, params, want) => {
    const out = await EDIT_CALENDAR.run(USER, params as never);
    expect(out).toMatch(/^Nothing was changed on their calendar:/);
    expect(out).toMatch(want);
    expect(listOccurrences).not.toHaveBeenCalled();
  });

  it('with no active plan, offers the build card and reads nothing', async () => {
    getActivePlan.mockResolvedValue(null);
    const out = await EDIT_CALENDAR.run(USER, { action: 'delete', date: '2026-09-15', title: 'Hill intervals' });
    expect(out).toMatch(/no active plan/);
    expect(listOccurrences).not.toHaveBeenCalled();
  });
});
