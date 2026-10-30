/**
 * The filter bar on the shelves (canvas "Cadence Quick Log", 2026-10-29). Find left the row of
 * doors: it only ever searched your saved foods, so it sits where those foods are. While it holds
 * words the grid shows matches from every shelf; when nothing of yours matches, the words go to
 * the coach in one tap — Tell the coach "starbucks latte" — instead of a dead end. The canvas says
 * "Tell Cadence"; UI copy names the role, never the product (owner, 2026-09-06).
 */
import { ChatIcon, SearchIcon } from '../captureIcons.tsx';

export function FindBar({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <div className="ms-find">
      <span className="ms-find-i" aria-hidden>
        <SearchIcon />
      </span>
      <input
        className="ms-find-in"
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search my foods"
        aria-label="Search my foods"
        autoComplete="off"
        enterKeyHint="search"
      />
      {query && (
        <button type="button" className="ms-find-x" aria-label="Clear search" onClick={() => onQuery('')}>
          ×
        </button>
      )}
    </div>
  );
}

/** Nothing of yours matched: hand the phrase on rather than end the search here. */
export function FindEmpty({ query, onTell }: { query: string; onTell: (words: string) => void }) {
  const words = query.trim();
  return (
    <div className="ms-find-empty">
      <div className="ms-find-empty-t">Not in your foods yet</div>
      <button type="button" className="ms-find-tell" onClick={() => onTell(words)}>
        <ChatIcon />
        <span>Tell the coach “{words}”</span>
      </button>
    </div>
  );
}
