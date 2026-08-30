import { describe, it, expect } from 'vitest';
import type { GoalEvent } from '@cadence/shared';
import { resolveShelf } from './progress-nontemporal-shelf.ts';

function event(at: string, label: string): GoalEvent {
  return { event_id: `zzq-${at}-${label}`, user_id: 'zzq-user', goal_id: null, kind: 'completion', label, at };
}

describe('resolveShelf', () => {
  it('omits with evidence when there are no events in the window', () => {
    expect(resolveShelf([])).toEqual({ id: 'shelf', kind: 'shelf', reason: 'no goal events in this window' });
  });

  it('orders most-recent-first', () => {
    const events = [event('2026-08-01', 'finished Dune'), event('2026-08-15', 'first 5k')];
    expect(resolveShelf(events)).toEqual({
      events: [
        { label: 'first 5k', at: '2026-08-15' },
        { label: 'finished Dune', at: '2026-08-01' },
      ],
    });
  });

  it('caps at 8, keeping the most recent', () => {
    const events = Array.from({ length: 12 }, (_, i) => event(`2026-08-${String(i + 1).padStart(2, '0')}`, `event ${i}`));
    const result = resolveShelf(events);
    expect('events' in result && result.events).toHaveLength(8);
    expect('events' in result && result.events[0]).toEqual({ label: 'event 11', at: '2026-08-12' });
  });
});
