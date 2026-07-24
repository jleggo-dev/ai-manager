import {
  LB_TO_KG,
  round1,
  plausibleKg,
  plausibleCm,
  kgToLbs,
  lbsToKg,
  cmToFtIn,
  ftInToCm,
  resolveWeightKg,
  parseWeightDraft,
  parseHeightCmDraft,
  parseHeightFtDraft,
  formatWeightDisplay,
} from './unitConversion.ts';

describe('unitConversion — round1 / constants', () => {
  it('exposes the same LB_TO_KG factor ReviewScreen historically used', () => {
    expect(LB_TO_KG).toBe(0.453592);
  });

  it('round1 rounds to one decimal place', () => {
    expect(round1(70.04)).toBe(70);
    expect(round1(70.05)).toBe(70.1);
    expect(round1(154.323583)).toBe(154.3);
  });
});

describe('unitConversion — plausibleKg clamp (prior data-corruption guard)', () => {
  it('accepts the inclusive 20–500 kg band', () => {
    expect(plausibleKg(20)).toBe(true);
    expect(plausibleKg(500)).toBe(true);
    expect(plausibleKg(80)).toBe(true);
  });

  it('rejects below 20, above 500, and non-numbers', () => {
    expect(plausibleKg(19.9)).toBe(false);
    expect(plausibleKg(500.1)).toBe(false);
    expect(plausibleKg(0)).toBe(false);
    expect(plausibleKg(undefined)).toBe(false);
    expect(plausibleKg(Number.NaN)).toBe(false);
  });

  it('rejects the fat-finger class that previously corrupted the store (e.g. 5078 kg)', () => {
    // Typing "170" while unit was mis-read, or repeated convert×display, produced values
    // far outside human body-weight range. The clamp must refuse to persist them.
    expect(plausibleKg(5078)).toBe(false);
    expect(parseWeightDraft('5078', 'kg')).toBeUndefined();
    expect(parseWeightDraft('11190', 'lbs')).toBeUndefined(); // ~5078 kg
  });
});

describe('unitConversion — resolveWeightKg (corrupted current → fall back to start)', () => {
  it('prefers a plausible current', () => {
    expect(resolveWeightKg({ current: 82.5, start: 90 })).toBe(82.5);
  });

  it('falls back to start when current is corrupted / out of band', () => {
    expect(resolveWeightKg({ current: 5078, start: 82 })).toBe(82);
    expect(resolveWeightKg({ current: 0, start: 70 })).toBe(70);
  });

  it('returns undefined when neither current nor start is plausible', () => {
    expect(resolveWeightKg({ current: 5078, start: 1 })).toBeUndefined();
    expect(resolveWeightKg(undefined)).toBeUndefined();
    expect(resolveWeightKg({})).toBeUndefined();
  });
});

describe('unitConversion — kg ↔ lbs round-trips', () => {
  it('converts kg to lbs display with one-decimal rounding', () => {
    expect(kgToLbs(70)).toBe(154.3);
    expect(kgToLbs(80)).toBe(176.4);
  });

  it('stores lbs as kg at 2-dp so a whole-lb input round-trips back to whole lbs (fixes 195→195.1)', () => {
    // 1-dp kg stored 195 lb as 88.5 kg, which displayed back as 195.1. 2-dp keeps the round-trip clean.
    expect(kgToLbs(lbsToKg(195))).toBe(195);
    expect(kgToLbs(lbsToKg(154.3))).toBe(154.3);
    expect(kgToLbs(lbsToKg(180))).toBe(180);
  });

  it('round-trips kg → lbs → kg without drifting (the corruption class)', () => {
    for (const kg of [55, 70, 82.5, 100, 120]) {
      const back = lbsToKg(kgToLbs(kg));
      // One decimal of loss is expected; must not balloon (e.g. 70 → 5078).
      expect(Math.abs(back - kg)).toBeLessThanOrEqual(0.1);
      expect(plausibleKg(back)).toBe(true);
    }
  });

  it('formatWeightDisplay uses the chosen unit', () => {
    expect(formatWeightDisplay(70, 'kg')).toBe('70');
    expect(formatWeightDisplay(70, 'lbs')).toBe('154.3');
    expect(formatWeightDisplay(undefined, 'kg')).toBe('');
  });

  it('parseWeightDraft converts once on commit and refuses implausible results', () => {
    expect(parseWeightDraft('70', 'kg')).toBe(70);
    expect(parseWeightDraft('154.3', 'lbs')).toBe(69.99); // 2-dp canonical kg (see round-trip test above)
    expect(parseWeightDraft('', 'kg')).toBeUndefined();
    expect(parseWeightDraft('  ', 'lbs')).toBeUndefined();
    expect(parseWeightDraft('-5', 'kg')).toBeUndefined();
    expect(parseWeightDraft('abc', 'kg')).toBeUndefined();
    expect(parseWeightDraft('10', 'kg')).toBeUndefined(); // below 20 kg clamp
  });
});

describe('unitConversion — cm ↔ ft/in', () => {
  it('accepts the inclusive 80–260 cm band', () => {
    expect(plausibleCm(80)).toBe(true);
    expect(plausibleCm(260)).toBe(true);
    expect(plausibleCm(79)).toBe(false);
    expect(plausibleCm(261)).toBe(false);
  });

  it('splits cm into ft/in the way the About-you fields display', () => {
    expect(cmToFtIn(178)).toEqual({ ft: 5, in: 10 });
    expect(cmToFtIn(183)).toEqual({ ft: 6, in: 0 });
  });

  it('converts ft/in back to whole cm', () => {
    expect(ftInToCm(5, 10)).toBe(178);
    expect(ftInToCm(6, 0)).toBe(183);
  });

  it('round-trips cm → ft/in → cm without leaving the plausible band', () => {
    for (const cm of [152, 165, 178, 183, 190]) {
      const { ft, in: inches } = cmToFtIn(cm);
      const back = ftInToCm(ft, inches);
      expect(Math.abs(back - cm)).toBeLessThanOrEqual(1);
      expect(plausibleCm(back)).toBe(true);
    }
  });

  it('parseHeightCmDraft / parseHeightFtDraft clamp to the plausible band', () => {
    expect(parseHeightCmDraft('178')).toBe(178);
    expect(parseHeightCmDraft('50')).toBeUndefined();
    expect(parseHeightCmDraft('')).toBeUndefined();
    expect(parseHeightFtDraft({ ft: '5', in: '10' })).toBe(178);
    expect(parseHeightFtDraft({ ft: '1', in: '0' })).toBeUndefined(); // ~30 cm
    expect(parseHeightFtDraft({ ft: '', in: '' })).toBeUndefined(); // 0 cm → clamp rejects
  });
});
