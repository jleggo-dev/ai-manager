/**
 * `repoint-profile.ts --verify`: run the smoke eval on the new model, and put the old pointers
 * back if it misses (HARNESS-V3 C5.3).
 *
 * WHY WRITE FIRST. The design asked for the smoke to run against the new pointer BEFORE it is
 * written. AI Admin cannot do that today: a coach chat turn reads the model from the profile row on
 * every send (`chat-messaging-stream.ts`, `profile.external_ai_id`), and neither `openChatSession`
 * nor `sendChatMessage` takes a model override. `modelOverride` exists only on one-shot job
 * execution (`job-execution.ts`), which runs no tools and no tool loop, so it cannot run this eval.
 * The smoke drives the deployed cadence-api, which opens real coach sessions on the profile.
 * So --verify writes the new pointer, runs the smoke, and on a miss writes the old pointers back,
 * exactly as they were read before the write. For the length of the smoke run (~10 minutes) the
 * new model answers EVERY coach turn, real users included. Running it before the write would take
 * an engine change (a per-session model override); that is the owner's call, not built here.
 *
 * WHAT IT CANNOT PROVE. The failover: the coach chat never calls it (only job execution fails
 * over), so --verify only proves a new primary. Prove a failover with a live call.
 *
 * The decisions are pure functions so they can be table-tested; the spawn and the log are not.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const EVAL_SCRIPT = path.join(scriptsDir, 'eval-tool-selection.ts');
/** One JSON line per verified repoint, kept or reverted; committed with the config change. */
export const VERIFY_LOG = path.resolve(scriptsDir, '../../../config/ai-admin/repoint-log.jsonl');

/** What the smoke run reports through `eval-tool-selection.ts --json`. F1 is percentage points. */
export interface SmokeResult {
  f1: number | null;
  floor: number | null;
  graderOk: boolean;
  errors: number | null;
  models: string[];
  error?: string | null;
}

export interface VerifyPlan {
  /** The new primary, or null when only the failover is being changed. */
  primary: string | null;
  /** True when the profile is the one the coach chat job runs on. */
  isCoachProfile: boolean;
  floor: number | null;
  /** undefined: --force not given; '': given with no reason. */
  force: string | undefined;
  /** Why the eval cannot mint its throwaway user, or null when it can. */
  evalEnvProblem: string | null;
}

/**
 * Everything that can be refused BEFORE the pointer is touched. A refusal here costs nothing and
 * changes nothing; every check that can run first, runs first.
 */
export function preflight(p: VerifyPlan): { ok: true } | { ok: false; why: string } {
  if (p.force !== undefined && !p.force.trim()) {
    return { ok: false, why: '--force needs a reason in quotes, e.g. --force "owner ruled the smoke miss is noise"' };
  }
  if (!p.primary) {
    return {
      ok: false,
      why:
        '--verify proves a new PRIMARY. The coach chat never calls the failover (only job execution fails ' +
        'over), so the smoke cannot reach it. Prove a failover with a live call instead.',
    };
  }
  if (!p.isCoachProfile) {
    return {
      ok: false,
      why:
        'the smoke runs the coach chat, and this profile is not the one the coach chat job uses — a pass ' +
        'would say nothing about it. Repoint without --verify, and prove the model with a live call.',
    };
  }
  if (p.floor === null) {
    return {
      ok: false,
      why: 'no floor: the eval baseline holds no F1 and no --floor was given. Pass --floor <F1>.',
    };
  }
  if (p.evalEnvProblem) return { ok: false, why: `the smoke cannot run: ${p.evalEnvProblem}` };
  return { ok: true };
}

/**
 * Did the smoke run on the model it was meant to test? The stream reports the model id; a match in
 * either direction allows for a provider prefix or suffix. Null when no model was reported at all.
 */
export function modelMatches(models: string[], expected: string): boolean | null {
  if (!models.length) return null;
  const want = expected.trim().toLowerCase();
  return models.some((m) => {
    const got = m.trim().toLowerCase();
    return got.includes(want) || want.includes(got);
  });
}

export type VerifyAction = 'keep' | 'keep-forced' | 'revert';

/**
 * After the smoke: keep the new pointer, keep it because --force said so, or put the old one back.
 * A run that produced no F1, ran on a different model, or scored under the floor is a miss.
 */
export function decide(input: {
  result: SmokeResult | null;
  floor: number;
  force: string | undefined;
  expectedModel: string;
}): { action: VerifyAction; why: string } {
  const miss = missReason(input.result, input.floor, input.expectedModel);
  if (!miss) return { action: 'keep', why: `F1 ${input.result!.f1} is at or above the floor of ${input.floor}` };
  if (input.force?.trim()) return { action: 'keep-forced', why: `${miss}; kept anyway: ${input.force.trim()}` };
  return { action: 'revert', why: miss };
}

function missReason(result: SmokeResult | null, floor: number, expectedModel: string): string | null {
  if (!result) return 'the smoke run wrote no result (it crashed or was stopped)';
  if (result.error) return `the smoke run failed: ${result.error}`;
  if (!result.graderOk || result.f1 === null) {
    return 'no function call was observed anywhere in the smoke run (the model may not be serving tools)';
  }
  if (modelMatches(result.models, expectedModel) === false) {
    return `the smoke was answered by ${result.models.join(', ')}, not ${expectedModel}, so it proved nothing`;
  }
  if (result.f1 < floor) {
    return `F1 ${result.f1} is ${Math.round((floor - result.f1) * 10) / 10} points under the floor of ${floor}`;
  }
  return null;
}

/**
 * Run `eval-tool-selection.ts --smoke` as a child process with its output on this terminal, and
 * read back its JSON result. Null when it wrote none.
 */
export async function runSmoke(floor: number): Promise<SmokeResult | null> {
  const dir = path.join(os.tmpdir(), `repoint-smoke-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'result.json');
  await new Promise<void>((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', EVAL_SCRIPT, '--smoke', '--floor', String(floor), '--json', out],
      { stdio: 'inherit', cwd: path.resolve(scriptsDir, '..') },
    );
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
  try {
    return JSON.parse(readFileSync(out, 'utf8')) as SmokeResult;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface VerifyLogEntry {
  at: string;
  profile: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  floor: number;
  f1: number | null;
  models: string[];
  action: VerifyAction;
  why: string;
  force: string | null;
}

/** Append one line to the repoint log. Never throws: the pointer state matters more than the log. */
export function appendVerifyLog(entry: VerifyLogEntry, file = VERIFY_LOG): string | null {
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
    return file;
  } catch (e) {
    console.error(`could not write ${file}:`, e);
    return null;
  }
}
