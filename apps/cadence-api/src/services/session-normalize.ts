/**
 * Pure app-side contract assertions for prescribe-session output (same stance as
 * plan-synthesis.ts#normalizeActivity). Kept free of DB/LLM so bounds + URL stripping
 * can be unit-tested without the AI Admin seam.
 */
import {
  BLOCK_MODE_KINDS,
  SESSION_TOOL_KINDS,
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

/**
 * The coaching arc, derived from data — no stored state: how many sessions of THIS activity
 * (by title, cross-plan) the user has actually logged decides how the coach behaves.
 *   discover  (0 logs) — a real coach's first session: EVALUATE, don't prescribe. Find baselines.
 *   calibrate (1-2)    — keep measuring what's unknown; gently apply what's already clear.
 *   progress  (3+)     — full evidence-based progression.
 */
export function coachingPhase(logged: number): 'discover' | 'calibrate' | 'progress' {
  return logged === 0 ? 'discover' : logged < 3 ? 'calibrate' : 'progress';
}

export { MAX_ITEMS };
