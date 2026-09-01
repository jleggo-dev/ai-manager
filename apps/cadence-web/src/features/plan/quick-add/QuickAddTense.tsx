import { useEffect, useState } from 'react';
import { deriveWalkthrough, nowMenuMeta, type NowMenuItem } from '@cadence/shared';
import { getNowMenu, logAdhoc } from '../../../lib/api.ts';
import { Walkthrough } from '../../walkthrough/Walkthrough.tsx';
import { sessionFor } from '../nowMenuSession.ts';
import { categoryOfArea } from '../../today/category.ts';
import { glyphOf, GLYPH } from '../../today/glyphs.ts';
import type { QuickAddArea } from './quickAddRows.ts';

const DURATION_CHIPS = [15, 30, 45] as const;

/** "A workout" → "Workout"; "Piano" → "Piano" — the article a fallback noun wears reads fine as a
 *  row label but not as the subject of a logged sentence. */
function bareNoun(noun: string): string {
  const stripped = noun.replace(/^(a|an)\s+/i, '').trim();
  return stripped ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : noun;
}

/** "Piano — 30 min", "Workout — 45 min" — deterministic, so the same noun always reads the same
 *  way in the log regardless of which chip (or the custom field) produced it. */
function composeLogText(noun: string, minutes: number): string {
  return `${bareNoun(noun)} — ${minutes} min`;
}

/** The seed sentence "Tell me instead" hands the coach — a plain opener, never a finished claim;
 *  the person finishes it in chat. Movement reads as a verb ("log a run"), practice as time spent
 *  ("log some piano time") — the same split the noun's own copy already makes everywhere else. */
function steerSeed(area: QuickAddArea, noun: string): string {
  const bare = bareNoun(noun);
  const lower = bare.charAt(0).toLowerCase() + bare.slice(1);
  return area === 'movement' ? `I want to log a ${lower}` : `I want to log some ${lower} time`;
}

/**
 * Screen 2 — "the tense" (Activity Builder 2A). Reached by tapping a screen-1 noun row: past
 * ("I went for one") above present ("Take me on one"), because logging is the fastest path and
 * the coach's own present-tense menu is the honest second choice, not the first.
 *
 * No "Build my own" here — the builder doesn't exist yet (TURN 1 of the design), and a dead row
 * beats no row not at all. No Apple Health pull — that's device-gated, a later parcel.
 */
