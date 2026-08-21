/**
 * REPORTING — the table, and the caveats printed beside it rather than in a doc nobody opens.
 *
 * Every score line carries its case's truth level. A `caption-only` case cannot tell you whether
 * 320 kcal was right, only that a number arrived; printing those two side by side without the
 * label is how a harness starts lying politely.
 */
import type { FoodVisionCase } from './eval-food-vision-cases.ts';
import type { DescriptionScore, MacroScore } from './eval-food-vision-score.ts';

export interface CaseResult {
  case: FoodVisionCase;
  model: string;
  description?: string;
  desc?: DescriptionScore;
  describeMs?: number;
  describeError?: string;
  baseline?: MacroScore;
  baselineRaw?: string;
  baselineMs?: number;
  baselineError?: string;
  twoStage?: MacroScore;
  twoStageRaw?: string;
  twoStageMs?: number;
  twoStageError?: string;
  describeInTokens?: number | null;
  converter?: string;
}

const pct = (n: number | null | undefined) => (n == null ? '  — ' : `${String(Math.round(n * 100)).padStart(3)}%`);
const ms = (n: number | undefined) => (n == null ? '   —' : `${(n / 1000).toFixed(1)}s`);
const yn = (b: boolean | undefined) => (b === undefined ? '—' : b ? 'yes' : 'NO ');

function describeRow(r: CaseResult): string {
  const d = r.desc;
  if (r.describeError) return `  ${r.model.padEnd(26)} ERROR  ${r.describeError.slice(0, 60)}`;
  if (!d) return `  ${r.model.padEnd(26)} (not run)`;
  const flags = [
    d.refused ? 'REFUSED' : '',
    d.invented.length ? `INVENTED:${d.invented.join(',')}` : '',
    d.missed.length ? `missed:${d.missed.join(',')}` : '',
  ]
    .filter(Boolean)
    .join('  ');
  return `  ${r.model.padEnd(26)} recall ${pct(d.recall)}  anchored ${yn(d.anchored)}  hedged ${yn(d.hedged)}  ${String(d.words).padStart(4)}w  ${ms(r.describeMs)}   ${flags}`;
}

function macroRow(label: string, m: MacroScore | undefined, err: string | undefined, t: number | undefined): string {
  if (err) return `  ${label.padEnd(26)} ERROR  ${err.slice(0, 60)}`;
  if (!m) return `  ${label.padEnd(26)} (not run)`;
  if (!m.parsed) return `  ${label.padEnd(26)} NO JSON  (${m.parseError})  ${ms(t)}`;
  const kcal = m.kcal == null ? '—' : String(m.kcal);
  const err_ = m.kcalErrorPct == null ? '' : `  (±${m.kcalErrorPct}% vs truth)`;
  const empty = m.hasNumbers ? '' : '  ← EMPTY: the 0-kcal bug';
  return `  ${label.padEnd(26)} kcal ${kcal.padStart(5)}  protein ${String(m.proteinG ?? '—').padStart(4)}g  items ${m.itemCount}  conf ${m.confidence ?? '—'}  ${ms(t)}${err_}${empty}`;
}

export function printReport(results: CaseResult[], opts: { sweeping: boolean; verbose: boolean }): void {
  const byCase = new Map<string, CaseResult[]>();
  for (const r of results) {
    const list = byCase.get(r.case.key) ?? [];
    list.push(r);
    byCase.set(r.case.key, list);
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(
    opts.sweeping
      ? 'STAGE-1 MODEL SWEEP — direct provider calls, NOT the app path'
      : 'APP PIPELINE — one-stage baseline vs two-stage',
  );
  console.log('='.repeat(100));

  for (const [key, list] of byCase) {
    const c = list[0]!.case;
    console.log(`\n${key}  [truth: ${c.truth}]  caption: ${JSON.stringify(c.caption)}`);
    console.log(`  expected: ${c.components.map((x) => x.name).join(', ')}`);
    console.log('  — stage 1: what it SAW —');
    for (const r of list) console.log(describeRow(r));

    if (list.some((r) => r.baseline || r.twoStage || r.baselineError || r.twoStageError)) {
      console.log('  — numbers —');
      for (const r of list) {
        if (opts.sweeping) console.log(`  · ${r.model}`);
        console.log(macroRow('one-stage (today)', r.baseline, r.baselineError, r.baselineMs));
        console.log(macroRow(`two-stage (→${r.converter ?? 'job'})`, r.twoStage, r.twoStageError, r.twoStageMs));
      }
    }

    if (opts.verbose) {
      for (const r of list) {
        if (!r.description) continue;
        console.log(`\n  ── ${r.model} said ──`);
        console.log(
          r.description
            .split('\n')
            .map((l) => `  │ ${l}`)
            .join('\n'),
        );
      }
    }
  }

  // Aggregates only where they mean something: recall averages over cases with components.
  const scored = results.filter((r) => r.desc && r.desc.recall != null);
  if (scored.length) {
    console.log(`\n${'-'.repeat(100)}`);
    const byModel = new Map<string, CaseResult[]>();
    for (const r of scored) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
    for (const [model, rs] of byModel) {
      const recall = rs.reduce((a, r) => a + (r.desc!.recall ?? 0), 0) / rs.length;
      const anchored = rs.filter((r) => r.desc!.anchored).length;
      const invented = rs.reduce((a, r) => a + r.desc!.invented.length, 0);
      const refused = rs.filter((r) => r.desc!.refused).length;
      console.log(
        `${model.padEnd(28)} recall ${pct(recall)}   anchored ${anchored}/${rs.length}   invented ${invented}   refused ${refused}`,
      );
    }
  }

  const anyUnverified = results.some((r) => r.case.truth === 'caption-only');
  console.log(`\n${'-'.repeat(100)}`);
  if (anyUnverified) {
    console.log('CAVEAT: cases marked [caption-only] have no verified nutrition. kcal accuracy is SKIPPED for');
    console.log('those, not scored — a number appearing is not a number being right. Fill in the truth in');
    console.log('eval-food-vision-cases.ts (the person who ate it is the only source) to turn those on.');
  }
  console.log(`${results.length} run(s) over ${byCase.size} case(s). Small n: read the transcripts (--verbose).`);
}
