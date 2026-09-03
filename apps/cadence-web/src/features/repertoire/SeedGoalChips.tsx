/**
 * Which goal the collection goes under — the person's live goals as chips, plus keeping it
 * without one.
 *
 * "No goal" is a chip like the others rather than the state you get by not choosing: what someone
 * knows outlives any one goal (`repertoire.goal_id` is nullable and set-null on goal delete), so
 * keeping a book unattached is a real answer, not a skipped question.
 */
const NO_GOAL = 'No goal — just keep it';

export interface SeedGoal {
  goal_id: string;
  title: string;
}

interface Props {
  goals: SeedGoal[];
  goalId: string | null;
  onPick: (goalId: string | null) => void;
}

export function SeedGoalChips({ goals, goalId, onPick }: Props) {
  const chip = (on: boolean) => `detour-chip sr-chip${on ? ' sr-chip--on' : ''}`;
  return (
    <>
      <div className="pw-sect">
        <span>Goes under</span>
      </div>
      <div className="detour-chips">
        {goals.map((g) => (
          <button
            key={g.goal_id}
            type="button"
            className={chip(goalId === g.goal_id)}
            aria-pressed={goalId === g.goal_id}
            onClick={() => onPick(g.goal_id)}
          >
            {g.title}
          </button>
        ))}
        <button
          type="button"
          className={chip(goalId === null)}
          aria-pressed={goalId === null}
          onClick={() => onPick(null)}
        >
          {NO_GOAL}
        </button>
      </div>
    </>
  );
}
