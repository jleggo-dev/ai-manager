import { describe, expect, it } from 'vitest';
import {
  DRAWER_HOOKS,
  DRAWER_LABEL_MAX,
  TOOL_CATEGORIES,
  labelBudgetReport,
  onDemandToolNames,
  FIND_TOOLS_NAME,
} from './coach-tool-tiers.ts';
import { COACH_META_TOOLS } from './coach-meta-tools.ts';

/**
 * The drawer's label is CI-gated (owner ruling 2026-08-30, coach-tool-tiers.ts): every tail tool
 * has a hook line she can see, the hooks stay short enough that the label stays a label, and the
 * generated find_tools description stays bounded as the tail grows. A tail tool without a hook
 * fails here BY NAME — the unlabeled-drawer regression this exists to prevent. (Category
 * coverage itself is gated next door in coach-meta-tools.test.ts; this file gates the HOOKS and
 * the generated label.)
 */

const HOOK_MAX = 90;
/** One source of truth, beside the hooks it bounds — description-audit.test.ts imports it too.
 *  It was written out as a bare 2600 in both files, which is two numbers that had to agree. */
const LABEL_MAX = DRAWER_LABEL_MAX;
const BANNED = ['streak', 'adherence', 'unlock', 'empower', 'journey', 'captured'];

describe('the drawer hooks', () => {
  it('cover exactly the on-demand tools — no missing, no extras', () => {
    const tail = [...onDemandToolNames()].sort();
    expect(Object.keys(DRAWER_HOOKS).sort()).toEqual(tail);
  });

  it('stay short enough to be a label, not a description', () => {
    const long = Object.entries(DRAWER_HOOKS)
      .filter(([, hook]) => hook.length > HOOK_MAX || !hook.trim())
      .map(([name, hook]) => `${name} (${hook.length})`);
    expect(long).toEqual([]);
  });

  it('speak the house voice — no banned words', () => {
    const text = Object.values(DRAWER_HOOKS).join(' ').toLowerCase();
    expect(BANNED.filter((w) => text.includes(w))).toEqual([]);
  });
});

describe('the generated find_tools label', () => {
  const label = COACH_META_TOOLS[FIND_TOOLS_NAME]!.description;

  it('stays bounded and names every category and tool', () => {
    // The message carries the breakdown on purpose. When this failed on #342 it said only
    // "2630 > 2600", which does not tell the next person whether THEIR hook is fat or the tail
    // simply grew past the budget — and those have opposite fixes.
    expect(label.length, labelBudgetReport(label)).toBeLessThanOrEqual(LABEL_MAX);
    for (const { label: sectionLabel, members } of TOOL_CATEGORIES) {
      expect(label).toContain(sectionLabel);
      for (const name of members) expect(label).toContain(name);
    }
  });

  it('explains itself when the budget is blown — the breach names its own cause', () => {
    // Guards the diagnostic, not the size: a breach must say whether ONE hook is fat or the tail
    // has simply outgrown the budget, because the fix differs and the number alone hides which.
    const report = labelBudgetReport(label);

    expect(report).toContain(`${label.length} chars`);
    expect(report).toContain(`${onDemandToolNames().length} tail tools`);
    expect(report).toMatch(/~\d+ each/);
    expect(report).toMatch(/DRAWER_HOOKS/);
    expect(report).toMatch(/DRAWER_LABEL_MAX/);
  });

  it('keeps the audit phrases and marks the tail action', () => {
    expect(label).toMatch(/does NOT change anything/);
    expect(label).toMatch(/\bUse\b/);
    // The read/write line she must never blur: the drawer's one action wears its mark.
    expect(label).toMatch(/propose_progress_layout \([^)]*\) \[changes their data\]/);
  });
});
