import { useState } from 'react';
import { BREATH_PATTERNS, type WalkthroughStep } from '@cadence/shared';
import { CoachFaceProvider } from '../coach/CoachFaceProvider.tsx';
import { CoachFaceGrid } from '../coach/CoachFaceGrid.tsx';
import { useCoachFace } from '../coach/coachFaceContext.ts';
import { WalkthroughDone } from '../walkthrough/WalkthroughDone.tsx';
import { StartCoachAsk } from '../plan/start/StartCoachAsk.tsx';
import { StartTrim } from '../plan/start/StartTrim.tsx';
import { proposeTrim } from '../plan/start/trim.ts';
import type { StepLogs } from '../walkthrough/state.ts';

/**
 * A dev harness for Cadence's moments, at `?preview=coach` — no auth, no plan, no coach session.
 *
 * It exists because five of these six surfaces only appear at a moment you cannot conjure on
 * demand: the start sheet needs a generated session, the feedback card needs a *finished* one,
 * and the daily check-in fires at most once per local day and then refuses for the rest of it.
 * Reviewing a copy change to the mind variant shouldn't cost a real breath session and a wait
 * until tomorrow.
 *
 * The picker at the top is live and writes through to the API when one is running, so switching
 * the face re-renders every surface below it — which is the property most worth eyeballing, since
 * the face is meant to be the same everywhere at once.
 */

const step = (id: string, minutes: number, core: boolean, skippable: boolean): WalkthroughStep => ({
  id,
  title: id,
  minutes,
  tool: { kind: 'checkoff', label: 'Done' },
  core,
  skippable,
});

const RUN: WalkthroughStep[] = [
  step('Warm up walk', 3, false, true),
  step('Run — conversational pace', 22, true, false),
  step('Cool down + stretch', 5, false, false),
];

/** A REAL breathing tool, not a checkoff — `sessionOutcome` picks the mind question off the tool
 *  kind, so a stand-in step would exercise the movement path and quietly prove nothing. */
const BREATH: WalkthroughStep[] = [
  {
    id: 'Six slow breaths',
    title: 'Six slow breaths',
    minutes: 4,
    tool: { kind: 'breathing', pattern: BREATH_PATTERNS[0]!, cycles: 6 },
    core: true,
    skippable: false,
  },
];

const CLEAN: StepLogs = {
  'Warm up walk': { kind: 'done' },
  'Run — conversational pace': { kind: 'done' },
  'Cool down + stretch': { kind: 'done' },
};
const SKIPPED: StepLogs = { 'Warm up walk': { kind: 'done' }, 'Run — conversational pace': { kind: 'done' } };

type View = 'ask' | 'trim' | 'clean' | 'skipped' | 'mind';

const VIEWS: { key: View; label: string }[] = [
  { key: 'ask', label: '03 · Ask' },
  { key: 'trim', label: '03 · Trim' },
  { key: 'clean', label: '04 · Clean' },
  { key: 'skipped', label: '04 · Skipped' },
  { key: 'mind', label: '06 · Mind' },
];

function Inner() {
  const { faceId, setFaceId } = useCoachFace();
  const [view, setView] = useState<View>('ask');
  const trim = proposeTrim({ total_min: 30, steps: RUN }, 0);

  return (
    <div className="app">
      <div className="scrollbody" style={{ padding: '16px 18px 24px' }}>
        <div className="screen-h">Cadence&apos;s moments</div>
        <div className="screen-sub">
          Dev harness. Pick a face — every surface below should change in the same frame.
        </div>

        <CoachFaceGrid selected={faceId} onPick={(id) => void setFaceId(id === faceId ? null : id)} />

        <div className="sfb-chips" style={{ marginTop: 18 }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className="sfb-chip"
              style={view === v.key ? { borderColor: 'var(--forest)', background: 'oklch(94% 0.04 152)' } : undefined}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div style={{ position: 'relative', marginTop: 16, minHeight: 460 }}>
          {view === 'ask' && (
            <StartCoachAsk
              title="Easy run"
              timeOfDay="12:30"
              minutes={30}
              insight={{
                source: 'last_feedback',
                text: 'Last time you marked this one too hard.',
              }}
            />
          )}
          {view === 'trim' && trim && (
            <StartTrim proposal={trim} onConfirm={() => {}} onTrimMore={() => {}} onBack={() => setView('ask')} />
          )}
          {view === 'clean' && (
            <WalkthroughDone steps={RUN} logs={CLEAN} title="Easy run" onFinish={() => {}} onTalk={() => {}} />
          )}
          {view === 'skipped' && (
            <WalkthroughDone steps={RUN} logs={SKIPPED} title="Easy run" onFinish={() => {}} onTalk={() => {}} />
          )}
          {view === 'mind' && (
            <WalkthroughDone
              steps={BREATH}
              logs={{ 'Six slow breaths': { kind: 'breathing', roundsDone: 4, totalRounds: 6, pattern: 'box' } }}
              title="Wind-down"
              onFinish={() => {}}
              onTalk={() => {}}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function CoachMomentsPreview() {
  return (
    <CoachFaceProvider>
      <Inner />
    </CoachFaceProvider>
  );
}
