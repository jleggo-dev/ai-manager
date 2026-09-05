/**
 * Pure app-side contract assertions for prescribe-session output (same stance as
 * plan-synthesis.ts#normalizeActivity). Kept free of DB/LLM so bounds + URL stripping
 * can be unit-tested without the AI Admin seam.
 */
import {
  BLOCK_MODE_KINDS,
  SESSION_TOOL_KINDS,
  clampCycles,
  clampIntervalMinutes,
  singleSetPlan,
  clampSitMinutes,
  isBreathPatternId,
  isGroundingGame,
  isMeditateBells,
  normalizeMetronome,
  patternById,
  type BlockMode,
  type OccurrenceSession,
  type SessionBlock,
  type SessionItem,
  type SessionItemTool,
} from '@cadence/shared';

const MAX_BLOCKS = 6;
const MAX_ITEMS = 12;

export const str = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

// Whitelists derive from the one tool catalog (@cadence/shared/tool-catalog) — the same list the
// coach is taught via {{tool_catalog}}, so what we accept can't drift from what we told it to emit.
const SESSION_TOOLS: ReadonlySet<string> = new Set(SESSION_TOOL_KINDS);

/** Whitelist the coach's tool choice (REQ8) — an off-catalog value is dropped so the walkthrough
 *  falls back to quantity inference rather than trusting an unknown renderer name. */
export const toolOf = (v: unknown): SessionItemTool | undefined =>
  typeof v === 'string' && SESSION_TOOLS.has(v) ? (v as SessionItemTool) : undefined;

const BLOCK_MODES: ReadonlySet<string> = new Set(BLOCK_MODE_KINDS);

/** Whitelist the coach's block set-flow (REQ8 slice 2) — off-catalog → undefined (= straight). */
export const modeOf = (v: unknown): BlockMode | undefined =>
  typeof v === 'string' && BLOCK_MODES.has(v) ? (v as BlockMode) : undefined;

/** Whitelist the coach's breath pattern (REQ9 §4.1) — an unknown name is dropped so the tool falls
 *  back to the default pattern rather than playing something we never vetted. */
export const breathPatternOf = (v: unknown): string | undefined =>
  typeof v === 'string' && isBreathPatternId(v) ? v : undefined;

/** Safety-clamp the coach's round count against the pattern's own cap. Belt and braces: the
 *  walkthrough clamps again at render, but a stored session should never hold an unsafe number. */
export const breathCyclesOf = (pattern: string | undefined, v: unknown): number | undefined => {
  const n = num(v);
  if (n === undefined) return undefined;
  return clampCycles(patternById(pattern), n);
};

/** Whitelist the coach's bell setting (REQ9 §4.2) — an unknown value is dropped so the sit falls
 *  back to a plain start/end pair rather than silence. */
export const meditateBellsOf = (v: unknown): string | undefined =>
  typeof v === 'string' && isMeditateBells(v) ? v : undefined;

/** Whitelist the coach's grounding game — an unknown name is dropped so the flow falls back to
 *  the senses sweep rather than a game we never wrote. */
export const groundingGameOf = (v: unknown): string | undefined =>
  typeof v === 'string' && isGroundingGame(v) ? v : undefined;

/**
 * The five interval numbers, resolved together (they only make sense as a set — the round count is
 * trimmed against the work/recover length) and written back only for an item that actually IS an
 * interval. An item that says `tool: 'interval'` but names no work length still gets the defaults
 * stored, so a stored session always holds a plan the player can run.
 */
/**
 * The metronome fields, bounded. Unlike the interval fields there is no "declared" fallback: an
 * absent tempo means no metronome, full stop. Defaulting one in would put a click on every step in
 * the app, which is exactly the thing this feature is not.
 */
export const metronomeFieldsOf = (
  i: Record<string, unknown>,
): Pick<SessionItem, 'metronome_bpm' | 'metronome_meter'> => {
  const spec = normalizeMetronome(num(i.metronome_bpm), num(i.metronome_meter));
  return spec ? { metronome_bpm: spec.bpm, metronome_meter: spec.meter } : {};
};

