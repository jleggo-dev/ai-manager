import { useState } from 'react';
import { addGoalEvent } from '../../lib/api.ts';

/**
 * Shared "+ add one" state for count-goal cards on Today and Progress.
 * `onAdded` refreshes whichever progress surface owns the hook (getProgress / load).
 */
export function useGoalEventAdd(onAdded?: () => void | Promise<void>) {
  const [addFor, setAddFor] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitAdd(goalId: string) {
    const label = addLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      await addGoalEvent(goalId, label);
      setAddFor(null);
      setAddLabel('');
      await onAdded?.();
    } finally {
      setBusy(false);
    }
  }

  return { addFor, addLabel, busy, setAddFor, setAddLabel, submitAdd };
}

export type GoalEventAddState = ReturnType<typeof useGoalEventAdd>;
