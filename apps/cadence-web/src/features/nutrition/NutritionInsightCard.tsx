/**
 * Req 5 WS-I — simple-upfront nutrition insight with drill-down depth.
 * One coaching line + soft status; expand for macros, extra insights, meals.
 */
import { useEffect, useState } from 'react';
import { getNutritionInsight, type NutritionInsightPack } from '../../lib/api.ts';

function kindLabel(kind: string): string {
  if (kind === 'macro') return 'Macros';
  if (kind === 'pattern') return 'Pattern';
  if (kind === 'variety') return 'Variety';
  return 'Note';
}

export function NutritionInsightCard({
  reloadKey = 0,
  compact = false,
}: {
  /** Bump when meals/targets change so the card refreshes. */
  reloadKey?: number;
  /** Tighter chrome for embedding under Food tab / rings. */
  compact?: boolean;
}) {
  const [pack, setPack] = useState<NutritionInsightPack | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNutritionInsight().then((p) => {
      if (!cancelled) setPack(p);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (!pack?.primary) return null;

  const { status_line, primary, more, drill } = pack;
  const hasDepth =
    more.length > 0 || drill.macros.some((m) => m.eaten > 0 || m.target != null) || drill.meals.length > 0;

  return (
    <section className={`insight-card${compact ? ' insight-card-compact' : ''}`} aria-label="Nutrition insight">
      <div className="insight-card-h">
        <b>A note from me</b>
        {status_line ? <span>{status_line}</span> : null}
      </div>
      <p className="insight-card-body">{primary.body}</p>

      {hasDepth && (
        <>
          <button type="button" className="insight-card-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide details' : 'See more'}
          </button>
          {open && (
            <div className="insight-card-drill">
              {more.length > 0 && (
                <ul className="insight-more">
                  {more.map((m, i) => (
                    <li key={`${m.kind}-${i}`}>
                      <span className="insight-kind">{kindLabel(m.kind)}</span>
                      <span>{m.body}</span>
                    </li>
                  ))}
                </ul>
              )}

              {drill.macros.some((m) => m.target != null || m.eaten > 0) && (
                <div className="insight-macros" aria-label="Today's macros">
                  <div className="insight-drill-t">Today</div>
                  <ul>
                    {drill.macros
                      .filter((m) => m.target != null || m.eaten > 0)
                      .map((m) => (
                        <li key={m.key}>
                          <span>{m.label}</span>
                          <span>
                            {m.eaten}
                            {m.target != null ? ` / ${m.target}` : ''}
                            {m.left != null && m.target != null ? ` · ${m.left} left` : ''}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {drill.meals.length > 0 && (
                <div className="insight-meals" aria-label="Today's meals">
                  <div className="insight-drill-t">Logged today</div>
                  <ul>
                    {drill.meals.map((m, i) => (
                      <li key={`${m.meal}-${i}`}>
                        <span className="insight-meal-kind">{m.meal}</span>
                        <span>
                          {m.summary}
                          {m.kcal != null ? ` · ${m.kcal} kcal` : ''}
                          {m.provisional ? ' · still provisional' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {drill.window.days_logged > 0 && (
                <p className="insight-window">
                  Last {drill.window.window_days} days · logged {drill.window.days_logged}
                  {drill.window.top_items.length
                    ? ` · often ${drill.window.top_items
                        .slice(0, 3)
                        .map((t) => t.name)
                        .join(', ')}`
                    : ''}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
