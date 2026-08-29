import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../food-capture.ts', () => ({ parseNutritionLabel: vi.fn(), identifyFood: vi.fn() }));
vi.mock('../meal-photos.ts', () => ({ signMealPhotoUrl: vi.fn(async () => 'https://example.com/signed.jpg') }));

import {
  parseNutritionLabel,
  identifyFood,
  type ParsedLabelCapture,
  type ParsedIdentifyCapture,
} from '../food-capture.ts';
import { signMealPhotoUrl } from '../meal-photos.ts';
import { READ_LABEL } from './label-function.ts';

/**
 * `read_label` wraps `parseNutritionLabel`/`identifyFood` (food-capture.ts) so the Coach can call
 * them on a photo already attached to this turn (MP13's photo_ref), and reports what it finds
 * through the same authority-ranked candidate shape `check_food_sources` uses (MP15). The
 * motivating fixture throughout is the mushroom jar from PLAN.md: "Per 15 pieces (15 g)".
 */

const USER = '00000000-0000-4000-a000-00000000a201';

function fakeImageResponse(
  opts: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    contentLength?: number | null;
    bodyBytes?: number;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  } = {},
): Response {
  const { ok = true, status = ok ? 200 : 404, contentType = 'image/jpeg', contentLength = null, bodyBytes = 3 } = opts;
  const headerMap: Record<string, string> = { 'content-type': contentType ?? '' };
  if (contentLength !== null) headerMap['content-length'] = String(contentLength);
  return {
    ok,
    status,
    headers: { get: (k: string) => headerMap[k.toLowerCase()] ?? null },
    arrayBuffer: opts.arrayBuffer ?? (async () => new Uint8Array(bodyBytes).buffer),
  } as unknown as Response;
}

const mushroomCapture = (): ParsedLabelCapture => ({
  label_readable: true,
  candidate: {
    name: 'Dried Mixed Mushrooms',
    brand: 'The Wild Mushroom Co',
    source: 'label_photo',
    base_unit: 'g',
    macros_per_base: {
      kcal: (40 / 15) * 100,
      protein_g: (3 / 15) * 100,
      carbs_g: (8 / 15) * 100,
      fat_g: (1 / 15) * 100,
      potassium_mg: (250 / 15) * 100,
      calcium_mg: (10 / 15) * 100,
      iron_mg: (0.3 / 15) * 100,
    },
    servings: [{ label: '15 g', unit: 'g', amount_g: 15 }],
    default_serving: 0,
    confidence: 0.9,
    photo_ref: 'user1/2026-08-28/mushroom.jpg',
  },
});

