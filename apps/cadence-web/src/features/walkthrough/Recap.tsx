import type { WalkthroughStep } from '@cadence/shared';
import { type StepLog, type StepLogs, stepFraction, logLine, recapSummary } from './state.ts';
import { StatusDisc } from './wt-parts.tsx';
import { TONE } from './tools/tone.ts';
import { overlay, closeBtn, greenBtn, recapCard, sectionLabel, skipAction } from './wt-styles.ts';

/**
 * The Recap (design D) — a real step in the shell, not a sheet. It shows what you did (each row's
 * value IS the log line) and what you passed over, each skip offering do-now / did-offline / leave-it.
 * "Nothing logged yet" is the honesty eyebrow: Finish is the single write in the whole flow. Nothing
 * logged at all → a quiet "Close without logging" instead of a false finish.
 */
export function Recap({
  steps,
  logs,
  title,
  onBack,
  onJump,
  onResolve,
  onFinish,
}: {
  steps: WalkthroughStep[];
  logs: StepLogs;
  title: string;
  onBack: () => void;
  onJump: (i: number) => void;
  onResolve: (id: string, log: StepLog) => void;
  onFinish: () => void;
}) {
  const did = steps.map((s, i) => ({ s, i })).filter(({ s }) => logs[s.id]);
  const skipped = steps.map((s, i) => ({ s, i })).filter(({ s }) => !logs[s.id]);
  const doneCount = did.length;
  const doneMin = did.reduce((n, { s }) => n + s.minutes, 0);
  const skipMin = skipped.reduce((n, { s }) => n + s.minutes, 0);

  return (
    <div style={overlay} role="dialog" aria-label="Recap">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={closeBtn} onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div style={{ flex: 1, display: 'flex', gap: 4 }}>
          {steps.map((s) => (
            <div
              key={s.id}
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                background: logs[s.id] ? TONE.deep : 'oklch(100% 0 0 / 0.5)',
                border: logs[s.id] ? undefined : '1px dashed oklch(70% 0.06 62)',
                boxSizing: 'border-box',
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 22, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: TONE.deep,
          }}
        >
          Recap · nothing logged yet
        </div>
        <div
          style={{
            fontFamily: 'var(--display), serif',
            fontWeight: 600,
            fontSize: 26,
            lineHeight: 1.15,
            color: TONE.ink2,
            marginTop: 7,
          }}
        >
          {doneCount === 0 ? 'Nothing logged yet.' : "Here's what today looked like."}
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'oklch(42% 0.02 150)', marginTop: 6 }}>
          {doneCount} of {steps.length} steps, {doneMin} minutes. Finish writes this to your log.
        </div>

        {doneCount > 0 && (
          <div style={{ ...recapCard, marginTop: 16 }}>
            <div style={sectionLabel}>You did</div>
            {did.map(({ s }) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <StatusDisc status={stepFraction(s, logs[s.id]) >= 1 ? 'logged' : 'partial'} />
                <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'oklch(32% 0.02 150)' }}>{s.title}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'oklch(48% 0.02 150)' }}>
                  {logLine(s, logs[s.id]!)}
                </div>
              </div>
            ))}
          </div>
        )}

        {skipped.length > 0 && (
          <div style={{ ...recapCard, marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={sectionLabel}>You passed over</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: TONE.sub }}>{skipMin} min of the plan</div>
            </div>
            {skipped.map(({ s, i }) => (
              <div
                key={s.id}
                style={{
                  border: '1px dashed oklch(86% 0.03 85)',
                  borderRadius: 12,
                  padding: '11px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 9,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      flex: 'none',
                      borderRadius: '50%',
                      border: '2px dashed oklch(78% 0.03 85)',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 800, color: 'oklch(32% 0.02 150)' }}>{s.title}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: TONE.sub }}>{s.minutes} min</div>
                </div>
                <div style={{ display: 'flex', gap: 7 }}>
                  <button
                    style={{
                      ...skipAction,
                      background: `linear-gradient(180deg, ${TONE.fillA}, ${TONE.fillB} 46%)`,
                      boxShadow: `0 3px 0 ${TONE.deep}`,
                      color: 'white',
                      border: 'none',
                    }}
                    onClick={() => onJump(i)}
                  >
                    Do it now
                  </button>
                  <button
                    style={{
                      ...skipAction,
                      background: 'white',
                      border: '1.5px solid oklch(86% 0.03 85)',
                      color: 'oklch(38% 0.02 150)',
                    }}
                    onClick={() => onResolve(s.id, { kind: 'done' })}
                  >
                    Did it offline
                  </button>
                  <button
                    style={{ ...skipAction, background: 'transparent', border: 'none', color: TONE.sub }}
                    onClick={onBack}
                  >
                    Leave it
                  </button>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11.5, lineHeight: 1.4, color: 'oklch(50% 0.02 150)' }}>
              Leaving it is a fine answer — skips are signal, not failure.
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        <div
          style={{
            background: 'oklch(97% 0.012 85)',
            border: '1px solid oklch(91% 0.015 85)',
            borderRadius: 14,
            padding: '11px 13px',
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              fontWeight: 900,
              letterSpacing: '0.09em',
              textTransform: 'uppercase',
              color: TONE.sub,
            }}
          >
            Goes to your log
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.45, color: 'oklch(36% 0.02 150)', marginTop: 3 }}>
            {title} — {doneMin} min · {recapSummary(steps, logs)}
          </div>
        </div>
        <button style={greenBtn} onClick={onFinish}>
          {doneCount === 0 ? 'Close without logging' : 'Finish · +10 XP'}
        </button>
      </div>
    </div>
  );
}
