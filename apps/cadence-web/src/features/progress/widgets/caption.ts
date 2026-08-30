/**
 * Captions bind to COMPUTED facts, never frozen prose (docs/cadence/PROGRESS-ENGINE.md): the
 * coach authors a `spec.caption.template` once, with `{field}` placeholders, and this interpolates
 * it against whatever the binding resolver hands the renderer — so a re-window never needs a
 * model call and the words never go stale. Deliberately tiny: no conditionals, no loops inside a
 * template — a widget that needs a clause omitted (e.g. dated_sessions' "usually around N bpm")
 * builds that string itself rather than teaching this util a mini-language.
 */

/** Round to one decimal and drop a trailing ".0" — "172" stays "172", "172.4" stays "172.4",
 *  "0.34" reads as "0.3". Good enough for weights, rates, and counts without a formatting library. */
export function formatCaptionNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Picks only the primitive (string/number/boolean) top-level fields off a payload — the "flat
 *  fields" a caption template is allowed to bind to. Arrays and nested objects (series, weeks,
 *  sessions…) are the renderer's job to draw, never a caption's job to describe. */
export function flatFields(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

/** Interpolates every `{field}` in `template` from `fields`. An unresolved placeholder — a field
 *  missing from the payload, or a genuinely absent ("not read", never zero) value — renders as
 *  empty rather than leaking `{field}` text into the UI; the resolver is what's responsible for
 *  reporting evidence when a section can't bind at all. */
export function renderCaption(template: string, fields: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    if (!(key in fields)) return '';
    const value = fields[key];
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return formatCaptionNumber(value);
    return String(value);
  });
}
