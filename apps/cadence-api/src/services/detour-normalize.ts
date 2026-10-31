/**
 * The capture-detour job's output, parsed and clamped — pure, no database.
 *
 * Split out of `detour-capture.ts` so the weekly coach probe can check the model's output through
 * the same normalizers the app uses without importing the episode repo, which loads the DB config
 * and throws when no DB password is set. The probe has no DB secret on purpose (it calls the
 * deployed AI Admin and nothing else), and that import crashed its tool-choice step at startup on
 * every scheduled run from at least 2026-09-07 to 2026-10-26.
 */
import type { CaptureDetourResult } from '@cadence/shared';

const EPISODE_TYPES = new Set(['travel', 'illness', 'injury', 'recovery', 'custom']);
const MAX_DAYS = 60;
const MAX_EQUIPMENT = 20;

/** Trim, de-junk and cap an equipment list from the model — shared by both modes. */
function clampEquipment(raw: unknown): Array<{ name: string }> {
  return (Array.isArray(raw) ? raw : [])
    .map((e) =>
      e && typeof (e as { name?: unknown }).name === 'string'
        ? String((e as { name: string }).name)
            .trim()
            .slice(0, 60)
        : '',
    )
    .filter(Boolean)
    .slice(0, MAX_EQUIPMENT)
    .map((name) => ({ name }));
}

/** The update-mode read: the arrived equipment answer, or null. */
export function normalizeEquipmentUpdate(raw: string): Array<{ name: string }> | null {
  let parsed: CaptureDetourResult;
  try {
    parsed = JSON.parse(raw) as CaptureDetourResult;
  } catch {
    return null;
  }
  const list = parsed?.equipment_update;
  if (!Array.isArray(list)) return null;
  const cleaned = clampEquipment(list);
  // An explicit empty list is a REAL answer ("nothing here, no gym") — it re-drafts to bodyweight.
  return cleaned.length || list.length === 0 ? cleaned : null;
}

/** Parse + clamp the job's output into an `enterEpisode` input, or null. */
export function normalizeDetour(raw: string): {
  type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
  start?: string;
  days?: number;
  end?: string;
  available_equipment: Array<{ name: string }>;
} | null {
  let parsed: CaptureDetourResult;
  try {
    parsed = JSON.parse(raw) as CaptureDetourResult;
  } catch {
    return null;
  }
  const d = parsed?.detour;
  // The explicit-assent gate: anything short of a confirmed agreement is conversation, not consent.
  if (!d || d.confirmed !== true) return null;
  if (typeof d.type !== 'string' || !EPISODE_TYPES.has(d.type)) return null;

  const days =
    typeof d.days === 'number' && Number.isFinite(d.days)
      ? Math.min(MAX_DAYS, Math.max(1, Math.round(d.days)))
      : undefined;
  const end = typeof d.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.end) ? d.end : undefined;
  // A stated arrival date schedules the detour (owner, 2026-08-04): nothing pauses until then.
  // Malformed or past dates drop to undefined — entering begins today, never retroactively.
  const start = typeof d.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.start) ? d.start : undefined;

  return { type: d.type, start, days, end, available_equipment: clampEquipment(d.available_equipment) };
}
