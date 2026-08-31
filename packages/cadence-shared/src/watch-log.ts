/**
 * What happened on the wrist, on its way back (watch app W2 — the return leg).
 *
 * The push carries the plan out; this carries the truth back. Without it the whole honesty
 * contract is drawn but not wired: "I did 5, not 6", the felt question that shapes next week, the
 * mic on Done — all collected on a wrist and dropped.
 *
 * **The watch sends STRUCTURE, not prose.** It knows exactly what happened — which sets were done,
 * which reps were amended, how many rounds were walked — and writing that into a sentence for the
 * server to parse back out with a model call would be laundering: slower, lossier, and billed.
 * The one genuinely free-text field is `note`, the mic, which is the user's own words and belongs
 * in the same parse the phone's "How did it go?" uses.
 *
 * Everything here is asserted rather than trusted. The payload crosses WatchConnectivity from an
 * app that may be older than the server, so `normalizeWatchLog` is a real gate, not a cast.
 */
import type { OccurrenceLogItem } from './types/occurrence.ts';
import type { WatchSessionKind } from './watch-week.ts';

/** Bounds — the wrist cannot produce more than this, and the wire is not trusted to agree. */
export const WATCH_LOG_MAX_ITEMS = 60;
export const WATCH_LOG_MAX_NAME = 120;
export const WATCH_LOG_MAX_NOTE = 2000;

export type FeltAnswer = 'easy' | 'right' | 'hard';
const FELTS = new Set<string>(['easy', 'right', 'hard']);

/** One step as the wrist actually performed it. `plannedReps` rides along so the amendment is
 *  legible as an amendment — the plan learns more from "8 asked, 5 done" than from a bare 5. */
export interface WatchLogItem {
  name: string;
  done: boolean;
  sets?: number;
  reps?: number;
  plannedReps?: number;
}

export interface WatchSessionLog {
  occurrenceId: string;
  /** ISO instant the session ended on the wrist. Sent rather than stamped on receipt because a
   *  transfer can arrive hours late — `transferUserInfo` queues until the phone is reachable, and
   *  a session logged on a run without a phone must not be dated to whenever it finally landed. */
  finishedAt: string;
  kind: WatchSessionKind;
  items: WatchLogItem[];
  felt?: FeltAnswer;
  /** The mic. The user's own words, and the only field that goes to the coach's parse. */
  note?: string;
  /** Interval only — rounds actually completed, which is what "stopping early keeps the rounds
   *  you did" means in data. */
  rounds?: number;
  /** Wall-clock the session actually took. */
  elapsedSec?: number;
  /** The sit only — times attention was noticed to have wandered and come back. Counted because
   *  noticing IS the practice; never reported as a lapse. */
  cameBack?: number;
  /** `tracked` only — kilometres covered, as HealthKit measured them. */
  distanceKm?: number;
  /** `tracked` only — active energy in kilocalories, as HealthKit measured it. */
  energyKcal?: number;
}

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const clean = raw.trim().slice(0, max);
  return clean || undefined;
}

function num(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined;
  return Math.round(raw);
}

function normalizeItem(raw: unknown): WatchLogItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const i = raw as Record<string, unknown>;
  const name = str(i.name, WATCH_LOG_MAX_NAME);
  if (!name) return null;
  return {
    name,
    // Absent `done` counts as done: the wrist only ever sends steps it walked, and dropping one
    // because a field was missing would under-report work somebody actually did.
    done: typeof i.done === 'boolean' ? i.done : true,
    sets: num(i.sets),
    reps: num(i.reps),
    plannedReps: num(i.plannedReps),
  };
}

/**
 * Assert a payload off the wire into a log we will store, or `null` if it is not one.
 *
 * Null means "this is not a log", never "the session did not happen" — the caller answers 400 and
 * the watch keeps it in its outbox to retry, rather than the record being silently lost.
 */
