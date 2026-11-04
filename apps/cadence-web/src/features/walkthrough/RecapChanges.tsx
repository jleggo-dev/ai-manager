import { useState, type CSSProperties } from 'react';
import type { StructureChange } from '@cadence/shared';
import { keepHowTo } from '../../lib/api.ts';
import { Pill } from './tools/rearrange-parts.tsx';

/**
 * "You changed 3 things" at the Recap (walkthrough v3 Phase 6c, design board "Recap"; R5). Each
 * change the person made — alternating, one set at a time, a swap — is one fact with its own
 * Every time / Just today pair. The copy is fixed (played-diff.ts); no model writes it.
 *
 * Every time keeps one plain sentence on the commitment, through the one route that writes it,
 * and then shows the sentence as a fact. Just today leaves the change in the log only. Nothing is
 * learned without a tap: Finish never writes anything here.
 */
type Row =
  | { status: 'idle' }
  | { status: 'keeping' }
  | { status: 'kept'; sentence: string }
  | { status: 'today' }
  | { status: 'failed' };

export function RecapChanges({ changes, occurrenceId }: { changes: StructureChange[]; occurrenceId?: string | null }) {
  const [rows, setRows] = useState<Record<string, Row>>({});
  if (changes.length === 0) return null;
  const row = (key: string): Row => rows[key] ?? { status: 'idle' };
  const set = (key: string, r: Row) => setRows((all) => ({ ...all, [key]: r }));

  async function keep(c: StructureChange) {
    if (!occurrenceId) return;
    set(c.key, { status: 'keeping' });
    const r = await keepHowTo(occurrenceId, c.sentence);
    set(c.key, r.ok ? { status: 'kept', sentence: c.sentence } : { status: 'failed' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: '#2c2f33' }}>
        You changed {changes.length} {changes.length === 1 ? 'thing' : 'things'}
      </div>
      {changes.map((c) => {
        const r = row(c.key);
        return (
          <div key={c.key} style={card}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#2c2f33' }}>{c.words}</div>
            {c.pills && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {c.pills.map((p, i) => (
                  <Pill key={i} label={p} alt={i % 2 === 1} style={{ height: 26, padding: '0 9px', fontSize: 11.5 }} />
                ))}
                {c.rounds != null && (
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: '#5c5f63' }}>· {c.rounds} rounds</span>
                )}
              </div>
            )}
            {r.status === 'kept' ? (
              <div style={fact}>Every time · {r.sentence}</div>
            ) : r.status === 'today' ? (
              <div style={fact}>Just today</div>
            ) : (
              <>
                {r.status === 'failed' && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'oklch(52% 0.12 40)' }}>
                    Didn&apos;t take — try again
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  {occurrenceId && (
                    <button type="button" style={choice} disabled={r.status === 'keeping'} onClick={() => void keep(c)}>
                      Every time
                    </button>
                  )}
                  <button type="button" style={choice} onClick={() => set(c.key, { status: 'today' })}>
                    Just today
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const card: CSSProperties = {
  background: 'white',
  border: '1px solid #eae2d0',
  borderRadius: 14,
  padding: '10px 10px 10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const choice: CSSProperties = {
  flex: 1,
  height: 44,
  borderRadius: 12,
  border: '1px solid #dcd2bc',
  background: 'white',
  fontSize: 13,
  fontWeight: 800,
  color: '#2c2f33',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const fact: CSSProperties = { fontSize: 12.5, fontWeight: 800, color: '#2c5545' };
