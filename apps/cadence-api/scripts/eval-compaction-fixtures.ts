/**
 * The conversations the compaction eval replays (`eval-compaction.ts`).
 *
 * SYNTHETIC ON PURPOSE. No real coach conversation has reached the 75K trigger yet (the longest on
 * file is ~17K units, 2026-10-31), and a planted fact is the only kind whose right answer is known
 * without a judge. Each fixture plants one fact per item on `coach-compact`'s KEEP list — decided,
 * corrected, constraint, their own words, still open, tried and failed — among ordinary coaching
 * talk, then the eval checks which survived the summaries.
 *
 * The ordinary talk is built by `eval-compaction-filler.ts` from a pool per fixture
 * (`eval-compaction-pool-*.ts`): production-sized, varied, seeded, and kept off every planted topic.
 *
 * A probe matches when EVERY group in `expect` has at least one of its terms in the summary
 * (case-insensitive). Groups stay loose on wording — a summary is allowed to paraphrase — and
 * strict on the thing that would be wrong to lose: the day, the number, the word they used. A
 * correction also lists the value it replaced (`mustNotContain`); see `scoreFact` for the rule.
 */
import { practicePool } from './eval-compaction-pool-practice.ts';
import { foodPool } from './eval-compaction-pool-food.ts';
import { runningPool } from './eval-compaction-pool-running.ts';

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
  /**
   * Corrections only: the value the correction replaced. A summary that still states it on its
   * own fails the fact (`scoreFact`).
   */
  mustNotContain?: string[];
}

/** One thing people talk to the coach about, with enough wording that it can come back unrepeated. */
export interface FillerTopic {
  /** What they say: short to long, so a message can be picked to fit a length. */
  asks: string[];
  /** Her first sentence back. */
  opens: string[];
  /** The rest of her reply: sentences that each stand alone, so any few of them read as a reply. */
  points: string[];
}

export interface FillerPool {
  topics: FillerTopic[];
  /** Short asides they add to a message ("Long day."), so a message can run long without a new topic. */
  asides: string[];
  /** Questions she sometimes ends a reply on. */
  followUps: string[];
  /** Sentences about the week as a whole, for a reply that runs longer than its topic can carry. */
  wider: string[];
}

export interface CompactionFixture {
  id: string;
  title: string;
  exchanges: number;
  facts: PlantedFact[];
  /** Ordinary talk for every exchange that plants nothing. Must stay off every planted topic. */
  pool: FillerPool;
}

const running: CompactionFixture = {
  id: 'half-marathon',
  title: 'Training for a half marathon around a sore knee',
  exchanges: 80,
  pool: runningPool,
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
      expect: [['november 2', 'nov 2', 'nov. 2', '2 november', 'november 2nd']],
      mustNotContain: ['october 12', 'oct 12', 'oct. 12', '12 october', '12th october', '12th of october'],
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
      expect: [['6am', '6 am', '6 a.m', '6:00', 'early morning', 'early-morning', 'morning run']],
    },
  ],
};

const nourishment: CompactionFixture = {
  id: 'new-parent-food',
  title: 'Eating well with a newborn at home',
  exchanges: 80,
  pool: foodPool,
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
      mustNotContain: ['vegetarian'],
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
};

const practice: CompactionFixture = {
  id: 'meditation-and-piano',
  title: 'A daily sitting practice and returning to the piano',
  exchanges: 80,
  pool: practicePool,
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
        // Not "dropped": `drop` is one of mind-decision's terms (school drop-off).
        user: "Change of plan, I've stopped working on the Chopin. I'm learning Satie's first Gymnopédie instead.",
        coach: 'Gymnopédie No. 1 it is — slower, and kinder on the hands while you get back into it.',
      },
      probe: 'Which piece are they learning now?',
      expect: [['satie', 'gymnop']],
      mustNotContain: ['chopin', 'nocturne'],
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
};

export const COMPACTION_FIXTURES: CompactionFixture[] = [running, nourishment, practice];