export function QuickAddTense({
  area,
  noun,
  toward,
  onBack,
  onLogged,
  onSteer,
}: {
  area: QuickAddArea;
  noun: string;
  toward?: string;
  onBack: () => void;
  /** Already the sheet's "log it, then close" wrapper (QuickAddSheet.tsx) — every path here
   *  (a chip, the custom minutes field, the free-text line, a finished walkthrough) calls this
   *  ONE callback and nothing else; closing the sheet is not this component's job. */
  onLogged: () => void;
  /** Hands a seed sentence to the coach and switches to her tab — wired at the shell (MainTabs)
   *  the same way PlanView's `onSteerCoach` is. Row hidden without it, same pattern `onOpenFood`
   *  uses on screen 1: a door with nowhere to open is not drawn. */
  onSteer?: (text: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const [freeText, setFreeText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [items, setItems] = useState<NowMenuItem[] | null>(null);
  const [playing, setPlaying] = useState<NowMenuItem | null>(null);

  useEffect(() => {
    let alive = true;
    getNowMenu()
      .then((rows) => {
        if (!alive) return;
        setItems(rows.filter((r) => r.action.kind === 'tool' && r.area === area));
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [area]);

  async function logMinutes(minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0 || busy) return;
    setBusy(true);
    setNote('');
    const { ok } = await logAdhoc(composeLogText(noun, Math.round(minutes)), undefined, area);
    setBusy(false);
    if (ok) onLogged();
    else setNote("That didn't save — try again in a moment.");
  }

  async function logFree() {
    const t = freeText.trim();
    if (!t || busy) return;
    setBusy(true);
    setNote('');
    const { ok } = await logAdhoc(t, undefined, area);
    setBusy(false);
    if (ok) onLogged();
    else setNote("That didn't save — try again in a moment.");
  }

  // A now-menu row plays through the exact walkthrough a scheduled task uses (DoNowSection's
  // machinery, shared via nowMenuSession.ts) — it overlays the whole screen on its own, so this
  // return replaces everything else here just as it does there.
  if (playing) {
    return (
      <Walkthrough
        walkthrough={deriveWalkthrough(sessionFor(playing))}
        title={playing.label}
        onClose={() => setPlaying(null)}
        onComplete={() => {
          setPlaying(null);
          // `onLogged` is already the sheet's "log it, then close" wrapper (QuickAddSheet.tsx) —
          // the same single call the chip/free-text paths below make.
          onLogged();
        }}
      />
    );
  }

  return (
    <>
      <div className="ld2-back">
        <button onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div>
          <b>{noun}</b>
          {toward && <span>toward {toward}</span>}
        </div>
      </div>

      <div className="ld2-sec">
        <b>I went for one</b> <span>log it — fastest path</span>
        <div className="ld2-chips">
          {DURATION_CHIPS.map((m) => (
            <button key={m} className="ld2-chip" disabled={busy} onClick={() => void logMinutes(m)}>
              {m} min
            </button>
          ))}
        </div>
        <div className="ld-free" style={{ marginTop: 0 }}>
          <input
            className="ld-input"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="__ min"
            value={custom}
            disabled={busy}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void logMinutes(parseFloat(custom));
            }}
          />
          <button
            className="ld-log"
            disabled={busy || !custom.trim()}
            onClick={() => void logMinutes(parseFloat(custom))}
          >
            Log it
          </button>
        </div>
        <div className="ld2-or">or say what happened</div>
        <div className="ld-free" style={{ marginTop: 0 }}>
          <input
            className="ld-input"
            placeholder={area === 'movement' ? 'e.g. "ran 5k, felt easy"' : 'What did you do?'}
            value={freeText}
            disabled={busy}
            onChange={(e) => setFreeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void logFree();
            }}
          />
          <button className="ld-log" disabled={busy || !freeText.trim()} onClick={() => void logFree()}>
            Log
          </button>
        </div>
        {note && <div className="ld-empty">{note}</div>}
        {onSteer && (
          <button className="ld-row" onClick={() => onSteer(steerSeed(area, noun))} aria-label="Tell me instead">
            <span className="ld-ic ld-ic-mindset" aria-hidden>
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d={GLYPH.bubble} fill="#fff" />
              </svg>
            </span>
            <span className="ld-row-t">
              <b>Tell me instead</b>
              <span>tell the coach what happened</span>
            </span>
            <span className="ld-plus" aria-hidden>
              ›
            </span>
          </button>
        )}
      </div>

      {/* Zero matching items is a real state (DoNowSection's own rule) — no heading, no dead
          row, the section simply isn't here. */}
      {items && items.length > 0 && (
        <div className="ld2-sec">
          <b>Take me on one</b> <span>the coach&rsquo;s present-tense menu, scoped to {noun.toLowerCase()}</span>
          <div className="ld-list">
            {items.map((item) => {
              const glyph = glyphOf(item.label, item.area);
              const meta = nowMenuMeta(item.action);
              return (
                <button key={item.id} className="ld-row" onClick={() => setPlaying(item)} aria-label={item.label}>
                  <span className={`ld-ic ld-ic-${categoryOfArea(item.area)}`} aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path d={glyph.d} fill="#fff" />
                    </svg>
                  </span>
                  <span className="ld-row-t">
                    <b>{item.label}</b>
                    {meta && <span>{meta}</span>}
                  </span>
                  <span className="ld-plus" aria-hidden>
                    ›
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
