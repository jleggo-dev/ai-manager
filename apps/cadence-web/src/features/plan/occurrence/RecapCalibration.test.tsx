/**
 * A23 §3 — the calibration block in the check-in. What these pin:
 *   • "not yet" is shown as PROGRESS, never as a closed door or a silent absence;
 *   • the number is labelled as being in this app's units, which is the sentence that makes it
 *     honest — it is maintenance measured against a ledger, not a laboratory;
 *   • nothing changes a target without a tap, and a guardrail that moved the number SAYS so.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ setMacroTargets: vi.fn(async () => ({ kcal: 2100 })) }));
vi.mock('../../../lib/api.ts', () => api);

const { RecapCalibration } = await import('./RecapCalibration.tsx');

type Cal = Parameters<typeof RecapCalibration>[0]['calibration'];

const cal = (over: Partial<Cal> = {}): Cal =>
  ({
    maintenance: {
      maintenance_kcal: 2550,
      mean_intake_kcal: 2000,
      kg_per_week: -0.5,
      complete_days: 24,
      window_days: 28,
      confidence: 'high',
    },
    blocker: null,
    complete_days: 24,
    complete_days_needed: 17,
    direction: 'lose',
    proposed: { kcal: 1800, limited_by: null },
    current_kcal: 2200,
    ...over,
  }) as Cal;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RecapCalibration', () => {
  it('says what maintenance is, and whose units it is in', async () => {
    render(<RecapCalibration calibration={cal()} />);
    expect(screen.getByText('~2550')).toBeInTheDocument();
    // The honesty clause: measured against this ledger, not a lab.
    expect(screen.getByText(/in the units this app counts/)).toBeInTheDocument();
    expect(screen.getByText(/from 24 logged days/)).toBeInTheDocument();
  });

  it('shows a not-yet as progress rather than a closed door', () => {
    render(
      <RecapCalibration
        calibration={cal({ maintenance: null, blocker: 'not_enough_logged_days', complete_days: 9, proposed: null })}
      />,
    );
    expect(screen.getByText(/need a few more logged days/)).toBeInTheDocument();
    expect(screen.getByText(/9 of 17 days so far/)).toBeInTheDocument();
  });

  it('renders nothing at all when there is nothing to say', () => {
    const { container } = render(
      <RecapCalibration calibration={cal({ maintenance: null, blocker: null, proposed: null })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('changes nothing without a tap', async () => {
    render(<RecapCalibration calibration={cal()} />);
    expect(api.setMacroTargets).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Use 1800 kcal/ }));
    await waitFor(() => expect(api.setMacroTargets).toHaveBeenCalledWith({ kcal: 1800 }));
    expect(await screen.findByText(/You can always change it in settings/)).toBeInTheDocument();
  });

  it('offers nothing when the suggestion matches what they already aim for', () => {
    render(<RecapCalibration calibration={cal({ proposed: { kcal: 2200, limited_by: null }, current_kcal: 2200 })} />);
    expect(screen.queryByRole('button', { name: /Use / })).not.toBeInTheDocument();
  });

  /** A guardrail that silently moved the number is a number nobody can question. */
  it('says when a guardrail held the number back', () => {
    render(<RecapCalibration calibration={cal({ proposed: { kcal: 2170, limited_by: 'maintenance_floor' } })} />);
    expect(screen.getByText(/going lower isn't worth it/i)).toBeInTheDocument();
  });

  it('says when we have already cut this month', () => {
    render(<RecapCalibration calibration={cal({ proposed: { kcal: 2200, limited_by: 'ratchet' } })} />);
    expect(screen.getByText(/rather talk than cut again/i)).toBeInTheDocument();
  });

  it('flags a thin estimate as still forming', () => {
    render(
      <RecapCalibration
        calibration={cal({
          maintenance: {
            maintenance_kcal: 2400,
            mean_intake_kcal: 2100,
            kg_per_week: -0.3,
            complete_days: 18,
            window_days: 28,
            confidence: 'low',
          },
        })}
      />,
    );
    expect(screen.getByText(/still forming/)).toBeInTheDocument();
  });
});
