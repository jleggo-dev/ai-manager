/**
 * Store a session finished on the watch (watch app W2 — the return leg).
 *
 * The watch sends structure, not prose: which steps were done, which reps were amended, how it
 * felt. That record is written deterministically — no model call — because the numbers are already
 * numbers and parsing them out of a sentence we generated ourselves would be slower, lossier and
 * billed.
 *
 * The one exception is the dictated note. If the user said something on the Done face, it goes
 * through the ORDINARY log path afterwards, which already reconciles a second report against the
 * first (see `logOccurrence`). So "actually I did six" revises the record the watch just wrote,
 * using the reconciliation that path was built for, rather than a merge invented here.
 */
import {
  normalizeWatchLog,
  watchLogItems,
  watchLogSummary,
  type OccurrenceLog,
  type Provenance,
} from '@cadence/shared';
import { getOccurrenceWithActivity, recordOccurrenceLog } from '../repos/occurrences.ts';
import { logOccurrence } from './session-log.ts';

export interface WatchLogResult {
  stored: boolean;
  summary: string;
  /** True when the same finished session had already been stored — a redelivery, not new work. */
  duplicate: boolean;
}

/**
 * `null` means the payload was not a log, or the occurrence is not this user's — the route
 * answers 4xx and the watch keeps it in its outbox. It never means "the session did not happen".
 */
export async function logSessionFromWatch(userId: string, raw: unknown): Promise<WatchLogResult | null> {
  const watch = normalizeWatchLog(raw);
  if (!watch) return null;

  const occ = await getOccurrenceWithActivity(userId, watch.occurrenceId);
  if (!occ) return null;

  const summary = watchLogSummary(watch);

  /**
   * Idempotency, because delivery is at-least-once.
   *
   * `transferUserInfo` queues until the phone is reachable, and the watch keeps its own outbox
   * until the phone confirms — so a lost acknowledgement means the same finished session arrives
   * twice. Keyed on the watch's own `finishedAt`, which identifies the session that ended rather
   * than the moment it landed. Without this, a redelivery re-runs the note's parse and bills a
   * second model call to reach the same row.
   */
  if (occ.log?.logged_at === watch.finishedAt) {
    return { stored: false, summary: occ.log.summary || summary, duplicate: true };
  }

  const log: OccurrenceLog = {
    items: watchLogItems(watch),
    summary,
    // Their own words when there are any; otherwise the deterministic summary, so `raw_text` is
    // never empty and the audit trail always says where the row came from.
    raw_text: watch.note ?? summary,
    logged_at: watch.finishedAt,
  };

  // Numeric rollups the progress engine reads. Only what the watch actually measured — an absent
  // number stays absent rather than becoming a zero that would drag an average.
  const value: Record<string, number> = {};
  if (watch.elapsedSec !== undefined && watch.elapsedSec >= 60) {
    value.duration_min = Math.round(watch.elapsedSec / 60);
  }
  if (watch.rounds !== undefined) value.rounds = watch.rounds;

  // `self_report` is the honest source: the user pressed Done and answered the felt question.
  // Which DEVICE they did it on is recorded in the summary text, not in provenance, whose four
  // values are about how the fact was obtained rather than on what hardware.
  const provenance: Provenance = {
    source: 'self_report',
    auto: false,
    recorded_at: new Date().toISOString(),
  };

  const ok = await recordOccurrenceLog(userId, watch.occurrenceId, { log, value, provenance });
  if (!ok) return null;

  /**
   * The dictated note, through the ordinary path.
   *
   * Deliberately after the structured write, so the parse sees the watch's record as the prior
   * report and reconciles against it. Best-effort: the structured log is already stored and a
   * failed parse must not lose it — the user's words are in `raw_text` either way.
   */
  if (watch.note) {
    try {
      const revised = await logOccurrence(userId, watch.occurrenceId, watch.note);
      if (revised) return { stored: true, summary: revised.summary, duplicate: false };
    } catch (err) {
      console.error('[watch-log:note]', err);
    }
  }

  return { stored: true, summary, duplicate: false };
}
