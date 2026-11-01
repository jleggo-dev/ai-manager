/**
 * Reading a meal photo in two steps, so the wait can show its work.
 *
 * One-stage photo logging asks a vision model for JSON and blocks 11–28s on it. Two-stage is
 * better — it commits to a portion, names its assumption, and calibrates its confidence honestly
 * (PLAN.md, 2026-08-21) — but it costs 40–70s, and a minute of spinner is not a feature.
 *
 * The owner's fix, and it is the right one: don't hide the wait, NARRATE it. "Any LLM message takes
 * time; the boredom is alleviated usually by seeing the stream of reasoning." So the pipeline is
 * split at its natural seam and exposed as two calls rather than one:
 *
 *   1. `readMealPhoto`          — upload, then ask the eyes what they see. Returns PLAIN TEXT,
 *                                 persists nothing but the photo.
 *   2. `previewMealFromReading` — the reading, as the person confirmed or corrected it, goes
 *                                 through the same coach-led read a typed meal gets
 *                                 (food-described-meal.ts: the phrase memory, the candidate book,
 *                                 one `food-check` call, the store's pricing). Rows come back for
 *                                 the card; nothing is written until the confirm.
 *
 * The client rotates its own copy during each call and shows the real reading in between, which is
 * what makes 60s feel like progress instead of a hang. Two calls rather than SSE because the seam
 * buys something a stream would not: **the user can correct the reading before any number is
 * computed from it.** That is the confirm step the brand asks for ("here's what I heard — did I get
 * it right?"), and it is free here rather than bolted on.
 *
 * THE READING'S SHAPE (the `describe-meal-photo` job, config/ai-admin/ai-admin.config.json): a few
 * plain sentences for the person — what it is, what the size was anchored to, what the eyes could
 * not tell — then a blank line, then the list: one line per food or drink, the amount first, in
 * the words a food list would use, nothing after it. `readingWords` reads the lines by SHAPE, not
 * by trusting that order: from the bottom, a run of lines that start with an amount is the list
 * and is split, looked up and priced exactly as typing "1 venti Starbucks latte, 1 medium banana"
 * is (FOOD-LOGGING-COACH-LED.md, build step 4); a line in or after the list that does not read as
 * a food, and any line past the caps, is handed back on `coach.not_read` for the card to show —
 * never dropped quietly. The sentences above the list are never looked up; they go to the
 * food-check call as its `notes` (bounded at NOTES_MAX), so a doubt the eyes flagged — "I cannot
 * tell whole or skim" — can become her question or her stated assumption for that part (owner,
 * 2026-11-01: "if it can't tell whole or skim milk, it should ask the user").
 *
 * NOTHING IS PERSISTED BY STEP 1 except the photo itself. A read that the user abandons leaves no
 * meal behind — which is why the row is inserted on the confirm and not before.
 */
import { runJobBySlug } from '../ai/aim.ts';
import { putMealPhoto, signMealPhotoUrl } from './meal-photos.ts';
import { logAi } from './ai-log.ts';
import { insertNutritionLog } from '../repos/nutrition.ts';
import { isMeal, parseMealResult, usageSlot, PROVISIONAL_BELOW } from './nutrition-parse.ts';
import { tickFoodLogOccurrence } from './nutrition.ts';
import { priceParsedMeal } from './food-pricing.ts';
import type { MealKind, Macros, NutritionLog } from '@cadence/shared';
import { enrichFlags } from './meal-enrich.ts';
import { MAX_PARTS, stripAmount } from './food-candidate-book.ts';
import { assertOwnPhotoRef } from './photo-validate.ts';
import {
  previewDescribedMeal,
  productionDeps,
  type DescribedMealDeps,
  type DescribedMealPreview,
} from './food-described-meal.ts';

export interface MealPhotoReading {
  photo_ref: string;
  /** The model's prose: what it is, how much, how it was prepared, what it could not tell. */
  reading: string;
  /** Set when the read failed. The caller may still log the meal from the caption alone. */
  error: string | null;
}

/**
 * Step 1 — the photo goes up, the eyes report back in prose.
 *
 * A failure here is NOT fatal and must not read as one: the user still took a photo and may still
 * have typed a caption, so the caller can go on to step 2 with an empty reading and log from words
 * alone. That is the same rule the one-stage path learned on 2026-08-20 — a meal never vanishes
 * because a model did.
 */
