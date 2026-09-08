import { useState } from 'react';
import type { CitySetter } from './useCitySetter.ts';

/**
 * The city line under the sheet's headline.
 *
 * Plain text when the device sets the place. When the place is a typed city (or nothing yet),
 * CHANGE opens the city field right here — the same save Settings' Set flow runs — because with
 * device location off this is where someone looks to fix a wrong city (owner, 2026-09-08). The
 * field is the whole flow: type, Save, and the header re-reads the sky for the new place.
 */
export function WeatherCityLine({ city, setter }: { city: string | null; setter?: CitySetter }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function save() {
    if (busy || !draft.trim()) return;
    setBusy(true);
    setMsg('');
    const ok = await setter!.save(draft);
    setBusy(false);
    if (ok) {
      setEditing(false);
      setDraft('');
    } else {
      setMsg("Couldn't find that city — try another spelling.");
    }
  }

  if (!setter?.canChange) {
    return (
      <span className="thead-loc">
        <span aria-hidden>📍</span> {city ?? 'Weather nearby'}
      </span>
    );
  }

  if (!editing) {
    return (
      <button className="thead-loc" type="button" onClick={() => setEditing(true)}>
        <span aria-hidden>📍</span> {city ?? 'Set a city'} <i>· CHANGE</i>
      </button>
    );
  }

  return (
    <div className="wxsheet-city">
      <div className="wxsheet-city-row">
        <input
          className="wiz-in"
          value={draft}
          disabled={busy}
          placeholder="City"
          aria-label="City"
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <button type="button" className="wxsheet-city-go" disabled={busy || !draft.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="wxsheet-city-cancel"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setMsg('');
          }}
        >
          Cancel
        </button>
      </div>
      {msg && <div className="auth-notice">{msg}</div>}
    </div>
  );
}
