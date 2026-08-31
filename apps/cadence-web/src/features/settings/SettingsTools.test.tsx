import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  getReview: vi.fn(),
  addEquipment: vi.fn(),
  deleteEquipmentItem: vi.fn(async () => undefined),
  sendGymPhotos: vi.fn(),
}));
vi.mock('../../lib/api.ts', () => api);
vi.mock('../plan/occurrence/format.ts', () => ({
  downscalePhoto: vi.fn(async () => 'data:image/jpeg;base64,fake'),
}));

const { SettingsTools } = await import('./SettingsTools.tsx');

const equip = (over: Record<string, unknown> = {}) => ({
  equipment_id: 'eq1',
  name: 'Kettlebell',
  category: 'strength',
  owned: true,
  recommended_by: null,
  linked_goal_ids: [],
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsTools', () => {
  it('removes a chip by calling deleteEquipmentItem', async () => {
    api.getReview.mockResolvedValueOnce({ equipment: [equip()] });
    render(<SettingsTools onBack={() => {}} />);

    expect(await screen.findByText('Kettlebell')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove Kettlebell'));

    await waitFor(() => expect(api.deleteEquipmentItem).toHaveBeenCalledWith('eq1'));
    expect(screen.queryByText('Kettlebell')).not.toBeInTheDocument();
  });

  it('adds a chip with the neutral "other" category — the server requires one but the user never picks it', async () => {
    api.getReview.mockResolvedValueOnce({ equipment: [] });
    api.addEquipment.mockResolvedValueOnce(equip({ equipment_id: 'eq2', name: 'the park pull-up bar' }));
    render(<SettingsTools onBack={() => {}} />);

    await screen.findByPlaceholderText('e.g. "kettlebell"');
    fireEvent.change(screen.getByPlaceholderText('e.g. "kettlebell"'), {
      target: { value: 'the park pull-up bar' },
    });
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() =>
      expect(api.addEquipment).toHaveBeenCalledWith({ name: 'the park pull-up bar', category: 'other' }),
    );
    expect(await screen.findByText('the park pull-up bar')).toBeInTheDocument();
  });

  it('calls onBack from the header', async () => {
    api.getReview.mockResolvedValueOnce({ equipment: [] });
    const onBack = vi.fn();
    render(<SettingsTools onBack={onBack} />);
    fireEvent.click(await screen.findByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });

  it("outside a detour, the gym photo card says so honestly instead of blaming the photo", async () => {
    api.getReview.mockResolvedValueOnce({ equipment: [] });
    api.sendGymPhotos.mockResolvedValueOnce({ ok: false });
    render(<SettingsTools onBack={() => {}} />);

    const file = new File(['x'], 'gym.jpg', { type: 'image/jpeg' });
    const input = (await screen.findByText('📷 Take a photo')).parentElement!.querySelector('input')!;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/reworking a detour week/)).toBeInTheDocument();
  });
});
