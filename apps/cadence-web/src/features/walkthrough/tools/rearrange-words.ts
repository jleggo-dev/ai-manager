import { type CombineMode, type PlayedGroup, type WalkthroughStep, distinctSteps, groupMeta, groupTitle, pillLabel, shortNames } from '@cadence/shared';

/**
 * The words of a group row (walkthrough v3 Phase 6): what each pill says, the row's title and
 * meta, and the toast after Combine. Out of the .tsx so react-refresh stays happy and the
 * table tests import no React.
 */

/** The pills of a group: one per turn, in the order you'll do them. A combined group's pills are
 *  the members' short names; a plain group's carry the set's number ("Pull-up 5", "Hang 45 s"). */
export function groupPills(group: PlayedGroup, stepOf: (id: string) => WalkthroughStep | undefined): { key: string; label: string; alt: boolean; timed: boolean }[] {
  const ids = distinctSteps(group);
  const names = shortNames(ids.map((id) => stepOf(id)?.title ?? id));
  return group.turns.map((t) => {
    const step = stepOf(t.stepId);
    const i = ids.indexOf(t.stepId);
    return {
      key: `${t.stepId}:${t.set}`,
      label: ids.length > 1 ? (names[i] ?? t.stepId) : step ? pillLabel(step) : t.stepId,
      alt: ids.length > 1 && i % 2 === 1,
      timed: step?.tool.kind === 'timer',
    };
  });
}

/** The row's title and meta: "Pull-ups · 3 sets", "Bench press + dumbbell row · 6 sets". */
export function groupWords(group: PlayedGroup, stepOf: (id: string) => WalkthroughStep | undefined): { title: string; meta: string } {
  const ids = distinctSteps(group);
  const steps = ids.map(stepOf);
  const one = steps.length === 1 ? steps[0] : undefined;
  return {
    title: one ? one.title : groupTitle(steps.map((s, i) => s?.title ?? ids[i] ?? '')),
    meta: groupMeta(group.turns.length, one?.tool),
  };
}

/** "Farmer carry and hip thrust now alternate." */
export function combineToast(titles: readonly string[], mode: CombineMode): string {
  const [first, ...rest] = titles;
  const tail = rest.map((t) => t.trim().charAt(0).toLowerCase() + t.trim().slice(1)).join(' and ');
  return `${first ?? ''} and ${tail} now ${mode === 'alternate' ? 'alternate' : 'run in sequence'}.`;
}
