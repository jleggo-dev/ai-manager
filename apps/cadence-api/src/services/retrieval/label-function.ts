/**
 * `read_label` — MP14. The Coach reads an attached photo with AI vision instead of guessing from
 * what she can see, or asking the person to retype a label by hand.
 *
 * The motivating artifact (PLAN.md, "Meal prep, end to end"): a dried-mushroom jar whose panel
 * reads "Per 15 pieces (15 g)" for a recipe that calls for 15 pieces — the label answers the exact
 * question, for the exact product, with no conversion. `POST /nutrition/foods/parse-label` and
 * `/identify` already do this (services/food-capture.ts, `parseNutritionLabel` / `identifyFood`,
 * both auth'd, validated, unit-tested) but had ZERO callers anywhere in the harness. This wraps
 * them as a tool she can call by name on a photo attached this turn (MP13's `photo_ref`).
 *
 * ONE tool, not two — TOOL-HARNESS's consolidation rule ("one tool with an action enum rather than
 * create_pr/review_pr/merge_pr"): `mode` picks which of the two jobs actually runs, the same
 * pattern `get_nutrition`'s facade already uses for four reads behind one door.
 *
 * `photo_ref` → a fresh data URL: `parseNutritionLabel`/`identifyFood` each take a raw
 * `data:image/...` string and upload it themselves (they were built for the client's direct-upload
 * flow); they do not accept an already-stored ref. Re-signing + fetching the existing photo and
 * re-encoding it is the seam that lets this wrap them UNCHANGED (services/food-capture.ts is
 * explicitly not this parcel's file to edit) rather than inventing a second upload path.
 *
 * A successful read is shaped through `toCandidate` (../food-source-report.ts, called with no
 * requested measure so it reports at the label's own preferred serving) — same `SourceCandidate`
 * shape `check_food_sources` reports, so a label read looks like every other source's answer, and
 * MP15's "most authoritative" note rides along automatically because the candidate's underlying
 * `source: 'label_photo'` triggers it in `candidateNotes`.
 */
import {
  identifyFood,
  parseNutritionLabel,
  type ParsedIdentifyCapture,
  type ParsedLabelCapture,
} from '../food-capture.ts';
import { signMealPhotoUrl } from '../meal-photos.ts';
import { MAX_PHOTO_BYTES } from '../photo-validate.ts';
import { toCandidate, type SourceCandidate } from '../food-source-report.ts';
import { boundToolResponse, toolFaultText } from '../tool-response.ts';
import type { FoodNutrients } from '@cadence/shared';
import type { RetrievalFunction } from './types.ts';

type ReadMode = 'nutrition_label' | 'identify';

interface LabelRunResult {
  mode: ReadMode;
  nutrition?: ParsedLabelCapture;
  identify?: ParsedIdentifyCapture;
}

/** Bounds on the re-sign → fetch → re-encode round trip — this runs on every read_label call. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * `parseNutritionLabel`/`identifyFood` only take a raw `data:image/...` string (they upload it
 * themselves). A `photo_ref` names a photo ALREADY in Storage — re-sign it for a fresh short-lived
 * URL, fetch the bytes back, and re-wrap them as a data URL. Bounded two ways: a 10s timeout
 * (`AbortController`, same pattern `DevsAiV2Client.chatCompletionStream` already uses) so a stalled
 * fetch cannot hang the turn, and a size cap — `MAX_PHOTO_BYTES` (photo-validate.ts), the SAME limit
 * `putMealPhoto` already enforces at upload time, checked from `content-length` where the storage
 * response sends one and again against the real buffer either way, since a header can be absent or
 * wrong. Throws on any failure (unknown ref, signing error, timeout, oversized, non-image
 * content-type); the caller lets that propagate so `executeCalls` marks the call a genuine FAULT
 * rather than an empty result — an unreadable photo is not "no label found" (see render() below).
 */
