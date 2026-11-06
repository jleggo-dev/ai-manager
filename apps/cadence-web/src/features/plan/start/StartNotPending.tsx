import { useState } from 'react';

/**
 * A task that has already been answered, tapped again. A done one can be opened again: finishing
 * by accident, or spotting a mistake afterwards, used to end here with no way back in
 * (owner, 2026-11-05). The earlier log stays on the row, and the next Finish is reconciled with it
 * rather than replacing it (session-log.ts).
 */
export function StartNotPending({ status, onReopen }: { status: string; onReopen: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const reopen = () => {
    setBusy(true);
    setFailed(false);
    onReopen().catch(() => {
      setBusy(false);
      setFailed(true);
    });
  };

  return (
    <>
      <div className="sheet-msg">
        {"This one's already "}
        {status === 'done' ? 'done — nice.' : `marked ${status}.`}
        {failed && <p className="sheet-msg-line">{"Couldn't open it just now — try again in a moment."}</p>}
      </div>
      {status === 'done' && (
        <button className="ss-btn ss-less" disabled={busy} onClick={reopen}>
          Open it again
        </button>
      )}
    </>
  );
}
