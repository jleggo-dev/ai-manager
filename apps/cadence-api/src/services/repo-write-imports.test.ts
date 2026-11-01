/**
 * A tool that declares `mutates: 'none'` never imports a repo function that writes
 * (HARNESS-V3 C4; TOOL-HARNESS.md backlog #7, "negative assertions").
 *
 * The other gates say what a tool set DOES contain. This one says what the read half must not: a
 * write path. Without it, a later refactor that lets `get_*` "just fix up" a row on its way past is
 * invisible to every check we have — the description still says it reads, `mutates` still says
 * `'none'`, and the user's data changes on a turn where she only looked.
 *
 * "Write" is decided by the exported function's leading verb, over every export of every module in
 * `src/repos/`. Every verb in use must be on one of the two lists below, so a repo function with a
 * new verb fails here until someone decides which it is — a new write cannot be filed as a read by
 * default.
 *
 * Scope, stated honestly: this reads the DIRECT imports of the files that hold `'none'` tools —
 * every source file in `retrieval/`, and `coach-meta-tools.ts` for `find_tools`. A read that reaches
 * a write through a service module (research_food's write-back to the food ledger is the known,
 * intended one) is not followed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { COACH_META_TOOLS } from './coach-meta-tools.ts';
import { FIND_TOOLS_NAME } from './coach-tool-tiers.ts';

const HOW = 'see docs/cadence/TOOL-HARNESS.md → backlog #7, and repo-write-imports.test.ts';

/** Verbs that change a row. `resolve` and `ensure` are here because both find-or-CREATE in repos/. */
const WRITE_VERBS = new Set([
  'insert', 'update', 'upsert', 'delete', 'remove', 'create', 'set', 'clear', 'close', 'note',
  'record', 'mark', 'merge', 'rename', 'restore', 'retire', 'save', 'touch', 'stamp', 'prune',
  'expire', 'claim', 'write', 'supersede', 'settle', 'restart', 'repoint', 'put', 'pause', 'move',
  'duplicate', 'mint', 'heal', 'ensure', 'end', 'dismiss', 'correct', 'commit', 'append', 'resolve',
]); // prettier-ignore

/** Verbs that only read. `collection` and `portion` name pure derivations (a key, a median). */
const READ_VERBS = new Set([
  'list', 'get', 'find', 'count', 'search', 'sum', 'recent', 'last', 'latest', 'feedback',
  'portion', 'collection',
]); // prettier-ignore

/** The leading lower-case word of an exported name; null for a constant like FOLLOW_UP_ID_PREFIX. */
const verbOf = (name: string): string | null => name.match(/^[a-z]+/)?.[0] ?? null;

type Kind = 'write' | 'read' | 'constant' | 'unknown';
function classify(name: string): Kind {
  const verb = verbOf(name);
  if (!verb) return 'constant';
  if (WRITE_VERBS.has(verb)) return 'write';
  if (READ_VERBS.has(verb)) return 'read';
  return 'unknown';
}

describe('which repo exports count as writes — by leading verb', () => {
  it.each([
    ['insertGoalEvent', 'write'],
    ['setPendingPlan', 'write'],
    ['upsertRepertoireItem', 'write'],
    ['closeFollowUp', 'write'],
    ['noteFollowUp', 'write'],
    ['recordCheckIn', 'write'],
    ['settleNotification', 'write'],
    ['settleWeek', 'write'], // "settle" writes in this codebase (settleNotification) — not a read
    ['ensureUser', 'write'], // find-or-create
    ['resolveCollectionByName', 'write'], // find-or-create: it calls createCollection
    ['endActiveEpisode', 'write'],
    ['getSettings', 'read'], // the brief's near-miss: a getter, whatever it is called
    ['listGoals', 'read'],
    ['sumWaterMl', 'read'],
    ['portionConsensus', 'read'],
    ['collectionKey', 'read'],
    // Near-misses: a name that STARTS with a write verb's letters is not that verb.
    ['settingsFor', 'unknown'], // "settings", not "set" or "settle"
    ['closestGoal', 'unknown'], // "closest", not "close"
    ['endpointFor', 'unknown'], // "endpoint", not "end"
    ['notesFor', 'unknown'], // "notes", not "note"
    ['updatedSince', 'unknown'], // "updated", not "update"
    ['FOLLOW_UP_ID_PREFIX', 'constant'],
  ] as const)('%s → %s', (name, kind) => {
    expect(classify(name)).toBe(kind);
  });
});

