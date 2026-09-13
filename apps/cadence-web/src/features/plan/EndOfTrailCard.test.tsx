/**
 * The end of the trail (check-in rebuild, step 6) — the owner's own hard requirement from review:
 * a bug in the rich card must degrade to a plain button, never to a blank week. These tests pin
 * that literally: `EndOfTrailBoundary` (what `EndOfTrail` wraps Layer 2 in) must fall back to
 * Layer 1's plain content on a render failure, not disappear.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EndOfTrail, EndOfTrailBoundary, EndOfTrailCard, EndOfTrailFallback } from './EndOfTrailCard.tsx';

const buildNextWeek = vi.fn();
const buildWeekAhead = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  buildNextWeek: (...a: unknown[]) => buildNextWeek(...a),
  buildWeekAhead: (...a: unknown[]) => buildWeekAhead(...a),
}));

/** Throws on every render — stands in for whatever real failure the rich card could have. */
function ThrowingChild(): never {
  throw new Error('boom');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EndOfTrailCard (Layer 2 — the rich card)', () => {
  it('renders the mockup copy verbatim, version interpolated', () => {
    render(<EndOfTrailCard version={5} onStartCheckIn={vi.fn()} onJustBuild={vi.fn()} busy={false} error={null} />);
    expect(screen.getByText('Week 5 wraps up today')).toBeTruthy();
    expect(screen.getByText(/tailor next week and ensure a smooth progression/)).toBeTruthy();
    expect(screen.getByText('Start check-in')).toBeTruthy();
    expect(screen.getByText('Just build my week')).toBeTruthy();
  });

  it('degrades the title gracefully when there is no version', () => {
    render(<EndOfTrailCard onStartCheckIn={vi.fn()} onJustBuild={vi.fn()} busy={false} error={null} />);
    expect(screen.getByText('Your week wraps up today')).toBeTruthy();
  });

  it('calls the right handler for each button', () => {
    const onStartCheckIn = vi.fn();
    const onJustBuild = vi.fn();
    render(
      <EndOfTrailCard
        version={1}
        onStartCheckIn={onStartCheckIn}
        onJustBuild={onJustBuild}
        busy={false}
        error={null}
      />,
    );
    screen.getByText('Start check-in').click();
    expect(onStartCheckIn).toHaveBeenCalledTimes(1);
    screen.getByText('Just build my week').click();
    expect(onJustBuild).toHaveBeenCalledTimes(1);
  });

  it('shows the error line and a busy label without hiding the card', () => {
    render(
      <EndOfTrailCard
        version={1}
        onStartCheckIn={vi.fn()}
        onJustBuild={vi.fn()}
        busy={true}
        error="Couldn't build your next week just now — try again in a moment."
      />,
    );
    expect(screen.getByText(/Couldn't build your next week/)).toBeTruthy();
    expect(screen.getByText('Building…')).toBeTruthy();
  });
});

/**
 * `endsOn` is `weekState.ends_on` (plan-view.ts). Nobody wires it up yet (PlanView.tsx passes only
 * `version`), so today every card still reads exactly as before — these tests exercise the prop
 * directly, the same way the rest of this file exercises `EndOfTrailCard` in isolation from its
 * caller. "Week 5 wraps up today" stops being true the moment the visit isn't the same day the
 * trail's edge was reached; two-plus days gets the past tense instead of a wrong claim about "today".
 */
describe('EndOfTrailCard — copy once the visit is no longer "today"', () => {
  const NOW = '2026-08-26T12:00:00.000Z';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the present tense the day the week actually ends', () => {
    render(
      <EndOfTrailCard
        version={5}
        endsOn="2026-08-26"
        onStartCheckIn={vi.fn()}
        onJustBuild={vi.fn()}
        busy={false}
        error={null}
      />,
    );
    expect(screen.getByText('Week 5 wraps up today')).toBeTruthy();
  });

  it('keeps the present tense one day late — not "very" late yet', () => {
    render(
      <EndOfTrailCard
        version={5}
        endsOn="2026-08-25"
        onStartCheckIn={vi.fn()}
        onJustBuild={vi.fn()}
        busy={false}
        error={null}
      />,
    );
    expect(screen.getByText('Week 5 wraps up today')).toBeTruthy();
  });

  it('switches to the past tense two or more days after the week ended', () => {
    render(
      <EndOfTrailCard
        version={5}
        endsOn="2026-08-16"
        onStartCheckIn={vi.fn()}
        onJustBuild={vi.fn()}
        busy={false}
        error={null}
      />,
    );
    expect(screen.getByText('Week 5 wrapped up')).toBeTruthy();
    expect(screen.queryByText(/wraps up today/)).toBeNull();
  });

  it('leaves the body copy alone when the title goes past tense', () => {
    render(
      <EndOfTrailCard
        version={5}
        endsOn="2026-08-16"
        onStartCheckIn={vi.fn()}
        onJustBuild={vi.fn()}
        busy={false}
        error={null}
      />,
    );
    expect(screen.getByText(/tailor next week and ensure a smooth progression/)).toBeTruthy();
  });

  it('applies the same past-tense switch to the no-version fallback title', () => {
    render(
      <EndOfTrailCard endsOn="2026-08-16" onStartCheckIn={vi.fn()} onJustBuild={vi.fn()} busy={false} error={null} />,
    );
    expect(screen.getByText('Your week wrapped up')).toBeTruthy();
  });

  it('defaults to present tense when no endsOn is supplied at all', () => {
    render(<EndOfTrailCard version={5} onStartCheckIn={vi.fn()} onJustBuild={vi.fn()} busy={false} error={null} />);
    expect(screen.getByText('Week 5 wraps up today')).toBeTruthy();
  });

  it('EndOfTrail threads endsOn down to the rich card', () => {
    render(<EndOfTrail show={true} version={3} endsOn="2026-08-16" onStartCheckIn={vi.fn()} onBuilt={vi.fn()} />);
    expect(screen.getByText('Week 3 wrapped up')).toBeTruthy();
  });
});

