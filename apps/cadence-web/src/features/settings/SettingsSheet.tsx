import { useState } from 'react';
import { supabase } from '../../lib/supabase.ts';
import { deleteMyData, isDevMode, getDevAccount, resetAccount } from '../../lib/api.ts';
import { NutritionTargets } from './NutritionTargets.tsx';
import { UnitSettings } from './UnitSettings.tsx';
import { WeighInSettings } from './WeighInSettings.tsx';
import { DietaryProfileEditor } from './DietaryProfileEditor.tsx';
import { LocationSettings } from './LocationSettings.tsx';
import { AppleHealthSettings } from './AppleHealthSettings.tsx';
import { ConstraintsSettings } from './ConstraintsSettings.tsx';
import { NotificationSettings } from './NotificationSettings.tsx';
import { CoachFaceSettings } from './CoachFaceSettings.tsx';

/**
 * Settings, as a sheet opened from the tab bar's Settings button (MainTabs). Real-auth: email,
 * sign out, password reset (email link — v1 skips in-app updateUser reauth), Edit goals &
 * equipment (Review manage mode), and the danger zone: "Start over" wipes Cadence data after the
 * user TYPES the phrase (the server re-verifies it; the login itself survives and the copy says
 * so). Dev mode: shows the account
 * slug and routes Start over through /dev/reset (which also clears the X-ray trace).
 */
export function SettingsSheet({
  email,
  onClose,
  onManage,
}: {
  email: string | null;
  onClose: () => void;
  onManage: () => void;
}) {
  const [danger, setDanger] = useState(false);
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
      <div className="sheet-scrim" onClick={busy ? undefined : onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-label="Settings">
        <div className="sheet-grab" aria-hidden />
        <div className="sheet-head">
          <div className="sheet-title">
            <b>Settings</b>
            <span>{dev ? `dev · ${getDevAccount()}` : (email ?? '')}</span>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sheet-body">
          <button
            className="set-row"
            onClick={() => {
              onClose();
              onManage();
            }}
          >
            <b>Edit goals & equipment</b>
            <span>Add, tweak, or retire what the plan is built from</span>
          </button>

          <CoachFaceSettings />

          <NutritionTargets />
          <UnitSettings />

          <WeighInSettings />

          <DietaryProfileEditor />

          <LocationSettings />

          {/* Native-shell only: both render null on web (capability seam). */}
          <ConstraintsSettings />
          <AppleHealthSettings />
          <NotificationSettings />

          {!dev && (
            <>
              <button className="set-row" onClick={sendReset} disabled={busy || !email}>
                <b>Change password</b>
                <span>{"We'll email you a secure reset link"}</span>
              </button>
              <button className="set-row" onClick={() => supabase.auth.signOut()}>
                <b>Sign out</b>
                <span>Your data stays put for next time</span>
              </button>
            </>
          )}

          {msg && (
            <div className="auth-notice" style={{ marginTop: 4 }}>
              {msg}
            </div>
          )}

          <div className="set-danger">
            <div className="set-danger-t">Danger zone</div>
            {!danger ? (
              <button className="set-danger-btn" onClick={() => setDanger(true)}>
                Start over…
              </button>
            ) : (
              <>
                <div className="sheet-msg" style={{ padding: '2px 0 8px' }}>
                  {"This erases your goals, plan, history, and conversations — everything you've built here."}
                  {dev ? '' : " Your login survives; you'd onboard from scratch."} Type <b>start over</b> to confirm.
                </div>
                <div className="prog-add">
                  <input
                    className="wiz-in"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder="start over"
                    disabled={busy}
                    autoFocus
                  />
                  <button
                    className="set-danger-btn set-danger-go"
                    onClick={startOver}
                    disabled={busy || phrase.trim().toLowerCase() !== 'start over'}
                  >
                    {busy ? 'Erasing…' : 'Erase it all'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
