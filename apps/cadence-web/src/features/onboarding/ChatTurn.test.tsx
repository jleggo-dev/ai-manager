import { render, screen } from '@testing-library/react';
import { ChatTurn } from './ChatTurn.tsx';

vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => <div /> }));

/**
 * "Cadence is checking your recorded workouts…" — the line that says what she is doing.
 *
 * It shipped silently dead. It was rendered only inside the `pending` branch, and `pending` means
 * `!text` — so it could only appear while she had said nothing at all. She streams a preamble
 * before calling anything, so by the time a tool ran there was text, `pending` was false, and the
 * line was unreachable in exactly the moment it exists for. Owner: *"the feature we put in to show
 * in the UI that Cadence is calling/using a tool - that doesn't seem to be working."*
 */
describe('the activity line', () => {
  it('shows while she is thinking and has said nothing yet', () => {
    render(<ChatTurn role="coach" text="" pending activity="checking your recorded workouts" />);
    expect(screen.getByText(/checking your recorded workouts/)).toBeInTheDocument();
  });

  /** The case that was broken: she has already spoken, and THEN reaches for a tool. */
  it('shows after she has already started speaking — the moment a tool actually runs', () => {
    render(<ChatTurn role="coach" text="Let me look." activity="reading your journal" />);
    expect(screen.getByText('Let me look.')).toBeInTheDocument();
    expect(screen.getByText(/reading your journal/)).toBeInTheDocument();
  });

  /**
   * The pre-first-token stretch (Phase 3): the server's `stage` frame lands before any model work,
   * so the pending bubble says what is happening instead of showing bare dots. One set of dots —
   * the line's own — never a second bare set stacked above it.
   */
  it('shows dots + the stage line while pending, with a single set of dots', () => {
    render(<ChatTurn role="coach" text="" pending activity="reading your file" />);
    expect(screen.getByText(/reading your file/)).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('shows nothing when there is no activity, which is most of the time', () => {
    render(<ChatTurn role="coach" text="All done." />);
    expect(screen.getByText('All done.')).toBeInTheDocument();
    expect(screen.queryByText(/…$/)).not.toBeInTheDocument();
  });

  it('never puts an activity line in the user’s own bubble', () => {
    render(<ChatTurn role="user" text="hello" activity="reading your journal" />);
    expect(screen.queryByText(/reading your journal/)).not.toBeInTheDocument();
  });
});
