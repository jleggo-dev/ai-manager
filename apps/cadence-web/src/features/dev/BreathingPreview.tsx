import { useEffect, useState } from 'react';
import {
  BREATH_PATTERNS,
  DEFAULT_CYCLES,
  clampCycles,
  patternCounts,
  type BreathPatternId,
  type MeditateBells,
  GROUNDING_GAMES,
  type GroundingGame,
  groundingSpec,
} from '@cadence/shared';
import { StepBreathing } from '../walkthrough/tools/StepBreathing.tsx';
import { StepMeditate } from '../walkthrough/tools/StepMeditate.tsx';
import { StepGrounding } from '../walkthrough/tools/StepGrounding.tsx';
import { DoNowSection } from '../plan/DoNowSection.tsx';
import { StepFeelingLog } from '../walkthrough/tools/StepFeelingLog.tsx';
import type { StepLog } from '../walkthrough/state.ts';

type BreathingLog = Extract<StepLog, { kind: 'breathing' }>;

/**
 * A dev-only harness for the breath pacer, reachable at `?preview=breathing` with no API, no auth
 * and no plan. It exists because the pacer is the one tool whose correctness is *temporal* — the
 * phase transitions, the pre-roll hand-off, the double inhale and the side-to-side cues can only
 * really be judged by watching them, and waiting on a coach-composed session to do that is a slow
 * loop. Every pattern in the bank is one tap away here.
 *
 * Not routed, not linked, and dev-only by URL — it renders the real component with real data, so
 * what you see here is what a prescribed step plays.
 */
export function BreathingPreview() {
  const [id, setId] = useState<BreathPatternId>('box');
  const [cycles, setCycles] = useState(DEFAULT_CYCLES);
  const [last, setLast] = useState<BreathingLog | null>(null);
  const [runKey, setRunKey] = useState(0);

  const pattern = BREATH_PATTERNS.find((p) => p.id === id) ?? BREATH_PATTERNS[0];
  if (!pattern) return null;
  const played = clampCycles(pattern, cycles);

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'oklch(96% 0.015 95)' }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55 }}>
        Breath pacer · dev preview
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {BREATH_PATTERNS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setId(p.id);
              setLast(null);
              setRunKey((k) => k + 1);
            }}
            style={{
              border: p.id === id ? '1.5px solid oklch(76% 0.15 55)' : '1.5px solid oklch(90% 0.015 95)',
              background: p.id === id ? 'oklch(95% 0.05 68)' : 'white',
              borderRadius: 999,
              padding: '7px 11px',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {p.name} <span style={{ opacity: 0.6 }}>{patternCounts(p)}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontWeight: 800 }}>
        <span>Rounds</span>
        <input
          type="range"
          min={1}
          max={20}
          value={cycles}
          onChange={(e) => {
            setCycles(Number(e.target.value));
            setRunKey((k) => k + 1);
          }}
          style={{ flex: 1 }}
        />
        <span style={{ minWidth: 78, textAlign: 'right', opacity: 0.7 }}>
          asked {cycles} · plays {played}
        </span>
      </div>

      <StepBreathing
        key={`${id}-${played}-${runKey}`}
        pattern={pattern}
        cycles={played}
        caution={pattern.caution}
        onLog={setLast}
        onDone={() => undefined}
      />

      <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.7 }}>
        {last ? `logged → ${last.roundsDone} of ${last.totalRounds} rounds (${last.pattern})` : 'no log yet'}
      </div>
    </div>
  );
}

/** The sit, with a short duration so the close (and the came-back sentence) is reachable in a dev
 *  loop rather than ten minutes away. */
export function MeditatePreview() {
  const [bells, setBells] = useState<MeditateBells>('start_end');
  const [last, setLast] = useState<Extract<StepLog, { kind: 'meditate' }> | null>(null);
  const [runKey, setRunKey] = useState(0);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'oklch(96% 0.015 95)' }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55 }}>
        Sit · dev preview
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['none', 'start_end', 'interval'] as MeditateBells[]).map((b) => (
          <button
            key={b}
            onClick={() => {
              setBells(b);
              setLast(null);
              setRunKey((k) => k + 1);
            }}
            style={{
              border: b === bells ? '1.5px solid oklch(76% 0.15 55)' : '1.5px solid oklch(90% 0.015 95)',
              background: b === bells ? 'oklch(95% 0.05 68)' : 'white',
              borderRadius: 999,
              padding: '7px 11px',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {b}
          </button>
        ))}
      </div>
      <StepMeditate
        key={`${bells}-${runKey}`}
        seconds={60}
        bells={bells}
        intervalMin={1}
        onLog={setLast}
        onDone={() => setRunKey((k) => k + 1)}
      />
      <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.7 }}>
        {last ? `logged → ${last.elapsedSec}/${last.targetSec}s · returns=${last.returns}` : 'no log yet'}
      </div>
    </div>
  );
}

