/**
 * Settings — dietary profile capture (Req 5 WS5).
 *
 * Confirm-first: edit chips → Save via GET/POST /nutrition/dietary-profile.
 * Soft-handles a missing/lagging API so the editor still works locally.
 */
import { useEffect, useState } from 'react';
import { DIET_OPTIONS, type DietaryProfile } from '@cadence/shared';
import { getDietaryProfile, saveDietaryProfile } from '../../lib/api.ts';

function splitTags(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function TagChips({
  label,
  hint,
  tags,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  hint: string;
  tags: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const next = splitTags(draft);
    if (!next.length) return;
    const seen = new Set(tags.map((t) => t.toLowerCase()));
    const merged = [...tags];
    for (const t of next) {
      if (seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      merged.push(t);
    }
    onChange(merged);
    setDraft('');
  }

  return (
    <div className="diet-block">
      <div className="diet-block-t">{label}</div>
      <div className="diet-block-h">{hint}</div>
      {tags.length > 0 && (
        <div className="diet-chips" role="list">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className="diet-chip"
              role="listitem"
              disabled={disabled}
              onClick={() => onChange(tags.filter((x) => x !== t))}
              aria-label={`Remove ${t}`}
              title="Tap to remove"
            >
              {t} <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
      <div className="diet-add">
        <input
          className="wiz-in"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="diet-add-btn" onClick={add} disabled={disabled || !draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

export function DietaryProfileEditor() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<DietaryProfile | null>(null);
  const [apiReady, setApiReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDietaryProfile().then((r) => {
      if (cancelled) return;
      setProfile(r.profile);
      setApiReady(r.status === 'ok');
      if (r.status === 'unavailable') setApiReady(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!open && profile === null) return null;

  if (!open) {
    const summary =
      profile && (profile.allergies.length || profile.diet || profile.dislikes.length)
        ? [
            profile.diet,
            profile.allergies.length
              ? `${profile.allergies.length} allerg${profile.allergies.length === 1 ? 'y' : 'ies'}`
              : null,
            profile.dislikes.length ? `${profile.dislikes.length} avoid` : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : 'Allergies, diet, and things to skip';
    return (
      <button className="set-row" onClick={() => setOpen(true)}>
        <b>What we work around (food)</b>
        <span>{summary}</span>
      </button>
    );
  }

  const p = profile ?? { allergies: [], diet: null, dislikes: [], notes: null };

  function patch(next: Partial<DietaryProfile>) {
    setProfile((prev) => ({ ...(prev ?? p), ...next }));
    setDirty(true);
    setNote('');
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const saved = await saveDietaryProfile(p);
      if (saved) {
        setProfile(saved);
        setApiReady(true);
        setDirty(false);
        setNote("Saved — here's what I'll keep in mind. Tell me if anything's off.");
      } else {
        setApiReady(false);
        setNote(
          dirty
            ? "Couldn't store this just now — your edits are still here; try Save again in a moment."
            : "Couldn't save just now — try again in a moment.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="set-targets diet-editor">
      <div className="set-targets-t">What we work around (food)</div>
      <div className="diet-lead">
        Allergies are hard stops — I&apos;ll never quietly suggest them. Dislikes and diet are soft guides. No
        prescriptions; if you have medical dietary needs, check with a professional too.
      </div>

      {!apiReady && (
        <div className="sheet-msg" style={{ padding: '2px 0 8px' }}>
          I couldn&apos;t reach food memory just now — you can still fill this in; Save will retry.
        </div>
      )}

      <TagChips
        label="Allergies"
        hint="Hard excludes — peanuts, shellfish, …"
        tags={p.allergies}
        onChange={(allergies) => patch({ allergies })}
        placeholder='e.g. "peanuts"'
        disabled={busy}
      />

      <div className="diet-block">
        <div className="diet-block-t">Diet</div>
        <div className="diet-block-h">Optional pattern I&apos;ll prefer around</div>
        <div className="diet-chips">
          {DIET_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`diet-chip diet-chip-opt${p.diet === opt ? ' diet-chip-on' : ''}`}
              disabled={busy}
              onClick={() => patch({ diet: p.diet === opt ? null : opt })}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <TagChips
        label="Rather skip"
        hint="Soft avoids — cilantro, olives, …"
        tags={p.dislikes}
        onChange={(dislikes) => patch({ dislikes })}
        placeholder='e.g. "cilantro"'
        disabled={busy}
      />

      <label className="diet-block">
        <div className="diet-block-t">Notes</div>
        <textarea
          className="logbox-in"
          rows={2}
          value={p.notes ?? ''}
          disabled={busy}
          placeholder="Anything else I should remember about food"
          onChange={(e) => patch({ notes: e.target.value.trim() ? e.target.value : null })}
        />
      </label>

      {note && (
        <div className="sheet-msg" style={{ padding: '2px 0 6px' }}>
          {note}
        </div>
      )}

      <div className="set-targets-actions">
        <button className="lockbtn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save — looks right'}
        </button>
        <button
          className="set-danger-btn"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setNote('');
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
