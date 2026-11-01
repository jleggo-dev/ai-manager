/**
 * The weekly fact review holds no write path to the facts (HARNESS-V3 C7: "it writes nothing to
 * the facts"). Read statically, from the source, so the guarantee does not depend on a test that
 * happens to exercise the right branch:
 *
 * - every fact-review*.ts file may import only from the modules listed here;
 * - from those, a name shaped like a write (WRITE_VERB) must be one of the two allowed writes —
 *   `noteFollowUp` (its findings) and `claimFactReviewWeek` (its run guard, on the recap) — and
 *   neither lives in a repo that holds facts;
 * - a repo name that is neither read-shaped nor an allowed write fails too, so a new verb cannot
 *   slip a write past the pattern;
 * - no raw `sql`, no namespace or default import of a repo, no dynamic import.
 *
 * Every pattern that decides the verdict is table-tested below with positives and near-misses.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const servicesDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(servicesDir, '..');

/** A function name that changes rows. Every verb a repo in this app uses for a write, and the obvious ones it may use next. */
const WRITE_VERB =
  /^(insert|update|delete|upsert|create|set|merge|close|mark|record|remove|rename|clear|touch|restore|stamp|save|prune|expire|claim|write|supersede|settle|retire|restart|repoint|put|pause|note|move|mint|heal|ensure|end|duplicate|dismiss|correct|commit|append|add|apply|replace|reset|toggle|confirm|enter|revise|patch|purge|archive|seed|sync|bump|increment|link|unlink|attach|detach|log|store|persist|assign)(?=[A-Z_0-9]|$)/;
/** A function name that only reads. */
const READ_VERB = /^(list|get|find|count|recent|search|sum|latest|last|load|read|fetch)(?=[A-Z_0-9]|$)/;

/** The repos holding facts the review reads. Nothing write-shaped may come out of these. */
const FACT_REPOS = ['repos/users.ts', 'repos/equipment.ts', 'repos/goals.ts', 'repos/episodes.ts'];
/** The only writes the review makes — neither touches a fact. */
const ALLOWED_WRITES: Record<string, string> = {
  noteFollowUp: 'repos/follow-ups.ts',
  claimFactReviewWeek: 'repos/recaps.ts',
};
/** Every module a fact-review file may import from (relative to src/), besides its own siblings. */
const ALLOWED_MODULES = [...FACT_REPOS, 'repos/follow-ups.ts', 'repos/recaps.ts', 'ai/aim.ts'];
/** From the AI module, only the job runner. */
const ALLOWED_FROM_AIM = ['runJobBySlug'];

interface Imported {
  name: string;
  from: string;
}

/**
 * The value bindings a file imports: `{ a, b as c, type T }` gives a and b (types are erased and
 * cannot write). Namespace and default imports come back as '*' so the caller can refuse them.
 */
