import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConstraintsSettings } from './ConstraintsSettings.tsx';

const getConstraints = vi.fn();
const removeConstraint = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getConstraints: (...a: unknown[]) => getConstraints(...a),
  removeConstraint: (...a: unknown[]) => removeConstraint(...a),
}));

const ELBOW = { id: 'e1', label: 'tendinitis in right elbow', kind: 'physical', status: 'quiet', plan_around: true };
const KNEE = { id: 'k1', label: 'tendinitis in left knee', kind: 'physical', status: 'quiet', plan_around: true };

beforeEach(() => {
  vi.clearAllMocks();
  getConstraints.mockResolvedValue([ELBOW, KNEE]);
  removeConstraint.mockResolvedValue([KNEE]);
});

/**
 * This panel exists because the coach was confidently wrong and the user had no way to check.
 * Asked to drop the elbow she said "Done — I've removed the elbow tendinitis"; it was still there,
 * and she kept saying it in later turns. The only recourse was asking her again.
 */
describe('what we work around', () => {
  it('shows what is actually stored, not what anyone said about it', async () => {
    render(<ConstraintsSettings />);
    expect(await screen.findByText('tendinitis in right elbow')).toBeInTheDocument();
    expect(screen.getByText('tendinitis in left knee')).toBeInTheDocument();
  });

  /** `plan_around` is the field that changes the plan, so it has to be legible at a glance. */
  it('says whether each one is actually being planned around', async () => {
    getConstraints.mockResolvedValue([ELBOW, { ...KNEE, plan_around: false }]);
    render(<ConstraintsSettings />);
    await screen.findByText('tendinitis in right elbow');
    expect(screen.getByText(/^planned around/)).toBeInTheDocument();
    expect(screen.getByText(/^not planned around/)).toBeInTheDocument();
  });

  /** The screen redraws from the SERVER's surviving list — it must never guess at the new state. */
  it('removes one and shows what the server says is left', async () => {
    render(<ConstraintsSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tendinitis in right elbow' }));

    await waitFor(() => expect(screen.queryByText('tendinitis in right elbow')).not.toBeInTheDocument());
    expect(removeConstraint).toHaveBeenCalledWith('e1');
    expect(screen.getByText('tendinitis in left knee')).toBeInTheDocument();
  });

  it('keeps the row and says so when the save fails, rather than pretending', async () => {
    removeConstraint.mockResolvedValue(null);
    render(<ConstraintsSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tendinitis in right elbow' }));

    expect(await screen.findByText(/didn't save just now/)).toBeInTheDocument();
    expect(screen.getByText('tendinitis in right elbow')).toBeInTheDocument();
  });

  it('says plainly when there is nothing on file', async () => {
    getConstraints.mockResolvedValue([]);
    render(<ConstraintsSettings />);
    expect(await screen.findByText(/Nothing on file/)).toBeInTheDocument();
  });
});
