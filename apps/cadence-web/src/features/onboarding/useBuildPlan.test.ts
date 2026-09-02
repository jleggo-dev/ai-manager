import { recoverIfAlreadyCommitted } from './useBuildPlan.ts';

const getPlan = vi.fn();
const lockPlan = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getPlan: (...args: unknown[]) => getPlan(...args),
  lockPlan: (...args: unknown[]) => lockPlan(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recoverIfAlreadyCommitted', () => {
  it('calls onLocked and returns true when the plan is already committed', async () => {
    getPlan.mockResolvedValue({ stage: 'committed' });
    const onLocked = vi.fn();
    await expect(recoverIfAlreadyCommitted(onLocked)).resolves.toBe(true);
    expect(onLocked).toHaveBeenCalledOnce();
  });

  it('returns false when the plan is not committed or getPlan fails', async () => {
    getPlan.mockResolvedValue({ stage: 'draft' });
    await expect(recoverIfAlreadyCommitted(vi.fn())).resolves.toBe(false);

    getPlan.mockRejectedValue(new Error('network'));
    const onLocked = vi.fn();
    await expect(recoverIfAlreadyCommitted(onLocked)).resolves.toBe(false);
    expect(onLocked).not.toHaveBeenCalled();
  });
});
