/**
 * What "complete" means, and when we are entitled to say a food HASN'T got something.
 *
 * Owner: *"what does complete mean? From the user's perspective it means macros and micronutrients,
 * although in most cases they'd be okay with just macros. And it will be hard to tell with
 * micronutrients, because honestly some foods just don't have any."* — then, correctly, *"untrue,
 * Oreos have sodium and fiber."*
 *
 * Both halves of that are load-bearing. Macros are the bar. And an Oreo is not nutrient-free — it
 * is a food whose LABEL only ever listed some nutrients, which is a different thing entirely and
 * the reason provenance decides this rather than the values do.
 */
import { describe, it, expect } from 'vitest';
import { isGoodEnough, microProvenance, microsAreMeasured, nutritionTier } from './completeness.ts';

/** A real Branded row: the Nutrition Facts panel, nothing more. */
const oreo = {
  kcal: 480,
  protein_g: 4.8,
  carbs_g: 71,
  fat_g: 20,
  fiber_g: 2.4,
  sodium_mg: 430,
  iron_mg: 4.3,
  calcium_mg: 0,
};
/** A real lab panel: SR Legacy publishes ~78 nutrients. */
const peanutButter = {
  kcal: 590,
  protein_g: 24,
  carbs_g: 21.8,
  fat_g: 49.9,
  fiber_g: 6.6,
  sodium_mg: 203,
  iron_mg: 1.9,
  zinc_mg: 2.78,
  vitamin_c_mg: 0,
  calcium_mg: 41,
  potassium_mg: 747,
  vitamin_b12_ug: 0,
};

describe('nutritionTier', () => {
  it('treats no calories, and calories alone, as unusable', () => {
    expect(nutritionTier({ protein_g: 5, carbs_g: 71, fat_g: 20 })).toBe('unusable');
    expect(nutritionTier({ kcal: 480 })).toBe('unusable');
    expect(nutritionTier(null)).toBe('unusable');
  });

  it('calls a real but incomplete row "partial" — most of the ledger lives here', () => {
    // A Greek yogurt at 59 kcal / 10 g protein / 110 mg calcium prices a breakfast perfectly well.
    // Demanding all four macros here sent exactly this row down a BILLED rung for nothing.
    expect(nutritionTier({ kcal: 59, protein_g: 10, calcium_mg: 110 })).toBe('partial');
    expect(isGoodEnough({ kcal: 59, protein_g: 10, calcium_mg: 110 })).toBe(true);
  });

  it('calls a label-derived food "macros" — usable, and honestly not more than that', () => {
    expect(nutritionTier(oreo)).toBe('macros');
  });

  it('calls a measured food "full"', () => {
    expect(nutritionTier(peanutButter)).toBe('full');
  });
});

describe('microsAreMeasured — the Oreo question', () => {
  it('trusts a record carrying nutrients no label would print', () => {
    // Zinc, B-12 and (since the 2016 refresh) vitamin C are not on a US Nutrition Facts panel.
    // Their presence proves the food was analysed, so absences on that record are real answers.
    expect(microsAreMeasured(peanutButter)).toBe(true);
  });

  it('does NOT treat a label transcription as an authority on what a food lacks', () => {
    // The Oreo row has sodium, iron and fibre — the owner is right that it is not nutrient-free.
    // What it cannot tell us is the zinc, because the packet was never going to say either way.
    expect(microsAreMeasured(oreo)).toBe(false);
    expect(oreo.sodium_mg).toBeGreaterThan(0);
  });

  it('distinguishes label, measured, and nothing at all', () => {
    expect(microProvenance(peanutButter)).toBe('measured');
    expect(microProvenance(oreo)).toBe('label');
    expect(microProvenance({ kcal: 200, protein_g: 1, carbs_g: 2, fat_g: 3 })).toBe('none');
  });
});

describe('isGoodEnough — where the waterfall stops', () => {
  it('stops at macros, even with no micronutrients whatsoever', () => {
    // The rungs below cost billed calls and seconds of someone's attention. Spending them to chase
    // the zinc content of an Oreo would spend a real rung on the half we cannot verify, for a food
    // whose label was never going to say — and then pin the invented answer forever.
    expect(isGoodEnough({ kcal: 480, protein_g: 4.8, carbs_g: 71, fat_g: 20 })).toBe(true);
  });

  it('keeps looking only for a stub — no calories, or calories and nothing else', () => {
    // The old waterfall was gated purely on whether a NAME matched, so a stub was accepted and
    // priced and the source that might have completed it was never asked. This is the narrow
    // case where paying for another rung is clearly worth it.
    expect(isGoodEnough({ kcal: 480 })).toBe(false);
    expect(isGoodEnough({ protein_g: 4 })).toBe(false);
    expect(isGoodEnough(null)).toBe(false);
  });
});

describe('where the gate must NOT reach', () => {
  it('says a calories-only pin is thin — which is exactly why the pin rung must not consult it', () => {
    // The trap, kept as a note beside the function it nearly broke: an AI-estimated pin can
    // legitimately carry calories and little else. Gating the PIN rung on this check made such a
    // row fail on every later log, pin a second row, and resolve the same words to a different
    // food each time — the precise drift the ledger exists to eliminate.
    //
    // Completeness escalates through SOURCES and stops at the ledger. Once a food is ours,
    // consistency outranks completeness: a thin row reused forever beats a fuller row re-guessed.
    expect(isGoodEnough({ kcal: 250 })).toBe(false);
    expect(nutritionTier({ kcal: 250 })).toBe('unusable');
  });
});