function parseImports(source: string): Imported[] {
  const out: Imported[] = [];
  for (const m of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    if (m[1]) continue;
    for (const part of m[2]!.split(',')) {
      const spec = part.trim();
      if (!spec || /^type\s/.test(spec)) continue;
      out.push({ name: spec.split(/\s+as\s+/)[0]!.trim(), from: m[3]! });
    }
  }
  for (const m of source.matchAll(/import\s+(?!type\b)(\*\s+as\s+\w+|\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*'([^']+)'/g)) {
    out.push({ name: '*', from: m[2]! });
  }
  for (const m of source.matchAll(/\bimport\s*\(\s*['"`]([^'"`]+)/g)) out.push({ name: '*', from: m[1]! });
  return out;
}

/** Exported function names of a module — `export (async) function x` and `export const x = (…) =>`. */
function exportedFunctions(source: string): string[] {
  return [
    ...[...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/g)].map((m) => m[1]!),
    ...[...source.matchAll(/export\s+const\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/g)].map((m) => m[1]!),
  ];
}

const reviewFiles = readdirSync(servicesDir).filter((f) => /^fact-review.*\.ts$/.test(f) && !f.endsWith('.test.ts'));

/** `../repos/users.ts` seen from services/ → `repos/users.ts`; a sibling stays `services/x.ts`. */
const fromSrc = (spec: string): string =>
  path.relative(srcDir, path.resolve(servicesDir, spec)).split(path.sep).join('/');

describe('the write-verb pattern', () => {
  it.each([
    'insertEquipment',
    'updateGoal',
    'deleteEquipment',
    'deleteAllEquipment',
    'upsertRecap',
    'createDraft',
    'setGoalStatus',
    'mergeBaseline',
    'mergeCapturedConstraints',
    'closeFollowUp',
    'markRead',
    'recordCoachTurn',
    'removeCapturedConstraint',
    'renameCapturedConstraint',
    'noteFollowUp',
    'expireFollowUps',
    'endActiveEpisode',
    'retireGoal',
    'restoreGoal',
    'touchAssessedAt',
    'ensureUser',
    'claimPlanRun',
    'stampFoodSweep',
    'clearHomeLocation',
    'healConstraintsShape',
    'writeRecapForReview',
    'restartActiveWeek',
    'purgeUserAiData',
    'add_row',
  ])('catches %s', (name) => {
    expect(WRITE_VERB.test(name)).toBe(true);
  });

  it.each([
    'listEquipment',
    'getUser',
    'listGoals',
    'listEpisodeRanges',
    'listOpenFollowUps',
    'getActiveEpisode',
    'settingsFor',
    'updatedAt',
    'closestMatch',
    'markdownToText',
    'recordsFor',
    'noteworthy',
    'endsWith',
    'setup',
    'insertionPoint',
    'mergeable',
    'addressOf',
    'logical',
  ])('leaves %s alone', (name) => {
    expect(WRITE_VERB.test(name)).toBe(false);
  });

  it.each(['listGoals', 'getUser', 'findOpenMeal', 'countWaterDays', 'recentFeedback', 'latestHealthDigest'])(
    'reads: %s',
    (name) => {
      expect(READ_VERB.test(name)).toBe(true);
      expect(WRITE_VERB.test(name)).toBe(false);
    },
  );

  it.each(['listing', 'getaway', 'finder', 'counter', 'lastly'])(
    'a word that only starts like a read is not one: %s',
    (name) => {
      expect(READ_VERB.test(name)).toBe(false);
    },
  );
});

describe('the import parser', () => {
  it('reads named imports, aliases and multi-line braces, and skips type-only names', () => {
    const src = `import { a, b as c,\n  type T } from '../repos/x.ts';\nimport type { U } from '../repos/y.ts';`;
    expect(parseImports(src)).toEqual([
      { name: 'a', from: '../repos/x.ts' },
      { name: 'b', from: '../repos/x.ts' },
    ]);
  });

  it('reports namespace, default and dynamic imports as "*"', () => {
    const src = `import * as users from '../repos/users.ts';\nimport sql from '../db/sql.ts';\nconst m = await import('../repos/goals.ts');`;
    expect(parseImports(src).map((i) => `${i.name} ${i.from}`)).toEqual([
      '* ../repos/users.ts',
      '* ../db/sql.ts',
      '* ../repos/goals.ts',
    ]);
  });
});

describe('the fact review holds no write path to the facts', () => {
  const imports = reviewFiles.flatMap((file) =>
    parseImports(readFileSync(path.join(servicesDir, file), 'utf8'))
      .filter((i) => i.from.startsWith('.'))
      .map((i) => ({ file, name: i.name, module: fromSrc(i.from) })),
  );
  const external = imports.filter((i) => !/^services\/fact-review[^/]*\.ts$/.test(i.module));

  it('finds the files and the reads it is meant to make (a scan of nothing proves nothing)', () => {
    expect(reviewFiles).toEqual(expect.arrayContaining(['fact-review.ts', 'fact-review-trigger.ts']));
    expect(external.map((i) => i.name)).toEqual(
      expect.arrayContaining(['getUser', 'listEquipment', 'listGoals', 'listEpisodeRanges', 'noteFollowUp']),
    );
  });

  it('imports only from the allowed modules — never raw sql, never a whole module', () => {
    const bad = external.filter((i) => !ALLOWED_MODULES.includes(i.module) || i.name === '*');
    expect(bad).toEqual([]);
  });

  it('takes nothing write-shaped except its two allowed writes, each from its own module', () => {
    const bad = external.filter((i) => WRITE_VERB.test(i.name) && ALLOWED_WRITES[i.name] !== i.module);
    expect(bad).toEqual([]);
  });

  it('takes only read-shaped names from a repo, besides the allowed writes', () => {
    const bad = external.filter(
      (i) => i.module.startsWith('repos/') && !READ_VERB.test(i.name) && !(i.name in ALLOWED_WRITES),
    );
    expect(bad).toEqual([]);
  });

  it('takes only the job runner from the AI module', () => {
    const bad = external.filter((i) => i.module === 'ai/aim.ts' && !ALLOWED_FROM_AIM.includes(i.name));
    expect(bad).toEqual([]);
  });

  it('neither allowed write lives in a repo that holds facts', () => {
    for (const module of Object.values(ALLOWED_WRITES)) expect(FACT_REPOS).not.toContain(module);
  });

  it.each(FACT_REPOS)('every function %s exports is classified as a read or a write', (repo) => {
    const names = exportedFunctions(readFileSync(path.join(srcDir, repo), 'utf8'));
    expect(names.length).toBeGreaterThan(0);
    const unclassified = names.filter((n) => READ_VERB.test(n) === WRITE_VERB.test(n));
    // A new verb in a fact repo lands here: add it to WRITE_VERB (or READ_VERB if it only reads).
    expect(unclassified).toEqual([]);
  });
});
