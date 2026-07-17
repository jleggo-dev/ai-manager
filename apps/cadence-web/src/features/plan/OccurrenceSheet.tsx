import { useEffect, useState } from 'react';
import type { SessionItem } from '@cadence/shared';
import { getOccurrenceDetail, logOccurrence, recordWeighIn, logMeal, getRecentMeals, getBaselineRead, type OccurrenceDetail, type Meal, type MealKind, type BaselineRead } from '../../lib/api.ts';
import { Orb } from '../../components/Orb.tsx';
import { MicButton } from '../../components/MicButton.tsx';

/**
 * The session sheet — tap an occurrence, see the coach's concrete session (blocks of items with
 * sets × reps @ load), the why (coach note), and ▶ how-to links. First open generates the
 * session server-side (one coach call, a few seconds) — same typing-dots loading as chat.
 * ▶ links are always YouTube SEARCH result pages built client-side from `video_query`; the
 * model never supplies URLs. A 404 means a re-plan replaced this day — say so plainly.
 */

/** "3×8 @ 55 lb · 12 min · 5 km" — compose only from the fields the item actually has. */
function qty(i: SessionItem): string {
  const parts: string[] = [];
  if (i.sets && i.reps) parts.push(`${i.sets}×${i.reps}`);
  else if (i.sets) parts.push(`${i.sets} sets`);
  else if (i.reps) parts.push(`${i.reps} reps`);
  if (i.load) parts.push(`@ ${i.load}`);
  if (i.duration_min) parts.push(`${i.duration_min} min`);
  if (i.distance_km) parts.push(`${i.distance_km} km`);
  return parts.join(' · ');
}

