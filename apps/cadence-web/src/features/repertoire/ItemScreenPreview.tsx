import { useState } from 'react';
import type { RepertoireItem } from '@cadence/shared';
import { ItemScreen } from './ItemScreen.tsx';

const BASE: RepertoireItem = {
  item_id: 'preview-item',
  user_id: 'preview-user',
  goal_id: 'preview-goal',
  label: 'Clair de lune',
  status: 'known',
  kind: 'piece',
  meta: { composer: 'Debussy', collection: 'Suite bergamasque', tempo_bpm: 60, tempo_meter: 4 },
  started_at: '2026-01-05T09:00:00Z',
  learned_at: '2026-03-14T09:00:00Z',
  last_practiced_at: '2026-08-29T18:00:00Z',
};

const FIXTURES: Record<string, { item: RepertoireItem; collidesWithLabel?: string | null; sessionCount?: number }> = {
  'plain (Keeping up, with tempo)': { item: BASE, sessionCount: 23 },
  'colliding title': {
    item: { ...BASE, label: 'Minuet in G Major', meta: { composer: 'Petzold' } },
    collidesWithLabel: 'Minuet in G Major (Anna Magdalena Notebook)',
  },
  'up next, backfilled, no tempo': {
    item: {
      ...BASE,
      status: 'queued',
      meta: null,
      learned_at: null,
      last_practiced_at: null,
    },
  },
  'learned, no month on file (backfilled)': {
    item: { ...BASE, status: 'retired', learned_at: null, meta: null },
  },
};

/**
 * `?preview=repertoireitem` — the item screen against fixture data (no network, no coach). Every
 * fixture is a state the real screen must render correctly: the plain case, a title collision,
 * an unstarted item with nothing settled yet, and a backfilled "learned" item with no date.
 * Registration into previewRoutes.tsx is the orchestrator's, not this parcel's.
 */
export function ItemScreenPreview() {
  const names = Object.keys(FIXTURES);
  const [name, setName] = useState(names[0] as string);
  const fixture = FIXTURES[name]!;

  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', flexWrap: 'wrap' }}>
        {names.map((n) => (
          <button
            key={n}
            className={`detour-chip ${n === name ? 'on' : ''}`}
            aria-pressed={n === name}
            onClick={() => setName(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <ItemScreen
        item={fixture.item}
        collidesWithLabel={fixture.collidesWithLabel}
        sessionCount={fixture.sessionCount}
        onBack={() => {}}
        onDeleted={() => {}}
      />
    </div>
  );
}
