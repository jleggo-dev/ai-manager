import type { CSSProperties } from 'react';
import type { StepTool } from '@cadence/shared';
import { StepTimer } from './StepTimer.tsx';
import { MicButton } from '../../../components/MicButton.tsx';

/**
 * The tool registry (REQ8) — renders a step's `StepTool` by kind. This is the one place that grows
 * when we add a tool: a new `StepTool` variant + a case here. The step's title/body are drawn by the
 * walkthrough shell; a renderer owns only the tool-specific interaction (and any capture). Only the
 * `timer` auto-advances on completion; everything else advances on the shell's Next. `journal`
 * writes into the shell's per-step `note` so a reflection becomes part of the completion log.
 */
export function ToolView({
  tool,
  onAutoAdvance,
  note,
  setNote,
}: {
  tool: StepTool;
  onAutoAdvance: () => void;
  note: string;
  setNote: (s: string) => void;
}) {
  switch (tool.kind) {
    case 'timer':
      return <StepTimer seconds={tool.seconds} chime={tool.chime ?? true} onComplete={onAutoAdvance} />;
    case 'reps':
      return <div style={big}>{repsLabel(tool)}</div>;
    case 'checkoff':
      return tool.label ? <div style={big}>{tool.label}</div> : null;
    case 'journal':
      return (
        <div style={{ width: '100%', maxWidth: 340 }}>
          <div className="logbox-label">{tool.prompt}</div>
          <div className="steer-row">
            <textarea
              className="logbox-in"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tool.mode === 'voice' ? 'Speak it…' : 'Write a few words…'}
            />
            {tool.mode !== 'text' && <MicButton value={note} onChange={setNote} />}
          </div>
        </div>
      );
    case 'photo':
      return <div className="prog-sub">📷 {tool.prompt} — photo capture is coming soon.</div>;
    case 'measure':
      return (
        <div className="prog-sub">
          Log your {tool.metric} ({tool.unit}) — capture coming soon.
        </div>
      );
    case 'read':
      return null; // the step body carries the instruction
    case 'rings':
    case 'insight':
      return <div className="prog-sub">Insight tool — will show your live data once placed in a task.</div>;
    default: {
      const _exhaustive: never = tool;
      void _exhaustive;
      return null;
    }
  }
}

function repsLabel(t: Extract<StepTool, { kind: 'reps' }>): string {
  const parts = [`${t.sets} set${t.sets === 1 ? '' : 's'}`];
  if (t.reps != null) parts.push(`× ${t.reps}`);
  if (t.load) parts.push(`@ ${t.load}`);
  return parts.join(' ');
}

const big: CSSProperties = { fontSize: 30, fontWeight: 800, color: 'var(--forest, #3f7a52)' };
