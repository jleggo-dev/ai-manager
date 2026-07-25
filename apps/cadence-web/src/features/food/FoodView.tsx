/**
 * Food tab (Req 5 WS4) — say / snap first, search as fallback.
 *
 * Say + search use POST /nutrition/foods/resolve (ranked + preselected serving/qty).
 * Snap stays on parse-label. Confirm-before-log always.
 */
import { useEffect, useState } from 'react';
import type { DietaryProfile } from '@cadence/shared';
import {
  getDietaryProfile,
  getFoodById,
  getFoodRecents,
  foodSummaryFromResolve,
  portionHintFromResolve,
  resolveFoods,
  type FoodSummary,
  type ResolvePortionHint,
} from '../../lib/api.ts';
import { FoodEntryActions } from './FoodEntryActions.tsx';
import { FoodPortionConfirm } from './FoodPortionConfirm.tsx';
import { FoodRecentsList } from './FoodRecentsList.tsx';
import { FoodSayPanel } from './FoodSayPanel.tsx';
import { FoodSnapPanel } from './FoodSnapPanel.tsx';
import type { FoodDraft, FoodDraftPortion } from './foodDraft.ts';

type Mode = 'home' | 'say' | 'snap' | 'search' | 'confirm';
type EntryMode = 'home' | 'say' | 'snap' | 'search';

export function FoodView() {
  const [mode, setMode] = useState<Mode>('home');
  const [draft, setDraft] = useState<FoodDraft | null>(null);
  const [returnMode, setReturnMode] = useState<EntryMode>('home');
  const [recents, setRecents] = useState<FoodSummary[]>([]);
  const [recentsStatus, setRecentsStatus] = useState<'loading' | 'ok' | 'empty' | 'unavailable'>('loading');
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<FoodSummary[]>([]);
  const [searchPortions, setSearchPortions] = useState<Record<string, ResolvePortionHint>>({});
  const [searchNote, setSearchNote] = useState('');
  const [pickNote, setPickNote] = useState('');
  const [dietary, setDietary] = useState<DietaryProfile | null>(null);
  const [banner, setBanner] = useState('');

  function reloadRecents() {
    getFoodRecents().then((r) => {
      if (r.status === 'unavailable') {
        setRecents([]);
        setRecentsStatus('unavailable');
        return;
      }
      setRecents(r.foods);
      setRecentsStatus(r.foods.length ? 'ok' : 'empty');
    });
  }

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
    getDietaryProfile().then((r) => {
      if (!cancelled && r.status === 'ok') setDietary(r.profile);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function openDraft(next: FoodDraft, from: EntryMode) {
    setDraft(next);
    setReturnMode(from);
    setMode('confirm');
    setPickNote('');
    setBanner('');
  }

  async function pickSaved(summary: FoodSummary, from: EntryMode, portion?: FoodDraftPortion) {
    setPickNote('');
    const detail = await getFoodById(summary.food_id);
    if (detail.status !== 'ok' || !detail.food) {
      setPickNote(
        detail.status === 'unavailable'
          ? "Couldn't load that food just now — try again in a moment."
          : "Couldn't open that food — try saying or snapping it fresh.",
      );
      return;
    }
    openDraft(
      {
        kind: 'saved',
        food: detail.food,
        ...(typeof portion?.servingIndex === 'number' ? { servingIndex: portion.servingIndex } : {}),
        ...(typeof portion?.quantity === 'number' ? { quantity: portion.quantity } : {}),
      },
      from,
    );
  }

  async function runSearch(q: string) {
    setSearchQ(q);
    setPickNote('');
    if (!q.trim()) {
      setSearchHits([]);
      setSearchPortions({});
      setSearchNote('');
      return;
    }
    const r = await resolveFoods({ text: q });
    if (r.status === 'unavailable' || r.status === 'error') {
      setSearchHits([]);
      setSearchPortions({});
      setSearchNote(
        r.status === 'unavailable'
          ? "Search isn't reachable just now — try saying it, or snap a label."
          : "Couldn't search just now — try again in a moment, or say it.",
      );
      return;
    }
    const summaries: FoodSummary[] = [];
    const portions: Record<string, ResolvePortionHint> = {};
    for (const c of r.candidates) {
      if (c.kind !== 'food') continue;
      const s = foodSummaryFromResolve(c);
      if (!s) continue;
      summaries.push(s);
      portions[s.food_id] = portionHintFromResolve(c);
    }
    setSearchHits(summaries);
    setSearchPortions(portions);
    setSearchNote(summaries.length ? '' : "Nothing matched yet — say it or snap it and we'll save it for next time.");
  }

  function onLogged() {
    setDraft(null);
    setMode('home');
    setBanner('Logged — nothing provisional here; that portion is on today.');
    reloadRecents();
  }

  if (mode === 'confirm' && draft) {
    return (
      <div className="scrollbody food-tab">
        <div className="screen-title" style={{ marginTop: 10 }}>
          Food
        </div>
        <FoodPortionConfirm
          draft={draft}
          dietary={dietary}
          onCancel={() => {
            setDraft(null);
            setMode(returnMode);
          }}
          onLogged={onLogged}
        />
      </div>
    );
  }

  const entryMode: EntryMode = mode === 'confirm' ? 'home' : mode;

  return (
    <div className="scrollbody food-tab">
      <div className="screen-title" style={{ marginTop: 10 }}>
        Food
      </div>
      <div className="screen-sub">
        Say it or snap it — I&apos;ll draft the log, you confirm. Search is here when you want it.
      </div>

      {banner && <div className="food-banner">{banner}</div>}

      <FoodEntryActions
        mode={entryMode}
        onMode={(m) => {
          setBanner('');
          setPickNote('');
          setMode(m);
        }}
      />

      {mode === 'say' && (
        <>
          {pickNote && <div className="food-empty">{pickNote}</div>}
          <FoodSayPanel
            onDraft={(d) => openDraft(d, 'say')}
            onCancel={() => setMode('home')}
            onPickSaved={(s, portion) => void pickSaved(s, 'say', portion)}
          />
        </>
      )}

      {mode === 'snap' && <FoodSnapPanel onDraft={(d) => openDraft(d, 'snap')} onCancel={() => setMode('home')} />}

      {mode === 'search' && (
        <div className="food-panel">
          <div className="food-panel-t">Search your foods</div>
          <input
            className="wiz-in food-search-in"
            value={searchQ}
            placeholder="yogurt, chili, …"
            autoFocus
            onChange={(e) => void runSearch(e.target.value)}
          />
          {searchNote && <div className="food-empty">{searchNote}</div>}
          {pickNote && <div className="food-empty">{pickNote}</div>}
          {searchHits.length > 0 && (
            <FoodRecentsList
              foods={searchHits}
              onPick={(s) => void pickSaved(s, 'search', searchPortions[s.food_id])}
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
          {pickNote && <div className="food-empty">{pickNote}</div>}
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
              Couldn&apos;t load your recent foods just now. Say or snap a meal today — once it&apos;s saved, it&apos;ll
              show up here for two-tap logging.
            </div>
          )}
          {recentsStatus === 'empty' && (
            <div className="food-empty">
              Nothing saved yet — that&apos;s fine. Log something once (say it or snap it) and I&apos;ll keep it here so
              next time is one confirm.
            </div>
          )}
          {recentsStatus === 'ok' && <FoodRecentsList foods={recents} onPick={(s) => void pickSaved(s, 'home')} />}
        </section>
      )}
    </div>
  );
}
