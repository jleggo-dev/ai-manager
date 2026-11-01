/**
 * Builds a fixture's whole conversation for the compaction eval: the planted facts at their
 * exchanges, ordinary talk everywhere else, and how much injected context sits beside each
 * exchange. Seeded, so every run and every machine gets the same conversation.
 *
 * WHY IT IS BUILT THIS WAY (P3b, 2026-10-31). The first fixtures were about a third of real length,
 * so no round came near the 10,000-character cap the engine puts on a job variable, which real
 * rounds hit. One filler line ("nuts — not peanuts") repeated a dozen times, so the peanut allergy
 * scored as kept against a summary that held only filler. And a counter in the filler ("Note 58")
 * came back in summaries as "ratings increasing up to 58". Now every length is drawn from what
 * production measures, every exchange is put together from a pool of distinct asks and reply
 * sentences, and nothing carries a counter.
 */
import type { CompactionFixture, Exchange, FillerPool, FillerTopic } from './eval-compaction-fixtures.ts';

/**
 * Sizes in characters, measured on the AI Admin DB: coach sessions, last 60 days (2026-10-31).
 * `context` is the injected context sent beside one exchange.
 */
export const PRODUCTION_SIZES = {
  user: { mean: 87, p90: 181 },
  coach: { mean: 446, p50: 340, p90: 893 },
  context: { mean: 3_100, p90: 12_500 },
} as const;

export type Rng = () => number;

/** mulberry32 over an FNV-1a hash of the seed: tiny, and the same sequence everywhere. */
export function seededRng(seed: string): Rng {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gaussian = (rng: Rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const logNormal = (rng: Rng, median: number, sigma: number) => median * Math.exp(sigma * gaussian(rng));
const clamp = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n)));

/**
 * Target lengths, fitted to PRODUCTION_SIZES.
 *  - Messages and replies are long-tailed, so log-normal. Replies: median 340 and p90 893 give
 *    sigma 0.75, whose mean (~450) matches the measured 446. Messages: mean 87 and p90 181 give
 *    median 60, sigma 0.86.
 *  - Injected context is not one curve: a p90 four times the mean means most turns carry a little
 *    and about one in eight carries a lot (a plan or a tool result). So one exchange in every
 *    eight gets a big block, 11.5K–15.5K, and the rest are log-normal around 1.35K. The big ones
 *    are spread one per eight-exchange stretch rather than drawn independently: drawn
 *    independently they bunched, and one fixture compacted at exchange 23 while another waited
 *    until 51, so a fixture's reading depended on where its seed happened to cluster them.
 * The composed text lands near the target, not on it; `eval-compaction-fixtures.test.ts` checks
 * the lengths that come out against production.
 */
export const sampleUserChars = (rng: Rng) => clamp(logNormal(rng, 60, 0.86), 12, 600);
export const sampleCoachChars = (rng: Rng) => clamp(logNormal(rng, 340, 0.75), 60, 2_400);
export const BIG_CONTEXT_EVERY = 8;
export const sampleContextChars = (rng: Rng, big: boolean) =>
  big ? clamp(11_500 + 4_000 * rng(), 11_500, 15_500) : clamp(logNormal(rng, 1_350, 0.6), 300, 9_000);

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Does adding `extra` characters bring a text of `len` closer to `target`? */
const closer = (len: number, extra: number, target: number) => Math.abs(len + extra - target) < Math.abs(len - target);

/** Topics in shuffled rounds, every topic once per round, never the same one twice in a row. */
function topicDealer(topics: readonly FillerTopic[], rng: Rng): () => FillerTopic {
  let deck: FillerTopic[] = [];
  let last: FillerTopic | undefined;
  return () => {
    if (!deck.length) {
      deck = shuffle(topics, rng);
      // The next topic comes off the END of the deck.
      if (deck.length > 1 && deck[deck.length - 1] === last) [deck[0], deck[deck.length - 1]] = [last!, deck[0]!];
    }
    last = deck.pop()!;
    return last;
  };
}

/**
 * Their message: the topic's ask nearest the target length, among the asks this topic has not used
 * since it last used them all, then up to two asides — one before, one after — when they bring it
 * nearer the target.
 */
