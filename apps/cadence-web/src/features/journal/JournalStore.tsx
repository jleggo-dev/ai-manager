import { useCallback, useEffect, useState } from 'react';
import { journalBank, journalPreview, type JournalEntry } from '@cadence/shared';
import { listJournal, setJournalSecret } from '../../lib/api.ts';
import { JournalWrite } from './JournalWrite.tsx';

/**
 * The store — the bookshelf (Journal v2 §3). Reverse-chron, date labels and words only: no
 * counts, no streaks, no search-by-anything. A secret entry is fully readable to its owner (key
 * + SECRET tag, no dimming, no redaction — the key locks against the coach, not you); a paper
 * entry is one quiet shelf row with nothing to open.
 */
export function JournalStore({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<JournalEntry[] | null>(null);
  const [writing, setWriting] = useState(false);
  const [open, setOpen] = useState<JournalEntry | null>(null);

  const load = useCallback(() => {
    listJournal()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);
  useEffect(load, [load]);

  if (writing) {
    return (
      <JournalWrite
        onClose={() => setWriting(false)}
        onKept={() => {
          setWriting(false);
          load();
        }}
      />
    );
  }

  if (open) {
    return (
      <JournalRead
        entry={open}
        onClose={() => setOpen(null)}
        onSecretChange={(secret) => {
          setOpen({ ...open, secret });
          void setJournalSecret(open.entry_id, secret).then(load);
        }}
      />
    );
  }

  return (
    <div className="js" role="dialog" aria-label="Your journal">
      <div className="js-bar">
        <button className="jw-back" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <div>
          <b>Your journal</b>
          <span className="js-sub">YOUR WORDS, AS YOU WROTE THEM</span>
        </div>
      </div>

      <div className="js-list">
        {entries === null ? null : entries.length === 0 ? (
          <div className="js-empty">Nothing here yet — the first line is the hardest one.</div>
        ) : (
          entries.map((e) => (
            <button
              key={e.entry_id}
              className={`js-row ${e.mode === 'paper' ? 'paper' : ''}`}
              onClick={() => e.mode !== 'paper' && setOpen(e)}
            >
              <span className="js-meta">
                <span className="js-date">{shelfDate(e.created_at)}</span>
                {e.bank && <span className="js-bank">{journalBank(e.bank)?.label.toUpperCase()}</span>}
                {e.secret && e.mode !== 'paper' && <span className="js-secret">⚿ SECRET</span>}
              </span>
              <span className="js-line">{journalPreview(e)}</span>
            </button>
          ))
        )}
      </div>

      <button className="js-write" onClick={() => setWriting(true)}>
        ＋ Write
      </button>
    </div>
  );
}

/** One entry, read view: the words, full-bleed, and the key. Nothing else. */
function JournalRead({
  entry,
  onClose,
  onSecretChange,
}: {
  entry: JournalEntry;
  onClose: () => void;
  onSecretChange: (secret: boolean) => void;
}) {
  const prompt = entry.prompt;
  return (
    <div className="jw" role="dialog" aria-label="Journal entry">
      <div className="jw-bar">
        <button className="jw-back" onClick={onClose} aria-label="Back">
          ‹
        </button>
        <span className="jw-date">{shelfDate(entry.created_at)}</span>
        <span className="jw-tools">
          <button
            className={`jw-key ${entry.secret ? 'on' : ''}`}
            onClick={() => onSecretChange(!entry.secret)}
            aria-pressed={entry.secret}
          >
            ⚿ {entry.secret ? 'secret' : ''}
          </button>
        </span>
      </div>
      {prompt && (
        <div className="jw-prompt read">
          <em>{prompt}</em>
        </div>
      )}
      <div className="jw-read">{entry.body}</div>
    </div>
  );
}

function shelfDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
}