describe('EndOfTrailFallback (Layer 1 — hard to break)', () => {
  it('renders plain text and two controls, and calls the right handler for each', () => {
    const onStartCheckIn = vi.fn();
    const onJustBuild = vi.fn();
    render(<EndOfTrailFallback onStartCheckIn={onStartCheckIn} onJustBuild={onJustBuild} busy={false} />);

    screen.getByText('Start check-in').click();
    expect(onStartCheckIn).toHaveBeenCalledTimes(1);
    screen.getByText('Just build my week').click();
    expect(onJustBuild).toHaveBeenCalledTimes(1);
  });
});

describe('EndOfTrailBoundary (the hard requirement: Layer 2 failure leaves Layer 1 standing)', () => {
  it('falls back to Layer 1 when the wrapped content throws', () => {
    // React logs the caught error to the console — expected noise for this one test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <EndOfTrailBoundary fallback={<EndOfTrailFallback onStartCheckIn={vi.fn()} onJustBuild={vi.fn()} busy={false} />}>
        <ThrowingChild />
      </EndOfTrailBoundary>,
    );
    expect(screen.getByText('Start check-in')).toBeTruthy();
    expect(screen.getByText('Just build my week')).toBeTruthy();
    spy.mockRestore();
  });

  it('renders the wrapped content untouched when nothing fails', () => {
    render(
      <EndOfTrailBoundary fallback={<div>never shown</div>}>
        <div>the real content</div>
      </EndOfTrailBoundary>,
    );
    expect(screen.getByText('the real content')).toBeTruthy();
    expect(screen.queryByText('never shown')).toBeNull();
  });
});

