/**
 * What the tool-selection eval prints — the per-case line, the aggregate, and the grader gate.
 * Split from `eval-tool-selection.ts` so the runner is only about driving turns; every judgement
 * about how to READ a run lives here.
 *
 * The numbers are deliberately plain. There is no composite "score", because a single figure is
 * the thing that gets quoted in a standup and then optimised against — and the two rates below
 * (silence where a tool was needed, firing where none was) are the ones that name real bugs.
 */
import { CASES, META_TOOLS, PROVIDER_BUILTINS, type EvalCase } from './eval-tool-selection-cases.ts';

export interface Outcome {
  c: EvalCase;
  called: string[];
  /** Provider UI hints seen and discarded — noise, reported so a new one cannot hide. */
  builtins: string[];
  invented: string[];
  missing: string[];
  /** Reads she never called because the Broker had already fetched them for this turn. */
  viaPrefetch: string[];
  extra: string[];
  violations: string[];
  argProblems: string[];
  pass: boolean;
  promptTokens: number | null;
  totalCompletion: number;
  ms: number;
  reply: string;
  model: string | null;
  prefetched: string[] | null;
  error?: string;
}

/** Did she promise the action in prose instead of taking it? A hint for the reader, never a score
 *  — this is the exact shape of the 2026-08-16 failure ("yes, let me swap it now", no call). */
const NARRATION =
  /\b(let me|i'?ll|i will|i can|i'?ve|shall i)\b[^.!?]{0,80}\b(chang|mov|updat|swap|adjust|log|record|set|drop|shift|push)/i;

export function header(): void {
  console.log(
    `\n${' '.repeat(3)}${'case'.padEnd(8)}${'kind'.padEnd(8)}${'tools she called'.padEnd(47)}${'prompt'.padStart(9)}\n`,
  );
}

export function line(o: Outcome): void {
  const mark = o.error ? '💥' : o.pass ? '✓ ' : '✗ ';
  const tok = o.promptTokens ? `${o.promptTokens.toLocaleString('en-US')} in` : '? in';
  console.log(
    `${mark} ${o.c.id.padEnd(7)} ${o.c.kind.padEnd(7)} ${(o.called.join(', ') || '(nothing)').padEnd(46)} ${tok.padStart(9)} ${(o.ms / 1000).toFixed(0)}s`,
  );
  if (o.error) console.log(`      error: ${o.error.slice(0, 200)}`);
  if (o.missing.length)
    console.log(
      `      MISSED  ${o.missing.join(', ')}${o.c.expect.length && !o.called.length ? '  (called nothing at all)' : ''}`,
    );
  if (o.viaPrefetch.length)
    console.log(`      via broker  ${o.viaPrefetch.join(', ')} — fetched for her, so not a miss`);
  if (o.extra.length) console.log(`      EXTRA   ${o.extra.join(', ')}`);
  if (o.violations.length) console.log(`      FORBID  ${o.violations.join(', ')}`);
  if (o.invented.length) console.log(`      INVENTED ${o.invented.join(', ')}`);
  for (const p of o.argProblems) console.log(`      ARGS    ${p}`);
  if (o.prefetched?.length) console.log(`      broker prefetched: ${o.prefetched.join(', ')}`);
  if (!o.pass && o.missing.length && NARRATION.test(o.reply)) {
    console.log(`      narrated it instead: "${o.reply.replace(/\s+/g, ' ').slice(0, 130)}…"`);
  }
}

const rate = (n: number, d: number): string => (d === 0 ? '—' : `${((n / d) * 100).toFixed(0)}% (${n}/${d})`);