const SERVICES = new URL('./', import.meta.url);
const REPOS = new URL('../repos/', import.meta.url);
const RETRIEVAL = new URL('./retrieval/', import.meta.url);
const isSource = (f: string): boolean => f.endsWith('.ts') && !f.endsWith('.test.ts');

/** Exported runtime names of one module: functions and consts (types carry no behaviour). */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/^export (?:async )?function\*? (\w+)|^export const (\w+)/gm)) {
    names.push((m[1] ?? m[2])!);
  }
  return names;
}

/** `{ a, b as c, type D }` from every static `import … from '<…>/repos/<module>.ts'`, by module. */
function repoImports(source: string): Array<{ module: string; name: string }> {
  const out: Array<{ module: string; name: string }> = [];
  for (const m of source.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/gm)) {
    const repo = m[3]!.match(/\/repos\/([\w-]+)\.ts$/)?.[1];
    if (m[1] || !repo) continue;
    for (const spec of m[2]!.split(',')) {
      const name = spec
        .trim()
        .split(/\s+as\s+/)[0]!
        .trim();
      if (name && !name.startsWith('type ')) out.push({ module: repo, name });
    }
  }
  return out;
}

describe("no 'none' tool imports a repo write", () => {
  const repoExports = new Map<string, string[]>(
    readdirSync(REPOS)
      .filter(isSource)
      .map((f) => [f.replace(/\.ts$/, ''), exportedNames(readFileSync(new URL(f, REPOS), 'utf8'))]),
  );

  it('every repo export has a decided verb — a new verb must be filed as a read or a write', () => {
    const undecided: string[] = [];
    for (const [module, names] of repoExports) {
      for (const n of names) if (classify(n) === 'unknown') undecided.push(`repos/${module}.ts: ${n}`);
    }
    expect(undecided, `${HOW} — add each verb to WRITE_VERBS or READ_VERBS`).toEqual([]);
  });

  it('the scan finds writes to look for (it is reading the real repos)', () => {
    const writes = [...repoExports.values()].flat().filter((n) => classify(n) === 'write');
    expect(writes.length).toBeGreaterThan(50);
  });

  /** Every retrieval function is a read by type; this pins that their whole directory is. */
  it("every retrieval function and find_tools declare 'none'", () => {
    expect(Object.values(RETRIEVAL_FUNCTIONS).filter((f) => f.mutates !== 'none')).toEqual([]);
    expect(COACH_META_TOOLS[FIND_TOOLS_NAME]!.mutates).toBe('none');
  });

  it("no file holding a 'none' tool imports a repo function that writes", () => {
    const files = [
      ...readdirSync(RETRIEVAL)
        .filter(isSource)
        .map((f) => ({ label: `retrieval/${f}`, url: new URL(f, RETRIEVAL) })),
      // find_tools lives here beside use_tool; neither imports a repo today, and a write here would
      // sit one door away from a tool that promises it only searches.
      { label: 'coach-meta-tools.ts', url: new URL('coach-meta-tools.ts', SERVICES) },
    ];
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const { label, url } of files) {
      for (const { module, name } of repoImports(readFileSync(url, 'utf8'))) {
        if (classify(name) === 'write') offenders.push(`${label} imports ${name} from repos/${module}.ts`);
      }
    }
    expect(offenders, HOW).toEqual([]);
  });

  it('the import reader sees multi-line imports, renames, and skips type-only ones', () => {
    const src = [
      "import { getUser } from '../../repos/users.ts';",
      'import {',
      '  listGoals,',
      '  updateGoal as patch,',
      '  type Goal,',
      "} from '../../repos/goals.ts';",
      "import type { Plan } from '../../repos/plans.ts';",
      "import { renderX } from '../render.ts';",
    ].join('\n');
    expect(repoImports(src)).toEqual([
      { module: 'users', name: 'getUser' },
      { module: 'goals', name: 'listGoals' },
      { module: 'goals', name: 'updateGoal' },
    ]);
  });
});
