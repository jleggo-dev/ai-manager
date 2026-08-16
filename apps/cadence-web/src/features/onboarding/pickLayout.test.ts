import { OPENING_PICKS } from '@cadence/shared';
import { derivePickLayout } from './pickLayout.ts';

/** A pick set written the way the coach writes one, with only the labels that decide the shape. */
const labels = (...ls: string[]) => ({ options: ls.map((label) => ({ label })) });

describe('derivePickLayout', () => {
  /**
   * The two question shapes the protocol actually asks for, side by side. If the deriver ever gets
   * these two wrong nothing else about it matters — everything below is the boundary around them.
   */
  it('grids the minutes question and keeps the time-of-day question as rows', () => {
    expect(
      derivePickLayout({
        options: [
          { label: '10', hint: 'a short one' },
          { label: '20', hint: 'most people' },
          { label: '30', hint: 'a proper session' },
          { label: '45+', hint: 'when there is room' },
        ],
      }),
    ).toBe('tiles');
    expect(derivePickLayout(labels('Morning', 'Midday', 'Evening', 'Flexible'))).toBe('list');
  });

  it("keeps the app's own opening question as rows", () => {
    // Four goals, all of them phrases, all of them area-tagged. The one pick set every single user
    // sees must not quietly become a grid of very large type.
    expect(derivePickLayout(OPENING_PICKS)).toBe('list');
  });

  it('grids up to six characters and no further', () => {
    expect(derivePickLayout(labels('10 min', '20 min'))).toBe('tiles');
    expect(derivePickLayout(labels('10 mins', '20 mins'))).toBe('list');
  });

  it('sends the whole set to rows when one label runs long', () => {
    // A grid is only glanceable while its cells are the same size; a single phrase among scalars
    // makes a ragged one, and the set is a set.
    expect(derivePickLayout(labels('10', '20', 'Whatever I can find'))).toBe('list');
  });

  it('needs two options to make a grid', () => {
    // `.qp-tiles` is two columns, so a lone cell is a half-width box beside nothing.
    expect(derivePickLayout(labels('45+'))).toBe('list');
    expect(derivePickLayout(labels('20', '45+'))).toBe('tiles');
  });

  it('stops gridding past the six options the protocol allows', () => {
    expect(derivePickLayout(labels('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'))).toBe('tiles');
    expect(derivePickLayout(labels('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'))).toBe('list');
  });

  it('never grids a set tagged by area, however short the labels are', () => {
    // An area colours a row's dot and a tile has no dot — so an area tag is the coach saying these
    // are topics, not values. "Runs" and "Pages" are goals whatever their length.
    expect(
      derivePickLayout({
        options: [
          { label: 'Runs', area: 'movement' },
          { label: 'Pages', area: 'practice' },
        ],
      }),
    ).toBe('list');
  });

  it('measures the label a user sees, not the string that carries it', () => {
    // Six characters and a stray space is still six characters.
    expect(derivePickLayout(labels(' 10 min ', '20 min'))).toBe('tiles');
    // A check-in scale: "🙂 good" is six characters and seven UTF-16 units, so counting the wrong
    // unit would send a perfectly good grid to rows.
    expect(derivePickLayout(labels('🙁 hard', '😐 ok', '🙂 good'))).toBe('tiles');
  });

  it('does not let the lead move the shape', () => {
    // The lead never reaches the screen — it only joins the composed sentence — so a layout that
    // moved with it would be unexplainable to anyone looking at the buttons.
    const options = labels('10', '20', '30').options;
    expect(derivePickLayout({ options })).toBe(derivePickLayout({ options, lead: 'I have about' }));
  });
});