export async function readMealPhoto(
  userId: string,
  input: { photo: string; caption?: string; date?: string },
): Promise<MealPhotoReading> {
  // Same UTC day-stamp nutrition.ts uses, so a read and its log can never land on different days.
  const date = input.date || new Date().toISOString().slice(0, 10);
  const photo_ref = await putMealPhoto(userId, date, input.photo);

  try {
    const images = [await signMealPhotoUrl(photo_ref)];
    const res = await runJobBySlug(userId, 'describe-meal-photo', { caption: input.caption ?? '' }, { images });
    const raw = (res.formatted ?? res.raw ?? '').trim();
    // Plain text is what the job is asked for; a model that writes markdown anyway ("***", a bold
    // heading) is tidied here so the box the person edits never shows it. The RAW text is what is
    // logged, with a flag when the two differ, so whether the synced prompt fixed the leak or this
    // line is hiding it stays visible (the owner found the leak by looking, 2026-10-31).
    const reading = plainReading(raw);

    void logAi(userId, {
      kind: 'describe_meal_photo',
      input: { caption: input.caption ?? null },
      output: { raw: raw.slice(0, 2000) },
      meta: { photo: true, words: reading.split(/\s+/).filter(Boolean).length, markdown_stripped: raw !== reading },
    });

    return { photo_ref, reading, error: null };
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn('[nutrition] describe-meal-photo failed — the caller may still log from words:', error);
    void logAi(userId, {
      kind: 'describe_meal_photo',
      input: { caption: input.caption ?? null },
      output: { raw: '' },
      meta: { photo: true, failed: true, error },
    });
    return { photo_ref, reading: '', error };
  }
}

export interface ReadingLogInput {
  photo_ref: string;
  /** The reading AS THE USER IS WILLING TO STAND BEHIND IT — possibly edited. See below. */
  reading: string;
  caption?: string;
  meal?: MealKind;
  date?: string;
}

/**
 * Step 2 — prose to numbers, and the row.
 *
 * `reading` comes back from the CLIENT rather than being cached server-side, and that is the point
 * of splitting here rather than streaming: the user may have corrected it ("that's oat milk", "it
 * was the large one"), and a correction outranks anything the model saw. `parse-meal-description`
 * is told the user is right about WHAT it was and the photo is right about HOW MUCH, so an edited
 * reading wins exactly where it should.
 *
 * No image reaches this job, which means it takes the REMOTE path (see `runJobBySlug`: images ride
 * in-process only) — faster, and testable off a laptop that has no credential encryption key.
 *
 * Every failure rule the one-stage path learned on 2026-08-20 applies unchanged, because they were
 * learned the expensive way: the words survive a failed parse, a parse that produced no numbers is
 * PROVISIONAL rather than a settled zero-calorie meal, and the reason is kept rather than collapsed
 * into an empty string.
 */
export async function logMealFromReading(userId: string, input: ReadingLogInput): Promise<NutritionLog> {
  assertOwnPhotoRef(userId, input.photo_ref);
  const date = input.date || new Date().toISOString().slice(0, 10);
  const hint = input.meal && isMeal(input.meal) ? input.meal : undefined;

  let meal: MealKind = hint ?? 'other';
  let items: NutritionLog['items'] = [];
  let flags: NutritionLog['flags'] = {};
  let macros: Macros | null = null;
  let confidence: number | null = null;
  let rawOut = '';
  let parseFailed = false;
  let parseError: string | null = null;

  try {
    const res = await runJobBySlug(userId, 'parse-meal-description', {
      description: input.reading,
      meal_text: input.caption ?? '',
      meal_hint: input.meal ?? '',
    });
    rawOut = res.formatted ?? res.raw ?? '';
    const shaped = parseMealResult(rawOut, hint);
    meal = shaped.meal;
    items = shaped.items;
    flags = shaped.flags;
    macros = shaped.macros;
    confidence = shaped.confidence;
  } catch (e) {
    parseFailed = true;
    parseError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.warn('[nutrition] parse-meal-description failed — storing UNPARSED and provisional:', parseError);
  }

  // Same ledger pass as the words path (A23 §1a) — a photographed parfait and a spoken one resolve
  // to the same pinned food, so they cost the same and only get estimated once between them.
  const ledger = await priceParsedMeal(userId, { items, macros, confidence }, { slot: usageSlot(date, meal) });
  items = ledger.items;
  macros = ledger.macros;

  const noNumbers = !macros || Object.keys(macros).length === 0;
  const provisional =
    parseFailed ||
    noNumbers ||
    (!ledger.fully_priced && !!macros && confidence !== null && confidence < PROVISIONAL_BELOW);

  const row = await insertNutritionLog(userId, {
    date,
    meal,
    items,
    input_method: 'photo',
    ai_confidence: confidence,
    raw_text: input.caption || null,
    flags: { ...flags, ...enrichFlags(ledger.wants_research) },
    photo_ref: input.photo_ref,
    macros,
    provisional,
    // Kept so a number can be explained later, and corrected at its cause rather than its symptom.
    photo_reading: input.reading || null,
  });

  await tickFoodLogOccurrence(userId, date, meal);

  void logAi(userId, {
    kind: 'parse_meal_description',
    input: { caption: input.caption ?? null, reading_words: input.reading.split(/\s+/).filter(Boolean).length },
    output: { raw: rawOut.slice(0, 2000) },
    meta: {
      meal,
      items: items.length,
      confidence,
      macros: !!macros,
      provisional,
      two_stage: true,
      ...(parseFailed ? { parseFailed: true, parseError } : {}),
    },
  });

  return row;
}

