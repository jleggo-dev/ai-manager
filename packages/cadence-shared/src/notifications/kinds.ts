/* ════════════════════════════════════════════════════════════════
   The nudge catalog — which nudges exist, and how loud the user asked for
   ════════════════════════════════════════════════════════════════ */

/**
 * Nine nudges, one dial.
 *
 * The tier is the ONLY volume control the user gets, and it is deliberately not a checkbox per
 * kind: nine toggles is a configuration screen, and a configuration screen is how someone ends up
 * with a combination nobody designed. Three named amounts are a promise a person can hold in their
 * head — "few" is the set you would miss if it vanished, "lots" is everything Cadence has to say.
 *
 * Tiers are CUMULATIVE. `moderate` is `few` plus three more; `lots` is `moderate` plus three more.
 * Turning the dial up never removes something, so a user who liked what they had cannot lose it by
 * asking for more — which is the failure mode of a non-nested "profile" model.
 */

export const NUDGE_KINDS = [
  'weekly_checkin',
  'freeze_save',
  'detour_ending',
  'almost_time',
  're_entry',
  'milestone_waypoint',
  'before_quiet_hours',
  'morning_adjust',
  'weather_move',
] as const;

export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** Quietest first. Order is load-bearing: `tierIncludes` reads it as a cumulative ladder. */
export const NUDGE_TIERS = ['few', 'moderate', 'lots'] as const;
export type NudgeTier = (typeof NUDGE_TIERS)[number];

/**
 * Moderate, not few.
 *
 * A user who never opens Settings should get the timing help (`almost_time`), the honest
 * "I haven't seen you" (`re_entry`) and the countdown to the day they are aiming at
 * (`milestone_waypoint`) — those are the ones that make the plan feel held rather than filed.
 * What they should NOT get by default is the third tier, all of which is Cadence volunteering an
 * opinion about the day.
 */
export const DEFAULT_NUDGE_TIER: NudgeTier = 'moderate';

/** What each tier ADDS on top of the one below it. */
const TIER_ADDITIONS: Record<NudgeTier, readonly NudgeKind[]> = {
  few: ['weekly_checkin', 'freeze_save', 'detour_ending'],
  moderate: ['almost_time', 're_entry', 'milestone_waypoint'],
  lots: ['before_quiet_hours', 'morning_adjust', 'weather_move'],
};

/** Every kind a tier allows, quietest-first, including everything the tiers below it allow. */
export function kindsForTier(tier: NudgeTier): NudgeKind[] {
  const out: NudgeKind[] = [];
  for (const t of NUDGE_TIERS) {
    out.push(...TIER_ADDITIONS[t]);
    if (t === tier) break;
  }
  return out;
}

/** Only what THIS tier adds — the "and here is what more looks like" half of the Settings card. */
export function kindsAddedByTier(tier: NudgeTier): NudgeKind[] {
  return [...TIER_ADDITIONS[tier]];
}

/** What a tier deliberately leaves out. The Settings card shows this; a volume dial that only
 *  lists what you gain is a sales page, not a setting. */
export function kindsExcludedByTier(tier: NudgeTier): NudgeKind[] {
  const allowed = new Set(kindsForTier(tier));
  return NUDGE_KINDS.filter((k) => !allowed.has(k));
}

export function isNudgeKind(v: unknown): v is NudgeKind {
  return typeof v === 'string' && (NUDGE_KINDS as readonly string[]).includes(v);
}

export function isNudgeTier(v: unknown): v is NudgeTier {
  return typeof v === 'string' && (NUDGE_TIERS as readonly string[]).includes(v);
}

/** True when this tier permits this kind. A kind outside the catalog is NOT tier-governed — the
 *  dial speaks for the nine designed nudges, and silently swallowing an unknown kind would hide a
 *  wiring bug rather than surface it. */
export function tierIncludes(tier: NudgeTier, kind: string): boolean {
  if (!isNudgeKind(kind)) return true;
  return kindsForTier(tier).includes(kind);
}

/**
 * The daily send cap implied by the tier.
 *
 * Two at `lots`, one everywhere else. Deliberately small: the tier already decides WHICH nudges
 * may fire, so this is the second, blunter guard for the case where several become due on the same
 * day — a Tuesday that happens to be a waypoint, a detour ending and a rainy morning should not
 * become three buzzes. The cap picks whichever arrives first and holds the rest, because the
 * alternative (deciding which is most important) is a ranking nobody can get right from here.
 */
export function maxPerDayForTier(tier: NudgeTier): number {
  return tier === 'lots' ? 2 : 1;
}

/**
 * Where a nudge is delivered from.
 *
 * LOCAL means the device already knows enough to schedule it from the committed plan — no server,
 * no APNs, exact timing, works offline. PUSH means only the server could know: a freeze that fired
 * overnight, tomorrow's forecast, an absence. This split is the reason the catalog is one module
 * and not two: the copy and the tier are the same question wherever the notification is posted
 * from, and separating them is how the two halves drift.
 */
export const NUDGE_CHANNEL: Record<NudgeKind, 'local' | 'push'> = {
  // PUSH, not local (check-in rebuild, step 8): the device can schedule a reminder about a
  // check-in it already knows is on the plan, but it has no way to know the plan's week ran out
  // without a commit ever landing — that fact lives only server-side (`computeWeekState`), so only
  // the server can produce this nudge. See notify/producers/checkin-due.ts.
  weekly_checkin: 'push',
  freeze_save: 'push',
  detour_ending: 'push',
  almost_time: 'local',
  re_entry: 'push',
  milestone_waypoint: 'local',
  before_quiet_hours: 'local',
  morning_adjust: 'local',
  weather_move: 'push',
};

export const LOCAL_NUDGE_KINDS: NudgeKind[] = NUDGE_KINDS.filter((k) => NUDGE_CHANNEL[k] === 'local');
export const PUSH_NUDGE_KINDS: NudgeKind[] = NUDGE_KINDS.filter((k) => NUDGE_CHANNEL[k] === 'push');

/**
 * Plain-language names, for the one place a kind is ever shown to a user: the "what this tier
 * includes / leaves out" card in Settings. Written as things Cadence DOES, not as feature names —
 * "A nudge shortly before a session you set a time for" rather than "Almost-time reminders",
 * because the user is deciding whether they want the behaviour, not shopping for a feature.
 */
export const NUDGE_LABEL: Record<NudgeKind, string> = {
  weekly_checkin: 'Your weekly check-in, the morning it lands',
  freeze_save: 'When a freeze covers a day off',
  detour_ending: 'The day before a detour ends',
  almost_time: 'Shortly before something you set a time for',
  re_entry: 'A check-in after a few quiet days — once, and once more, then I leave it',
  milestone_waypoint: "Waypoints on the way to a day you're aiming at",
  before_quiet_hours: 'A last note before quiet hours, if something short still fits',
  morning_adjust: 'A morning count of how yesterday went, with an offer to lighten today',
  weather_move: 'When tomorrow’s weather argues with an outdoor session',
};