export const intervalFieldsOf = (
  i: Record<string, unknown>,
): Pick<
  SessionItem,
  'interval_work_sec' | 'interval_recover_sec' | 'interval_rounds' | 'interval_warmup_sec' | 'interval_cooldown_sec'
> => {
  const declared = i.tool === 'interval' || num(i.interval_work_sec) !== undefined;
  if (!declared) return {};
  const plan = singleSetPlan({
    warmupSec: num(i.interval_warmup_sec) ?? 0,
    workSec: num(i.interval_work_sec),
    recoverSec: typeof i.interval_recover_sec === 'number' ? i.interval_recover_sec : undefined,
    rounds: num(i.interval_rounds),
    cooldownSec: num(i.interval_cooldown_sec) ?? 0,
  });
  const set = plan.sets[0];
  if (!set) return {};
  return {
    interval_work_sec: set.workSec,
    interval_recover_sec: set.recoverSec,
    interval_rounds: set.rounds,
    interval_warmup_sec: plan.warmupSec,
    interval_cooldown_sec: plan.cooldownSec,
  };
};

/**
 * App-side contract assertion: coerce whatever the model returned into a bounded,
 * render-safe OccurrenceSession — or null if there's nothing usable.
 * video_query is mechanically de-URLed: the client builds YouTube SEARCH links itself, and a
 * model-invented URL must never reach the UI.
 */
export function normalizeSession(raw: Record<string, unknown> | null): OccurrenceSession | null {
  if (!raw || !Array.isArray(raw.blocks)) return null;
  const blocks: SessionBlock[] = (raw.blocks as unknown[])
    .slice(0, MAX_BLOCKS)
    .map((b): SessionBlock | null => {
      const blk = b as { label?: unknown; items?: unknown; mode?: unknown; rounds?: unknown };
      if (!blk || !Array.isArray(blk.items)) return null;
      const items: SessionItem[] = (blk.items as unknown[])
        .slice(0, MAX_ITEMS)
        .map((it): SessionItem | null => {
          const i = it as Record<string, unknown>;
          const name = str(i.name, 120);
          if (!name) return null;
          const vq = str(i.video_query, 80);
          const breathPattern = breathPatternOf(i.breath_pattern);
          return {
            name,
            sets: num(i.sets),
            reps: num(i.reps),
            load: str(i.load, 40),
            duration_min: num(i.duration_min),
            distance_km: num(i.distance_km),
            detail: str(i.detail, 200),
            video_query: vq && !/https?:|youtube\.com|youtu\.be|www\./i.test(vq) ? vq : null,
            tool: toolOf(i.tool),
            breath_pattern: breathPattern,
            breath_cycles: breathCyclesOf(breathPattern, i.breath_cycles),
            meditate_bells: meditateBellsOf(i.meditate_bells),
            grounding_game: groundingGameOf(i.grounding_game),
            grounding_bank: str(i.grounding_bank, 20),
            ...intervalFieldsOf(i),
            // Rides along with any tool (see metronome.ts) — absent unless the coach asked for a
            // pulse, and bounded here so a stored session never holds a tempo nobody can play.
            ...metronomeFieldsOf(i),
            // Bounded here too, so a stored session never holds an out-of-range sit.
            meditate_interval_min:
              num(i.meditate_interval_min) === undefined
                ? undefined
                : clampIntervalMinutes(clampSitMinutes(num(i.duration_min)), num(i.meditate_interval_min)),
          };
        })
        .filter((i): i is SessionItem => i !== null);
      if (items.length === 0) return null;
      const block: SessionBlock = { label: str(blk.label, 40) ?? 'Session', items };
      const mode = modeOf(blk.mode);
      if (mode) block.mode = mode;
      // Rounds only mean something for a circuit; cap so a bad number can't balloon the player.
      const rounds = num(blk.rounds);
      if (mode === 'circuit' && rounds) block.rounds = Math.min(10, Math.round(rounds));
      return block;
    })
    .filter((b): b is SessionBlock => b !== null);
  if (blocks.length === 0) return null;
  return {
    blocks,
    note: str(raw.note, 400) ?? '',
    generated_at: new Date().toISOString(),
    version: 1,
  };
}

export { MAX_ITEMS };
