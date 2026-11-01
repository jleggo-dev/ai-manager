/**
 * What calling a tool does to the user's data, as a typed field (HARNESS-V3 C4,
 * TOOL-HARNESS.md backlog #3).
 *
 * Until this existed, the only record of whether an action committed on call or waited for a tap
 * was a sentence in its description, and the only check was a regex over the always-on
 * descriptions looking for one of two phrases. A tail action could leave the sentence out, and a
 * tool that waits for a tap could say it takes effect immediately, and nothing would notice.
 *
 * Now every tool declares `mutates`, and the sentence in an action's description is generated
 * from it:
 *
 *  - `'none'` — it only reads. Every retrieval function, and `find_tools`.
 *  - `'proposes'` — it writes only something that waits on the user's screen (a proposal card, a
 *    questionnaire, a checklist). Their data does not change until they act on it.
 *  - `'immediate'` — the call itself changes their data.
 *
 * The description carries `{gate}` where the sentence goes, so the wording that follows stays each
 * tool's own ("Takes effect immediately: reflecting it back is the confirmation.").
 */

export type Mutates = 'none' | 'proposes' | 'immediate';

/** Where the generated sentence goes in an action's description. */
export const GATE_TOKEN = '{gate}';

/**
 * The words for each mode. These are the exact phrases the descriptions already used before the
 * field existed, so generating them changes nothing she reads.
 */
export const GATE_PHRASE: Readonly<Record<Exclude<Mutates, 'none'>, string>> = {
  immediate: 'takes effect immediately',
  proposes: 'does NOT change anything',
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The description with `{gate}` replaced by the phrase for `mutates`.
 *
 * Capitalized when the token starts a sentence (start of the text, or after ". ", "! ", "? "), and
 * lower-case otherwise, so "This {gate} until that tap" and "{gate}. Use it when…" both read as
 * written. A `'none'` tool gets no sentence at all.
 */
export function renderGate(template: string, mutates: Mutates): string {
  if (mutates === 'none') return template;
  const phrase = GATE_PHRASE[mutates];
  return template.replace(/\{gate\}/g, (_match, at: number) =>
    at === 0 || /[.!?]\s+$/.test(template.slice(0, at)) ? capitalize(phrase) : phrase,
  );
}

/** How many times a phrase appears, ignoring case — the audit's "exactly once". */
export function countPhrase(text: string, phrase: string): number {
  return text.toLowerCase().split(phrase.toLowerCase()).length - 1;
}
