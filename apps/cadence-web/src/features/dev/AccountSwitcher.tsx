import { useState } from 'react';
import {
  DEV_ACCOUNTS,
  DEV_ACCOUNT_LABELS,
  getDevAccount,
  setDevAccount,
  resetAccount,
  type DevAccount,
} from '../../lib/api.ts';

/**
 * Dev-only account switcher (real auth deferred): flip between two interchangeable scratch
 * accounts, and clear the current one's data with Reset. Both reload so the app re-fetches
 * under the new/cleared state. Disappears once real auth replaces the dev-account header.
 */
export function AccountSwitcher() {
  const current = getDevAccount();
  const [busy, setBusy] = useState(false);

  async function doReset() {
    if (busy) return;
    if (
      !window.confirm(`Reset ${DEV_ACCOUNT_LABELS[current]}? This clears all its data — goals, plan, and chat history.`)
    ) {
      return;
    }
    setBusy(true);
    try {
      await resetAccount();
    } catch {
      /* reload anyway — shows the (possibly unchanged) state */
    }
    window.location.reload();
  }

  return (
    <div className="acct-switch" title="Dev: switch test account">
      <span className="acct-dot" />
      <select
        value={current}
        onChange={(e) => {
          setDevAccount(e.target.value as DevAccount);
          window.location.reload();
        }}
      >
        {DEV_ACCOUNTS.map((a) => (
          <option key={a} value={a}>
            {DEV_ACCOUNT_LABELS[a]}
          </option>
        ))}
      </select>
      <button className="acct-reset" onClick={doReset} disabled={busy} title="Clear this account's data">
        {busy ? '…' : 'Reset'}
      </button>
    </div>
  );
}
