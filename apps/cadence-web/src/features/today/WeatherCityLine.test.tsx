/**
 * The sheet's city line: plain text while the device sets the place, CHANGE otherwise — and
 * CHANGE is a real flow, not a label (owner, 2026-09-08): type a city, Save runs the setter, a
 * failed save says so and keeps the field open.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WeatherCityLine } from './WeatherCityLine.tsx';

describe('WeatherCityLine', () => {
  it('is plain text with no setter at all', () => {
    render(<WeatherCityLine city="Montreal" />);
    expect(screen.getByText(/Montreal/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/CHANGE/)).toBeNull();
  });

  it('is plain text while the device sets the place', () => {
    render(<WeatherCityLine city="Montreal" setter={{ canChange: false, save: vi.fn() }} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/CHANGE/)).toBeNull();
  });

  it('offers CHANGE for a typed city, and names the gap when there is none', () => {
    const { rerender } = render(<WeatherCityLine city="Montreal" setter={{ canChange: true, save: vi.fn() }} />);
    expect(screen.getByRole('button', { name: /Montreal.*CHANGE/ })).toBeInTheDocument();
    rerender(<WeatherCityLine city={null} setter={{ canChange: true, save: vi.fn() }} />);
    expect(screen.getByRole('button', { name: /Set a city.*CHANGE/ })).toBeInTheDocument();
  });

  it('CHANGE opens the field; Save hands the typed city to the setter and closes it', async () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<WeatherCityLine city="Montreal" setter={{ canChange: true, save }} />);
    fireEvent.click(screen.getByRole('button', { name: /CHANGE/ }));
    const field = screen.getByLabelText('City');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'Quebec City' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('Quebec City');
    await waitFor(() => expect(screen.queryByLabelText('City')).toBeNull());
    expect(screen.getByRole('button', { name: /CHANGE/ })).toBeInTheDocument();
  });

  it('Enter saves too', () => {
    const save = vi.fn().mockResolvedValue(true);
    render(<WeatherCityLine city={null} setter={{ canChange: true, save }} />);
    fireEvent.click(screen.getByRole('button', { name: /CHANGE/ }));
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Ottawa' } });
    fireEvent.keyDown(screen.getByLabelText('City'), { key: 'Enter' });
    expect(save).toHaveBeenCalledWith('Ottawa');
  });

  it('a failed save says so and keeps the field open', async () => {
    const save = vi.fn().mockResolvedValue(false);
    render(<WeatherCityLine city="Montreal" setter={{ canChange: true, save }} />);
    fireEvent.click(screen.getByRole('button', { name: /CHANGE/ }));
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Nowhere' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Couldn't find that city/);
    expect(screen.getByLabelText('City')).toBeInTheDocument();
  });

  it('Cancel closes the field without saving', () => {
    const save = vi.fn();
    render(<WeatherCityLine city="Montreal" setter={{ canChange: true, save }} />);
    fireEvent.click(screen.getByRole('button', { name: /CHANGE/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('City')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
