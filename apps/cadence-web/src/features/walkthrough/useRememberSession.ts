import { useEffect, useRef } from 'react';
import { writeSessionInProgress, type SessionSnapshot } from './sessionInProgress.ts';

/**
 * Write the walkthrough's state to disk whenever it changes, so a reload can put the person back
 * where they were (sessionInProgress.ts). Null means "not a session worth remembering" (an ad-hoc
 * run with no plan task behind it) and writes nothing.
 *
 * Compared by content, not identity: the shell rebuilds the snapshot object on every render, and a
 * render that changed nothing must not touch storage. A running timer re-renders its own card four
 * times a second, never this shell, so in practice this writes on a step, a log, a tempo, or a
 * clock starting or stopping — a handful of times a session.
 */
export function useRememberSession(snapshot: SessionSnapshot | null): void {
  const json = snapshot ? JSON.stringify(snapshot) : null;
  const latest = useRef(snapshot);
  latest.current = snapshot;
  useEffect(() => {
    if (json && latest.current) writeSessionInProgress(latest.current);
  }, [json]);
}
