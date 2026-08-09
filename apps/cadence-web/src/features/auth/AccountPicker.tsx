import { useState } from 'react';
import { coachFace } from '@cadence/shared';
import { Orb } from '../../components/Orb.tsx';
import { forgetDeviceAccount, listDeviceAccounts, resumeDeviceAccount, type DeviceAccount } from './deviceAccounts.ts';

/**
 * "Welcome back" — the accounts that have signed in on this phone.
 *
 * Two modes in one component because they are one screen with an edit state, exactly as the
 * design draws them: the list, and the same list with a remove control per row. Splitting them
 * would duplicate the row.
 *
 * The footnote under the manage list is load-bearing. A red minus beside your own face reads as
 * "delete me", and the true answer — this signs you out here and nothing else — has to be on
 * screen at the moment of the tap, not in a confirm dialog after it.
 */
function Avatar({ account }: { account: DeviceAccount }) {
  const face = coachFace(account.faceId);
  return (
    <span className="acct-face" aria-hidden>
      {face?.art ? <img src={face.art} alt="" loading="lazy" decoding="async" /> : <Orb />}
    </span>
  );
}

export function AccountPicker({ onAddAccount, onResumed }: { onAddAccount: () => void; onResumed: () => void }) {
  const [accounts, setAccounts] = useState<DeviceAccount[]>(() => listDeviceAccounts());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  async function resume(a: DeviceAccount) {
    if (busy) return;
    setBusy(a.userId);
    setMsg('');
    const result = await resumeDeviceAccount(a.userId);
    setBusy(null);
    if (result === 'ok') return onResumed();
    setAccounts(listDeviceAccounts());
    setMsg("That sign-in has expired — sign in again and I'll pick up right where we left off.");
  }

  function forget(a: DeviceAccount) {
    forgetDeviceAccount(a.userId);
    const left = listDeviceAccounts();
    setAccounts(left);
    if (!left.length) setEditing(false);
  }

  return (
    <div className="welcome acctscreen">
      {!editing && (
        <div className="acct-hero">
          <Orb hero />
          <div className="acct-h">Welcome back</div>
        </div>
      )}
      {editing && <div className="acct-h acct-h-edit">Manage accounts</div>}

      <div className="acct-list">
        {accounts.map((a) => (
          <div key={a.userId} className="acct-row">
            {editing && (
              <button
                className="acct-remove"
                onClick={() => forget(a)}
                aria-label={`Sign ${a.name ?? a.email ?? 'this account'} out of this device`}
              >
                −
              </button>
            )}
            <button className="acct-main" onClick={() => !editing && void resume(a)} disabled={editing || !!busy}>
              <Avatar account={a} />
              <span className="acct-who">
                <b>{a.name ?? a.email ?? 'Your account'}</b>
                <span>
                  {a.email ?? 'signed in on this device'}
                  {!editing && a.refreshToken ? ' · signed in' : ''}
                </span>
              </span>
              {!editing && (
                <span className="acct-go" aria-hidden>
                  {busy === a.userId ? '…' : '›'}
                </span>
              )}
            </button>
          </div>
        ))}
        {!editing && (
          <button className="acct-row acct-add" onClick={onAddAccount}>
            <span className="acct-plus" aria-hidden>
              +
            </span>
            Add another account
          </button>
        )}
      </div>

      {msg && <div className="auth-error acct-msg">{msg}</div>}

      <button className="acct-manage" onClick={() => setEditing((e) => !e)}>
        {editing ? 'Done editing' : 'Manage accounts'}
      </button>

      {editing && (
        <div className="acct-foot">{'Removing an account signs it out on this device only — nothing is deleted.'}</div>
      )}
    </div>
  );
}
