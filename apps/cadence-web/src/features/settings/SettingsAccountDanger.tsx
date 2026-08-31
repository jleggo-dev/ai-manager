import { useState } from 'react';
import { supabase } from '../../lib/supabase.ts';
import { deleteMyData, isDevMode, resetAccount } from '../../lib/api.ts';

/**
 * ACCOUNT + DANGER ZONE (design owner-approved 2026-08-31).
 *
 * Same handlers as `SettingsSheet.tsx` — real-auth "start over" goes through `deleteMyData`
 * (server re-verifies the typed phrase), dev mode through `resetAccount` — restyled per the
 * design: the danger card is always expanded (no more "Start over…" teaser tap to reveal it,
 * since the Room is already a deliberate destination rather than a cramped sheet), and the body
 * copy is lifted verbatim.
 *
 * The dev-mode clause (dropping "Your login survives…") is preserved from `SettingsSheet.tsx`
 * rather than lifted verbatim for every mode: a dev scratch account has no real login for that
 * sentence to be true of, and the design brief wasn't contemplating dev mode when it wrote the
 * canonical paragraph.
 */
export function SettingsAccountDanger({ email }: { email: string | null }) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const dev = isDevMode();

  async function sendReset() {
    if (!email || busy) return;
    setBusy(true);
    setMsg('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      setMsg(
        error ? "Couldn't send the reset email — try again in a moment." : `Password reset link sent to ${email}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    if (busy || phrase.trim().toLowerCase() !== 'start over') return;
    setBusy(true);
    setMsg('');
    try {
      const ok = dev
        ? await resetAccount()
            .then(() => true)
            .catch(() => false)
        : await deleteMyData('start over');
      if (ok) {
        window.location.reload(); // stage resolves to 'new' → Welcome
        return;
      }
      setMsg("That didn't go through — try again in a moment.");
    } catch {
      setMsg("That didn't go through — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="room-group">
        <h3 className="room-group-label">Account</h3>
        {!dev && (
          <>
            <button className="room-row" onClick={sendReset} disabled={busy || !email}>
              <b>Change password</b>
              <span>{"We'll email you a secure reset link"}</span>
            </button>
            <button className="room-row" onClick={() => supabase.auth.signOut()}>
              <b>Sign out</b>
              <span>Your data stays put for next time</span>
            </button>
          </>
        )}
        {msg && <div className="auth-notice">{msg}</div>}
      </section>

      <section className="room-danger">
        <h3 className="room-group-label room-danger-label">Danger zone</h3>
        <div className="room-danger-card">
          <div className="room-danger-h">Start over</div>
          <p className="room-danger-body">
            {"This erases your goals, plan, history, and conversations — everything you've built here."}
            {dev ? '' : " Your login survives; you'd onboard from scratch."}
            {' There is no undo, which is why we make you type it.'}
          </p>
          <input
            className="room-danger-input"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="start over"
            disabled={busy}
          />
          <button
            className="room-danger-go"
            onClick={startOver}
            disabled={busy || phrase.trim().toLowerCase() !== 'start over'}
          >
            {busy ? 'Erasing…' : 'Erase it all'}
          </button>
          <p className="room-danger-foot">{"The server checks the phrase again — the button alone can't do it."}</p>
        </div>
      </section>
    </>
  );
}
