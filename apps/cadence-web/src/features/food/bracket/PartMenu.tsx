/**
 * The bracket's ⋯ — every gesture's boring twin, worded (canvas A3, "The certain path").
 * Gesture for speed, menu for certainty: nobody is ever stuck holding a bracket they can't undo.
 * Pure callbacks; the caller owns what each row actually does and when the sheet closes.
 */
import { fmtKcal, numberWord } from './copy.ts';

export interface PartMenuProps {
  /** The part's label — its name, or "4 things". */
  label: string;
  memberCount: number;
  /** The part's own kcal, for the header line. */
  kcal?: number;
  /** Butter header rail when the part makes several portions. */
  several?: boolean;
  /** Saved to the cookbook (recipe_id present): header says so, and the remove row appears. */
  inCookbook?: boolean;
  /** For the ungroup note: the whole meal's kcal and how many rows the meal reads as now. */
  mealKcal?: number;
  readsNow?: number;
  onRename: () => void;
  onAddTo: () => void;
  onTakeOut: () => void;
  onUngroup: () => void;
  onYield: () => void;
  onRemoveFromCookbook?: () => void;
  onClose: () => void;
}

function Row({
  icon,
  title,
  sub,
  accent,
  chevron,
  onPress,
}: {
  icon: string;
  title: string;
  sub?: string;
  accent?: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" className={`mb-menu-row${accent ? ' mb-menu-row--accent' : ''}`} onClick={onPress}>
      <span className="mb-menu-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="mb-menu-words">
        <span className="mb-menu-title">{title}</span>
        {sub && <span className="mb-menu-sub">{sub}</span>}
      </span>
      {chevron && (
        <span className="mb-menu-chevron" aria-hidden="true">
          ›
        </span>
      )}
    </button>
  );
}

export function PartMenu(props: PartMenuProps) {
  const { label, memberCount, kcal, several, inCookbook, mealKcal, readsNow } = props;
  const head = [
    memberCount === 1 ? '1 thing' : `${memberCount} things`,
    typeof kcal === 'number' ? `${fmtKcal(kcal)} kcal` : null,
    inCookbook ? 'in your cookbook' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="mb-sheet-backdrop" onClick={props.onClose}>
      <div className="mb-sheet" role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="mb-sheet-grab" aria-hidden="true" />
        <div className="mb-sheet-head">
          <div className={`mb-rail mb-rail--head${several ? ' mb-rail--butter' : ''}`} />
          <div className="mb-sheet-words">
            <div className="mb-sheet-title">{label}</div>
            <div className="mb-sheet-sub">{head}</div>
          </div>
        </div>
        <div className="mb-menu">
          <Row icon="✎" title="Rename it" onPress={props.onRename} />
          <Row icon="＋" title="Add something to this" sub="search, say it, or scan" onPress={props.onAddTo} />
          <Row
            icon="☑"
            title="Take something out"
            sub="tick what should leave the bowl"
            accent
            chevron
            onPress={props.onTakeOut}
          />
          <Row
            icon="⤨"
            title="Ungroup it"
            sub={`${numberWord(memberCount)} loose things again, same numbers`}
            onPress={props.onUngroup}
          />
          <Row icon="▤" title="It makes several portions" sub="give it a yield" onPress={props.onYield} />
        </div>
        {typeof mealKcal === 'number' && typeof readsNow === 'number' && (
          <div className="mb-sheet-note">
            {"Ungrouping never removes food from your day. It's the same "}
            {fmtKcal(mealKcal)}
            {' kcal, read as '}
            {numberWord(readsNow - 1 + memberCount)}
            {' things instead of '}
            {numberWord(readsNow)}
            {'.'}
          </div>
        )}
        {inCookbook && props.onRemoveFromCookbook && (
          <button type="button" className="mb-quiet-btn" onClick={props.onRemoveFromCookbook}>
            Remove it from my cookbook
          </button>
        )}
      </div>
    </div>
  );
}