const ytSearch = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q.replace(/\s+/g, ' ').trim())}`;

const isFoodRow = (d: OccurrenceDetail | null): boolean =>
  !!d && d.kind === 'system' && /food|meal|nutrition/i.test(d.title);

/** Sensible default meal for right now — the user can always switch it. */
const mealForNow = (): MealKind => {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snack' : h < 21 ? 'dinner' : 'snack';
};

/**
 * Downscale a photo client-side (max 1024px, JPEG q0.8) so a 10MB phone shot becomes a
 * ~100-300KB upload — well inside the server's caps. Returns a data URL.
 */
function downscalePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

export function OccurrenceSheet({
  occurrenceId,
  onClose,
  onLogged,
  onProposeChange,
}: {
  occurrenceId: string;
  onClose: () => void;
  onLogged?: () => void; // parent refreshes the week so the row shows done
  onProposeChange?: (steer: string) => void; // hand the baseline's suggested change to the Adjust flow
}) {
  const [detail, setDetail] = useState<OccurrenceDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading');
  const [logText, setLogText] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [logErr, setLogErr] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>('lb');
  const [mealText, setMealText] = useState('');
  const [mealKind, setMealKind] = useState<MealKind>(mealForNow());
  const [mealBusy, setMealBusy] = useState(false);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [mealPhoto, setMealPhoto] = useState<string | null>(null); // downscaled data URL, ready to send
  const [daysLogged, setDaysLogged] = useState(0); // distinct dates in the last 7d — the phase gate

  async function pickPhoto(file: File | null | undefined) {
    if (!file || mealBusy) return;
    setLogErr('');
    try {
      setMealPhoto(await downscalePhoto(file));
    } catch {
      setLogErr("Couldn't read that photo — try a different one.");
    }
  }
  const [baseline, setBaseline] = useState<BaselineRead | null>(null);
  const [baselineBusy, setBaselineBusy] = useState(false);

  async function fetchBaseline() {
    if (baselineBusy) return;
    setBaselineBusy(true);
    setLogErr('');
    try {
      setBaseline(await getBaselineRead());
    } catch {
      setLogErr("Couldn't put the read together just now — try again in a moment.");
    } finally {
      setBaselineBusy(false);
    }
  }

  async function submitMeal() {
    const text = mealText.trim();
    if ((!text && !mealPhoto) || mealBusy || !detail) return;
    setMealBusy(true);
    setLogErr('');
    try {
      const m = await logMeal(text, mealKind, mealPhoto ?? undefined);
      setMeals([m, ...meals]);
      setMealText('');
      setMealPhoto(null);
      if (detail.status === 'pending') setDetail({ ...detail, status: 'done' }); // server ticked the row
      onLogged?.();
    } catch {
      setLogErr("That didn't save — give it another try.");
    } finally {
      setMealBusy(false);
    }
  }

  async function submitWeighIn() {
    const w = parseFloat(weight);
    if (!Number.isFinite(w) || w <= 0 || logBusy || !detail) return;
    setLogBusy(true);
    setLogErr('');
    try {
      await recordWeighIn(detail.occurrence_id, w, weightUnit);
      const shown = `${w} ${weightUnit}`;
      setDetail({ ...detail, status: 'done', log: { items: [], summary: `Weighed in at ${shown}.`, raw_text: shown, logged_at: new Date().toISOString() } });
      onLogged?.();
    } catch {
      setLogErr("That didn't save — check the number and try again.");
    } finally {
      setLogBusy(false);
    }
  }

  async function submitLog() {
    const text = logText.trim();
    if (!text || logBusy || !detail) return;
    setLogBusy(true);
    setLogErr('');
    try {
      const r = await logOccurrence(detail.occurrence_id, text);
      setDetail({ ...detail, status: 'done', log: r.log });
      setLogText('');
      onLogged?.();
    } catch (e) {
      const status = (e as { status?: number }).status;
      setLogErr(
        status === 404
          ? 'This session moved with your new plan — close and take a fresh look.'
          : "That didn't save — give it another try.",
      );
    } finally {
      setLogBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    getOccurrenceDetail(occurrenceId)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setState('ready');
      })
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        setState(e.status === 404 ? 'gone' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [occurrenceId]);

  // Food rows: load the day's meals so the sheet shows what's already been logged.
  useEffect(() => {
    if (!isFoodRow(detail)) return;
    let alive = true;
    getRecentMeals(7)
      .then((ms) => {
        if (!alive) return;
        setMeals(ms.filter((m) => m.date === detail!.date));
        setDaysLogged(new Set(ms.map((m) => m.date)).size); // client-side gate check — no extra request
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.occurrence_id]);

  const session = detail?.session;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-label="Session detail">
        <div className="sheet-grab" aria-hidden />
        {state === 'loading' ? (
          <div className="sheet-loading">
            <span className="typing"><i /><i /><i /></span>
            <span className="sheet-loading-t">Putting your session together…</span>
          </div>
        ) : state === 'gone' ? (
          <div className="sheet-msg">This session moved with your new plan — close this and take a fresh look at your week.</div>
        ) : state === 'error' ? (
          <div className="sheet-msg">Something hiccuped loading this session — close and tap it again.</div>
        ) : detail ? (
          <>
            <div className="sheet-head">
              <div className="sheet-title">
                <b>{detail.title}</b>
                <span>
                  {[detail.date, detail.schedule?.time_of_day, detail.schedule?.duration_min ? `${detail.schedule.duration_min} min` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button className="sheet-x" onClick={onClose} aria-label="Close">×</button>
            </div>

            {/* Why this session exists — the commitment's stored rationale (persisted at commit). */}
            {detail.why && <div className="sheet-why">{detail.why}</div>}

            {detail.log && (
              <div className="log-chip">
                <b>Logged:</b> {detail.log.summary}
              </div>
            )}

            {session ? (
              <div className="sheet-body">
                {session.blocks.map((b, bi) => (
                  <div className="sess-block" key={bi}>
                    <div className="sess-label">{b.label}</div>
                    {b.items.map((it, ii) => (
                      <div className="sess-item" key={ii}>
                        <div className="sess-item-t">
                          <span className="sess-name">{it.name}</span>
                          {qty(it) && <span className="sess-qty">{qty(it)}</span>}
                        </div>
                        {it.detail && <div className="sess-detail">{it.detail}</div>}
                        {it.video_query && (
                          <a className="vid-link" href={ytSearch(it.video_query)} target="_blank" rel="noopener noreferrer">
                            ▶ how-to: {it.video_query}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {session.note && (
                  <div className="sess-note">
                    <Orb />
                    <span>{session.note}</span>
                  </div>
                )}

                {detail.status === 'pending' && (
                  <div className="logbox">
                    <div className="logbox-label">How did it go? Tell me in your own words.</div>
                    <div className="steer-row">
                      <textarea
                        className="logbox-in"
                        value={logText}
                        onChange={(e) => setLogText(e.target.value)}
                        placeholder="e.g. did the presses — 15 reps at 50 lb, felt easy; skipped the rows"
                        rows={2}
                        disabled={logBusy}
                      />
                      <MicButton value={logText} onChange={setLogText} disabled={logBusy} />
                    </div>
                    {logErr && <div className="auth-error">{logErr}</div>}
                    <button className="logbox-btn" onClick={submitLog} disabled={logBusy || !logText.trim()}>
                      {logBusy ? 'Noting it down…' : 'Log it — done ✓'}
                    </button>
                  </div>
                )}
              </div>
            ) : isFoodRow(detail) ? (
              /* Observe phase: meals accumulate all day (open even when already ticked done). */
              <div className="logbox" style={{ borderTop: 'none', paddingTop: 0 }}>
                <div className="logbox-label">What did you eat? Your words are enough.</div>
                {meals.length > 0 && (
                  <div className="meal-list">
                    {meals.map((m) => (
                      <div className="meal-item" key={m.log_id}>
                        <span className="meal-kind">{m.meal}</span>
                        {m.photo_url && <img className="meal-thumb" src={m.photo_url} alt="" loading="lazy" />}
                        <span className="meal-what">{m.items.map((i) => i.name).join(', ') || m.raw_text || (m.photo_url ? '📷 photo' : '')}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="steer-row">
                  <textarea
                    className="logbox-in"
                    value={mealText}
                    onChange={(e) => setMealText(e.target.value)}
                    placeholder={'e.g. "two eggs, sourdough toast and a coffee" — or just snap it'}
                    rows={2}
                    disabled={mealBusy}
                  />
                  <MicButton value={mealText} onChange={setMealText} disabled={mealBusy} />
                  {/* capture="environment" opens the rear camera on phones; a file picker on desktop. */}
                  <label className={`photo-btn${mealPhoto ? ' photo-on' : ''}`} title="Snap your plate" aria-label="Add a photo">
                    📷
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      disabled={mealBusy}
                      onChange={(e) => {
                        void pickPhoto(e.target.files?.[0]);
                        e.target.value = ''; // same photo re-pickable
                      }}
                    />
                  </label>
                </div>
                {mealPhoto && (
                  <div className="photo-preview">
                    <img src={mealPhoto} alt="your plate" />
                    <button className="photo-clear" onClick={() => setMealPhoto(null)} disabled={mealBusy} aria-label="Remove photo">×</button>
                    <span className="photo-hint">Add a few words if you like — I can't read plates yet, but the photo is kept.</span>
                  </div>
                )}
                <div className="weigh-row">
                  <select className="wiz-sel" value={mealKind} onChange={(e) => setMealKind(e.target.value as MealKind)} disabled={mealBusy}>
                    <option value="breakfast">breakfast</option>
                    <option value="lunch">lunch</option>
                    <option value="dinner">dinner</option>
                    <option value="snack">snack</option>
                    <option value="drink">drink</option>
                    <option value="other">other</option>
                  </select>
                  <button className="logbox-btn meal-btn" onClick={submitMeal} disabled={mealBusy || (!mealText.trim() && !mealPhoto)}>
                    {mealBusy ? 'Writing it down…' : 'Log this meal'}
                  </button>
                </div>
                {logErr && <div className="auth-error">{logErr}</div>}

                {/* The Baseline moment: 7+ observed days → the coach's read + ONE gradual change,
                    which feeds the existing Adjust (steer → preview → confirm) flow. */}
                {daysLogged >= 7 && !baseline && (
                  <button className="baseline-cta" onClick={fetchBaseline} disabled={baselineBusy}>
                    {baselineBusy ? 'Reading your week…' : 'A week of watching is done — want my read?'}
                  </button>
                )}
                {baseline?.ready === true && (
                  <div className="baseline-box">
                    <div className="sess-note">
                      <Orb />
                      <span>{baseline.read}</span>
                    </div>
                    <div className="baseline-sug">
                      <b>One small change:</b> {baseline.suggestion}
                      {baseline.rationale ? <span className="baseline-why"> — {baseline.rationale}</span> : null}
                    </div>
                    {onProposeChange && (
                      <button className="lockbtn" onClick={() => onProposeChange(baseline.suggestion)}>
                        Weave it into my plan →
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : detail.kind === 'system' && /weigh/i.test(detail.title) && detail.status === 'pending' ? (
              <div className="logbox" style={{ borderTop: 'none', paddingTop: 0 }}>
                <div className="logbox-label">What's the scale saying today?</div>
                <div className="weigh-row">
                  <input
                    className="wiz-in"
                    type="number"
                    inputMode="decimal"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder={weightUnit === 'lb' ? 'e.g. 195' : 'e.g. 88.5'}
                    disabled={logBusy}
                  />
                  <button className="wiz-sel" onClick={() => setWeightUnit(weightUnit === 'lb' ? 'kg' : 'lb')} disabled={logBusy}>
                    {weightUnit} ⇄
                  </button>
                </div>
                {logErr && <div className="auth-error">{logErr}</div>}
                <button className="logbox-btn" onClick={submitWeighIn} disabled={logBusy || !weight.trim()}>
                  {logBusy ? 'Noting it down…' : 'Log it — done ✓'}
                </button>
              </div>
            ) : detail.kind === 'system' ? (
              <div className="sheet-msg">A quick built-in check-in — just tap it done when it happens.</div>
            ) : detail.status !== 'pending' ? (
              <div className="sheet-msg">This one's already {detail.status === 'done' ? 'done — nice.' : `marked ${detail.status}.`}</div>
            ) : (
              <div className="sheet-msg">I couldn't put this session together just now — close and tap it again in a moment.</div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
