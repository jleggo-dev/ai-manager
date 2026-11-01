/**
 * The quick log's round doors are drawn alike: white, each with its own glyph tint.
 *
 * Turn 1 dressed the type-it door in dark ink, and on the phone it read as a pressed or selected
 * button sitting among white ones (owner, 2026-11-01: "it should look the same as the other
 * buttons"). A per-door rule may set the glyph's colour; it may not repaint the door itself.
 */
import { describe, expect, it } from 'vitest';
import { parseStylesheet, readStyle } from '../test/css.ts';

const SHEETS = ['src/styles/food-capture.css', 'src/styles/quick-log.css'];
const DOORS = ['chat', 'voice', 'picture', 'barcode', 'search'];

describe('quick log doors', () => {
  it.each(SHEETS)('%s — no single door gets its own background or border', (path) => {
    const { rules } = parseStylesheet(readStyle(path));
    for (const door of DOORS) {
      const style = rules.get(`.fm-tiles-icons .fm-tile-${door}`);
      if (!style) continue;
      expect(style.getPropertyValue('background'), `${door} door background`).toBe('');
      expect(style.getPropertyValue('background-color'), `${door} door background`).toBe('');
      expect(style.getPropertyValue('border-color'), `${door} door border`).toBe('');
    }
  });

  it('the type-it door still has a tint of its own', () => {
    const { rules } = parseStylesheet(readStyle('src/styles/quick-log.css'));
    expect(rules.get('.fm-tiles-icons .fm-tile-chat')?.getPropertyValue('color')).not.toBe('');
  });
});