/**
 * The markdown a model leaves in a text reading, taken off: bold and italic marks, heading marks,
 * bullet and numbering marks at the start of a line, and lines that are only a rule ("***", "---",
 * "* * *"). The words stay as they were; only the marks go. Deterministic, so the table test is
 * the contract.
 */
export function plainReading(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      // A rule line goes first, judged as written: stripping its marks first turned "* * *" into
      // an empty line, and an empty line splits the list in two.
      .filter((line) => !/^\s*(?:[*\-_=]\s*){3,}$/.test(line))
      .map((line) =>
        line
          .replace(/^\s*#{1,6}\s+/, '')
          .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
          .replace(/(\*\*|__)(.+?)\1/g, '$2')
          .replace(/(^|[\s(])[*_]([^*_\n]+?)[*_](?=$|[\s).,;:!?])/g, '$1$2')
          .replace(/`([^`]*)`/g, '$1')
          .trimEnd(),
      )
      .join('\n')
      .trim()
  );
}

/**
 * The most characters of a photo reading's list that are read. Ten lines (MAX_PARTS) of "amount,
 * brand, food" run to about half this; the rest is room for the person's own corrections. A line
 * past it is handed back as not read, never cut mid-word.
 */
export const PHOTO_WORDS_MAX = 1000;
/**
 * The most characters of the eyes' sentences that go to the coach's call. The reading's prose
 * runs to a few sentences; past this the trace says the notes were cut, so a doubt that fell off
 * the end is not a silent loss.
 */
export const NOTES_MAX = 500;

const NUMBER_WORD = /^(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|half|some|a few|a couple)\b/i;
const SENTENCE_END = /[.!?:;]$/;
/** More words than this is a sentence, whatever it starts with. */
const LINE_WORDS_MAX = 12;

/**
 * Does a line read as one line of the list — an amount, then a food — rather than a sentence?
 * A line that starts with a measure the split can peel does ("1 venti Starbucks latte", "150 g
 * chicken", "half a banana"); so does a short line that starts with a number word and does not end
 * like a sentence ("a banana", "two eggs"). "A tall cup with a sleeve, a venti by its height, and
 * a banana beside it." starts with a number word and is a sentence; "Compact Summary for Data
 * Entry:" is a heading; "Let me know if you'd like changes." is a sign-off. None is looked up.
 */
export function isFoodLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.split(/\s+/).length > LINE_WORDS_MAX) return false;
  if (stripAmount(t).measure) return true;
  return NUMBER_WORD.test(t) && !SENTENCE_END.test(t);
}

export interface ReadingWords {
  /** The list's lines, one a line — what is split, looked up and priced. */
  words: string;
  /** The sentences above the list — for the person, the log, and the coach's `notes`; never looked up. */
  notes: string;
  /** Lines in or after the list that do not read as a food, and lines past the caps — in their words. */
  not_read: string[];
}

/**
 * The words of a reading, read by shape from the bottom up.
 *
 * Below the list: lines that do not read as a food (a closing sentence, a sign-off) are not read,
 * and said so. The list: the run of lines up to the blank line above it; a line in that run that
 * does not read as a food (a heading the old prompt wrote, a stray sentence) is not read either,
 * and said so, while its neighbours still are. Above the blank: the eyes' notes. Then the caps,
 * which also say what they left out: lines past MAX_PARTS, then lines from the end until the list
 * fits PHOTO_WORDS_MAX. A reading with no blank line still reads: the prose the person left in is
 * not a food line and is reported, the lines that are foods are read. With no food line at all
 * (the read failed, prose only) the caption is the words, and every line is reported.
 */
export function readingWords(reading: string, caption?: string): ReadingWords {
  const lines = plainReading(reading)
    .split('\n')
    .map((l) => l.trim());
  let i = lines.length - 1;
  const tail: string[] = [];
  while (i >= 0 && !isFoodLine(lines[i]!)) {
    if (lines[i]) tail.push(lines[i]!);
    i -= 1;
  }
  const list: string[] = [];
  const inList: string[] = [];
  while (i >= 0 && lines[i]) {
    (isFoodLine(lines[i]!) ? list : inList).unshift(lines[i]!);
    i -= 1;
  }
  const notes = lines
    .slice(0, Math.max(i, 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const over = list.splice(MAX_PARTS);
  while (list.length > 1 && list.join('\n').length > PHOTO_WORDS_MAX) over.unshift(list.pop()!);
  const not_read = [...inList, ...tail.reverse(), ...over];
  if (list.length) return { words: list.join('\n'), notes, not_read };
  return { words: (caption ?? '').trim(), notes, not_read };
}

/**
 * Step 2 WITHOUT the row — the photo door's reading, read the way a typed meal is.
 *
 * `reading` comes back from the CLIENT rather than being cached server-side, and that is the point
 * of splitting here rather than streaming: the user may have corrected it ("that's oat milk", "it
 * was the large one"), and a correction outranks anything the model saw. What they confirmed is
 * what is read: the list's lines are the parts, and the same phrase memory, candidate book, one
 * `food-check` call and store pricing apply (food-described-meal.ts) — so a photo of a latte and a
 * banana produces the rows, the trace and the numbers that typing "a latte and a banana" does.
 * The eyes' sentences ride beside the list as the call's `notes`, so a doubt there becomes her
 * question or her assumption for that part. Lines that were not read come back on
 * `coach.not_read`, beside any the split itself left out, for the card to show.
 *
 * Writes nothing. The confirm goes through the `parsed` path (the draft's `appendParsed` with
 * `photo_ref` and `photo_reading`; nutrition.ts `logMeal({ parsed })` likewise) with each row's
 * `food_id` and `said`, like any described meal. Until 2026-11-01 this ran `parse-meal-description`
 * and the code-picked match: the model wrote the numbers and nobody saw what was found or rejected.
 */
export async function previewMealFromReading(
  userId: string,
  input: { reading: string; caption?: string; meal?: MealKind },
  deps: DescribedMealDeps = productionDeps(userId),
): Promise<DescribedMealPreview> {
  const { words, notes, not_read } = readingWords(input.reading, input.caption);
  if (!words) {
    // Both match the route's "a meal needs" → 400; the second says what shape would have read.
    throw new Error(
      not_read.length
        ? 'a meal needs a line that reads as a food — the amount first, then the food'
        : 'a meal needs a reading or a caption',
    );
  }
  const hint = input.meal && isMeal(input.meal) ? input.meal : undefined;
  const notesForCoach = notes.slice(0, NOTES_MAX);
  // The same `food_check` log row as the typed path, marked as the photo door's and carrying the
  // notes the eyes wrote above the list and the lines not read, so a number can be explained
  // later from what was and was not read. (`not_read` on the row is the split's own count.)
  const log: DescribedMealDeps['log'] = (entry) =>
    deps.log({
      ...entry,
      meta: {
        ...(entry.meta as Record<string, unknown>),
        photo: true,
        notes: notesForCoach,
        notes_cut: notes.length > NOTES_MAX,
        lines_not_read: not_read,
      },
    });
  const preview = await previewDescribedMeal(
    userId,
    words,
    hint,
    { ...deps, log },
    { maxChars: PHOTO_WORDS_MAX, notes: notesForCoach },
  );
  // The lines this reading left out join the split's own, so the card says everything in one
  // place; a cut of the notes is said in the trace, since a doubt past the cut never reached her.
  const checked =
    notes.length > NOTES_MAX
      ? [
          ...preview.coach.checked,
          `the photo's notes: the first ${NOTES_MAX} characters went to the coach, the rest did not`,
        ]
      : preview.coach.checked;
  return { ...preview, coach: { ...preview.coach, checked, not_read: [...preview.coach.not_read, ...not_read] } };
}
