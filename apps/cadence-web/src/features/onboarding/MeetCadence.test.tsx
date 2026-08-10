import { fireEvent, render, screen } from '@testing-library/react';
import { MeetCadence } from './MeetCadence.tsx';

vi.mock('../coach/useEnsureCoachFace.ts', () => ({ useEnsureCoachFace: () => {} }));
vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => <span>face</span> }));

/**
 * The regression these guard: a Supabase session survives a hard close, and the fork only renders
 * when there is none — so without a door out, onboarding was a one-way street. Every launch landed
 * back in the chat with no route to sign in, switch accounts, or start again.
 */
describe('MeetCadence', () => {
  it('leaves immediately when there is nothing to lose', () => {
    const onLeave = vi.fn();
    render(<MeetCadence onSayHi={vi.fn()} onLeave={onLeave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('asks first when the draft is anonymous and therefore unrecoverable', () => {
    const onLeave = vi.fn();
    render(<MeetCadence onSayHi={vi.fn()} onLeave={onLeave} warnUnsaved />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('backs out of the warning without leaving', () => {
    const onLeave = vi.fn();
    render(<MeetCadence onSayHi={vi.fn()} onLeave={onLeave} warnUnsaved />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep going' }));

    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows no way out when the caller offers none', () => {
    render(<MeetCadence onSayHi={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });
});
