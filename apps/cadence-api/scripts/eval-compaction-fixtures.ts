/**
 * The conversations the compaction eval replays (`eval-compaction.ts`).
 *
 * SYNTHETIC ON PURPOSE. No real coach conversation has reached the 75K trigger yet (the longest on
 * file is ~17K units, 2026-10-31), and a planted fact is the only kind whose right answer is known
 * without a judge. Each fixture plants one fact per item on `coach-compact`'s KEEP list — decided,
 * corrected, constraint, their own words, still open, tried and failed — among ordinary coaching
 * talk, then the eval checks which survived the summaries.
 *
 * A probe matches when EVERY group in `expect` has at least one of its terms in the summary
 * (case-insensitive). Groups stay loose on wording — a summary is allowed to paraphrase — and
 * strict on the thing that would be wrong to lose: the day, the number, the word they used.
 */

export const FACT_KINDS = ['decision', 'correction', 'constraint', 'own-words', 'open', 'tried-failed'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface Exchange {
  user: string;
  coach: string;
}

export interface PlantedFact {
  id: string;
  kind: FactKind;
  /** 0-based exchange index this fact is planted at. */
  at: number;
  plant: Exchange;
  /** A correction overrides something said earlier: planted at `before.at`. */
  before?: Exchange & { at: number };
  /** What a later turn would need to know, in words. Shown in the report. */
  probe: string;
  expect: string[][];
}

export interface CompactionFixture {
  id: string;
  title: string;
  exchanges: number;
  facts: PlantedFact[];
  /** Ordinary talk, cycled to fill every exchange that plants nothing. `{n}` becomes a counter. */
  filler: Exchange[];
}

const running: CompactionFixture = {
  id: 'half-marathon',
  title: 'Training for a half marathon around a sore knee',
  exchanges: 80,
  facts: [
    {
      id: 'run-decision',
      kind: 'decision',
      at: 6,
      plant: {
        user: "OK let's do it — Thursdays become the easy 30 minute run and Sunday is the long one.",
        coach: "Done: Thursday is an easy 30 minutes, Sunday is the long run. I'll hold you to the 'easy' part.",
      },
      probe: 'Which day is the easy run, and how long?',
      expect: [['thursday'], ['30', 'thirty', 'half hour', 'half-hour']],
    },
    {
      id: 'run-correction',
      kind: 'correction',
      at: 38,
      before: {
        at: 9,
        user: 'Race day is October 12th, the Harbourfront Half.',
        coach: 'October 12th, Harbourfront Half — that gives us a good runway.',
      },
      plant: {
        user: "Correction — the race moved. It's November 2nd now, not October.",
        coach: 'Got it: November 2nd. That buys us three extra weeks, so the build can be gentler.',
      },
      probe: 'When is the race?',
      expect: [['november 2', 'nov 2', '2 november', 'november 2nd']],
    },
    {
      id: 'run-constraint',
      kind: 'constraint',
      at: 14,
      plant: {
        user: 'My left knee aches going down stairs, has since the spring. Running flat is fine.',
        coach:
          "Thanks for telling me. We'll keep hills and stairs out for now and watch how the left knee feels after long runs.",
      },
      probe: 'What do we work around?',
      expect: [['knee'], ['left'], ['stair', 'downhill', 'hill']],
    },
    {
      id: 'run-own-words',
      kind: 'own-words',
      at: 31,
      plant: {
        user: 'Heads up, the last week of every month is a "crunch week" at work — I barely sleep.',
        coach: 'Crunch weeks noted. Those weeks we keep it to two short runs and nothing hard.',
      },
      probe: 'What do they call the busy last week of the month?',
      expect: [['crunch week']],
    },
    {
      id: 'run-open',
      kind: 'open',
      at: 42,
      plant: {
        user: "I'm not sure whether to buy the new shoes before the race or not.",
        coach:
          "Let's decide that once you've done two long runs in the old pair — ask me again after the 18K. Still open for now.",
      },
      probe: 'What is still undecided?',
      expect: [['shoe']],
    },
    {
      id: 'run-tried',
      kind: 'tried-failed',
      at: 22,
      plant: {
        user: 'I tried the 6am runs last week. Total disaster, I skipped three of four.',
        coach: "Early mornings didn't work — fair enough. Evenings after work it is.",
      },
      probe: 'What did they try that did not work?',
      expect: [['6am', '6 am', '6:00', 'early morning', 'early-morning', 'morning run']],
    },
  ],
  filler: [
    {
      user: 'Did the run today, felt okay. Legs a bit heavy at the end. Day {n}.',
      coach:
        "Heavy legs at the end of a run that felt okay is normal at this stage. Keep the pace conversational next time and we'll see if that changes.",
    },
    {
      user: 'How much water should I bring on longer runs?',
      coach:
        'For anything over an hour, a small bottle or a loop past a fountain is plenty. Sip every 15–20 minutes rather than waiting until you are thirsty.',
    },
    {
      user: 'Rest day today. Went for a walk with the dog instead. Check-in {n}.',
      coach: 'A walk on a rest day is perfect — it keeps things moving without asking anything of your legs.',
    },
    {
      user: 'Should I stretch before or after?',
      coach:
        'A few minutes of easy movement before — leg swings, a slow first kilometre — and save the longer stretches for after, when you are warm.',
    },
    {
      user: 'Run felt great today, honestly. Kept it slow like you said. Week note {n}.',
      coach: "That's the one to remember. Slow and great is exactly how the base gets built.",
    },
    {
      user: 'What should I eat before a long run?',
      coach:
        'Something you know sits well, an hour or two before — toast with banana, oats, a bagel. Nothing new on a long-run morning.',
    },
  ],
};

const nourishment: CompactionFixture = {
  id: 'new-parent-food',
  title: 'Eating well with a newborn at home',
  exchanges: 80,
  facts: [
    {
      id: 'food-decision',
      kind: 'decision',
      at: 5,
      plant: {
        user: "Yes — Sunday batch-cook it is, two big pots, and that's lunches Monday to Wednesday.",
        coach: 'Agreed: Sunday batch-cook, two pots, covering lunches Monday through Wednesday.',
      },
      probe: 'What did we agree for lunches?',
      expect: [['sunday'], ['batch', 'cook', 'pots']],
    },
    {
      id: 'food-correction',
      kind: 'correction',
      at: 36,
      before: {
        at: 8,
        user: "I'm vegetarian, so no meat ideas please.",
        coach: 'Vegetarian — got it. Lentils, eggs, tofu and beans will do a lot of the work.',
      },
      plant: {
        user: "Small update: I'm eating fish again, so pescatarian now. Salmon is back on the menu.",
        coach: 'Pescatarian now — great, salmon and sardines open up a lot of easy dinners.',
      },
      probe: 'What do they eat now?',
      expect: [['pescatarian', 'eats fish', 'eating fish', 'fish again']],
    },
    {
      id: 'food-constraint',
      kind: 'constraint',
      at: 12,
      plant: {
        user: "Important: I'm allergic to peanuts. Proper allergy, I carry an EpiPen.",
        coach: "Thank you — peanuts are out completely, and I'll flag anything that might contain them.",
      },
      probe: 'Any allergies?',
      expect: [['peanut']],
    },
    {
      id: 'food-own-words',
      kind: 'own-words',
      at: 29,
      plant: {
        user: 'The 3am feed is when I raid the pantry. I call it "the vulture hour".',
        coach: "The vulture hour — I love that. Let's leave something good out for it so it isn't whatever's nearest.",
      },
      probe: 'What do they call the 3am pantry raid?',
      expect: [['vulture hour']],
    },
    {
      id: 'food-open',
      kind: 'open',
      at: 40,
      plant: {
        user: 'Should I be taking iron? My midwife mentioned it but I never followed up.',
        coach:
          "That's one for your midwife or doctor — they can check your levels. Let me know what they say and we'll build around it. Open until then.",
      },
      probe: 'What are we waiting to hear back on?',
      expect: [['iron']],
    },
    {
      id: 'food-tried',
      kind: 'tried-failed',
      at: 20,
      plant: {
        user: 'The meal kit subscription was a bust — the boxes sat in the fridge and went off.',
        coach: "Meal kits didn't stick, noted. We'll keep it to things that survive a missed day.",
      },
      probe: 'What did they try that did not work?',
      expect: [['meal kit', 'meal-kit', 'subscription', 'box']],
    },
  ],
  filler: [
    {
      user: 'Ate okay today, mostly toast and coffee though. Day {n}.',
      coach:
        'Toast and coffee days happen with a newborn. Could a handful of nuts — not peanuts — or yoghurt sit next to the kettle?',
    },
    {
      user: 'How much water am I meant to drink when breastfeeding?',
      coach:
        "Drink to thirst, and keep a full glass wherever you usually feed — it's the easiest way to get enough without counting.",
    },
    {
      user: 'Had a proper dinner tonight! Partner cooked. Note {n}.',
      coach: 'A proper dinner counts. Anything from it worth doubling next time so there are leftovers?',
    },
    {
      user: 'Any ideas for one-handed breakfasts?',
      coach: 'Overnight oats in a jar, a boiled egg, a banana with cheese, a wrap rolled the night before.',
    },
    {
      user: 'Skipped lunch again, the baby would not settle. Check-in {n}.',
      coach: "That's a hard day, not a failure. Tomorrow, let's have lunch be something already made.",
    },
    {
      user: 'Is it bad that I snack all day instead of meals?',
      coach: 'Not at all right now. Grazing on good things is a perfectly good way to eat with a newborn.',
    },
  ],
};

const practice: CompactionFixture = {
  id: 'meditation-and-piano',
  title: 'A daily sitting practice and returning to the piano',
  exchanges: 80,
  facts: [
    {
      id: 'mind-decision',
      kind: 'decision',
      at: 4,
      plant: {
        user: "Let's say ten minutes sitting, right after I drop the kids at school. Every weekday.",
        coach: 'Settled: ten minutes of sitting each weekday, straight after school drop-off.',
      },
      probe: 'When and how long is the sit?',
      expect: [
        ['ten minutes', '10 minutes', '10-minute', 'ten-minute', '10 min'],
        ['drop', 'school'],
      ],
    },
    {
      id: 'mind-correction',
      kind: 'correction',
      at: 37,
      before: {
        at: 10,
        user: "The piece I'm working on is the Chopin nocturne in E-flat.",
        coach: 'The E-flat nocturne — lovely. We can take it a phrase at a time.',
      },
      plant: {
        user: "Change of plan, I've dropped the Chopin. I'm learning Satie's first Gymnopédie instead.",
        coach: 'Gymnopédie No. 1 it is — slower, and kinder on the hands while you get back into it.',
      },
      probe: 'Which piece are they learning now?',
      expect: [['satie', 'gymnop']],
    },
    {
      id: 'mind-constraint',
      kind: 'constraint',
      at: 15,
      plant: {
        user: 'I have tinnitus, so silent sits get loud. I need some sound in the room.',
        coach: "Thank you for saying. We'll use a soft sound in the background — rain or a fan — rather than silence.",
      },
      probe: 'What do we work around for sitting?',
      expect: [['tinnitus']],
    },
    {
      id: 'mind-own-words',
      kind: 'own-words',
      at: 28,
      plant: {
        user: 'When my thoughts spin like that I call it "the washing machine".',
        coach:
          'The washing machine — good name. When it starts, just notice "washing machine" and come back to the breath.',
      },
      probe: 'What do they call spinning thoughts?',
      expect: [['washing machine']],
    },
    {
      id: 'mind-open',
      kind: 'open',
      at: 43,
      plant: {
        user: "I can't decide whether to join the Thursday group sit at the library.",
        coach: "No rush. Try one and tell me how it felt — we'll decide after that. It's still open.",
      },
      probe: 'What is still undecided?',
      expect: [['group'], ['library', 'thursday']],
    },
    {
      id: 'mind-tried',
      kind: 'tried-failed',
      at: 21,
      plant: {
        user: 'Sitting before bed did not work. I just fell asleep every single time.',
        coach: "Bedtime sits turned into naps — fair. Mornings suit you better, so let's keep it there.",
      },
      probe: 'What did they try that did not work?',
      expect: [
        ['bed', 'night', 'evening'],
        ['asleep', 'sleep'],
      ],
    },
  ],
  filler: [
    {
      user: 'Sat for ten minutes today. Mind was all over the place. Day {n}.',
      coach: 'All over the place and you still sat — that is the practice. Noticing the wandering is the rep.',
    },
    {
      user: 'Played scales for fifteen minutes, fingers are stiff.',
      coach: 'Stiff fingers after a break are expected. Slow scales, hands separately, and stop before it aches.',
    },
    {
      user: 'Missed today, busy morning. Check-in {n}.',
      coach: "A missed day is just a missed day. Tomorrow's sit is still there.",
    },
    {
      user: 'Is it okay to sit in a chair instead of on the floor?',
      coach: 'Completely. A chair with your feet flat is as good a seat as any cushion.',
    },
    {
      user: 'Practised the left hand alone tonight. Note {n}.',
      coach: 'Hands separately is how it gets solid. Keep the tempo slow enough that it is easy.',
    },
    {
      user: 'Does it matter if I keep my eyes open?',
      coach:
        'Not at all — eyes softly open, gaze resting on the floor a little ahead of you, works well for many people.',
    },
  ],
};

export const COMPACTION_FIXTURES: CompactionFixture[] = [running, nourishment, practice];
