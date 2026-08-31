import { createElement, type ReactNode } from 'react';
import type { WidgetKind, WidgetPayload, WidgetSpec } from '@cadence/shared';
import { RhythmWidget } from './RhythmWidget.tsx';
import { TrendVsTargetWidget } from './TrendVsTargetWidget.tsx';
import { DatedSessionsWidget } from './DatedSessionsWidget.tsx';
import { WeeklyBarsWidget } from './WeeklyBarsWidget.tsx';
import { FeltWeeksWidget } from './FeltWeeksWidget.tsx';
import { ShelfWidget } from './ShelfWidget.tsx';
import { StagePathWidget } from './StagePathWidget.tsx';
import { CountTowardWidget } from './CountTowardWidget.tsx';
import { BalanceWidget } from './BalanceWidget.tsx';
import { TotalWidget } from './TotalWidget.tsx';
import { VarietyWidget } from './VarietyWidget.tsx';
import { RepertoireWidget } from './RepertoireWidget.tsx';
import { RecapRailWidget } from './RecapRailWidget.tsx';
import { HistoryWidget } from './HistoryWidget.tsx';

/**
 * WidgetKind → renderer — the display-side twin of declared-equals-executable
 * (docs/cadence/PROGRESS-ENGINE.md "Rendering contract"). widgets-registry.test.ts asserts every
 * WIDGET_KINDS entry has one here, so a kind added to the shared grammar without a renderer fails
 * CI instead of silently omitting a section on the page.
 *
 * A plain .ts file (createElement, not JSX) on purpose: `registry.tsx` exports the WidgetSection
 * *component*, and react-refresh's "only export components" rule wants a component file to export
 * only components — so the actual kind→renderer map (a value, not a component) lives here instead,
 * imported by registry.tsx and by the contract test directly.
 *
 * Each entry re-checks `payload.kind` even though the caller already dispatched on it: a plain
 * `Record<WidgetKind, fn>` loses the per-key payload type from the WidgetPayload union, and this
 * narrowing is what gets each renderer its correctly-typed `data` without an `any`.
 */
type Renderer = (payload: WidgetPayload, spec: WidgetSpec) => ReactNode;

const renderRhythm: Renderer = (payload) =>
  payload.kind === 'rhythm' ? createElement(RhythmWidget, { data: payload.data }) : null;
const renderTrendVsTarget: Renderer = (payload, spec) =>
  payload.kind === 'trend_vs_target'
    ? createElement(TrendVsTargetWidget, { data: payload.data, caption: spec.caption })
    : null;
const renderDatedSessions: Renderer = (payload) =>
  payload.kind === 'dated_sessions' ? createElement(DatedSessionsWidget, { data: payload.data }) : null;
const renderWeeklyBars: Renderer = (payload) =>
  payload.kind === 'weekly_bars' ? createElement(WeeklyBarsWidget, { data: payload.data }) : null;
const renderFeltWeek: Renderer = (payload) =>
  payload.kind === 'felt_week' ? createElement(FeltWeeksWidget, { data: payload.data }) : null;
const renderShelf: Renderer = (payload) =>
  payload.kind === 'shelf' ? createElement(ShelfWidget, { data: payload.data }) : null;
const renderStagePath: Renderer = (payload) =>
  payload.kind === 'stage_path' ? createElement(StagePathWidget, { data: payload.data }) : null;
const renderCountToward: Renderer = (payload) =>
  payload.kind === 'count_toward' ? createElement(CountTowardWidget, { data: payload.data }) : null;
const renderBalance: Renderer = (payload) =>
  payload.kind === 'balance' ? createElement(BalanceWidget, { data: payload.data }) : null;
const renderTotal: Renderer = (payload) =>
  payload.kind === 'total' ? createElement(TotalWidget, { data: payload.data }) : null;
const renderVariety: Renderer = (payload) =>
  payload.kind === 'variety' ? createElement(VarietyWidget, { data: payload.data }) : null;
const renderRepertoire: Renderer = (payload) =>
  payload.kind === 'repertoire' ? createElement(RepertoireWidget, { data: payload.data }) : null;
const renderRecapRail: Renderer = (payload) =>
  payload.kind === 'recap_rail' ? createElement(RecapRailWidget, { data: payload.data }) : null;
const renderHistory: Renderer = (payload) =>
  payload.kind === 'history' ? createElement(HistoryWidget, { data: payload.data }) : null;

export const WIDGET_REGISTRY: Record<WidgetKind, Renderer> = {
  rhythm: renderRhythm,
  trend_vs_target: renderTrendVsTarget,
  dated_sessions: renderDatedSessions,
  weekly_bars: renderWeeklyBars,
  felt_week: renderFeltWeek,
  shelf: renderShelf,
  stage_path: renderStagePath,
  count_toward: renderCountToward,
  balance: renderBalance,
  total: renderTotal,
  variety: renderVariety,
  repertoire: renderRepertoire,
  recap_rail: renderRecapRail,
  history: renderHistory,
};