/** Micro-averaged over SELECTIONS, not cases — a turn that needed two tools counts twice. */
function selection(outcomes: Outcome[], serial: boolean): void {
  const byCall = outcomes.reduce((n, o) => n + o.c.expect.filter((t) => o.called.includes(t)).length, 0);
  const byBroker = outcomes.reduce((n, o) => n + o.viaPrefetch.length, 0);
  const tp = byCall + byBroker;
  const fn = outcomes.reduce((n, o) => n + o.missing.length, 0);
  const fp = outcomes.reduce((n, o) => n + o.extra.length + o.violations.length, 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  console.log('\n══ SELECTION ══');
  console.log(`  precision  ${(precision * 100).toFixed(1)}%   (${tp} right, ${fp} unasked-for)`);
  console.log(`  recall     ${(recall * 100).toFixed(1)}%   (${tp} right, ${fn} missed)`);
  console.log(`  F1         ${(f1 * 100).toFixed(1)}%`);
  console.log(`  cases clean ${rate(outcomes.filter((o) => o.pass).length, outcomes.length)}`);
  if (byBroker) {
    console.log(`\n  ${byBroker} of those ${tp} arrived because the BROKER prefetched them, not because she asked.`);
    console.log('  Read that as the split HARNESS-V2 predicts: reads are context, actions are hers.');
  }
  if (!serial) {
    console.log('\n  ⚠ ran at concurrency >1, so no prefetch attribution — every read miss here is unexplained.');
  }
}

function failureModes(outcomes: Outcome[]): void {
  const shouldFire = outcomes.filter((o) => o.c.expect.length > 0);
  const shouldNot = outcomes.filter((o) => o.c.expect.length === 0);
  // The MCP-Atlas headline, and it has to mean "nothing reached the turn" rather than "she was
  // quiet": a read the Broker had already fetched is not a no-tool-use failure.
  const silent = shouldFire.filter((o) => o.called.length === 0 && o.missing.length > 0);
  const falseTrig = shouldNot.filter((o) => o.extra.length + o.violations.length > 0);

  console.log('\n══ THE TWO FAILURE MODES ══');
  console.log(
    `  called NOTHING where a tool was needed  ${rate(silent.length, shouldFire.length)}${silent.length ? `  → ${silent.map((o) => o.c.id).join(', ')}` : ''}`,
  );
  console.log(
    `  fired where nothing was needed          ${rate(falseTrig.length, shouldNot.length)}${falseTrig.length ? `  → ${falseTrig.map((o) => o.c.id).join(', ')}` : ''}`,
  );

  console.log('\n══ BY KIND ══');
  for (const kind of ['action', 'read', 'silence', 'canary'] as const) {
    const g = outcomes.filter((o) => o.c.kind === kind);
    if (g.length) console.log(`  ${kind.padEnd(8)} ${rate(g.filter((o) => o.pass).length, g.length)}`);
  }

  const invented = [...new Set(outcomes.flatMap((o) => o.invented))];
  const builtins = [...new Set(outcomes.flatMap((o) => o.builtins))];
  const argProblems = outcomes.filter((o) => o.argProblems.length);
  if (invented.length) console.log(`\n  invented tool names: ${invented.join(', ')}`);
  if (argProblems.length) console.log(`  right tool, wrong arguments: ${argProblems.map((o) => o.c.id).join(', ')}`);
  if (builtins.length) {
    console.log(`  provider UI hints seen and ignored: ${builtins.join(', ')} (Devs.ai's own, not ours)`);
  }
}

function cost(outcomes: Outcome[], wallMs: number, concurrency: number): void {
  const tokens = outcomes.map((o) => o.promptTokens).filter((t): t is number => typeof t === 'number');
  const median = tokens.length ? [...tokens].sort((a, b) => a - b)[Math.floor(tokens.length / 2)]! : 0;
  console.log('\n══ COST ══');
  console.log(
    tokens.length
      ? `  prompt tokens/turn  median ${median.toLocaleString('en-US')}  ·  min ${Math.min(...tokens).toLocaleString('en-US')}  ·  max ${Math.max(...tokens).toLocaleString('en-US')}`
      : '  prompt tokens/turn  (upstream reported none — the stream shape may have changed)',
  );
  console.log(
    `  total in  ${tokens.reduce((a, b) => a + b, 0).toLocaleString('en-US')} tokens across ${outcomes.length} turns`,
  );
  console.log(`  total out ${outcomes.reduce((n, o) => n + o.totalCompletion, 0).toLocaleString('en-US')} tokens`);
  console.log(`  wall      ${(wallMs / 1000 / 60).toFixed(1)} min at concurrency ${concurrency}`);
  console.log(
    `  model     ${[...new Set(outcomes.map((o) => o.model).filter(Boolean))].join(', ') || '(not reported)'}`,
  );
}

export function summarize(outcomes: Outcome[], wallMs: number, concurrency: number): void {
  selection(outcomes, concurrency === 1);
  failureModes(outcomes);
  cost(outcomes, wallMs, concurrency);
}

/**
 * The instrument check, before any of the above is allowed to mean anything.
 *
 * THE GATE IS "NOTHING AT ALL", not "the canary missed". Two canaries were rejected before this
 * rule was written (the history is in `eval-tool-selection-cases.ts`), and both times a single
 * case's miss suppressed a report that was fine. One case is a data point; a run that saw NO
 * function call anywhere while several cases expected one is the actual signature of definitions
 * not reaching the model, or of this script failing to read the stream. That is what halts a run.
 *
 * `CAN-POS` still earns its place — it is the likeliest case in the set to fire, so its miss is
 * worth a loud line — but it warns rather than suppresses.
 */
export function graderVerdict(outcomes: Outcome[]): boolean {
  const expectedAny = outcomes.filter((o) => o.c.expect.length > 0);
  const sawAnyCall = outcomes.some((o) => o.called.length > 0);
  const canary = outcomes.find((o) => o.c.id === 'CAN-POS');

  if (!sawAnyCall && expectedAny.length > 0) {
    console.log('\n🛑 GRADER SUSPECT — not one function call was observed, across every case that needed one.');
    console.log('   That is an instrument signature, not a model one: either the deployment is not');
    console.log('   attaching tool definitions, or this script cannot read a function_call off the');
    console.log('   stream. Every miss above is unexplained until it is fixed — check the stream shape');
    console.log('   first (probe-tool-loop.ts), not the case set.');
    return false;
  }
  if (canary && !canary.called.includes(canary.c.expect[0] ?? '')) {
    console.log(`\n⚠ CAN-POS missed ${canary.c.expect[0]} — the plainest action request in the set.`);
    console.log('   Calls WERE seen elsewhere, so the harness can observe them and this is hers, not');
    console.log('   ours. Read it as the strongest single signal in the run, and read her reply.');
    return true;
  }
  if (sawAnyCall)
    console.log("\n✓ calls were observed, so silence on any given case is the model's and not the harness's.");
  return true;
}

/** `--dry`: the case table, the local definition budget, and a drift check. Costs nothing. */
export async function dryRun(cases: EvalCase[], known: Set<string>): Promise<void> {
  const { coachToolDefinitions } = await import('../src/services/coach-tools.ts');
  const defs = coachToolDefinitions();
  const chars = JSON.stringify(defs).length;
  console.log(`${cases.length} case(s) · no network, nothing spent\n`);
  for (const c of cases) {
    console.log(
      `  ${c.id.padEnd(7)} ${c.kind.padEnd(7)} expect ${(c.expect.join(', ') || '(nothing)').padEnd(24)} "${c.turn.slice(0, 74)}"`,
    );
  }
  console.log(
    `\nLOCAL tool definitions (your tree, not the deployment): ${defs.length} tools, ${chars.toLocaleString('en-US')} chars ≈ ${Math.round(chars / 4).toLocaleString('en-US')} tokens per turn.`,
  );
  console.log('The run reports the DEPLOYED figure from the wire, which is the one that counts.');

  // A renamed or dropped tool would otherwise land in the report as an INVENTED name and read as a
  // hallucination — the cases would be wrong and the model would take the blame. Checked here
  // because --dry is free, so there is no reason to find out mid-run.
  //
  // Compare against what the harness will HONOUR, which is what `known` already is: derived from
  // both tiers (#291). It is NOT `coachToolDefinitions()` — that is Layer 1 alone, because the long
  // tail is reached through find_tools/use_tool and the dossier reads ride the pack as Broker
  // prefetches. Diffing against that subset marked all nineteen tail-and-prefetch names "gone" on
  // every run ever made, above a line telling you not to trust the run — while a live run was
  // calling `get_journal`, one of the nineteen, perfectly well. A check that can never be silent is
  // not a check; it buries the drift it exists to catch.
  //
  // So it reads the half that is not structural. `known` is derived and cannot rot; `expect`,
  // `allow`, `forbid` and `args.tool` are hand-written strings, and nothing stops one naming a tool
  // that has since been renamed or hidden. Read from CASES rather than the selected `cases`, so
  // `--only` narrows what is RUN without narrowing what is checked.
  const named = new Set(
    CASES.flatMap((c) => [...c.expect, ...(c.allow ?? []), ...(c.forbid ?? []), ...(c.args ? [c.args.tool] : [])]),
  );
  const gone = [...named].filter((t) => !known.has(t));
  // META_TOOLS are the discovery path, not a selection — no case should ever name them, so their
  // absence is the design working rather than a hole in coverage.
  const meta = new Set<string>(META_TOOLS);
  const untested = [...known].filter((t) => !named.has(t) && !PROVIDER_BUILTINS.has(t) && !meta.has(t));
  if (gone.length) {
    console.log('\n⚠ the case file names tools the harness will not honour:');
    console.log(`   ${gone.join(', ')}`);
    console.log('   Each one scores correct behaviour as a miss AND an invention. Fix the cases before running.');
  }
  if (untested.length) {
    console.log(`\n· reachable, but no case exercises it: ${untested.join(', ')}`);
  }
}
