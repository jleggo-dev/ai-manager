/**
 * Settings — home location + timezone (§B1).
 *
 * Warm, confirm-first: we never grab GPS until the user taps Share. Coarse coords go to
 * cadence-api (server-only weather key); optional city label + timezone as a fallback when
 * they prefer not to share precise location.
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

function formatCoords(loc: HomeLocation): string {
  const label = loc.label?.trim();
  if (label) return label;
  return `${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°`;
}

export function LocationSettings() {
  const [loc, setLoc] = useState<HomeLocation | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
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
      if (r.home_location?.label) setCity(r.home_location.label);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function shareLocation() {
    if (busy || !geoOk) return;
    setBusy(true);
    setMsg('');
    try {
      const coords = await capabilities.location.getCoarseLocation();
      if (!coords) {
        setMsg("Couldn't get a location — you can type a city below instead.");
        return;
      }
      const tz = browserTimezone();
      const saved = await saveHomeLocation({
        lat: coords.lat,
        lon: coords.lon,
        ...(city.trim() ? { label: city.trim() } : {}),
        ...(tz ? { timezone: tz } : {}),
      });
      setLoc(saved.home_location);
      setTimezone(saved.timezone);
      setMsg('Got it — outdoor sessions can use the weather near you.');
    } catch {
      setMsg("That didn't save — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCityFallback() {
    if (busy || !city.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const tz = browserTimezone();
      // City path: server geocodes via OpenWeatherMap when lat/lon omitted.
      const saved = await saveHomeLocation({
        city: city.trim(),
        label: city.trim(),
        ...(tz ? { timezone: tz } : {}),
      });
      setLoc(saved.home_location);
      setTimezone(saved.timezone);
      setMsg(loc ? 'Updated — thanks.' : 'Got it — outdoor sessions can use the weather near that city.');
    } catch {
      setMsg("Couldn't find that city — try another spelling, or share from this device.");
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const ok = await clearHomeLocation();
      if (ok) {
        setLoc(null);
        setTimezone(null);
        setCity('');
        setMsg('Forgot that place.');
      } else setMsg("Couldn't clear that — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!available) return null;

  return (
    <div className="diet-block" style={{ marginTop: 12 }}>
      <div className="diet-block-t">Where you are</div>
      <div className="diet-block-h">
        Cadence uses a coarse location (not a pin on a map) so outdoor sessions can match the weather. Nothing is shared
        until you say yes.
      </div>

      {loc ? (
        <div className="sheet-msg" style={{ padding: '6px 0 8px' }}>
          Saved: <b>{formatCoords(loc)}</b>
          {timezone ? ` · ${timezone}` : ''}
        </div>
      ) : (
        <div className="sheet-msg" style={{ padding: '6px 0 8px' }}>
          No home place yet — outdoor weather stays off until you share.
        </div>
      )}

      <div className="diet-add" style={{ marginBottom: 8 }}>
        <input
          className="wiz-in"
          value={city}
          disabled={busy}
          placeholder="City (optional fallback)"
          onChange={(e) => setCity(e.target.value)}
        />
        <button type="button" className="diet-add-btn" disabled={busy || !city.trim()} onClick={saveCityFallback}>
          Use city
        </button>
      </div>

      <button type="button" className="set-row" onClick={shareLocation} disabled={busy || !geoOk}>
        <b>{loc ? 'Update from this device' : 'Share coarse location'}</b>
        <span>
          {geoOk
            ? 'Your browser will ask once — we only need an approximate place.'
            : 'Location isn’t available in this browser.'}
        </span>
      </button>

      {loc && (
        <button type="button" className="set-row" onClick={forget} disabled={busy}>
          <b>Forget this place</b>
          <span>Stops weather-aware outdoor tips until you share again</span>
        </button>
      )}

      {msg && (
        <div className="auth-notice" style={{ marginTop: 6 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
