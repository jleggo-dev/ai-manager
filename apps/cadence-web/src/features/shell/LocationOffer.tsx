/**
 * First-run / soft prompt: when home_location is unset and the browser can share coarse
 * geolocation, offer once (sessionStorage) with warm copy. Never auto-grabs GPS.
 */
import { useEffect, useState } from 'react';
import { browserTimezone, getHomeLocation, saveHomeLocation } from '../../lib/api.ts';
import { capabilities } from '../../lib/capability/index.ts';

const DISMISS_KEY = 'cadence.locationOffer.dismissed';

export function LocationOffer() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY) === '1') return;
    if (!capabilities.location.isAvailable()) return;
    let cancelled = false;
    void getHomeLocation().then((r) => {
      if (cancelled || !r.available || r.home_location) return;
      setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setOpen(false);
  }

  async function share() {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const coords = await capabilities.location.getCoarseLocation();
      if (!coords) {
        setMsg('No worries — you can share later from Settings.');
        return;
      }
      const tz = browserTimezone();
      await saveHomeLocation({
        lat: coords.lat,
        lon: coords.lon,
        ...(tz ? { timezone: tz } : {}),
      });
      dismiss();
    } catch {
      setMsg("That didn't save — try again from Settings whenever you're ready.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      role="region"
      aria-label="Location"
      style={{
        margin: '8px 12px 0',
        padding: '12px 14px',
        borderRadius: 12,
        background: 'color-mix(in srgb, var(--ink, #1a1a1a) 6%, transparent)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Outdoor sessions work better with weather</div>
      <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 10 }}>
        If you&apos;re willing, share a coarse location so I can check the weather near you. Your browser will ask — you
        can say no and change this anytime in Settings.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={share} disabled={busy}>
          {busy ? 'Sharing…' : 'Share coarse location'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={dismiss} disabled={busy}>
          Not now
        </button>
      </div>
      {msg && (
        <div className="auth-notice" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
