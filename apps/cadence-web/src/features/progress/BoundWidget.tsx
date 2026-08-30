import type { ReactNode } from 'react';
import type { HealthDigestStepsWeek, ProgressWindow, WidgetSpec } from '@cadence/shared';
import { WidgetSection } from './widgets/registry.tsx';
import {
  useDatedSessions,
  useHealthDigest,
  useProgress,
  useProgressBalance,
  useProgressCount,
  useProgressEvents,
  useProgressHistory,
  useProgressStagePath,
  useProgressTotals,
  useProgressVariety,
} from '../../lib/query/index.ts';
import { useGoalEventAdd } from '../today/useGoalEventAdd.ts';
import { rhythmDates, windowDates } from './windowDates.ts';

/**
 * The binding layer (W1-6): one small component per kind, each married to its data hook, so the
 * page can render a layout's sections without a per-section waterfall of conditional hooks.
 * A section whose data isn't there yet (or came back as an omission) renders NOTHING — the page
 * never shows a zero, a spinner-per-card, or a red state for absent data. Wave 3's coach-composed
 * layouts ride this same layer unchanged.
 */
interface BoundProps {
  spec: WidgetSpec;
  window: ProgressWindow;
  /** dated_sessions drill-down: open the full session list for an activity. */
  onDrill?: (activity: string) => void;
}

function RhythmBound({ spec, window }: BoundProps) {
  const { from, to } = rhythmDates(window);
  const { data } = useProgressHistory(from, to);
  if (!data || data.rhythm.weeks.length === 0) return null;
  return <WidgetSection spec={spec} payload={{ kind: 'rhythm', data: data.rhythm }} />;
}

function TrendVsTargetBound({ spec, window }: BoundProps) {
  const { data } = useProgress(window);
  const card = data?.cards.find((c) => c.kind === 'latest_vs_target');
  if (!card || card.kind !== 'latest_vs_target') return null;
  const { kind: _k, area: _a, title, ...payload } = card;
  return <WidgetSection spec={{ ...spec, title: spec.title ?? title }} payload={{ kind: 'trend_vs_target', data: payload }} />;
}

function DatedSessionsBound({ spec, window, onDrill }: BoundProps) {
  const activity = spec.source?.activity ?? '';
  const { data } = useDatedSessions(activity, window);
  if (!activity || !data || data.sessions.length === 0) return null;
  return (
    <div>
      <WidgetSection spec={spec} payload={{ kind: 'dated_sessions', data }} />
      {onDrill && (
        <button className="prog-addbtn" onClick={() => onDrill(activity)}>
          every session ›
        </button>
      )}
    </div>
  );
}

function WeeklyBarsBound({ spec }: BoundProps) {
  const { data } = useHealthDigest();
  // Steps only in Wave 1; a kcal-sourced weekly_bars binds in a later wave (month nutrition read).
  const steps = spec.source?.measure === 'steps' ? data?.digest?.dailySteps : undefined;
  if (!steps?.byWeek?.length) return null;
  const weeks = steps.byWeek.map((w: HealthDigestStepsWeek) => ({
    label: w.weekStartISO.slice(5),
    value: w.daysObserved > 0 ? w.avgPerDay : null,
  }));
  return (
    <WidgetSection
      spec={spec}
      payload={{ kind: 'weekly_bars', data: { unit: 'steps/day', weeks, latest: steps.avgPerDayLast7 ?? null } }}
    />
  );
}

function ShelfBound({ spec, window }: BoundProps) {
  const { from, to } = windowDates(window);
  const { data } = useProgressEvents(from, to);
  if (!data || 'omission' in data || data.events.length === 0) return null;
  return <WidgetSection spec={spec} payload={{ kind: 'shelf', data }} />;
}

function BalanceBound({ spec, window }: BoundProps) {
  const kind = spec.source?.feedback_kind === 'movement' ? 'movement' : 'mind';
  const { data } = useProgressBalance(kind, window);
  if (!data || 'omission' in data || data.total === 0) return null;
  return <WidgetSection spec={spec} payload={{ kind: 'balance', data }} />;
}

function TotalBound({ spec, window }: BoundProps) {
  const { data } = useProgressTotals(spec.source?.goal_id ?? '', window);
  if (!spec.source?.goal_id || !data || 'omission' in data) return null;
  return <WidgetSection spec={spec} payload={{ kind: 'total', data }} />;
}

function VarietyBound({ spec, window }: BoundProps) {
  const { data } = useProgressVariety(window);
  if (!data || 'omission' in data || data.count === 0) return null;
  return <WidgetSection spec={spec} payload={{ kind: 'variety', data }} />;
}

function StagePathBound({ spec }: BoundProps) {
  const { data } = useProgressStagePath(spec.source?.goal_id ?? '');
  if (!spec.source?.goal_id || !data || 'omission' in data) return null;
  return <WidgetSection spec={spec} payload={{ kind: 'stage_path', data }} />;
}

function CountTowardBound({ spec }: BoundProps) {
  const goalId = spec.source?.goal_id ?? '';
  const { data, refetch } = useProgressCount(goalId);
  const add = useGoalEventAdd(() => void refetch());
  if (!goalId || !data || 'omission' in data) return null;
  return (
    <div>
      <WidgetSection spec={spec} payload={{ kind: 'count_toward', data }} />
      {add.addFor === goalId ? (
        <div className="prog-add">
          <input
            className="wiz-in"
            value={add.addLabel}
            placeholder="what was it?"
            onChange={(e) => add.setAddLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add.submitAdd(goalId)}
          />
          <button className="prog-addbtn" disabled={add.busy} onClick={() => void add.submitAdd(goalId)}>
            add
          </button>
        </div>
      ) : (
        <button className="prog-addbtn" onClick={() => add.setAddFor(goalId)}>
          + add one
        </button>
      )}
    </div>
  );
}

function HistoryBound({ spec, window }: BoundProps) {
  const { data } = useProgress(window);
  if (!data || data.history.length === 0) return null;
  return <WidgetSection spec={spec} payload={{ kind: 'history', data: { entries: data.history } }} />;
}

const BOUND: Partial<Record<WidgetSpec['kind'], (p: BoundProps) => ReactNode>> = {
  rhythm: RhythmBound,
  trend_vs_target: TrendVsTargetBound,
  dated_sessions: DatedSessionsBound,
  weekly_bars: WeeklyBarsBound,
  shelf: ShelfBound,
  balance: BalanceBound,
  total: TotalBound,
  variety: VarietyBound,
  stage_path: StagePathBound,
  count_toward: CountTowardBound,
  history: HistoryBound,
  // recap_rail binds in Wave 2 once recaps persist — until then the section quietly stands down.
};

export function BoundWidget(props: BoundProps) {
  const Bound = BOUND[props.spec.kind];
  if (!Bound) return null;
  return <Bound {...props} />;
}