async function dataUrlFromPhotoRef(photoRef: string): Promise<string> {
  const signedUrl = await signMealPhotoUrl(photoRef, 300);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(signedUrl, { signal: controller.signal });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    throw new Error(`could not read the attached photo (${timedOut ? 'timed out' : 'network error'})`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`could not read the attached photo (storage returned ${res.status})`);

  const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (!mime || !/^image\/(jpeg|jpg|png|webp)$/.test(mime)) {
    throw new Error(`attached photo has an unsupported type (${mime || 'unknown'})`);
  }
  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PHOTO_BYTES) {
    throw new Error(`attached photo is too large (${declaredLength} bytes)`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_PHOTO_BYTES) throw new Error(`attached photo is too large (${buffer.length} bytes)`);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

const NUTRIENT_LABELS: ReadonlyArray<[keyof FoodNutrients, string, number]> = [
  ['kcal', 'kcal', 0],
  ['protein_g', 'protein', 1],
  ['carbs_g', 'carbs', 1],
  ['fat_g', 'fat', 1],
  ['fiber_g', 'fibre', 1],
  ['sodium_mg', 'sodium mg', 0],
  ['iron_mg', 'iron mg', 1],
  ['calcium_mg', 'calcium mg', 0],
  ['potassium_mg', 'potassium mg', 0],
  ['zinc_mg', 'zinc mg', 1],
  ['vitamin_c_mg', 'vit C mg', 1],
  ['vitamin_b12_ug', 'B12 µg', 1],
];

function nutrientLine(n: FoodNutrients): string {
  const parts: string[] = [];
  for (const [key, label, dp] of NUTRIENT_LABELS) {
    const v = n[key];
    if (typeof v === 'number') parts.push(`${Number(v.toFixed(dp))} ${label}`);
  }
  return parts.length ? parts.join(' · ') : 'no numbers on this record';
}

/**
 * `label_readable` is the job's own honest verdict, not a guess by this file — "the panel was
 * unreadable" and "nothing on file" must read as different facts (TOOL-HARNESS step 4 / this
 * parcel's non-negotiables). A real read renders through `toCandidate` (no requested measure, so it
 * reports at the label's own preferred serving) so MP12's micronutrients (potassium/calcium/iron)
 * and MP15's authority note both survive untouched.
 */
function renderLabel(cap: ParsedLabelCapture): string {
  if (!cap.label_readable) {
    return (
      'Looked at the attached photo but could not read a Nutrition Facts panel on it — too blurry, ' +
      'cropped, or this may be a front-of-package shot instead of the panel. Call read_label again ' +
      'with {"mode": "identify"} on the same photo_ref for the product name and brand, or ask for a ' +
      'clearer photo of the nutrition panel. This is not the same as the food having no numbers.'
    );
  }
  const c: SourceCandidate = toCandidate(cap.candidate, 'label');
  const pct = Math.round((cap.candidate.confidence ?? 0) * 100);
  const lines = [
    `[label] ${[c.brand, c.name].filter(Boolean).join(' ') || 'Unnamed product'} — per ${c.per.measure}, read confidence ${pct}%`,
    `    ${nutrientLine(c.per.nutrients)}`,
  ];
  for (const note of c.notes) lines.push(`    ! ${note}`);
  lines.push('Not saved yet — this is a read; use the food-save path if it should become a real food.');
  return lines.join('\n');
}

/** Name/brand only — no macros. Mirrors renderLabel's readable/unreadable split. */
function renderIdentify(id: ParsedIdentifyCapture): string {
  if (!id.name && !id.brand) {
    return (
      'Looked at the attached photo but could not make out a product name or brand on it. If this ' +
      'is actually the Nutrition Facts panel, call read_label again with {"mode": "nutrition_label"} ' +
      'on the same photo_ref instead.'
    );
  }
  const pct = Math.round(id.confidence * 100);
  return (
    `[label:identify] ${[id.brand, id.name].filter(Boolean).join(' ')} — name/brand only, confidence ${pct}%. ` +
    'Call read_label again with {"mode": "nutrition_label"} on the same photo_ref for the numbers.'
  );
}

export const READ_LABEL: RetrievalFunction = {
  name: 'read_label',
  description:
    'Reads a photo attached to this turn with AI vision: a nutrition panel\'s macros and nutrients at its own printed serving, or a front-of-package shot\'s name and brand. Use it when the exact printed numbers matter more than a web or database guess — a photographed label is the most authoritative source for that exact product. Pass {"photo_ref": "..."} from the attached photo; add {"mode": "identify"} for a front-of-package photo (default "nutrition_label"), or {"hint": "Wild Mushroom Co"} to help a hard read.',
  domains: ['nutrition', 'foods'],

  async run(userId, params) {
    const photoRef = typeof params?.photo_ref === 'string' ? params.photo_ref.trim() : '';
    if (!photoRef) return null;
    const mode: ReadMode = params?.mode === 'identify' ? 'identify' : 'nutrition_label';
    const rawHint = typeof params?.hint === 'string' ? params.hint.trim() : '';
    const hint = rawHint || undefined;

    const dataUrl = await dataUrlFromPhotoRef(photoRef);
    if (mode === 'identify') {
      return { mode, identify: await identifyFood(userId, { photo: dataUrl, hint }) } satisfies LabelRunResult;
    }
    return { mode, nutrition: await parseNutritionLabel(userId, { photo: dataUrl, hint }) } satisfies LabelRunResult;
  },

  render(result) {
    // `undefined` = run() threw (bad photo_ref, storage error, job error) → a real fault, never
    // rendered as an empty result. `null` = no photo_ref was given at all → usage.
    if (result === undefined) return toolFaultText('That image');
    if (result === null) {
      return (
        'read_label: pass {"photo_ref": "..."} — the id of this turn\'s attachment. ' +
        'There is none to read without it.'
      );
    }
    const r = result as LabelRunResult;
    const text = r.mode === 'identify' ? renderIdentify(r.identify!) : renderLabel(r.nutrition!);
    return boundToolResponse(text);
  },

  rows(result) {
    if (!result) return 0;
    const r = result as LabelRunResult;
    if (r.mode === 'identify') return r.identify?.name || r.identify?.brand ? 1 : 0;
    return r.nutrition?.label_readable ? 1 : 0;
  },
};
