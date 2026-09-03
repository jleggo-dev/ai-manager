/**
 * `?preview=repertoire` — the list screen against the current dev account's real repertoire.
 *
 * Not fixture data: `ItemScreenPreview` can use fixtures because `ItemScreen` is fully props-driven,
 * but this screen fetches for itself (the items+collisions read, the card's counts), the same
 * reason `SeedReviewPreview` exercises the real network rather than fixtures. Unscoped by default
 * ("everything they keep"); the field lets a goal id be tried without hunting one down in dev tools.
 */
import { useState } from 'react';
import { ListScreen } from './ListScreen.tsx';

export function ListScreenPreview() {
  const [goalId, setGoalId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const trimmed = goalId.trim();

  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', alignItems: 'center' }}>
        <input
          className="wiz-in"
          placeholder="goal_id (blank = everything they keep)"
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
        />
        <button type="button" className="detour-chip" onClick={() => setAttempt((a) => a + 1)}>
          Reload
        </button>
      </div>
      <ListScreen
        key={`${trimmed}-${attempt}`}
        goalId={trimmed || null}
        goalName={trimmed || null}
        onBack={() => {}}
        onOpenChat={(note) => window.alert(`onOpenChat:\n${note}`)}
      />
    </div>
  );
}
