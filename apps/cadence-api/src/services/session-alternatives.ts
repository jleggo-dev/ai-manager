/**
 * The bounds on what the coach writes beside an item for the Change sheet (walkthrough v3 R3,
 * owner 2026-11-03): the alternatives she offers in a move's place, and the load she would start
 * at. Pure, like session-normalize.ts, and used from two places — the session normalizer, for the
 * alternatives written at build time, and the alternative-item route, for the one she writes when
 * the person asks for "Something else" — so the two can never accept different shapes.
 *
 * No reason field is read, kept or invented. The rows show the name, the target, the equipment and
 * the person's own history; a reason the coach wrote would be a line explaining the UI.
 */
import {
  ALTERNATIVES_MAX,
  ALTERNATIVE_EQUIPMENT_MAX,
  EQUIPMENT_NAME_MAX,
  ITEM_DETAIL_MAX,
  ITEM_LOAD_MAX,
  ITEM_NAME_MAX,
  type SessionItemAlternative,
} from '@cadence/shared';
import { num, str } from './session-normalize.ts';

/** A YouTube search phrase, never a link: a model-invented URL must never reach the UI. */
const searchPhrase = (v: unknown): string | null => {
  const vq = str(v, 80);
  return vq && !/https?:|youtube\.com|youtu\.be|www\./i.test(vq) ? vq : null;
};

/** The equipment names on an alternative: strings only, each cut to its limit, at most six. */
export function normalizeEquipmentNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((e) => str(e, EQUIPMENT_NAME_MAX))
    .filter((e): e is string => !!e)
    .slice(0, ALTERNATIVE_EQUIPMENT_MAX);
}

/** One alternative, bounded. Null when it has no name — nothing to show a row for. */
export function normalizeAlternative(raw: unknown): SessionItemAlternative | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const name = str(a.name, ITEM_NAME_MAX);
  if (!name) return null;
  const out: SessionItemAlternative = { name, equipment: normalizeEquipmentNames(a.equipment) };
  const sets = num(a.sets);
  const reps = num(a.reps);
  const load = str(a.load, ITEM_LOAD_MAX);
  const duration = num(a.duration_min);
  const distance = num(a.distance_km);
  const detail = str(a.detail, ITEM_DETAIL_MAX);
  const video = searchPhrase(a.video_query);
  if (sets !== undefined) out.sets = sets;
  if (reps !== undefined) out.reps = reps;
  if (load) out.load = load;
  if (duration !== undefined) out.duration_min = duration;
  if (distance !== undefined) out.distance_km = distance;
  if (detail) out.detail = detail;
  if (video) out.video_query = video;
  return out;
}

/** The list on an item: at most `ALTERNATIVES_MAX`, nameless ones dropped. Undefined when empty,
 *  so a stored item without alternatives carries no key. */
export function normalizeAlternatives(raw: unknown): SessionItemAlternative[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kept = (raw as unknown[])
    .map(normalizeAlternative)
    .filter((a): a is SessionItemAlternative => a !== null)
    .slice(0, ALTERNATIVES_MAX);
  return kept.length ? kept : undefined;
}

/** The coach's starting load for the weight sheet's "my suggestion" chip, bounded like any load. */
export function normalizeSuggestedLoad(raw: unknown): string | undefined {
  return str(raw, ITEM_LOAD_MAX);
}