describe('EndOfTrail (what PlanView renders)', () => {
  it('renders nothing when show is false', () => {
    const { container } = render(<EndOfTrail show={false} version={3} onStartCheckIn={vi.fn()} onBuilt={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the rich card by default when show is true', () => {
    render(<EndOfTrail show={true} version={3} onStartCheckIn={vi.fn()} onBuilt={vi.fn()} />);
    expect(screen.getByText('Week 3 wraps up today')).toBeTruthy();
  });

  it('"Start check-in" calls the caller-supplied bridge directly — no fetch of its own', () => {
    const onStartCheckIn = vi.fn();
    render(<EndOfTrail show={true} onStartCheckIn={onStartCheckIn} onBuilt={vi.fn()} />);
    screen.getByText('Start check-in').click();
    expect(onStartCheckIn).toHaveBeenCalledTimes(1);
    expect(buildNextWeek).not.toHaveBeenCalled();
  });

  it('"Just build my week" calls the API and notifies the caller on success', async () => {
    buildNextWeek.mockResolvedValue({ status: 'committed', version: 4 });
    const onBuilt = vi.fn();
    render(<EndOfTrail show={true} onStartCheckIn={vi.fn()} onBuilt={onBuilt} />);

    screen.getByText('Just build my week').click();

    await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
    expect(buildNextWeek).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error and leaves the card standing when the build call fails', async () => {
    buildNextWeek.mockResolvedValue({ status: 'not_due' });
    const onBuilt = vi.fn();
    render(<EndOfTrail show={true} version={3} onStartCheckIn={vi.fn()} onBuilt={onBuilt} />);

    screen.getByText('Just build my week').click();

    await screen.findByText(/Couldn't build your next week/);
    expect(onBuilt).not.toHaveBeenCalled();
    // The card is still there, not swapped for the fallback — a declined build is not a render failure.
    expect(screen.getByText('Week 3 wraps up today')).toBeTruthy();
  });
});

/**
 * The mid-week wall (owner, 2026-09-09): the same card, before the check-in is due, with the
 * week's end named and a build that writes NEXT week without moving the check-in. What the copy
 * must never do is claim the week wraps up "today" when it does not; what the build must do is
 * call the build-ahead route (never the roll-forward, which would end the week) and treat
 * `built` and `already_built` as landed.
 */
describe('EndOfTrail — the mid-week wall (mode "ahead")', () => {
  const NOW = '2026-08-26T12:00:00.000Z'; // a Wednesday

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the day the week wraps, says the check-in stays put, and offers both exits', () => {
    render(
      <EndOfTrailCard
        version={5}
        endsOn="2026-08-30"
        mode="ahead"
        onStartCheckIn={vi.fn()}
        onJustBuild={vi.fn()}
        busy={false}
        error={null}
      />,
    );
    expect(screen.getByText('Week 5 wraps up on Sunday')).toBeTruthy();
    expect(screen.getByText(/your check-in stays where it is/)).toBeTruthy();
    expect(screen.getByText('Start check-in')).toBeTruthy();
    expect(screen.getByText('Build next week')).toBeTruthy();
    expect(screen.queryByText('Just build my week')).toBeNull();
  });

  it('never claims "today" mid-week — an unreadable end date reads as "soon"', () => {
    render(
      <EndOfTrailCard
        version={5}
        mode="ahead"
        onStartCheckIn={vi.fn()}
        onJustBuild={vi.fn()}
        busy={false}
        error={null}
      />,
    );
    expect(screen.getByText('Week 5 wraps up soon')).toBeTruthy();
  });

  it('the fallback carries the same build label', () => {
    render(<EndOfTrailFallback mode="ahead" onStartCheckIn={vi.fn()} onJustBuild={vi.fn()} busy={false} />);
    expect(screen.getByText('Build next week')).toBeTruthy();
  });

  it('builds ahead — never the roll-forward — and treats "built" as landed', async () => {
    buildWeekAhead.mockResolvedValue({ status: 'built', builtThrough: '2026-09-06' });
    const onBuilt = vi.fn();
    render(<EndOfTrail show={true} mode="ahead" endsOn="2026-08-30" onStartCheckIn={vi.fn()} onBuilt={onBuilt} />);

    screen.getByText('Build next week').click();

    await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
    expect(buildWeekAhead).toHaveBeenCalledTimes(1);
    expect(buildNextWeek).not.toHaveBeenCalled();
  });

  it('"already_built" is landed too', async () => {
    buildWeekAhead.mockResolvedValue({ status: 'already_built', builtThrough: '2026-09-06' });
    const onBuilt = vi.fn();
    render(<EndOfTrail show={true} mode="ahead" endsOn="2026-08-30" onStartCheckIn={vi.fn()} onBuilt={onBuilt} />);

    screen.getByText('Build next week').click();

    await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
  });

  it('a declined build shows the line and leaves the card standing', async () => {
    buildWeekAhead.mockResolvedValue({ status: 'due' });
    const onBuilt = vi.fn();
    render(<EndOfTrail show={true} mode="ahead" endsOn="2026-08-30" onStartCheckIn={vi.fn()} onBuilt={onBuilt} />);

    screen.getByText('Build next week').click();

    await screen.findByText(/Couldn't build your next week/);
    expect(onBuilt).not.toHaveBeenCalled();
    expect(screen.getByText('Start check-in')).toBeTruthy();
  });

  it('the due card still rolls forward through the trust path, never the build-ahead', async () => {
    buildNextWeek.mockResolvedValue({ status: 'committed', version: 6 });
    const onBuilt = vi.fn();
    render(<EndOfTrail show={true} mode="due" onStartCheckIn={vi.fn()} onBuilt={onBuilt} />);

    screen.getByText('Just build my week').click();

    await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
    expect(buildWeekAhead).not.toHaveBeenCalled();
  });
});