export function normalizeWatchLog(raw: unknown): WatchSessionLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const occurrenceId = str(r.occurrenceId, 64);
  if (!occurrenceId) return null;

  const finishedAt = str(r.finishedAt, 40);
  const stamp = finishedAt && !Number.isNaN(Date.parse(finishedAt)) ? finishedAt : new Date().toISOString();

  const kinds = new Set<string>(['interval', 'strength', 'sit', 'tracked']);
  const kind = (typeof r.kind === 'string' && kinds.has(r.kind) ? r.kind : 'strength') as WatchSessionKind;

  const items = Array.isArray(r.items)
    ? r.items
        .slice(0, WATCH_LOG_MAX_ITEMS)
        .map(normalizeItem)
        .filter((i): i is WatchLogItem => i !== null)
    : [];

  const log: WatchSessionLog = { occurrenceId, finishedAt: stamp, kind, items };
  if (typeof r.felt === 'string' && FELTS.has(r.felt)) log.felt = r.felt as FeltAnswer;
  const note = str(r.note, WATCH_LOG_MAX_NOTE);
  if (note) log.note = note;
  const rounds = num(r.rounds);
  if (rounds !== undefined) log.rounds = rounds;
  const elapsedSec = num(r.elapsedSec);
  if (elapsedSec !== undefined) log.elapsedSec = elapsedSec;
  const cameBack = num(r.cameBack);
  if (cameBack !== undefined) log.cameBack = cameBack;
  // Distance keeps one decimal — it is a measurement, and rounding 4.7 km to 5 would overstate
  // what somebody did. `num` rounds to integers, so this one is read directly.
  if (typeof r.distanceKm === 'number' && Number.isFinite(r.distanceKm) && r.distanceKm > 0) {
    log.distanceKm = Math.round(r.distanceKm * 100) / 100;
  }
  const energyKcal = num(r.energyKcal);
  if (energyKcal !== undefined) log.energyKcal = energyKcal;
  return log;
}

/**
 * The wrist's structured record, in the shape the occurrence store already keeps.
 *
 * `felt` lands on every item rather than on the session, because that is where `OccurrenceLogItem`
 * carries it and where adaptation reads it. One answer on the wrist is a statement about the
 * session, so it applies to each step of it.
 */
export function watchLogItems(log: WatchSessionLog): OccurrenceLogItem[] {
  return log.items.map((i) => {
    const item: OccurrenceLogItem = { name: i.name, done: i.done };
    if (i.sets !== undefined) item.sets = i.sets;
    if (i.reps !== undefined) item.reps = i.reps;
    if (log.felt) item.felt = log.felt;
    return item;
  });
}

/**
 * One legible sentence for the UI and the coach's context.
 *
 * **Counts what happened.** Never what was skipped, never a percentage, never a comparison. An
 * amendment is reported as its own fact ("2 amended") rather than as a shortfall, because that is
 * information the plan wants rather than a failure to report. The sit's "came back" is named
 * plainly for the same reason: noticing is the practice.
 */
export function watchLogSummary(log: WatchSessionLog): string {
  const bits: string[] = [];

  if (log.kind === 'interval' && log.rounds !== undefined) {
    bits.push(`${log.rounds} ${log.rounds === 1 ? 'round' : 'rounds'}`);
  }

  if (log.distanceKm !== undefined) {
    bits.push(`${log.distanceKm.toFixed(log.distanceKm < 10 ? 1 : 0)} km`);
  }

  const done = log.items.filter((i) => i.done).length;
  if (done > 0) bits.push(`${done} ${done === 1 ? 'set' : 'sets'}`);

  if (log.elapsedSec !== undefined && log.elapsedSec >= 60) {
    bits.push(`${Math.round(log.elapsedSec / 60)} min`);
  }

  if (log.kind === 'sit' && log.cameBack) {
    bits.push(`came back ${log.cameBack}×`);
  }

  const amended = log.items.filter((i) => i.done && i.plannedReps !== undefined && i.reps !== i.plannedReps).length;
  if (amended > 0) bits.push(`${amended} amended`);

  const head = bits.length > 0 ? `Done on your watch — ${bits.join(', ')}` : 'Done on your watch';
  return log.felt ? `${head}. Felt ${log.felt}.` : `${head}.`;
}

/**
 * The words the coach's parse should see, or null when there are none.
 *
 * ONLY the user's own dictated note qualifies. The structured record is already structured and
 * must never be round-tripped through a model — that would spend a call to recover facts we were
 * handed, and risk the parse "correcting" a number the user typed with the crown.
 */
export function watchLogText(log: WatchSessionLog): string | null {
  return log.note ?? null;
}
