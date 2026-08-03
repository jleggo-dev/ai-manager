import { useEffect, useState } from 'react';
import { deriveWalkthrough, nowMenuMeta, type NowMenuItem, type OccurrenceSession } from '@cadence/shared';
import { getNowMenu } from '../../lib/api.ts';
import { Walkthrough } from '../walkthrough/Walkthrough.tsx';
import { JournalWrite } from '../journal/JournalWrite.tsx';
import { ICON, type Category } from '../today/category.ts';

/**
 * "Do something now" — the present-tense half of the ＋ sheet (REQ10 §6, REQ9 §3.1).
 *
 * Sits ABOVE "Log something you did" because the past is patient: a log can wait a tap, and
 * someone who needs three minutes cannot. The ＋ itself stays neutral and unchanged — the shell
 * law is that nothing pillar-flavoured ships in the frame, so the pillar colour appears only here,
 * inside the sheet, on rows that genuinely are mind items.
 *
 * The section **hides itself entirely when the menu is empty**, which is a real state rather than
 * a failure: a person the coach has nothing to offer right now should see the log section alone,
 * not an apology.
 */
export function DoNowSection({ onClose, onLogged }: { onClose: () => void; onLogged: () => void }) {
  const [items, setItems] = useState<NowMenuItem[] | null>(null);
  const [playing, setPlaying] = useState<NowMenuItem | null>(null);

  useEffect(() => {
    let alive = true;
    getNowMenu()
      .then((rows) => {
        // Activity rows need a deep-link into that task's own flow, which doesn't exist yet — they
        // are dropped rather than rendered as something that wouldn't work under a thumb.
        if (alive) setItems(rows.filter((r) => r.action.kind === 'tool'));
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Journal rows open the real writing page (full-screen, the store behind it) — the walkthrough's
  // journal step is for sessions; a menu-launched entry belongs to the module.
  if (playing?.action.kind === 'tool' && playing.action.tool === 'journal') {
    return (
      <JournalWrite
        onClose={() => setPlaying(null)}
        onKept={() => {
          setPlaying(null);
          onLogged();
          onClose();
        }}
      />
    );
  }

  if (playing) {
    return (
      <Walkthrough
        walkthrough={deriveWalkthrough(sessionFor(playing))}
        title={playing.label}
        onClose={() => setPlaying(null)}
        onComplete={() => {
          setPlaying(null);
          onLogged();
          onClose();
        }}
      />
    );
  }

  // Nothing yet, or nothing to offer: render no heading at all rather than an empty shell.
  if (items === null || items.length === 0) return null;

  const pinned = items.find((i) => i.pinned);
  const rest = items.filter((i) => !i.pinned);

  return (
    <div className="dn">
      <div className="dn-head">Do something now</div>

      {pinned && (
        <button className={`dn-pin ld-ic-${areaIcon(pinned.area)}`} onClick={() => setPlaying(pinned)}>
          <span className="dn-pin-ic" aria-hidden>
            <svg viewBox="0 0 24 24" width="23" height="23">
              <path d={ICON[areaIcon(pinned.area)]} fill="#fff" />
            </svg>
          </span>
          <span className="dn-pin-t">
            <b>{pinned.label}</b>
            {pinned.coachLine && <span>{pinned.coachLine}</span>}
          </span>
        </button>
      )}

      <div className="dn-list">
        {rest.map((item) => {
          const meta = nowMenuMeta(item.action);
          return (
            <button key={item.id} className="dn-row" onClick={() => setPlaying(item)} aria-label={item.label}>
              <span className={`dn-ic ld-ic-${areaIcon(item.area)}`} aria-hidden>
                <svg viewBox="0 0 24 24" width="15" height="15">
                  <path d={ICON[areaIcon(item.area)]} fill="#fff" />
                </svg>
              </span>
              <span className="dn-row-t">
                <b>{item.label}</b>
                {/* Derived from the parameters that will actually play — never coach copy, so the
                    row can't promise five minutes and deliver ten. */}
                {meta && <span>{meta}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A one-item session so a menu row plays through the same walkthrough a scheduled task uses —
 *  same renderers, same logging, same partial-credit rules. Nothing about the tool knows it was
 *  launched from a menu rather than the trail. */
function sessionFor(item: NowMenuItem): OccurrenceSession {
  const params = item.action.kind === 'tool' ? item.action.params : {};
  return {
    blocks: [
      {
        label: '',
        items: [
          {
            name: item.label,
            tool: item.action.kind === 'tool' ? item.action.tool : undefined,
            breath_pattern: str(params.breath_pattern),
            breath_cycles: num(params.breath_cycles),
            duration_min: num(params.duration_min),
            meditate_bells: str(params.meditate_bells),
            grounding_game: str(params.grounding_game),
          },
        ],
      },
    ],
    note: '',
    generated_at: new Date().toISOString(),
    version: 1,
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The pillar's two glyphs already ship: mind takes the mindset sun, practice the reflection moon
 *  (a 7am intention and a 10pm wind-down are different intentions, and the trail reads better for
 *  it). Body areas keep their own. */
function areaIcon(area: NowMenuItem['area']): Category {
  if (area === 'nourishment') return 'nutrition';
  if (area === 'mind') return 'mindset';
  if (area === 'practice') return 'reflection';
  return 'movement';
}
