import type { WidgetPayload, WidgetSpec } from '@cadence/shared';
import { WIDGET_REGISTRY } from './widgetRegistry.ts';
import { headerGlyphPath, headerTag, type WidgetFamily } from './cardHeader.ts';
import '../../../styles/progress-widgets.css';

/**
 * The card shell + dispatcher (owner design "Cadence Progress" 1a): a white card with the glyph
 * chip + title + mono measure-tag header row (cardHeader.ts owns those maps), then the kind's own
 * interior (widgetRegistry.ts). `family` colors the chip only when the binding honestly knows the
 * goal's area; absent, the chip stays neutral — never a guess. spec.title stays the coach's
 * ("copy names the goal, never the area" per BRAND.md). An unbindable/unknown kind was already
 * omitted upstream WITH evidence (WidgetOmission) — WidgetSection only ever sees kinds that
 * resolved. `history` alone drops the card header for a hairline section label: the design
 * demotes the log to a quiet "this week" list under the goal cards.
 */
export function WidgetSection({
  spec,
  payload,
  family,
}: {
  spec: WidgetSpec;
  payload: WidgetPayload;
  family?: WidgetFamily;
}) {
  const render = WIDGET_REGISTRY[payload.kind];
  if (payload.kind === 'history') {
    return (
      <div>
        {spec.title && (
          <div className="pw-sect">
            <span>{spec.title}</span>
          </div>
        )}
        <div className="pw-card">{render(payload, spec)}</div>
      </div>
    );
  }
  return (
    <div className="pw-card">
      {spec.title && (
        <div className="pw-head">
          <span className={`pw-glyph pw-glyph--${family ?? 'neutral'}`} aria-hidden>
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path d={headerGlyphPath(payload.kind)} fill="currentColor" />
            </svg>
          </span>
          <span className="pw-head-t">
            <b>{spec.title}</b>
            <span className="pw-head-tag">{headerTag(payload)}</span>
          </span>
          <span className="pw-head-chev" aria-hidden>
            ›
          </span>
        </div>
      )}
      {render(payload, spec)}
    </div>
  );
}
