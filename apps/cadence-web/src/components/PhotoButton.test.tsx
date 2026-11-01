import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoButton } from './PhotoButton.tsx';

const photos = vi.hoisted(() => ({
  isAvailable: vi.fn(() => false),
  pick: vi.fn(async (_source: 'camera' | 'library'): Promise<File | null> => null),
}));
vi.mock('../lib/capability/index.ts', () => ({ capabilities: { photos } }));

const file = (name = 'plate.jpg') => new File(['x'], name, { type: 'image/jpeg' });
const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Add a photo' }));

beforeEach(() => {
  photos.isAvailable.mockReturnValue(false);
  photos.pick.mockReset().mockResolvedValue(null);
});

describe('PhotoButton', () => {
  it('shows only the camera until it is tapped', () => {
    render(<PhotoButton onPick={() => {}} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    openMenu();
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual([
      'Take a photo',
      'Choose from your photos',
    ]);
  });

  // On the phone each line opens its own source, and only that one.
  it.each([
    ['Take a photo', 'camera'],
    ['Choose from your photos', 'library'],
  ] as const)('native: "%s" opens the %s', async (line, source) => {
    photos.isAvailable.mockReturnValue(true);
    const f = file();
    photos.pick.mockResolvedValue(f);
    const onPick = vi.fn();
    render(<PhotoButton onPick={onPick} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: line }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith([f]));
    expect(photos.pick).toHaveBeenCalledTimes(1);
    expect(photos.pick).toHaveBeenCalledWith(source);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('native: backing out of the picker sends nothing', async () => {
    photos.isAvailable.mockReturnValue(true);
    const onPick = vi.fn();
    render(<PhotoButton onPick={onPick} />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Take a photo' }));
    await waitFor(() => expect(photos.pick).toHaveBeenCalled());
    expect(onPick).not.toHaveBeenCalled();
  });

  // In a browser the camera line must carry `capture` and the library line must NOT — without
  // that split both lines open the same system menu, which is the bug this button exists to fix.
  it.each([
    ['Take a photo', 'environment'],
    ['Choose from your photos', null],
  ] as const)('web: "%s" input capture=%s', (line, capture) => {
    render(<PhotoButton onPick={() => {}} />);
    openMenu();
    const input = screen.getByRole('menuitem', { name: line }).querySelector('input')!;
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.getAttribute('capture')).toBe(capture);
  });

  it('web: a picked file goes out and the menu closes', () => {
    const onPick = vi.fn();
    render(<PhotoButton multiple onPick={onPick} />);
    openMenu();
    const input = screen.getByRole('menuitem', { name: 'Choose from your photos' }).querySelector('input')!;
    expect(input.multiple).toBe(true);
    const f = file();
    fireEvent.change(input, { target: { files: [f] } });
    expect(onPick).toHaveBeenCalledWith([f]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('web: an empty pick sends nothing', () => {
    const onPick = vi.fn();
    render(<PhotoButton onPick={onPick} />);
    openMenu();
    const input = screen.getByRole('menuitem', { name: 'Take a photo' }).querySelector('input')!;
    fireEvent.change(input, { target: { files: [] } });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('closes when they tap elsewhere or press Escape', () => {
    render(<PhotoButton onPick={() => {}} />);
    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    openMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a disabled camera does not open', () => {
    render(<PhotoButton disabled onPick={() => {}} />);
    openMenu();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
