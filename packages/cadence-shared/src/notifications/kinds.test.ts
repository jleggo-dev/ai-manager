/**
 * The dial. The failure this file guards against is subtle and expensive: a tier model that is not
 * genuinely cumulative means turning the volume UP can silently take something away, and the user
 * discovers it by not being told about the thing they cared about.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NUDGE_TIER,
  LOCAL_NUDGE_KINDS,
  NUDGE_CHANNEL,
  NUDGE_KINDS,
  NUDGE_LABEL,
  NUDGE_TIERS,
  PUSH_NUDGE_KINDS,
  isNudgeKind,
  isNudgeTier,
  kindsAddedByTier,
  kindsExcludedByTier,
  kindsForTier,
  maxPerDayForTier,
  tierIncludes,
} from './kinds.ts';

describe('tiers are cumulative', () => {
  it('turning the dial up never removes a kind', () => {
    const few = kindsForTier('few');
    const moderate = kindsForTier('moderate');
    const lots = kindsForTier('lots');
    for (const k of few) expect(moderate).toContain(k);
    for (const k of moderate) expect(lots).toContain(k);
  });

  it('lots is the whole catalog, and nothing is orphaned', () => {
    expect([...kindsForTier('lots')].sort()).toEqual([...NUDGE_KINDS].sort());
  });

  it('each tier adds exactly three', () => {
    for (const t of NUDGE_TIERS) expect(kindsAddedByTier(t)).toHaveLength(3);
  });

  it('excluded is the exact complement of included', () => {
    for (const t of NUDGE_TIERS) {
      const included = kindsForTier(t);
      const excluded = kindsExcludedByTier(t);
      expect(included.length + excluded.length).toBe(NUDGE_KINDS.length);
      for (const k of excluded) expect(included).not.toContain(k);
    }
  });

  it('the quietest tier keeps the ones you would miss', () => {
    // Not an arbitrary three: a freeze that fired, a detour ending, and the weekly check-in are
    // all things that HAPPENED. Everything above them is Cadence volunteering an opinion.
    expect(kindsForTier('few').sort()).toEqual(['detour_ending', 'freeze_save', 'weekly_checkin']);
  });
});

describe('tierIncludes', () => {
  it('gates a kind above the user’s tier', () => {
    expect(tierIncludes('few', 'almost_time')).toBe(false);
    expect(tierIncludes('moderate', 'almost_time')).toBe(true);
    expect(tierIncludes('moderate', 'weather_move')).toBe(false);
    expect(tierIncludes('lots', 'weather_move')).toBe(true);
  });

  it('lets a kind outside the catalog through — the dial speaks for the nine designed nudges', () => {
    // Swallowing an unknown kind here would hide a wiring bug behind a silent non-delivery.
    expect(tierIncludes('few', 'session_reminder')).toBe(true);
  });
});

describe('the daily cap', () => {
  it('is 2 at lots and 1 everywhere else', () => {
    expect(maxPerDayForTier('lots')).toBe(2);
    expect(maxPerDayForTier('moderate')).toBe(1);
    expect(maxPerDayForTier('few')).toBe(1);
  });

  it('never exceeds the number of kinds the tier allows', () => {
    for (const t of NUDGE_TIERS) expect(maxPerDayForTier(t)).toBeLessThanOrEqual(kindsForTier(t).length);
  });
});

describe('channels', () => {
  it('splits the catalog with nothing left over', () => {
    expect(LOCAL_NUDGE_KINDS.length + PUSH_NUDGE_KINDS.length).toBe(NUDGE_KINDS.length);
  });

  it('routes the four the device can work out itself to local', () => {
    expect([...LOCAL_NUDGE_KINDS].sort()).toEqual(
      ['almost_time', 'before_quiet_hours', 'milestone_waypoint', 'morning_adjust'].sort(),
    );
  });

  it('routes the five only the server could know to push', () => {
    // weekly_checkin joined this side in the check-in rebuild (step 8): "this plan's week has run
    // out" is a fact only the server holds (computeWeekState), so only the server can say it.
    expect([...PUSH_NUDGE_KINDS].sort()).toEqual(
      ['detour_ending', 'freeze_save', 're_entry', 'weather_move', 'weekly_checkin'].sort(),
    );
  });

  it('has a channel for every kind', () => {
    for (const k of NUDGE_KINDS) expect(NUDGE_CHANNEL[k]).toMatch(/^(local|push)$/);
  });
});

describe('defaults and guards', () => {
  it('defaults to moderate', () => {
    expect(DEFAULT_NUDGE_TIER).toBe('moderate');
    expect(kindsForTier(DEFAULT_NUDGE_TIER)).toHaveLength(6);
  });

  it('validates tiers and kinds from the wire', () => {
    expect(isNudgeTier('lots')).toBe(true);
    expect(isNudgeTier('LOUD')).toBe(false);
    expect(isNudgeTier(null)).toBe(false);
    expect(isNudgeKind('freeze_save')).toBe(true);
    expect(isNudgeKind('phase_checkpoint')).toBe(false); // designed, not built — see the PR
  });

  it('has a plain-language label for every kind, because Settings shows all of them', () => {
    for (const k of NUDGE_KINDS) expect(NUDGE_LABEL[k].trim().length).toBeGreaterThan(0);
  });
});
