/**
 * Food tab shell (Req 5 WS4) — MFP-fast logging surface in a coach's voice.
 *
 * Say / snap first; search is the fallback. Recents load when WS1 routes exist;
 * 404 → warm empty state (never a dead error). Confirm-first logging wires in
 * once the resolver lands — this shell only owns entry points + empty/recents.
 */
import { useEffect, useState } from 'react';
import { getFoodRecents, searchFoods, type FoodSummary } from '../../lib/api.ts';
import { FoodEntryActions } from './FoodEntryActions.tsx';
import { FoodRecentsList } from './FoodRecentsList.tsx';

type Mode = 'home' | 'say' | 'snap' | 'search';

export function FoodView() {
  const [mode, setMode] = useState<Mode>('home');
  const [recents, setRecents] = useState<FoodSummary[]>([]);
  const [recentsStatus, setRecentsStatus] = useState<'loading' | 'ok' | 'empty' | 'unavailable'>('loading');
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<FoodSummary[]>([]);
  const [searchNote, setSearchNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    getFoodRecents().then((r) => {
      if (cancelled) return;
      if (r.status === 'unavailable') {
        setRecents([]);
        setRecentsStatus('unavailable');
        return;
      }
      setRecents(r.foods);
      setRecentsStatus(r.foods.length ? 'ok' : 'empty');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSearch(q: string) {
    setSearchQ(q);
    if (!q.trim()) {
      setSearchHits([]);
      setSearchNote('');
      return;
    }
    const r = await searchFoods(q);
    if (r.status === 'unavailable') {
      setSearchHits([]);
      setSearchNote("Search isn't hooked up yet — try saying it to me in Coach, or snap a label soon.");
      return;
    }
    setSearchHits(r.foods);
    setSearchNote(r.foods.length ? '' : "Nothing matched yet — say it or snap it and we'll save it for next time.");
  }

  return (
    <div className="scrollbody food-tab">
      <div className="screen-title" style={{ marginTop: 10 }}>
        Food
      </div>
      <div className="screen-sub">
        Say it or snap it — I&apos;ll draft the log, you confirm. Search is here when you want it.
      </div>

      <FoodEntryActions mode={mode} onMode={setMode} />

      {mode === 'say' && (
        <div className="food-panel">
          <div className="food-panel-t">Say what you ate</div>
          <p className="food-panel-p">
            Tell me in Coach for now — &ldquo;I had my usual yogurt&rdquo; or describe something new. Fast
            say-to-confirm lands with the food resolver.
          </p>
          <button type="button" className="lockbtn ghost" onClick={() => setMode('home')}>
            Back
          </button>
        </div>
      )}

      {mode === 'snap' && (
        <div className="food-panel">
          <div className="food-panel-t">Snap a label or plate</div>
          <p className="food-panel-p">
            Nutrition-label snap and plate photo will land here. Until then, the meal photo path on Today still works —
            and I&apos;ll ask you to confirm before anything counts.
          </p>
          <button type="button" className="lockbtn ghost" onClick={() => setMode('home')}>
            Back
          </button>
        </div>
      )}

      {mode === 'search' && (
        <div className="food-panel">
          <div className="food-panel-t">Search your foods</div>
          <input
            className="wiz-in food-search-in"
            value={searchQ}
            placeholder="yogurt, chili, …"
            autoFocus
            onChange={(e) => runSearch(e.target.value)}
          />
          {searchNote && <div className="food-empty">{searchNote}</div>}
          {searchHits.length > 0 && (
            <FoodRecentsList
              foods={searchHits}
              onPick={() => setSearchNote("Got it — confirm-to-log wires in next. For now I've noted the pick.")}
            />
          )}
          <button type="button" className="lockbtn ghost" style={{ marginTop: 10 }} onClick={() => setMode('home')}>
            Back
          </button>
        </div>
      )}

      {mode === 'home' && (
        <section className="food-recents" aria-label="Recent foods">
          <div className="plan-week-label" style={{ marginTop: 8 }}>
            Recent
          </div>
          {recentsStatus === 'loading' && (
            <div className="chat-loading">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          {recentsStatus === 'unavailable' && (
            <div className="food-empty">
              Your food memory is still warming up. Say or snap a meal today — once it&apos;s saved, it&apos;ll show up
              here for two-tap logging.
            </div>
          )}
          {recentsStatus === 'empty' && (
            <div className="food-empty">
              Nothing saved yet — that&apos;s fine. Log something once (say it or snap it) and I&apos;ll keep it here so
              next time is one confirm.
            </div>
          )}
          {recentsStatus === 'ok' && (
            <FoodRecentsList
              foods={recents}
              onPick={() => {
                /* confirm-to-log: WS-R */
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}
