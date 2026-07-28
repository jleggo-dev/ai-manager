import { useEffect, useReducer, useRef } from 'react';
import { createTimer, pause, reset, start, tick, type TimerState } from './timer.ts';

type Action =
  { type: 'start' } | { type: 'pause' } | { type: 'reset' } | { type: 'tick' } | { type: 'init'; seconds: number };

function reducer(state: TimerState, action: Action): TimerState {
  switch (action.type) {
    case 'start':
      return start(state);
    case 'pause':
      return pause(state);
    case 'reset':
      return reset(state);
    case 'tick':
      return tick(state);
    case 'init':
      return createTimer(action.seconds);
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Drive the pure timer with a real 1s interval and fire `onDone` exactly once when it completes.
 * The interval runs ONLY while `running`, so a paused/ready/done timer costs nothing. Re-inits when
 * `seconds` changes so the same mounted tool can serve a different step. `onDone` is held in a ref
 * so a fresh closure each render never re-fires it — only the transition into `done` does.
 */
export function useStepTimer(seconds: number, onDone?: () => void) {
  const [state, dispatch] = useReducer(reducer, seconds, createTimer);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    dispatch({ type: 'init', seconds });
  }, [seconds]);

  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if (state.status === 'done') onDoneRef.current?.();
  }, [state.status]);

  return {
    state,
    start: () => dispatch({ type: 'start' }),
    pause: () => dispatch({ type: 'pause' }),
    reset: () => dispatch({ type: 'reset' }),
  };
}