describe('read_label — run()', () => {
  beforeEach(() => {
    vi.mocked(parseNutritionLabel).mockReset();
    vi.mocked(identifyFood).mockReset();
    vi.mocked(signMealPhotoUrl).mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeImageResponse()),
    );
  });

  it('is a usage case, not a fault, when no photo_ref is given at all', async () => {
    expect(await READ_LABEL.run(USER, {})).toBeNull();
    expect(await READ_LABEL.run(USER, { photo_ref: '' })).toBeNull();
    expect(await READ_LABEL.run(USER, { photo_ref: '   ' })).toBeNull();
    expect(parseNutritionLabel).not.toHaveBeenCalled();
  });

  it('re-signs the ref, fetches it, and hands parseNutritionLabel a fresh data URL (default mode)', async () => {
    vi.mocked(parseNutritionLabel).mockResolvedValueOnce(mushroomCapture());

    const result = await READ_LABEL.run(USER, { photo_ref: 'user1/2026-08-28/mushroom.jpg', hint: 'Wild Mushroom Co' });

    expect(signMealPhotoUrl).toHaveBeenCalledWith('user1/2026-08-28/mushroom.jpg', 300);
    expect(parseNutritionLabel).toHaveBeenCalledWith(USER, {
      photo: expect.stringMatching(/^data:image\/jpeg;base64,/),
      hint: 'Wild Mushroom Co',
    });
    expect(identifyFood).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'nutrition_label' });
  });

  it('calls identifyFood instead when mode is "identify"', async () => {
    vi.mocked(identifyFood).mockResolvedValueOnce({
      name: 'Dried Mixed Mushrooms',
      brand: 'The Wild Mushroom Co',
      confidence: 0.85,
      photo_ref: 'ref1',
    } as ParsedIdentifyCapture);

    const result = await READ_LABEL.run(USER, { photo_ref: 'ref1', mode: 'identify' });

    expect(identifyFood).toHaveBeenCalledOnce();
    expect(parseNutritionLabel).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'identify' });
  });

  it('omits hint entirely rather than passing an empty string', async () => {
    vi.mocked(parseNutritionLabel).mockResolvedValueOnce(mushroomCapture());
    await READ_LABEL.run(USER, { photo_ref: 'ref1' });
    expect(parseNutritionLabel).toHaveBeenCalledWith(USER, { photo: expect.any(String), hint: undefined });
  });

  /**
   * Non-negotiable: an unreadable photo must reach the caller as a genuine FAULT (this throws, so
   * executeCalls records `undefined` and render() below returns toolFaultText), never as a quiet
   * "nothing found". This is what stops `read_label` repeating the crash-reads-as-empty bug
   * TOOL-HARNESS.md is written around.
   */
  it('throws — never resolves to an empty-looking result — when the photo cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeImageResponse({ ok: false, status: 404 })),
    );
    await expect(READ_LABEL.run(USER, { photo_ref: 'gone' })).rejects.toThrow();
  });

  it('throws on a non-image content type rather than uploading garbage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeImageResponse({ contentType: 'text/html' })),
    );
    await expect(READ_LABEL.run(USER, { photo_ref: 'weird' })).rejects.toThrow();
  });

  /**
   * The re-sign -> fetch -> re-encode round trip runs on EVERY read_label call, so it needs its own
   * bounds rather than trusting the far end. Two checks, both a real fault (never "no label found"):
   * a declared size over MAX_PHOTO_BYTES is rejected WITHOUT reading the body, and an undeclared
   * size is still caught once the bytes are in hand — a header can be absent or simply wrong.
   */
  it('rejects an oversized photo by its declared content-length, without reading the body', async () => {
    const arrayBuffer = vi.fn(async () => new Uint8Array(0).buffer);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeImageResponse({ contentLength: 2_000_000, arrayBuffer })),
    );
    await expect(READ_LABEL.run(USER, { photo_ref: 'huge' })).rejects.toThrow(/too large/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects an oversized photo by its real size when no content-length was declared', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeImageResponse({ contentLength: null, bodyBytes: 2_000_000 })),
    );
    await expect(READ_LABEL.run(USER, { photo_ref: 'huge-undeclared' })).rejects.toThrow(/too large/);
  });

  it('calls fetch with an abort signal, so a stalled connection can actually be cancelled', async () => {
    const fetchMock = vi.fn(async () => fakeImageResponse());
    vi.stubGlobal('fetch', fetchMock);
    await READ_LABEL.run(USER, { photo_ref: 'ref1' });
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), { signal: expect.any(AbortSignal) });
  });

  it('aborts and reports a fault instead of hanging past the timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, opts?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }),
        ),
      );
      const runPromise = READ_LABEL.run(USER, { photo_ref: 'stalled' });
      const assertion = expect(runPromise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('read_label — render(): error, empty, and usage are three different texts', () => {
  it('a crashed run() (undefined) reads as a fault, never an empty result', () => {
    const out = READ_LABEL.render(undefined);
    expect(out).toMatch(/could not be read/i);
    expect(out).toMatch(/NOT an empty record/i);
  });

  it('no photo_ref (null) reads as a usage hint, not a fault', () => {
    const out = READ_LABEL.render(null);
    expect(out).toContain('photo_ref');
    expect(out).not.toMatch(/could not be read/i);
  });

  it('shares no meaningful wording between the fault and usage texts', () => {
    const fault = READ_LABEL.render(undefined).toLowerCase();
    const usage = READ_LABEL.render(null).toLowerCase();
    const overlap = usage
      .split(/\W+/)
      .filter((w) => w.length > 4)
      .filter((w) => fault.includes(w));
    expect(overlap).toEqual([]);
  });

  /** Error != empty != usage — this is the third state, and it must not collapse into either. */
  it('an unreadable label is a real, distinct answer — not a fault, not "nothing on file"', () => {
    const out = READ_LABEL.render({
      mode: 'nutrition_label',
      nutrition: { label_readable: false, candidate: mushroomCapture().candidate },
    });
    expect(out).not.toMatch(/could not be read/i);
    expect(out).not.toMatch(/NOT an empty record/i);
    expect(out).toMatch(/could not read a Nutrition Facts panel/i);
    expect(out).toMatch(/"mode": "identify"/);
  });

  it("renders full macros AND micros for a readable label, at the label's own printed serving", () => {
    const out = READ_LABEL.render({ mode: 'nutrition_label', nutrition: mushroomCapture() });
    expect(out).toContain('Dried Mixed Mushrooms');
    expect(out).toContain('The Wild Mushroom Co');
    expect(out).toContain('per 15 g');
    expect(out).toMatch(/40 kcal/);
    // MP12: potassium/calcium/iron must survive — the three the mushroom label prints.
    expect(out).toMatch(/250 potassium mg/);
    expect(out).toMatch(/10 calcium mg/);
    expect(out).toMatch(/0\.3 iron mg/);
    expect(out).toContain('Not saved yet');
  });

  it('names the label as the most authoritative source, right in what she reads (MP15)', () => {
    const out = READ_LABEL.render({ mode: 'nutrition_label', nutrition: mushroomCapture() });
    expect(out).toMatch(/most authoritative/);
  });

  it('identify mode with nothing legible points back at the panel instead of guessing', () => {
    const out = READ_LABEL.render({
      mode: 'identify',
      identify: { name: null, brand: null, confidence: 0.1, photo_ref: null },
    });
    expect(out).toMatch(/could not make out/i);
    expect(out).toMatch(/"mode": "nutrition_label"/);
  });

  it('identify mode with a real name renders it and routes back to nutrition_label for numbers', () => {
    const out = READ_LABEL.render({
      mode: 'identify',
      identify: { name: 'Dried Mixed Mushrooms', brand: 'The Wild Mushroom Co', confidence: 0.85, photo_ref: 'ref1' },
    });
    expect(out).toContain('Dried Mixed Mushrooms');
    expect(out).toContain('The Wild Mushroom Co');
    expect(out).toMatch(/85%/);
    expect(out).toMatch(/"mode": "nutrition_label"/);
  });
});

describe('read_label — rows()', () => {
  it('counts nothing for a missing, unreadable, or unnamed result', () => {
    expect(READ_LABEL.rows(null)).toBe(0);
    expect(READ_LABEL.rows(undefined)).toBe(0);
    expect(
      READ_LABEL.rows({
        mode: 'nutrition_label',
        nutrition: { label_readable: false, candidate: mushroomCapture().candidate },
      }),
    ).toBe(0);
    expect(
      READ_LABEL.rows({ mode: 'identify', identify: { name: null, brand: null, confidence: 0, photo_ref: null } }),
    ).toBe(0);
  });

  it('counts one for a real read, either mode', () => {
    expect(READ_LABEL.rows({ mode: 'nutrition_label', nutrition: mushroomCapture() })).toBe(1);
    expect(
      READ_LABEL.rows({ mode: 'identify', identify: { name: 'X', brand: null, confidence: 0.5, photo_ref: null } }),
    ).toBe(1);
  });
});

/**
 * Self-contained CI-shape checks (mirrors retrieval/description-audit.test.ts, which now covers
 * `read_label` for real via its registry.ts entry). Kept here too as a fast, local, single-file
 * regression guard against description drift — cheap redundancy, not a substitute.
 */
describe('read_label — description obeys the harness rules', () => {
  const BANNED: RegExp[] = [
    /\boccurrences?\b/i,
    /\bwindow\b/i,
    /Params:/,
    /\bprovenance\b/i,
    /\bcache(d)?\b/i,
    /\bdeterministic\b/i,
    /\bbaseline\b/i,
    /\bcaptured?\b/i,
    /\bbroker\b/i,
    /\bdossier\b/i,
    /\bjsonb?\b/i,
    /\bOFF\b/,
    /shared DB/i,
    /\blocked\b/i,
  ];

  it('says WHEN to use it and stays under the 520-char read cap', () => {
    expect(READ_LABEL.description).toMatch(/\bUse\b/);
    expect(READ_LABEL.description.length).toBeLessThanOrEqual(520);
  });

  it('teaches every parameter with a quoted example', () => {
    expect(READ_LABEL.description).toContain('"photo_ref"');
    expect(READ_LABEL.description).toContain('"mode"');
    expect(READ_LABEL.description).toContain('"hint"');
  });

  it('carries no jargon a model reading cold would not understand', () => {
    const hits = BANNED.filter((re) => re.test(READ_LABEL.description));
    expect(hits.map(String)).toEqual([]);
  });
});
