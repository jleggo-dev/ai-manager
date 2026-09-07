/**
 * The face paints from disk (owner, on device, 2026-09-07): the weather beside it was already on
 * screen from last launch's snapshot while the avatar showed the brand mark until `/me/coach-face`
 * came back. The pick now lives in the query cache — seeded by the boot snapshot before the first
 * render — so the FIRST paint wears the portrait, and every live answer or pick is written back
 * so the next launch has it too.
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '../../lib/query/keys.ts';
import { makeTestQueryClient } from '../../test/withQuery.tsx';
import { CoachFaceProvider } from './CoachFaceProvider.tsx';
import { useCoachFace } from './coachFaceContext.ts';

const getCoachFace = vi.fn();
const setCoachFace = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  getCoachFace: (...a: unknown[]) => getCoachFace(...a),
  setCoachFace: (...a: unknown[]) => setCoachFace(...a),
}));

const PICK = 'mindful-guide-feminine-2';

/** Reports the context's answer, and offers a way to pick, so the test can see both sides. */
function Probe() {
  const { faceId, ready, setFaceId } = useCoachFace();
  return (
    <>
      <span data-testid="face">{faceId ?? 'none'}</span>
      <span data-testid="ready">{String(ready)}</span>
      <button type="button" onClick={() => void setFaceId(PICK)}>
        pick
      </button>
    </>
  );
}

const hang = () => new Promise<never>(() => {});

function mount(seed?: { face_id: string | null }) {
  const client = makeTestQueryClient();
  if (seed) client.setQueryData(queryKeys.coachFace.all, seed);
  render(
    <QueryClientProvider client={client}>
      <CoachFaceProvider>
        <Probe />
      </CoachFaceProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  setCoachFace.mockResolvedValue(PICK);
});
afterEach(cleanup);

describe('CoachFaceProvider — painted from the cache', () => {
  it('wears the cached portrait on the first paint, before the read answers', () => {
    getCoachFace.mockImplementation(hang);
    mount({ face_id: PICK });
    expect(screen.getByTestId('face').textContent).toBe(PICK);
    // …but a cached pick is not a LIVE answer: nothing may draw a random face over it yet.
    expect(screen.getByTestId('ready').textContent).toBe('false');
  });

  it('shows the mark with nothing cached, then adopts the read and writes it back', async () => {
    getCoachFace.mockResolvedValue({ ok: true, faceId: PICK });
    const client = mount();
    expect(screen.getByTestId('face').textContent).toBe('none');
    await waitFor(() => expect(screen.getByTestId('face').textContent).toBe(PICK));
    expect(client.getQueryData(queryKeys.coachFace.all)).toEqual({ face_id: PICK });
  });

  it('a cached null is "hasn’t picked", kept apart from "nothing cached"', () => {
    getCoachFace.mockImplementation(hang);
    const client = mount({ face_id: null });
    expect(screen.getByTestId('face').textContent).toBe('none');
    expect(client.getQueryData(queryKeys.coachFace.all)).toEqual({ face_id: null });
  });

  it('a pick lands in the cache at once, so the next launch paints it', async () => {
    getCoachFace.mockResolvedValue({ ok: true, faceId: null });
    const client = mount();
    await waitFor(() => expect(getCoachFace).toHaveBeenCalled());
    screen.getByText('pick').click();
    await waitFor(() => expect(client.getQueryData(queryKeys.coachFace.all)).toEqual({ face_id: PICK }));
    expect(setCoachFace).toHaveBeenCalledWith(PICK);
  });
});
