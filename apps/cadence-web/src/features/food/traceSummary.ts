/**
 * The words of the coach's trace line (CoachTrace.tsx), apart from the component so the file
 * that draws it exports only the component (fast refresh). Table-tested in CoachTrace.test.tsx.
 */
/** One sentence from a list of lines: a line that already ends like a sentence does not get a second full stop. */
export const sentence = (lines: string[]): string => {
  const joined = lines.join('; ');
  return /[.!?]$/.test(joined) ? joined : `${joined}.`;
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "2 parts looked up · 1 picked before · 1 call" — from the lines, never from canned copy. */
export function traceSummary(lines: string[], calls?: number): string {
  const remembered = lines.filter((l) => l.includes('picked before')).length;
  const looked = lines.length - remembered;
  const work =
    looked > 0
      ? `${plural(looked, 'part', 'parts')} looked up`
      : `${plural(remembered, 'part', 'parts')} picked before`;
  return [
    work,
    looked > 0 && remembered > 0 ? `${remembered} picked before` : '',
    calls ? plural(calls, 'call', 'calls') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
