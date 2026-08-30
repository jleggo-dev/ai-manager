import type { WidgetPayload, WidgetSpec } from '@cadence/shared';
import { WIDGET_REGISTRY } from './widgetRegistry.ts';
import '../../../styles/progress-widgets.css';

/**
 * The card shell + dispatcher: renders the .dash-h title row (spec.title, "copy names the goal,
 * never the area" per BRAND.md — the coach's job, not this component's) and hands off to the
 * kind's renderer (widgetRegistry.ts). An unbindable/unknown kind was already omitted upstream
 * WITH evidence (WidgetOmission) — WidgetSection only ever sees kinds that resolved.
 */
export function WidgetSection({ spec, payload }: { spec: WidgetSpec; payload: WidgetPayload }) {
  const render = WIDGET_REGISTRY[payload.kind];
  return (
    <div className="pw-card">
      {spec.title && (
        <div className="dash-h">
          <b>{spec.title}</b>
        </div>
      )}
      {render(payload, spec)}
    </div>
  );
}
