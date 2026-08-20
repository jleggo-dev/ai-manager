import type { MealMacros } from '../../lib/api.ts';

/**
 * One chart language (Food Journey act 1): a ring for calories, BARS for macros — everywhere.
 * Three rows, protein-first (owner ruling: macros read protein-first everywhere in Cadence).
 *
 * Two honest states, nothing added when targets arrive:
 *   • counting — no targets yet: the track is DASHED and the value is the bare grams eaten.
 *     Dashed means counting, not scoring; there is no fill because a fill needs a denominator.
 *   • scored — targets exist: the same bars simply gain a fill and a denominator ("88 / 150 g").
 *     The fill clamps at 100% — over is a fact the number states, never a warning the bar shouts.
 *
 * `dense` is the trail-strip variant: tighter labels, bare numbers (no " g"), because the strip
 * is a glance and the unit is noise at that size.
 */
const ROWS: Array<{ key: 'protein_g' | 'carbs_g' | 'fat_g'; label: string; color: string }> = [
  { key: 'protein_g', label: 'PROTEIN', color: 'oklch(48% 0.10 152)' },
  { key: 'carbs_g', label: 'CARBS', color: 'oklch(48% 0.09 250)' },
  { key: 'fat_g', label: 'FAT', color: 'oklch(50% 0.11 268)' },
];

export function MacroBars({
  eaten,
  targets,
  dense = false,
}: {
  eaten: MealMacros;
  targets: MealMacros | null;
  dense?: boolean;
}) {
  return (
    <span className={`mbars${dense ? ' is-dense' : ''}`}>
      {ROWS.map((row) => {
        const e = Math.round(eaten[row.key] ?? 0);
        const t = targets?.[row.key];
        const scored = typeof t === 'number' && t > 0;
        const pct = scored ? Math.min(100, (e / t) * 100) : 0;
        return (
          <span className="mbar" key={row.key}>
            <span className="mbar-l" style={{ color: row.color }}>
              {row.label}
            </span>
            {/* One track in both states — solid, per the design (verified 2026-08-20). Counting
                simply has nothing in it yet; the grams beside it say what happened, and the
                denominator appears when a target does. Nothing is added when targets arrive. */}
            <span className="mbar-track">
              {scored && <span className="mbar-fill" style={{ width: `${pct}%`, background: row.color }} />}
            </span>
            <span className="mbar-v">{scored ? `${e} / ${Math.round(t)} g` : dense ? `${e}` : `${e} g`}</span>
          </span>
        );
      })}
    </span>
  );
}
