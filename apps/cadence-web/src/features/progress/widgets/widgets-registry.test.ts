import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { WIDGET_KINDS } from '@cadence/shared';
import { WidgetSection } from './registry.tsx';
import { WIDGET_REGISTRY } from './widgetRegistry.ts';
import { FITNESS_FIXTURES, PRACTICE_FIXTURES } from './fixtures.ts';

/**
 * The display-side twin of declared-equals-executable (docs/cadence/PROGRESS-ENGINE.md
 * "Rendering contract"): every kind the coach/composer may declare in WIDGET_KINDS must have a
 * renderer here. This is the gate that fails CI the moment a kind is added to the shared grammar
 * without a client renderer, instead of that section silently disappearing off the page.
 */
describe('WIDGET_REGISTRY parity with WIDGET_KINDS', () => {
  it('has a renderer for every declared kind', () => {
    for (const kind of WIDGET_KINDS) {
      expect(WIDGET_REGISTRY[kind]).toBeTypeOf('function');
    }
  });

  it('declares no renderer for a kind outside WIDGET_KINDS', () => {
    expect(Object.keys(WIDGET_REGISTRY).sort()).toEqual([...WIDGET_KINDS].sort());
  });
});

/** "brand physics enforced by the renderer, not by prompts" — a banned word slipping into any
 *  rendered widget, from either fixture set, is a real regression: these are copy the renderer
 *  itself owns (footers, sentence templates), not model output this test could excuse. */
const BANNED_WORDS = ['streak', 'adherence', 'unlock', 'empower', 'journey', 'captured'];

describe('WidgetSection smoke render (both fixture flavours)', () => {
  for (const [flavour, fixtures] of [
    ['fitness', FITNESS_FIXTURES],
    ['practice', PRACTICE_FIXTURES],
  ] as const) {
    for (const kind of WIDGET_KINDS) {
      it(`renders ${kind} from the ${flavour} fixture without throwing or banned copy`, () => {
        const payload = fixtures[kind];
        const { container } = render(WidgetSection({ spec: { id: `w-${kind}`, kind, title: 'Test' }, payload }));
        const text = container.textContent?.toLowerCase() ?? '';
        for (const word of BANNED_WORDS) {
          expect(text.includes(word), `"${word}" found in rendered ${kind} (${flavour})`).toBe(false);
        }
      });
    }
  }
});
