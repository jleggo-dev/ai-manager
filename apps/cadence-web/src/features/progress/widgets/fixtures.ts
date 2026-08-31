import type { WidgetKind, WidgetPayload } from '@cadence/shared';

/** Tiny inline placeholder "photos" (solid-color SVGs, 3:4) so the photo_pair fixtures need no
 *  network and no binary asset — real slots carry short-lived signed URLs. */
function placeholderPhoto(fill: string): string {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='30' height='40'%3E%3Crect width='30' height='40' fill='%23${fill}'/%3E%3C/svg%3E`;
}

/**
 * Realistic fixture payloads for every WIDGET_KINDS entry, in two flavours: FITNESS_FIXTURES (a
 * movement/nourishment-led user — runs, weigh-ins, steps) and PRACTICE_FIXTURES (a mind/practice
 * user — meditation sits, a novel-in-progress, journaling). The grammar is deliberately
 * area-agnostic (PROGRESS-ENGINE.md's "not everyone defines success linearly/temporally"), and
 * these two sets are what widgets-registry.test.ts and the `?preview=widgets` dev surface render
 * to prove it. Every fixture honors the brand physics it exercises: no red, absent readings are
 * `null` never `0`, warm dawn accents sit only on accomplishment rows.
 */

export const FITNESS_FIXTURES: Record<WidgetKind, WidgetPayload> = {
  rhythm: {
    kind: 'rhythm',
    data: {
      weeks: [
        {
          start: '2026-08-24',
          label: 'Aug 24–30',
          kept: 3,
          scheduled: 4,
          days: [
            { date: '2026-08-24', state: 'kept' },
            { date: '2026-08-25', state: 'missed' },
            { date: '2026-08-26', state: 'kept' },
            { date: '2026-08-27', state: 'unscheduled' },
            { date: '2026-08-28', state: 'kept' },
            { date: '2026-08-29', state: 'upcoming' },
            { date: '2026-08-30', state: 'upcoming' },
          ],
        },
        {
          start: '2026-08-17',
          label: 'Aug 17–23',
          kept: 0,
          scheduled: 4,
          detour: { type: 'travel', label: 'Travel week' },
          days: [
            { date: '2026-08-17', state: 'checkin' },
            { date: '2026-08-18', state: 'checkin' },
            { date: '2026-08-19', state: 'unscheduled' },
            { date: '2026-08-20', state: 'checkin' },
            { date: '2026-08-21', state: 'unscheduled' },
            { date: '2026-08-22', state: 'unscheduled' },
            { date: '2026-08-23', state: 'unscheduled' },
          ],
        },
        {
          start: '2026-08-10',
          label: 'Aug 10–16',
          kept: 4,
          scheduled: 4,
          days: [
            { date: '2026-08-10', state: 'kept' },
            { date: '2026-08-11', state: 'kept' },
            { date: '2026-08-12', state: 'unscheduled' },
            { date: '2026-08-13', state: 'kept' },
            { date: '2026-08-14', state: 'unscheduled' },
            { date: '2026-08-15', state: 'kept' },
            { date: '2026-08-16', state: 'unscheduled' },
          ],
        },
      ],
    },
  },
  trend_vs_target: {
    kind: 'trend_vs_target',
    data: {
      unit: 'lbs',
      latest: 171.8,
      start: 178.2,
      target: 165,
      trend: 172.4,
      rate_per_week: -0.6,
      confidence: 'high',
      series: [
        { date: '2026-07-01', value: 178.2 },
        { date: '2026-07-08', value: 177.1 },
        { date: '2026-07-15', value: 176.4 },
        { date: '2026-07-22', value: 175.0 },
        { date: '2026-07-29', value: 174.6 },
        { date: '2026-08-05', value: 173.5 },
        { date: '2026-08-12', value: 172.9 },
        { date: '2026-08-19', value: 172.0 },
        { date: '2026-08-26', value: 171.8 },
      ],
    },
  },
  dated_sessions: {
    kind: 'dated_sessions',
    data: {
      activity: 'Running',
      total: 24,
      last_4_weeks: 9,
      usual_hr: 148,
      sessions: [
        { date: '2026-07-30', title: 'Easy run', distance_km: 5.2, duration_min: 31, avg_hr: 142 },
        { date: '2026-08-04', title: 'Easy run', distance_km: 6.0, duration_min: 35, avg_hr: 146 },
        { date: '2026-08-09', title: 'Long run', distance_km: 9.5, duration_min: 58, avg_hr: 151 },
        { date: '2026-08-14', title: 'Easy run', distance_km: 5.5, duration_min: 33, avg_hr: 144 },
        { date: '2026-08-20', title: 'Long run', distance_km: 12.1, duration_min: 74, avg_hr: 153, best: true },
        { date: '2026-08-27', title: 'Easy run', distance_km: 6.2, duration_min: 37, avg_hr: 147 },
      ],
    },
  },
  weekly_bars: {
    kind: 'weekly_bars',
    data: {
      unit: 'steps/day',
      latest: 8420,
      weeks: [
        { label: '8 weeks ago', value: 6200 },
        { label: '7 weeks ago', value: 7100 },
        { label: '6 weeks ago', value: 6800 },
        { label: '5 weeks ago', value: null },
        { label: '4 weeks ago', value: 7600 },
        { label: '3 weeks ago', value: 8100 },
        { label: '2 weeks ago', value: 7900 },
        { label: 'this week', value: 8420 },
      ],
    },
  },
  felt_week: {
    kind: 'felt_week',
    data: {
      weeks: [
        { label: 'Aug 3', value: 2.8, days: 5 },
        { label: 'Aug 10', value: null, days: 0 },
        { label: 'Aug 17', value: 3.6, days: 6 },
        { label: 'Aug 24', value: 4.3, days: 7 },
      ],
    },
  },
  shelf: {
    kind: 'shelf',
    data: {
      events: [
        { label: 'First 10k without stopping', at: '2026-08-09' },
        { label: 'Fastest 5k yet', at: '2026-07-19' },
        { label: 'Ran through the whole heat wave', at: '2026-07-02' },
      ],
    },
  },
  stage_path: {
    kind: 'stage_path',
    data: {
      stages: [
        { label: 'base building', state: 'done' },
        { label: 'speed block', state: 'current' },
        { label: 'taper', state: 'ahead' },
        { label: 'race day', state: 'ahead' },
      ],
      note: 'speed block — three weeks in, two to go',
    },
  },
  count_toward: {
    kind: 'count_toward',
    data: { current: 142, target: 300, unit: 'km this year' },
  },
  balance: {
    kind: 'balance',
    data: { positive_label: 'felt strong', positive: 6, total: 8, noun: 'runs' },
  },
  total: {
    kind: 'total',
    data: { value: 1120, unit: 'minutes moved', window_label: 'this month' },
  },
  variety: {
    kind: 'variety',
    data: { count: 5, noun: 'different routes', window_label: 'this month' },
  },
  repertoire: {
    kind: 'repertoire',
    data: {
      items: [
        { label: 'Freestyle flip turn', state: 'learned', learned_month: null },
        { label: 'Breaststroke', state: 'learned', learned_month: '2026-05' },
        { label: 'Butterfly', state: 'in_progress', weeks_in: 4 },
        { label: 'Open-water sighting', state: 'not_started' },
      ],
      learned: 2,
      in_progress: 1,
      noun: 'skills',
    },
  },
  then_now: {
    kind: 'then_now',
    data: {
      since: '2026-01-05',
      pairs: [
        { label: 'Farmer carry', then: '20 lb', now: '50 lb', area: 'movement' },
        { label: 'Easy run pace', then: '7:50 /km', now: '6:38 /km', area: 'movement' },
        { label: 'Grip hang', then: '12 s', now: '64 s', area: 'movement' },
        { label: 'Longest sit', then: '3 min', now: '12 min', area: 'mind' },
      ],
    },
  },
  photo_pair: {
    kind: 'photo_pair',
    data: {
      first: { date: '2026-01-05', weight_kg: 86.0, url: placeholderPhoto('d9d2c0') },
      latest: { date: '2026-08-24', weight_kg: 82.4, url: placeholderPhoto('cbc2ab') },
      next_due: '2026-09-21',
      count: 8,
    },
  },
  recap_rail: {
    kind: 'recap_rail',
    data: {
      recaps: [
        {
          week_of: 'Aug 18',
          facts_line: '3 of 4 runs · 172 lbs trend',
          line: 'A travel week, and you still found three runs — that counts.',
          detour: true,
        },
        {
          week_of: 'Aug 11',
          facts_line: '4 of 4 runs · 173 lbs trend',
          line: 'A full week, and the long run felt easy by the end.',
        },
      ],
    },
  },
  history: {
    kind: 'history',
    data: {
      entries: [
        { at: '2026-08-27', kind: 'session', title: 'Easy run', detail: '6.2 km · 37 min' },
        { at: '2026-08-20', kind: 'event', title: 'First 10k without stopping', detail: '' },
        { at: '2026-08-20', kind: 'session', title: 'Long run', detail: '12.1 km · 74 min' },
      ],
    },
  },
};

export const PRACTICE_FIXTURES: Record<WidgetKind, WidgetPayload> = {
  rhythm: {
    kind: 'rhythm',
    data: {
      weeks: [
        {
          start: '2026-08-24',
          label: 'Aug 24–30',
          kept: 5,
          scheduled: 7,
          days: [
            { date: '2026-08-24', state: 'kept' },
            { date: '2026-08-25', state: 'kept' },
            { date: '2026-08-26', state: 'missed' },
            { date: '2026-08-27', state: 'kept' },
            { date: '2026-08-28', state: 'kept' },
            { date: '2026-08-29', state: 'kept' },
            { date: '2026-08-30', state: 'upcoming' },
          ],
        },
        {
          start: '2026-08-17',
          label: 'Aug 17–23',
          kept: 2,
          scheduled: 7,
          detour: { type: 'illness', label: 'Under the weather' },
          days: [
            { date: '2026-08-17', state: 'checkin' },
            { date: '2026-08-18', state: 'missed' },
            { date: '2026-08-19', state: 'missed' },
            { date: '2026-08-20', state: 'checkin' },
            { date: '2026-08-21', state: 'missed' },
            { date: '2026-08-22', state: 'kept' },
            { date: '2026-08-23', state: 'kept' },
          ],
        },
      ],
    },
  },
  trend_vs_target: {
    kind: 'trend_vs_target',
    data: {
      unit: 'words/day',
      latest: 540,
      start: 300,
      target: 500,
      trend: 512,
      rate_per_week: 18,
      confidence: 'medium',
      series: [
        { date: '2026-08-01', value: 300 },
        { date: '2026-08-05', value: 340 },
        { date: '2026-08-10', value: 410 },
        { date: '2026-08-14', value: 460 },
        { date: '2026-08-18', value: 470 },
        { date: '2026-08-22', value: 505 },
        { date: '2026-08-26', value: 540 },
      ],
    },
  },
  dated_sessions: {
    kind: 'dated_sessions',
    data: {
      activity: 'Meditation',
      total: 41,
      last_4_weeks: 12,
      usual_hr: null,
      sessions: [
        { date: '2026-08-05', title: 'Sit', duration_min: 15 },
        { date: '2026-08-11', title: 'Sit', duration_min: 20 },
        { date: '2026-08-16', title: 'Sit', duration_min: 18 },
        { date: '2026-08-21', title: 'Sit', duration_min: 32, best: true },
        { date: '2026-08-27', title: 'Sit', duration_min: 22 },
      ],
    },
  },
  weekly_bars: {
    kind: 'weekly_bars',
    data: {
      unit: 'minutes/day',
      latest: 24,
      weeks: [
        { label: '6 weeks ago', value: 10 },
        { label: '5 weeks ago', value: 12 },
        { label: '4 weeks ago', value: null },
        { label: '3 weeks ago', value: 15 },
        { label: '2 weeks ago', value: 19 },
        { label: 'this week', value: 24 },
      ],
    },
  },
  felt_week: {
    kind: 'felt_week',
    data: {
      weeks: [
        { label: 'Aug 3', value: 2.2, days: 4 },
        { label: 'Aug 10', value: 3.1, days: 7 },
        { label: 'Aug 17', value: null, days: 0 },
        { label: 'Aug 24', value: 4.6, days: 6 },
      ],
    },
  },
  shelf: {
    kind: 'shelf',
    data: {
      events: [
        { label: 'Longest sit yet: 32 minutes', at: '2026-08-21' },
        { label: 'First 30-day return to the cushion', at: '2026-08-01' },
      ],
    },
  },
  stage_path: {
    kind: 'stage_path',
    data: {
      stages: [
        { label: 'outline', state: 'done' },
        { label: 'part one', state: 'done' },
        { label: 'part two', state: 'current' },
        { label: 'revision', state: 'ahead' },
      ],
      note: 'part two — four chapters in',
    },
  },
  count_toward: {
    kind: 'count_toward',
    data: { current: 78, target: 150, unit: 'Psalms' },
  },
  balance: {
    kind: 'balance',
    data: { positive_label: 'calmer', positive: 6, total: 8, noun: 'sits' },
  },
  total: {
    kind: 'total',
    data: { value: 340, unit: 'minutes sat', window_label: 'this month' },
  },
  variety: {
    kind: 'variety',
    data: { count: 6, noun: 'different techniques practiced', window_label: 'this month' },
  },
  repertoire: {
    kind: 'repertoire',
    data: {
      items: [
        { label: 'Gymnopédie №1', state: 'learned', learned_month: '2026-03' },
        { label: "Comptine d'un autre été", state: 'learned', learned_month: '2026-06' },
        { label: 'Clair de lune', state: 'in_progress', weeks_in: 6 },
        { label: 'River Flows in You', state: 'not_started' },
      ],
      learned: 2,
      in_progress: 1,
      noun: 'pieces',
    },
  },
  then_now: {
    kind: 'then_now',
    data: {
      since: '2026-02-02',
      pairs: [
        { label: 'Longest sit', then: '3 min', now: '32 min', area: 'mind' },
        { label: 'Box breathing', then: '90 s', now: '150 s', area: 'mind' },
      ],
    },
  },
  photo_pair: {
    kind: 'photo_pair',
    data: {
      // One photo, no weigh-in near it: a first slot, an honest line, and no invented weight.
      first: { date: '2026-08-24', weight_kg: null, url: placeholderPhoto('d9d2c0') },
      latest: null,
      next_due: '2026-09-21',
      count: 1,
    },
  },
  recap_rail: {
    kind: 'recap_rail',
    data: {
      recaps: [
        {
          week_of: 'Aug 18',
          facts_line: '2 of 7 sits · under the weather',
          line: 'A rough week — you still found the cushion twice, and that held the thread.',
          detour: true,
        },
        {
          week_of: 'Aug 11',
          facts_line: '6 of 7 sits · 512 words/day trend',
          line: 'A steady week on both fronts — the pages and the cushion kept pace with each other.',
        },
      ],
    },
  },
  history: {
    kind: 'history',
    data: {
      entries: [
        { at: '2026-08-27', kind: 'session', title: 'Sit', detail: '22 min' },
        { at: '2026-08-21', kind: 'event', title: 'Longest sit yet: 32 minutes', detail: '' },
        { at: '2026-08-21', kind: 'session', title: 'Sit', detail: '32 min' },
      ],
    },
  },
};
