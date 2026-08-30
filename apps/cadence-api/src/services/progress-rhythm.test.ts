import { describe, it, expect } from 'vitest';
import {
  addDaysIso,
  buildRhythmWeeks,
  mondayOnOrBefore,
  type RhythmEpisodeRange,
  type RhythmOccurrence,
} from './progress-rhythm.ts';

/** Fixed "today" — Wednesday 2026-07-15 UTC. Week: Mon 07-13 .. Sun 07-19. */
const TODAY = new Date(Date.UTC(2026, 6, 15));

function occ(date: string, status: RhythmOccurrence['status'] = 'done'): RhythmOccurrence {
  return { date, status };
}

describe('mondayOnOrBefore / addDaysIso (pure date helpers)', () => {
  it('a Monday maps to itself', () => {
    expect(mondayOnOrBefore('2026-07-13')).toBe('2026-07-13');
  });
  it('a mid-week date snaps back to its own Monday', () => {
    expect(mondayOnOrBefore('2026-07-15')).toBe('2026-07-13'); // Wed
    expect(mondayOnOrBefore('2026-07-16')).toBe('2026-07-13'); // Thu
  });
  it('a Sunday snaps back to the Monday that started ITS week (not the next one)', () => {
    expect(mondayOnOrBefore('2026-07-19')).toBe('2026-07-13');
  });
  it('addDaysIso crosses a month boundary correctly', () => {
    expect(addDaysIso('2026-07-27', 6)).toBe('2026-08-02');
  });
});

