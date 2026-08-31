/**
 * Settings Room — Location, rebuilt to the three-state consent design (owner-approved
 * 2026-08-31), replacing `LocationSettings.tsx`'s always-visible text field:
 *
 *   (a) device location ON  — toggle on, place shown, "Update" greyed, "Forget this place"
 *                              re-reads from the device rather than clearing (the toggle staying
 *                              on while there is nowhere to point it would be a broken promise).
 *   (b) OFF, a typed city    — city shown, "Update" (reopens the Set flow) + "Forget this place"
 *                              (clears it).
 *   (c) OFF, nothing set     — a single "Set" button.
 *
 * The raw city text field appears ONLY inside the Set flow, never on the main surface — the
 * three states above are the whole of what a glance at Settings shows.
 *
 * `/me/location` has no "how this was set" column, so which of (a)/(b) a saved place is in is
 * tracked client-side (`cadence.locationSource`) rather than invented by re-reading `label`,
 * which a device share can also carry. This is a UI-copy decision, not a data-integrity one: the
 * underlying place and the ability to forget it round-trip through the real API either way.
 */
import { useEffect, useState } from 'react';
import {
  browserTimezone,
  clearHomeLocation,
  getHomeLocation,
  saveHomeLocation,
  type HomeLocation,
} from '../../lib/api.ts';
import { capabilities } from '../../lib/capability/index.ts';

type Source = 'device' | 'city';
const SOURCE_KEY = 'cadence.locationSource';

function readSource(loc: HomeLocation | null): Source | null {
  if (!loc) return null;
  try {
    const stored = window.localStorage.getItem(SOURCE_KEY);
    if (stored === 'device' || stored === 'city') return stored;
  } catch {
    /* fall through to the heuristic below */
  }
  // No record (e.g. a place saved before this rebuild, or storage unavailable): a typed city
  // always carries a label; a bare device share usually does not.
  return loc.label ? 'city' : 'device';
}

function writeSource(source: Source | null) {
  try {
    if (source) window.localStorage.setItem(SOURCE_KEY, source);
    else window.localStorage.removeItem(SOURCE_KEY);
  } catch {
    /* no localStorage, no matter — the next load falls back to the label heuristic */
  }
}

function formatPlace(loc: HomeLocation): string {
  const label = loc.label?.trim();
  if (label) return label;
  return `${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°`;
}

export function SettingsLocation() {
  const [loc, setLoc] = useState<HomeLocation | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [source, setSource] = useState<Source | null>(null);
  const [flow, setFlow] = useState(false);
  const [useDevice, setUseDevice] = useState(true);
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const geoOk = capabilities.location.isAvailable();

  useEffect(() => {
    let cancelled = false;
    void getHomeLocation().then((r) => {
      if (cancelled) return;
      setAvailable(r.available);
      setLoc(r.home_location);
      setTimezone(r.timezone);
      setSource(readSource(r.home_location));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function shareFromDevice() {
    if (busy || !geoOk) return;
    setBusy(true);
    setMsg('');
    try {
      const coords = await capabilities.location.getCoarseLocation();
      if (!coords) {
        setMsg("Couldn't get a location from this device — try a city instead.");
        return;
      }
      const tz = browserTimezone();
      const saved = await saveHomeLocation({ lat: coords.lat, lon: coords.lon, ...(tz ? { timezone: tz } : {}) });
      setLoc(saved.home_location);
      setTimezone(saved.timezone);
      setSource('device');
      writeSource('device');
      setFlow(false);
      setMsg('Got it — outdoor sessions can use the weather near you.');
    } catch {
      setMsg("That didn't save — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCity() {
    if (busy || !city.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const tz = browserTimezone();
      const saved = await saveHomeLocation({ city: city.trim(), label: city.trim(), ...(tz ? { timezone: tz } : {}) });
      setLoc(saved.home_location);
      setTimezone(saved.timezone);
      setSource('city');
      writeSource('city');
      setFlow(false);
      setCity('');
      setMsg('Got it — outdoor sessions can use the weather near that city.');
    } catch {
      setMsg("Couldn't find that city — try another spelling, or share from this device.");
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    if (busy) return;
    // State (a): the toggle is still ON, so "forgetting" the stale place means reading a fresh
    // one from the device rather than leaving the promise ("use this device's location") broken.
    if (source === 'device') return shareFromDevice();
    setBusy(true);
    setMsg('');
    try {
      const ok = await clearHomeLocation();
      if (ok) {
        setLoc(null);
        setTimezone(null);
        setSource(null);
        writeSource(null);
        setMsg('Forgot that place.');
      } else setMsg("Couldn't clear that — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!available) return null;

  return (
    <div className="room-row-wrap">
      {loc && source === 'device' && (
        <div className="room-row room-row-toggle" role="switch" aria-checked="true">
          <span className="room-row-text">
            <b>{"Use this device's location"}</b>
            <span>For weather on outdoor sessions</span>
          </span>
          <span className="room-toggle is-on" aria-hidden>
            <span className="room-toggle-knob" />
          </span>
        </div>
      )}
      {loc && (
        <div className="room-loc-place">
          {formatPlace(loc)}
          {timezone ? ` · ${timezone}` : ''}
        </div>
      )}
      {!loc && (
        <button type="button" className="room-row" onClick={() => setFlow(true)} disabled={busy}>
          <span className="room-row-text">
            <b>Location</b>
            <span>Off — no weather-aware outdoor tips yet</span>
          </span>
          <span className="room-loc-set">Set</span>
        </button>
      )}
      {loc && (
        <div className="room-loc-actions">
          <button
            type="button"
            className="room-loc-btn"
            disabled={busy || source === 'device'}
            onClick={() => {
              setUseDevice(false);
              setCity(source === 'city' ? formatPlace(loc) : '');
              setFlow(true);
            }}
          >
            Update
          </button>
          <button type="button" className="room-loc-btn" disabled={busy} onClick={forget}>
            Forget this place
          </button>
        </div>
      )}

      {flow && (
        <div className="room-loc-flow">
          <button
            type="button"
            className="room-row room-row-toggle"
            role="switch"
            aria-checked={useDevice}
            disabled={!geoOk}
            onClick={() => setUseDevice((v) => !v)}
          >
            <span className="room-row-text">
              <b>{"Use this device's location"}</b>
              <span>{geoOk ? 'For weather on outdoor sessions' : "Location isn't available in this browser"}</span>
            </span>
            <span className={`room-toggle${useDevice && geoOk ? ' is-on' : ''}`} aria-hidden>
              <span className="room-toggle-knob" />
            </span>
          </button>
          {(!useDevice || !geoOk) && (
            <div className="room-loc-city">
              <input
                className="wiz-in"
                value={city}
                disabled={busy}
                placeholder="City"
                onChange={(e) => setCity(e.target.value)}
              />
              <button type="button" className="room-loc-go" disabled={busy || !city.trim()} onClick={saveCity}>
                Save
              </button>
            </div>
          )}
          <div className="room-loc-actions">
            {useDevice && geoOk && (
              <button type="button" className="room-loc-go" disabled={busy} onClick={shareFromDevice}>
                {busy ? 'Getting your location…' : 'Share coarse location'}
              </button>
            )}
            <button type="button" className="room-loc-btn" disabled={busy} onClick={() => setFlow(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="room-row-pointer">Forget clears it — no weather until a place is set.</p>
      {msg && <div className="auth-notice">{msg}</div>}
    </div>
  );
}
