/**
 * The one honest sentence for a session the coach could not build, with a Try-again that
 * re-fetches in place. Shared by every occurrence sheet so the words are the same wherever it
 * happens.
 *
 * Why its own state and its own line: on 2026-10-27/28 the provider stopped serving the coach's
 * models, and for a day every workout and piano session opened to "Couldn't open this just now —
 * close and tap it again in a moment", which was neither true (tapping again did nothing) nor
 * telling (it read as the app being broken). The server now retries before answering and names
 * the fault (503 `coach_unreachable`); this is where that name becomes words. The plan itself is
 * untouched by a failed build, and the line says so.
 */
export const COACH_UNREACHABLE_LINE =
  "I couldn't reach the coach to build this just now. Your plan is safe — try again in a minute.";

export function CoachUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="sheet-msg" role="status">
      <p className="sheet-msg-line">{COACH_UNREACHABLE_LINE}</p>
      <button type="button" className="ss-btn ss-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
