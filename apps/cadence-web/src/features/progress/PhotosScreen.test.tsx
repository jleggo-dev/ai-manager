/**
 * SR-5 "All photos" — the Progress-side home for progress photos (opt-in, dated, weight-stamped,
 * never scored). Mocks lib/api.ts the house way (NotificationSettings.test.tsx) with a real
 * QueryClient, so "upload invalidates" is proven by a genuine refetch rather than a faked hook —
 * and `downscalePhoto` is mocked to a fixed data-URL since jsdom has no real canvas/Image.
 */
import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhotosRow, PhotosScreen } from './PhotosScreen.tsx';
import type { ProgressPhotoList } from '../../lib/api.ts';

const getProgressPhotos = vi.fn();
const postProgressPhoto = vi.fn();
const getProgressPhotoPair = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getProgressPhotos: (...a: unknown[]) => getProgressPhotos(...a),
  postProgressPhoto: (...a: unknown[]) => postProgressPhoto(...a),
  getProgressPhotoPair: (...a: unknown[]) => getProgressPhotoPair(...a),
  putProgressPhotosEnabled: vi.fn(),
}));

vi.mock('../plan/occurrence/format.ts', () => ({
  downscalePhoto: vi.fn(async () => 'data:image/jpeg;base64,AAA'),
}));

function list(over: Partial<ProgressPhotoList> = {}): ProgressPhotoList {
  return {
    enabled: true,
    count: 2,
    next_due: '2099-01-01', // far future — not due, by default
    photos: [
      { date: '2026-07-01', weight_kg: 82.3, url: 'https://example.com/p1.jpg' },
      { date: '2026-08-01', weight_kg: null, url: 'https://example.com/p2.jpg' },
    ],
    ...over,
  };
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PhotosScreen', () => {
  it('renders the grid oldest to newest, dated and weight-stamped', async () => {
    getProgressPhotos.mockResolvedValue(list());
    const { container } = renderWithClient(<PhotosScreen onBack={() => {}} />);

    expect(await screen.findByText('Jul 1 · 82.3 kg')).toBeInTheDocument();
    expect(container.querySelectorAll('.apg-cell')).toHaveLength(2);
    // Oldest first, same order the server sends — the screen never reorders.
    const dates = [...container.querySelectorAll('.apg-cell img')].map((img) => img.getAttribute('alt'));
    expect(dates).toEqual(['Progress photo, Jul 1', 'Progress photo, Aug 1']);
  });

  it('shows an absent weight as the date alone, never a zero', async () => {
    getProgressPhotos.mockResolvedValue(list());
    renderWithClient(<PhotosScreen onBack={() => {}} />);

    expect(await screen.findByText('Aug 1')).toBeInTheDocument();
    expect(screen.queryByText(/0(\.0)?\s*kg/)).not.toBeInTheDocument();
  });

  it('off shows the pointer line only — no grid, no due card', async () => {
    getProgressPhotos.mockResolvedValue(list({ enabled: false, count: 0, next_due: null, photos: [] }));
    const { container } = renderWithClient(<PhotosScreen onBack={() => {}} />);

    expect(await screen.findByText('Progress photos are off — turn them on in Settings.')).toBeInTheDocument();
    expect(container.querySelector('.apg-grid')).toBeNull();
    expect(container.querySelector('.apg-due')).toBeNull();
  });

  it('shows the due card, warm not nagging, when empty-but-on', async () => {
    getProgressPhotos.mockResolvedValue(list({ count: 0, next_due: null, photos: [] }));
    const { container } = renderWithClient(<PhotosScreen onBack={() => {}} />);

    expect(await screen.findByText('Time for this month’s photo')).toBeInTheDocument();
    expect(container.querySelector('.apg-grid')).toBeNull(); // the due card alone
  });

  it('shows the due card once next_due has arrived, alongside the existing grid', async () => {
    getProgressPhotos.mockResolvedValue(list({ next_due: '2020-01-01' }));
    renderWithClient(<PhotosScreen onBack={() => {}} />);

    expect(await screen.findByText('Time for this month’s photo')).toBeInTheDocument();
    expect(screen.getByText('Jul 1 · 82.3 kg')).toBeInTheDocument();
  });

  it('stays quiet when next_due is still in the future', async () => {
    getProgressPhotos.mockResolvedValue(list()); // next_due 2099
    renderWithClient(<PhotosScreen onBack={() => {}} />);

    await screen.findByText('Jul 1 · 82.3 kg');
    expect(screen.queryByText('Time for this month’s photo')).not.toBeInTheDocument();
  });

  it('uploads a picked photo as a data-URL and shows it without a full reload', async () => {
    getProgressPhotos.mockResolvedValueOnce(list({ count: 0, next_due: null, photos: [] })).mockResolvedValueOnce(
      list({
        count: 1,
        next_due: '2026-09-27',
        photos: [{ date: '2026-08-30', weight_kg: null, url: 'https://example.com/new.jpg' }],
      }),
    );
    postProgressPhoto.mockResolvedValue({ photo: { date: '2026-08-30', weight_kg: null }, next_due: '2026-09-27' });

    const { container } = renderWithClient(<PhotosScreen onBack={() => {}} />);
    await screen.findByText('Time for this month’s photo'); // empty-but-on: the invitation

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(postProgressPhoto).toHaveBeenCalledWith('data:image/jpeg;base64,AAA', undefined));
    // Invalidated → the query refetches on its own; the component never re-mounts to get there.
    await waitFor(() => expect(getProgressPhotos).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Aug 30')).toBeInTheDocument();
  });

  it('says so, without pretending, when an upload fails', async () => {
    getProgressPhotos.mockResolvedValue(list({ count: 0, next_due: null, photos: [] }));
    postProgressPhoto.mockResolvedValue(null);

    const { container } = renderWithClient(<PhotosScreen onBack={() => {}} />);
    await screen.findByText('Time for this month’s photo');

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] } });

    expect(await screen.findByText("That didn't save — give it another try.")).toBeInTheDocument();
  });
});

describe('PhotosRow', () => {
  it('shows the count from the pair read (no second fetch just for a headline number)', async () => {
    getProgressPhotoPair.mockResolvedValue({
      first: { date: '2026-07-01', weight_kg: 82.3, url: 'https://example.com/p1.jpg' },
      latest: null,
      next_due: '2026-08-01',
      count: 1,
    });
    renderWithClient(<PhotosRow onOpen={() => {}} />);

    expect(await screen.findByText('Your photos')).toBeInTheDocument();
    expect(await screen.findByText('1 photo')).toBeInTheDocument();
  });

  it('reads "none yet" for the omission shape — off and empty both say it honestly', async () => {
    getProgressPhotoPair.mockResolvedValue({ omission: { id: 'photo_pair', kind: 'photo_pair', reason: 'off' } });
    renderWithClient(<PhotosRow onOpen={() => {}} />);

    expect(await screen.findByText('none yet')).toBeInTheDocument();
  });

  it('opens the screen on click', async () => {
    getProgressPhotoPair.mockResolvedValue({ omission: { id: 'photo_pair', kind: 'photo_pair', reason: 'off' } });
    const onOpen = vi.fn();
    renderWithClient(<PhotosRow onOpen={onOpen} />);

    fireEvent.click(await screen.findByText('Your photos'));
    expect(onOpen).toHaveBeenCalled();
  });
});
