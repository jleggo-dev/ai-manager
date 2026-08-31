import { useState } from 'react';
import { WIDGET_KINDS, type WidgetKind, type WidgetSpec } from '@cadence/shared';
import { WidgetSection } from '../progress/widgets/registry.tsx';
import { FITNESS_FIXTURES, PRACTICE_FIXTURES } from '../progress/widgets/fixtures.ts';

const FITNESS_TITLES: Record<WidgetKind, string> = {
  rhythm: 'Your rhythm',
  trend_vs_target: 'Weight',
  dated_sessions: 'Your runs',
  weekly_bars: 'Steps',
  felt_week: 'How your days felt',
  shelf: 'Bests & firsts',
  stage_path: 'Race build',
  count_toward: 'Miles this year',
  balance: 'How runs felt',
  total: 'Time moved',
  variety: 'Routes run',
  repertoire: 'Swim skills',
  recap_rail: 'Your weekly check-ins',
  history: 'History',
};

const PRACTICE_TITLES: Record<WidgetKind, string> = {
  rhythm: 'Your rhythm',
  trend_vs_target: 'Pages a day',
  dated_sessions: 'Your sits',
  weekly_bars: 'Minutes sat',
  felt_week: 'Calmer evenings',
  shelf: 'Bests & firsts',
  stage_path: 'The novel',
  count_toward: 'Psalms',
  balance: 'How sits felt',
  total: 'Time sat',
  variety: 'Techniques tried',
  repertoire: 'Piano repertoire',
  recap_rail: 'Your weekly check-ins',
  history: 'History',
};

const FLAVOURS = ['fitness', 'practice'] as const;
type Flavour = (typeof FLAVOURS)[number];

/**
 * `?preview=widgets` — every WIDGET_KINDS renderer, stacked against fixture data at the phone's
 * 390px width (PhoneFrame supplies that; this just fills a normal .scrollbody). This is the human
 * review surface for the widget grammar (docs/cadence/PROGRESS-ENGINE.md W1-1): nothing here talks
 * to a server or a coach — it renders WidgetSection exactly as a real /me/progress-page would,
 * against both a movement-led fixture set and a mind/practice-led one, so a kind that only looks
 * right for runs-and-weigh-ins is visible immediately.
 */
export function WidgetsPreview() {
  const [flavour, setFlavour] = useState<Flavour>('fitness');
  const fixtures = flavour === 'fitness' ? FITNESS_FIXTURES : PRACTICE_FIXTURES;
  const titles = flavour === 'fitness' ? FITNESS_TITLES : PRACTICE_TITLES;

  return (
    <div className="app">
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', flexWrap: 'wrap' }}>
        {FLAVOURS.map((f) => (
          <button
            key={f}
            className={`detour-chip ${flavour === f ? 'on' : ''}`}
            aria-pressed={flavour === f}
            onClick={() => setFlavour(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="scrollbody">
        {WIDGET_KINDS.map((kind) => {
          const spec: WidgetSpec = { id: `w-${kind}`, kind, title: titles[kind] };
          return <WidgetSection key={kind} spec={spec} payload={fixtures[kind]} />;
        })}
      </div>
    </div>
  );
}
