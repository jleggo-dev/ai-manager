import type { NowMenuItem, OccurrenceSession } from '@cadence/shared';

/**
 * A one-item session so a now-menu row plays through the same walkthrough a scheduled task uses —
 * same renderers, same logging, same partial-credit rules. Nothing about the tool knows it was
 * launched from a menu rather than the trail.
 *
 * Shared by DoNowSection (the ＋ sheet's present-tense section, REQ10 §6) and QuickAddTense
 * (screen 2's "Take me on one", Activity Builder 2A) — extracted so the two can't drift on how a
 * `NowMenuItem` becomes a playable `OccurrenceSession`.
 */
export function sessionFor(item: NowMenuItem): OccurrenceSession {
  const params = item.action.kind === 'tool' ? item.action.params : {};
  return {
    blocks: [
      {
        label: '',
        items: [
          {
            name: item.label,
            tool: item.action.kind === 'tool' ? item.action.tool : undefined,
            breath_pattern: str(params.breath_pattern),
            breath_cycles: num(params.breath_cycles),
            duration_min: num(params.duration_min),
            meditate_bells: str(params.meditate_bells),
            grounding_game: str(params.grounding_game),
            interval_work_sec: num(params.interval_work_sec),
            interval_recover_sec: num(params.interval_recover_sec),
            interval_rounds: num(params.interval_rounds),
            interval_warmup_sec: num(params.interval_warmup_sec),
            interval_cooldown_sec: num(params.interval_cooldown_sec),
          },
        ],
      },
    ],
    note: '',
    generated_at: new Date().toISOString(),
    version: 1,
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
