import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase.ts';
import { deleteMyData, isDevMode, getDevAccount, resetAccount, getNutritionDay, setMacroTargets, clearMacroTargets, type MealMacros } from '../../lib/api.ts';

const MK = [
  { k: 'kcal', label: 'Calories', unit: 'kcal' },
  { k: 'protein_g', label: 'Protein', unit: 'g' },
  { k: 'carbs_g', label: 'Carbs', unit: 'g' },
  { k: 'fat_g', label: 'Fat', unit: 'g' },
] as const;

/**
 * Daily macro-target editor (N3 "later tweaks"). Collapsed until opened; loads current targets,
 * lets the user set/adjust each field, and clear them entirely (back to observe-style). Only
 * appears once targets exist OR the user opens it — a books-only user never sees macro chrome
 * here either.
 */
function NutritionTargets() {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [has, setHas] = useState<boolean | null>(null); // null = not loaded yet
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    getNutritionDay()
      .then((d) => {
        const t = d?.targets ?? null;
        setHas(!!t && Object.keys(t).length > 0);
        if (t) setVals(Object.fromEntries(MK.map(({ k }) => [k, t[k] != null ? String(t[k]) : ''])));
      })
      .catch(() => setHas(false));
  }, []);

  if (has === null || (!has && !open)) {
    // Hidden until it exists; a subtle way in for users who want to set them manually.
    return has === false ? (
      <button className="set-row" onClick={() => setOpen(true)}>
        <b>Daily nutrition targets</b>
        <span>Set calorie & macro goals — or let your coach propose them</span>
      </button>
    ) : null;
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setNote('');
    const body: MealMacros = {};
    for (const { k } of MK) {
      const n = Number(vals[k]);
      if (Number.isFinite(n) && n > 0) body[k] = n;
    }
    try {
      const saved = await setMacroTargets(body);
      if (saved) {
        setHas(true);
        setNote('Saved — your day now shows what’s left.');
      } else setNote('Those numbers didn’t look right — check the ranges and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      if (await clearMacroTargets()) {
        setHas(false);
        setOpen(false);
        setVals({});
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="set-targets">
      <div className="set-targets-t">Daily nutrition targets</div>
      <div className="set-targets-grid">
        {MK.map(({ k, label, unit }) => (
          <label className="set-target" key={k}>
            <span>{label}</span>
            <input
              className="wiz-in"
              type="number"
              inputMode="numeric"
              value={vals[k] ?? ''}
              placeholder={unit}
              disabled={busy}
              onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {note && <div className="sheet-msg" style={{ padding: '2px 0 6px' }}>{note}</div>}
      <div className="set-targets-actions">
        <button className="lockbtn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save targets'}</button>
        {has && <button className="set-danger-btn" onClick={clear} disabled={busy}>Clear</button>}
      </div>
    </div>
  );
}

/**
 * Settings, as a sheet from the header gear. Real-auth: email, sign out, password reset (email
 * link — v1 skips in-app updateUser reauth), Edit goals & equipment (Review manage mode), and
 * the danger zone: "Start over" wipes Cadence data after the user TYPES the phrase (the server
 * re-verifies it; the login itself survives and the copy says so). Dev mode: shows the account
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
      setMsg(error ? "Couldn't send the reset email — try again in a moment." : `Password reset link sent to ${email}.`);
    } finally {
      setBusy(false);
    }
  }

  async function startOver() {
    if (busy || phrase.trim().toLowerCase() !== 'start over') return;
    setBusy(true);
    setMsg('');
    try {
      const ok = dev ? (await resetAccount().then(() => true).catch(() => false)) : await deleteMyData('start over');
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
            <span>{dev ? `dev · ${getDevAccount()}` : email ?? ''}</span>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="sheet-body">
          <button className="set-row" onClick={() => { onClose(); onManage(); }}>
            <b>Edit goals & equipment</b>
            <span>Add, tweak, or retire what the plan is built from</span>
          </button>

          <NutritionTargets />

          {!dev && (
            <>
              <button className="set-row" onClick={sendReset} disabled={busy || !email}>
                <b>Change password</b>
                <span>We'll email you a secure reset link</span>
              </button>
              <button className="set-row" onClick={() => supabase.auth.signOut()}>
                <b>Sign out</b>
                <span>Your data stays put for next time</span>
              </button>
            </>
          )}

          {msg && <div className="auth-notice" style={{ marginTop: 4 }}>{msg}</div>}

          <div className="set-danger">
            <div className="set-danger-t">Danger zone</div>
            {!danger ? (
              <button className="set-danger-btn" onClick={() => setDanger(true)}>Start over…</button>
            ) : (
              <>
                <div className="sheet-msg" style={{ padding: '2px 0 8px' }}>
                  This erases your goals, plan, history, and conversations — everything you've built here.
                  {dev ? '' : ' Your login survives; you\'d onboard from scratch.'} Type <b>start over</b> to confirm.
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
