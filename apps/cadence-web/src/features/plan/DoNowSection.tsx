import { useState } from 'react';
import { deriveWalkthrough, journalBank, journalOpener, nowMenuMeta, type NowMenuItem } from '@cadence/shared';
import { Walkthrough } from '../walkthrough/Walkthrough.tsx';
import { JournalWrite } from '../journal/JournalWrite.tsx';
import { categoryOfArea, type Category } from '../today/category.ts';
import { glyphOf } from '../today/glyphs.ts';
import { sessionFor } from './nowMenuSession.ts';

/**
 * "Do something now" — the CONTENT of the ＋ sheet's "Calming techniques" sub-screen (device-test
 * ruling, 2026-09-01), not a section of the sheet's first screen. A top-level menu of mind tools
 * the coach hadn't actually prescribed FOR THIS USER broke the sheet's law, so it demoted to one
 * ordinary row like everything else — tapping it opens these items here.
 *
 * Purely presentational now: `items` is fetched once by the ＋ sheet itself (QuickAddSheet.tsx,
 * lifted there the same day) and handed down as a prop, so this component owns none of the
 * loading state that used to pop the sheet's own layout around underneath a person's thumb while
 * the fetch was in flight (the squish bug the same device test caught). The playing/walkthrough/
 * journal machinery and the pinned-item treatment are otherwise unchanged — the pillar colour
 * still appears only here, on rows that genuinely are mind items.
 *
 * Still **renders nothing at all on an empty list** — a real state, not a failure: nothing the
 * coach has composed should read as an apology rather than simply not being there.
 */
export function DoNowSection({
  items,
  onClose,
  onLogged,
}: {
  /** The now-menu's tool items, already filtered by the ＋ sheet the same way this component used
   *  to filter them itself. Empty renders nothing (below) — the same "no claim" reading a failed
   *  or not-yet-resolved fetch gets upstream. */
  items: NowMenuItem[];
  onClose: () => void;
  onLogged: () => void;
}) {
  const [playing, setPlaying] = useState<NowMenuItem | null>(null);

  // Journal rows open the real writing page (full-screen, the store behind it) — the walkthrough's
  // journal step is for sessions; a menu-launched entry belongs to the module.
  if (playing?.action.kind === 'tool' && playing.action.tool === 'journal') {
    // The coach picked a bank or wrote a question for this row; before this it chose one and the
    // page opened blank anyway. `journalOpener` holds the "your sentence always wins" rule.
    const opener = journalOpener(playing.action.params);
    const mins = playing.action.params.duration_min;
    return (
      <JournalWrite
        openWith={{
          bank: journalBank(opener.bank) ?? null,
          prompt: opener.prompt,
          // A duration turns this into a timed free-write: the page opens on the start sheet, so
          // the clock still begins on a deliberate press rather than the moment the row is tapped.
          minutes: typeof mins === 'number' ? mins : undefined,
        }}
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

  // Nothing to offer: render no heading at all rather than an empty shell.
  if (items.length === 0) return null;

  const pinned = items.find((i) => i.pinned);
  const rest = items.filter((i) => !i.pinned);

  return (
    <div className="dn">
      <div className="dn-head">Do something now</div>

      {pinned && (
        <button className={`dn-pin ld-ic-${areaIcon(pinned.area)}`} onClick={() => setPlaying(pinned)}>
          <span className="dn-pin-ic" aria-hidden>
            <svg viewBox="0 0 24 24" width="23" height="23">
              <path d={glyphOf(pinned.label, pinned.area).d} fill="#fff" />
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
                  <path d={glyphOf(item.label, item.area).d} fill="#fff" />
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

/** One mapping for every surface — categoryOfArea (category.ts). Practice stopped borrowing the
 *  reflection moon when it got its own family and glyph (2026-08-31). */
const areaIcon = (area: NowMenuItem['area']): Category => categoryOfArea(area);