/** Every grounding game one tap away — the four-zone shell has to survive six very different
 *  payloads, and that is only judgeable by walking each of them. */
export function GroundingPreview() {
  const [game, setGame] = useState<GroundingGame>('senses');
  const [last, setLast] = useState<Extract<StepLog, { kind: 'grounding' }> | null>(null);
  const [runKey, setRunKey] = useState(0);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'oklch(96% 0.015 95)' }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55 }}>
        Grounding · dev preview
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {GROUNDING_GAMES.map((g) => (
          <button
            key={g}
            onClick={() => {
              setGame(g);
              setLast(null);
              setRunKey((k) => k + 1);
            }}
            style={{
              border: g === game ? '1.5px solid oklch(76% 0.15 55)' : '1.5px solid oklch(90% 0.015 95)',
              background: g === game ? 'oklch(95% 0.05 68)' : 'white',
              borderRadius: 999,
              padding: '7px 11px',
              fontSize: 11.5,
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            {g}
          </button>
        ))}
      </div>
      <StepGrounding
        key={`${game}-${runKey}`}
        spec={groundingSpec(game, 'animals')}
        onLog={setLast}
        onDone={() => setRunKey((k) => k + 1)}
      />
      <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.7 }}>
        {last ? `logged → ${last.game} ${last.stepsDone}/${last.total} helped=${String(last.helped)}` : 'no log yet'}
      </div>
    </div>
  );
}

const NOW_MENU_FIXTURE = [
  {
    id: 'n1',
    label: 'Three long exhales',
    area: 'mind',
    pinned: true,
    coachLine: "I'll count",
    action: { kind: 'tool', tool: 'breathing', params: { breath_pattern: 'extended_exhale', breath_cycles: 5 } },
  },
  {
    id: 'n2',
    label: 'Five things you can see',
    area: 'mind',
    action: { kind: 'tool', tool: 'grounding', params: { grounding_game: 'senses' } },
  },
  {
    id: 'n3',
    label: 'A short sit',
    area: 'practice',
    action: { kind: 'tool', tool: 'meditate', params: { duration_min: 5, meditate_bells: 'start_end' } },
  },
];

/** The "Do something now" section against a stubbed menu, so the sheet's chrome can be judged
 *  without the api running. Stubs the network, not the component — what renders here is the real
 *  DoNowSection with real rows. */
export function NowMenuPreview() {
  // The api can't compose a real menu on this machine (the engine needs credentials we don't
  // have), and the service correctly soft-fails to an empty list — which would render nothing to
  // look at. So the preview stubs the ENDPOINT and leaves the component untouched: what renders
  // below is the real DoNowSection, fetching over the real client, against a fixture.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const orig = window.fetch;
    window.fetch = ((u: RequestInfo | URL, o?: RequestInit) =>
      String(u).includes('/me/now-menu')
        ? Promise.resolve(
            new Response(JSON.stringify({ items: NOW_MENU_FIXTURE }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
        : orig(u, o)) as typeof window.fetch;
    setReady(true);
    return () => {
      window.fetch = orig;
    };
  }, []);
  if (!ready) return null;
  return (
    <div style={{ padding: 0, background: 'oklch(96% 0.015 95)', minHeight: 600 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          opacity: 0.55,
          padding: 16,
        }}
      >
        ＋ sheet · dev preview
      </div>
      <div className="sheet ld" style={{ position: 'static', transform: 'none' }}>
        <div className="sheet-grab" aria-hidden />
        <DoNowSection onClose={() => undefined} onLogged={() => undefined} />
        <div className="ld-split" aria-hidden />
        <div className="ld-head">
          <b>Log something you did</b>
          <span>Tap what you did — it counts even if it wasn&apos;t scheduled for today.</span>
        </div>
      </div>
    </div>
  );
}

/** The instrument, end to end — family, word, room, note, acknowledgement. */
export function FeelingLogPreview() {
  const [last, setLast] = useState<Extract<StepLog, { kind: 'feeling_log' }> | null>(null);
  const [runKey, setRunKey] = useState(0);
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'oklch(96% 0.015 95)' }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.55 }}>
        Feeling log · dev preview
      </div>
      <StepFeelingLog key={runKey} onLog={setLast} onDone={() => setRunKey((k) => k + 1)} />
      <div style={{ fontSize: 11.5, lineHeight: 1.5, opacity: 0.7 }}>
        {last ? `logged → ${last.word} · room=${last.room} · ${last.note ?? 'no note'}` : 'no log yet'}
      </div>
    </div>
  );
}