function composeAsk(topic: FillerTopic, unused: string[], pool: FillerPool, target: number, rng: Rng): string {
  if (!unused.length) unused.push(...topic.asks);
  unused.sort((a, b) => Math.abs(a.length - target) - Math.abs(b.length - target));
  let text = unused.shift()!;
  const [before, after] = shuffle(pool.asides, rng);
  if (before && closer(text.length, before.length + 1, target)) text = `${before} ${text}`;
  if (after && closer(text.length, after.length + 1, target)) text = `${text} ${after}`;
  return text;
}

/**
 * Her reply: one of the topic's openings, then its points in a fresh order while they bring the
 * reply nearer the target — then, for a long reply, sentences about the week as a whole — and
 * sometimes a closing question. A blank line every three sentences, as her longer replies have.
 */
function composeReply(topic: FillerTopic, pool: FillerPool, target: number, rng: Rng): string {
  const sentences = [topic.opens[Math.floor(rng() * topic.opens.length)]!];
  let len = sentences[0]!.length;
  const add = (candidates: string[]) => {
    for (const s of candidates) {
      if (!closer(len, s.length + 1, target)) continue;
      sentences.push(s);
      len += s.length + 1;
    }
  };
  add(shuffle(topic.points, rng));
  // Only a reply that has used every point of its topic goes on to the week as a whole.
  if (sentences.length === topic.points.length + 1) add(shuffle(pool.wider, rng));
  const followUp = pool.followUps[Math.floor(rng() * pool.followUps.length)]!;
  if (rng() < 0.5 && closer(len, followUp.length + 1, target)) sentences.push(followUp);
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) paragraphs.push(sentences.slice(i, i + 3).join(' '));
  return paragraphs.join('\n\n');
}

export interface ConversationTurn {
  exchange: Exchange;
  /** Characters of injected context sent beside this exchange. */
  contextChars: number;
  /** The planted fact this exchange carries (its plant, or the earlier value a correction replaces). */
  factId?: string;
}

/**
 * The fixture's conversation, exchange by exchange. Lengths, context sizes and wording each draw
 * from their own seeded stream, so editing a pool's wording leaves every target length and context
 * size where it was: the rounds move only as far as the new wording's lengths move them (an
 * exchange or so), not to wherever a reshuffled seed would put them.
 */
export function composeConversation(fixture: CompactionFixture): ConversationTurn[] {
  const planted = new Map<number, { exchange: Exchange; factId: string }>();
  for (const f of fixture.facts) {
    planted.set(f.at, { exchange: f.plant, factId: f.id });
    if (f.before) planted.set(f.before.at, { exchange: f.before, factId: f.id });
  }
  const contextRng = seededRng(`${fixture.id}:context`);
  const lengthRng = seededRng(`${fixture.id}:lengths`);
  const textRng = seededRng(`${fixture.id}:text`);
  const nextTopic = topicDealer(fixture.pool.topics, textRng);
  const unusedAsks = new Map<FillerTopic, string[]>();

  const turns: ConversationTurn[] = [];
  let bigAt = -1;
  for (let i = 0; i < fixture.exchanges; i++) {
    if (i % BIG_CONTEXT_EVERY === 0) bigAt = i + Math.floor(contextRng() * BIG_CONTEXT_EVERY);
    const contextChars = sampleContextChars(contextRng, i === bigAt);
    const userTarget = sampleUserChars(lengthRng);
    const coachTarget = sampleCoachChars(lengthRng);
    const fact = planted.get(i);
    if (fact) {
      turns.push({
        exchange: { user: fact.exchange.user, coach: fact.exchange.coach },
        contextChars,
        factId: fact.factId,
      });
      continue;
    }
    const topic = nextTopic();
    if (!unusedAsks.has(topic)) unusedAsks.set(topic, []);
    const user = composeAsk(topic, unusedAsks.get(topic)!, fixture.pool, userTarget, textRng);
    const coach = composeReply(topic, fixture.pool, coachTarget, textRng);
    turns.push({ exchange: { user, coach }, contextChars });
  }
  return turns;
}

/** Every string a pool can put into a conversation, for the checks that must hold whatever the seed. */
export const poolStrings = (pool: FillerPool): string[] => [
  ...pool.topics.flatMap((t) => [...t.asks, ...t.opens, ...t.points]),
  ...pool.asides,
  ...pool.followUps,
  ...pool.wider,
];