describe('buildRhythmWeeks (pure — no DB)', () => {
  it('classifies kept / missed / upcoming / unscheduled / checkin, in priority order', () => {
    const occurrences: RhythmOccurrence[] = [
      occ('2026-07-13', 'done'), // Mon — done
      occ('2026-07-14', 'missed'), // Tue — past, scheduled, not done
      occ('2026-07-15', 'pending'), // Wed — TODAY, scheduled, not done (grace: not a miss yet)
      occ('2026-07-16', 'pending'), // Thu — future, scheduled
      // 07-17 (Fri): no occurrence at all, not in an episode -> unscheduled
      // 07-18 (Sat): no occurrence, in an episode AND checked in -> checkin
      // 07-19 (Sun): no occurrence, checked in but OUTSIDE the episode -> stays unscheduled
    ];
    const checkInDays = ['2026-07-18', '2026-07-19'];
    const episodes: RhythmEpisodeRange[] = [{ start: '2026-07-17', end: '2026-07-18', type: 'travel' }];

    const payload = buildRhythmWeeks('2026-07-13', '2026-07-19', occurrences, checkInDays, episodes, TODAY);
    expect(payload.weeks).toHaveLength(1);
    const week = payload.weeks[0]!;
    expect(week.start).toBe('2026-07-13');
    expect(week.label).toBe('Jul 13–19');
    expect(week.days.map((d) => d.state)).toEqual(['kept', 'missed', 'upcoming', 'upcoming', 'unscheduled', 'checkin', 'unscheduled']);
    expect(week.days.map((d) => d.date)).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
    ]);
  });

  it('a done day wins over checkin even inside an episode (kept has top priority)', () => {
    const occurrences: RhythmOccurrence[] = [occ('2026-07-18', 'done')];
    const checkInDays = ['2026-07-18'];
    const episodes: RhythmEpisodeRange[] = [{ start: '2026-07-17', end: '2026-07-18', type: 'illness' }];
    const payload = buildRhythmWeeks('2026-07-13', '2026-07-19', occurrences, checkInDays, episodes, TODAY);
    const day = payload.weeks[0]!.days.find((d) => d.date === '2026-07-18')!;
    expect(day.state).toBe('kept');
  });

  it('a paused/shielded day with NO check-in still reads missed once past (not a new hidden state)', () => {
    // Base occurrences are typically PAUSED (not deleted) for a shielded stretch — still "scheduled"
    // by the any-occurrence rule. Without an explicit check-in that day, it reads as `missed`, which
    // is itself brand-neutral (no red anywhere) rather than a fourth "shielded" state.
    const occurrences: RhythmOccurrence[] = [occ('2026-07-14', 'paused')];
    const episodes: RhythmEpisodeRange[] = [{ start: '2026-07-14', end: '2026-07-15', type: 'illness' }];
    const payload = buildRhythmWeeks('2026-07-13', '2026-07-19', occurrences, [], episodes, TODAY);
    const day = payload.weeks[0]!.days.find((d) => d.date === '2026-07-14')!;
    expect(day.state).toBe('missed');
  });

  it('kept/scheduled reuse the scheduled-days-only denominator (a gap is not counted either way)', () => {
    const occurrences: RhythmOccurrence[] = [
      occ('2026-07-13', 'done'),
      occ('2026-07-13', 'done'), // second activity, same day — still one scheduled day
      occ('2026-07-14', 'missed'),
    ];
    const payload = buildRhythmWeeks('2026-07-13', '2026-07-19', occurrences, [], [], TODAY);
    const week = payload.weeks[0]!;
    // Only 07-13 and 07-14 had anything scheduled; the rest of the week is a genuine gap.
    expect(week).toMatchObject({ kept: 1, scheduled: 2 });
  });

  it('reads 0 of 0 for a week with nothing scheduled at all — never streak-shame 0 of 7', () => {
    const payload = buildRhythmWeeks('2026-07-13', '2026-07-19', [], [], [], TODAY);
    expect(payload.weeks[0]).toMatchObject({ kept: 0, scheduled: 0 });
  });

  it('attaches the detour to every week the episode overlaps, with a plain label', () => {
    const episodes: RhythmEpisodeRange[] = [{ start: '2026-07-17', end: '2026-07-21', type: 'injury' }];
    // Two-week span: 07-13..07-19 (Fri 17–Sun 19 overlap) and 07-20..07-26 (Mon 20–Tue 21 overlap).
    const payload = buildRhythmWeeks('2026-07-13', '2026-07-26', [], [], episodes, TODAY);
    expect(payload.weeks).toHaveLength(2);
    for (const week of payload.weeks) {
      expect(week.detour).toEqual({ type: 'injury', label: 'injury detour' });
    }
  });

  it('a week the episode does not touch has no detour', () => {
    const episodes: RhythmEpisodeRange[] = [{ start: '2026-07-17', end: '2026-07-18', type: 'custom' }];
    const payload = buildRhythmWeeks('2026-07-06', '2026-07-19', [], [], episodes, TODAY);
    const priorWeek = payload.weeks.find((w) => w.start === '2026-07-06')!;
    expect(priorWeek.detour).toBeNull();
    const overlapWeek = payload.weeks.find((w) => w.start === '2026-07-13')!;
    expect(overlapWeek.detour).toEqual({ type: 'custom', label: 'a detour' });
  });

  it('orders weeks most-recent-first', () => {
    const payload = buildRhythmWeeks('2026-07-06', '2026-07-19', [], [], [], TODAY);
    expect(payload.weeks.map((w) => w.start)).toEqual(['2026-07-13', '2026-07-06']);
  });

  it('snaps a mid-week `from`/`to` out to the full Monday-start week', () => {
    const payload = buildRhythmWeeks('2026-07-15', '2026-07-16', [], [], [], TODAY);
    expect(payload.weeks).toHaveLength(1);
    expect(payload.weeks[0]!.start).toBe('2026-07-13');
    expect(payload.weeks[0]!.days).toHaveLength(7);
  });

  it('formats a week label that crosses a month boundary', () => {
    const payload = buildRhythmWeeks('2026-07-27', '2026-08-02', [], [], [], TODAY);
    expect(payload.weeks[0]).toMatchObject({ start: '2026-07-27', label: 'Jul 27–Aug 2' });
  });
});
