import type { Baseline, Constraint } from '@cadence/shared';
import { updateBaseline, updateName } from '../../lib/api.ts';
import type { ReviewData } from '../../lib/api.ts';
import { useDraftField } from './useDraftField.ts';
import { TrashIcon } from './TrashIcon.tsx';
import {
  cmToFtIn,
  formatWeightDisplay,
  parseHeightCmDraft,
  parseHeightFtDraft,
  parseWeightDraft,
  resolveWeightKg,
} from './unitConversion.ts';

type Props = {
  data: ReviewData;
  setData: (data: ReviewData) => void;
  baseline: Baseline;
  setBaseline: (b: Baseline) => void;
  patchBaseline: (p: Partial<Baseline>) => void;
};

export function AboutYouStep({ data, setData, baseline, setBaseline, patchBaseline }: Props) {
  const wUnit = baseline.weight_unit ?? 'kg';
  const wKg = resolveWeightKg(baseline.weight_kg);
  const wDisplay = formatWeightDisplay(wKg, wUnit);
  const weight = useDraftField(wDisplay, (raw) => {
    const kg = parseWeightDraft(raw, wUnit);
    if (kg == null) return;
    patchBaseline({
      weight_kg: {
        current: kg,
        start: baseline.weight_kg?.start ?? kg,
        source: 'manual',
        updated_at: new Date().toISOString(),
      },
    });
  });

  const hUnit: 'cm' | 'ft' = baseline.height_unit ?? (wUnit === 'lbs' ? 'ft' : 'cm');
  const hCm = baseline.height_cm;
  const ftIn = hCm != null ? cmToFtIn(hCm) : null;
  const cmCommitted = hCm != null ? String(Math.round(hCm)) : '';
  const ftCommitted = {
    ft: ftIn != null ? String(ftIn.ft) : '',
    in: ftIn != null ? String(ftIn.in) : '',
  };

  const heightCm = useDraftField(cmCommitted, (raw) => {
    const cm = parseHeightCmDraft(raw);
    if (cm != null) patchBaseline({ height_cm: cm });
  });

  const heightFt = useDraftField(ftCommitted, (d) => {
    const cm = parseHeightFtDraft(d);
    if (cm != null) patchBaseline({ height_cm: cm });
  });

  return (
    <div className="wiz-list">
      <div className="screen-sub">The facts I'll plan around. Fix anything that's off.</div>
      <div className="wiz-card">
        <label className="wiz-field">
          <span>Your name</span>
          <input
            className="wiz-in"
            value={data.name ?? ''}
            placeholder="What should I call you?"
            onChange={(e) => setData({ ...data, name: e.target.value })}
            onBlur={(e) => updateName(e.target.value)}
          />
        </label>
        <div className="wiz-fields wiz-body" style={{ marginTop: 10 }}>
          <label className="wiz-field">
            <span>Age</span>
            <input
              className="wiz-in"
              type="number"
              value={baseline.age ?? ''}
              onChange={(e) => patchBaseline({ age: e.target.value ? Number(e.target.value) : undefined })}
            />
          </label>
          <label className="wiz-field">
            <span>Height</span>
            <div className="wiz-weight">
              {hUnit === 'ft' ? (
                <>
                  <input
                    className="wiz-in"
                    type="number"
                    inputMode="numeric"
                    placeholder="ft"
                    value={heightFt.shown.ft}
                    onChange={(e) => heightFt.setDraft({ ft: e.target.value, in: heightFt.shown.in })}
                    onBlur={heightFt.onBlur}
                  />
                  <input
                    className="wiz-in"
                    type="number"
                    inputMode="numeric"
                    placeholder="in"
                    value={heightFt.shown.in}
                    onChange={(e) => heightFt.setDraft({ ft: heightFt.shown.ft, in: e.target.value })}
                    onBlur={heightFt.onBlur}
                  />
                </>
              ) : (
                <input
                  className="wiz-in"
                  type="number"
                  inputMode="numeric"
                  placeholder="cm"
                  value={heightCm.shown}
                  onChange={(e) => heightCm.setDraft(e.target.value)}
                  onBlur={heightCm.onBlur}
                />
              )}
              <select
                className="wiz-sel"
                value={hUnit}
                onChange={(e) => patchBaseline({ height_unit: e.target.value as 'cm' | 'ft' })}
              >
                <option value="cm">cm</option>
                <option value="ft">ft/in</option>
              </select>
            </div>
          </label>
          <label className="wiz-field">
            <span>Weight</span>
            <div className="wiz-weight">
              <input
                className="wiz-in"
                type="number"
                inputMode="decimal"
                value={weight.shown}
                onChange={(e) => weight.setDraft(e.target.value)}
                onBlur={weight.onBlur}
              />
              <select
                className="wiz-sel"
                value={wUnit}
                onChange={(e) => patchBaseline({ weight_unit: e.target.value as 'kg' | 'lbs' })}
              >
                <option value="kg">kg</option>
                <option value="lbs">lbs</option>
              </select>
            </div>
          </label>
        </div>
      </div>

      <div className="wiz-label">What we work around</div>
      {(baseline.constraints ?? []).map((c, i) => (
        <div className="wiz-card wiz-card-tight" key={c.id || i}>
          <div className="wiz-row">
            <input
              className="wiz-in"
              placeholder="e.g. left knee · burnout · night shifts"
              value={c.label}
              onChange={(e) => {
                const constraints = baseline.constraints.map((x, j) => (j === i ? { ...x, label: e.target.value } : x));
                setBaseline({ ...baseline, constraints });
              }}
              onBlur={() => updateBaseline({ constraints: baseline.constraints })}
            />
            <label className="wiz-check">
              <input
                type="checkbox"
                checked={c.plan_around}
                onChange={(e) =>
                  patchBaseline({
                    constraints: baseline.constraints.map((x, j) =>
                      j === i ? { ...x, plan_around: e.target.checked } : x,
                    ),
                  })
                }
              />
              plan around it
            </label>
            <button
              className="wiz-del"
              onClick={() => patchBaseline({ constraints: baseline.constraints.filter((_, j) => j !== i) })}
              aria-label="Remove"
            >
              <TrashIcon />
            </button>
          </div>
        </div>
      ))}
      <button
        className="wiz-add"
        onClick={() =>
          patchBaseline({
            constraints: [
              ...(baseline.constraints ?? []),
              { id: '', label: '', kind: 'other', plan_around: true } as Constraint,
            ],
          })
        }
      >
        + Add one
      </button>
    </div>
  );
}
